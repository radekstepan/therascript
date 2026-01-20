# Architecture Review Report: Therascript

**Date:** January 19, 2026  
**Scope:** Single-tenant locally-running therapy transcription and AI analysis system  
**Severity Levels:** 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low

---

## Executive Summary

Therascript is a well-structured monorepo with clear separation between packages. However, several architectural anti-patterns and potential bugs need attention. The most significant issues are:

1. **Cross-package coupling** via `@therascript/api/dist/*` imports in worker
2. **Multiple conflicting signal handlers** across packages
3. **SQLite statement cache not cleared on close** (memory leak/stale reference bug)
4. **Missing request cancellation/abort plumbing** for long-running operations
5. **Duplicated Ollama streaming implementation** in worker vs API

---

## Table of Contents

1. [Critical Issues](#1-critical-issues)
2. [High Priority Issues](#2-high-priority-issues)
3. [Medium Priority Issues](#3-medium-priority-issues)
4. [Low Priority Issues](#4-low-priority-issues)
5. [Recommendations Summary](#5-recommendations-summary)

---

## 1. Critical Issues

### 1.1 🔴 SQLite Statement Cache Not Cleared on Close

**Location:** [`packages/db/src/sqliteService.ts:491-505`](file:///Users/radek/dev/therascript/packages/db/src/sqliteService.ts#L491-L505)

**Problem:** The `statementCache` Map persists across database closes. When `closeDb()` is called, it sets `dbInstance = null` but does **not** clear the statement cache. If the database is reopened (different path or reconnect scenario), cached statements reference the old, closed connection.

```typescript
const statementCache = new Map<string, DbStatement>();  // Never cleared

export function closeDb(): void {
  if (dbInstance && dbInstance.open) {
    dbInstance.close();
    dbInstance = null;  // Statement cache still holds stale references!
  }
}
```

**Impact:** 
- Stale prepared statements bound to closed connection
- Potential crashes or undefined behavior on reconnect
- Memory leak (unbounded cache growth)

**Fix:**
```typescript
export function closeDb(): void {
  if (dbInstance && dbInstance.open) {
    dbInstance.close();
    dbInstance = null;
    statementCache.clear();  // ADD THIS LINE
  }
}
```

---

### 1.2 🔴 Worker Imports from API Compiled Output

**Location:** [`packages/worker/src/jobs/transcriptionProcessor.ts:4-16`](file:///Users/radek/dev/therascript/packages/worker/src/jobs/transcriptionProcessor.ts#L4-L16), [`packages/worker/src/jobs/analysisProcessor.ts:4-13`](file:///Users/radek/dev/therascript/packages/worker/src/jobs/analysisProcessor.ts#L4-L13)

**Problem:** Worker package directly imports from `@therascript/api/dist/*`:

```typescript
import { sessionRepository } from '@therascript/api/dist/repositories/sessionRepository.js';
import { transcriptRepository } from '@therascript/api/dist/repositories/transcriptRepository.js';
import { calculateTokenCount } from '@therascript/api/dist/services/tokenizerService.js';
```

**Impact:**
- Worker depends on API's build artifacts existing
- Breaks if API build output layout changes
- Imports internal implementation details, not stable APIs
- Makes local dev workflows fragile (watch mode, ts-node)
- Hides potential circular dependencies

**Recommended Fix:** Create shared packages:
- `@therascript/data` - repositories (session, transcript, message, chat, analysis, usage)
- `@therascript/domain` - shared types
- `@therascript/services` - shared services (tokenizer, file service, Ollama client)

---

### 1.3 🔴 Missing HTTP Status Check in Analysis Processor Streaming

**Location:** [`packages/worker/src/jobs/analysisProcessor.ts:28-42`](file:///Users/radek/dev/therascript/packages/worker/src/jobs/analysisProcessor.ts#L28-L42)

**Problem:** The `streamChatTokens` function doesn't check if the HTTP response was successful:

```typescript
async function* streamChatTokens(...): AsyncGenerator<string> {
  const response = await fetch(`${config.services.ollamaBaseUrl}/api/chat`, {...});
  // MISSING: if (!response.ok) throw new Error(...)
  if (!response.body) throw new Error('No response body from Ollama');
  // Proceeds to read body even if status is 4xx/5xx
}
```

**Impact:**
- Silent failures when Ollama returns errors (model not found, overloaded, etc.)
- Corrupted job state from processing error response as tokens
- Difficult to debug LLM issues

**Fix:**
```typescript
if (!response.ok) {
  const errorText = await response.text();
  throw new Error(`Ollama request failed (${response.status}): ${errorText}`);
}
```

---

## 2. High Priority Issues

### 2.1 🟠 Multiple Conflicting Signal Handlers

**Locations:**
- [`packages/api/src/server.ts:459-460`](file:///Users/radek/dev/therascript/packages/api/src/server.ts#L459-L460)
- [`packages/worker/src/index.ts:93-94`](file:///Users/radek/dev/therascript/packages/worker/src/index.ts#L93-L94)
- [`packages/db/src/sqliteService.ts:528-541`](file:///Users/radek/dev/therascript/packages/db/src/sqliteService.ts#L528-L541)
- [`packages/api/src/services/jobQueueService.ts:100-101`](file:///Users/radek/dev/therascript/packages/api/src/services/jobQueueService.ts#L100-L101)

**Problem:** Multiple packages register their own `process.on('SIGINT/SIGTERM')` handlers and call `process.exit()`:

```typescript
// In sqliteService.ts - A library should NOT do this
process.on('exit', closeDb);
process.on('SIGHUP', () => process.exit(128 + 1));
process.on('SIGINT', () => process.exit(128 + 2));
process.on('uncaughtException', (err) => { closeDb(); process.exit(1); });

// In jobQueueService.ts - Also registers handlers
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```

**Impact:**
- Shutdown ordering is undefined (library may exit before entrypoint cleanup)
- Different exit codes from different handlers
- Shutdown races and double-close errors
- Hard to test and reason about

**Recommended Fix:**
1. Remove all signal handlers from library packages (db, jobQueueService, etc.)
2. Packages should only export `close()` functions
3. Only entrypoints (server.ts, worker/index.ts) should register signal handlers
4. Entrypoints call close functions in defined order

---

### 2.2 🟠 Duplicate Ollama Streaming Implementations

**Locations:**
- [`packages/worker/src/jobs/analysisProcessor.ts:23-79`](file:///Users/radek/dev/therascript/packages/worker/src/jobs/analysisProcessor.ts#L23-L79) - Custom `fetch`-based implementation
- [`packages/api/src/services/ollamaService.real.ts:928-1077`](file:///Users/radek/dev/therascript/packages/api/src/services/ollamaService.real.ts#L928-L1077) - Uses `ollama` library

**Problem:** Two completely different streaming implementations:

| Aspect | API (ollamaService.real.ts) | Worker (analysisProcessor.ts) |
|--------|---------------------------|------------------------------|
| Client | `ollama` npm package | Raw `fetch` |
| Status check | Via library | ❌ Missing |
| Timeout | Via library defaults | ❌ None |
| Abort support | ❌ No | ❌ No |
| Stop tokens | ✅ Configured | ❌ None |
| Error handling | Structured ApiErrors | Basic Error throws |

**Impact:**
- Semantic drift between API and worker behavior
- Different error handling and token accounting
- Bug fixes need to be applied twice
- Worker streaming lacks critical safeguards

**Recommended Fix:** Extract a shared Ollama streaming adapter with:
- `AbortSignal` support
- Status code checking
- Configurable timeout
- Unified token accounting
- Stop token configuration

---

### 2.3 🟠 Missing Abort/Cancellation Plumbing

**Problem:** Long-running LLM operations cannot be cancelled when:
- SSE client disconnects
- Analysis job is cancelled
- Request times out

**UI has abort support:**
```typescript
// packages/ui/src/hooks/useMessageStream.ts:50-51
const streamControllerRef = useRef<AbortController | null>(null);
streamControllerRef.current = new AbortController();
```

**But backend doesn't propagate it:**
- [`sessionChatHandler.ts`](file:///Users/radek/dev/therascript/packages/api/src/api/sessionChatHandler.ts) - No abort signal to Ollama
- [`analysisProcessor.ts`](file:///Users/radek/dev/therascript/packages/worker/src/jobs/analysisProcessor.ts) - No timeout or abort on fetch

**Impact:**
- Wasted GPU/LLM resources on abandoned requests
- Analysis jobs continue even after cancellation flag is set
- SSE stream errors don't stop Ollama consumption

**Recommended Fix:**
1. Add `AbortController` to API chat handlers
2. Pass `AbortSignal` through to `streamChatResponse`
3. Worker streaming should accept abort signal and timeout
4. Check cancellation flag more frequently in analysis loop

---

### 2.4 🟠 Elasticsearch Client Never Closes

**Location:** [`packages/elasticsearch-client/src/client.ts`](file:///Users/radek/dev/therascript/packages/elasticsearch-client/src/client.ts)

**Problem:** The ES client singleton is created but never closed:

```typescript
let esClientInstance: Client | null = null;

export const getElasticsearchClient = (nodeUrl: string): Client => {
  if (!esClientInstance) {
    esClientInstance = new Client({ node: nodeUrl, ... });
  }
  return esClientInstance;
};
// No closeElasticsearchClient() function exists
```

**Impact:**
- On shutdown, ES client may have pending operations
- Node.js process may hang waiting for connections to close
- No way to flush pending bulk operations

**Fix:** Add close function and call from entrypoint shutdown:
```typescript
export const closeElasticsearchClient = async (): Promise<void> => {
  if (esClientInstance) {
    await esClientInstance.close();
    esClientInstance = null;
  }
};
```

---

## 3. Medium Priority Issues

### 3.1 🟡 Configuration Duplication

**Locations:**
- [`packages/api/src/config/index.ts`](file:///Users/radek/dev/therascript/packages/api/src/config/index.ts)
- [`packages/worker/src/config/index.ts`](file:///Users/radek/dev/therascript/packages/worker/src/config/index.ts)

**Problem:** Both packages have separate config modules with overlapping keys and different defaults:

| Config Key | API Default | Worker Default |
|-----------|-------------|----------------|
| `DB_PATH` | `./data/therapy-analyzer.sqlite` | `../api/data/therapy-analyzer-dev.sqlite` |
| Path resolution | Relative to API package | Relative to worker package |

**Impact:**
- Risk of API and worker using different databases in development
- Duplicated env var parsing logic
- Easy to add new config to one but forget the other

**Recommended Fix:** Create `@therascript/config` shared package with unified configuration.

---

### 3.2 🟡 BullMQ Rate Limiter May Be Unnecessary

**Location:** [`packages/worker/src/index.ts:34-37`](file:///Users/radek/dev/therascript/packages/worker/src/index.ts#L34-L37)

```typescript
const transcriptionWorker = new Worker(transcriptionQueueName, transcriptionProcessor, {
  connection: redisConnection,
  concurrency: 1,  // Good - one at a time for GPU
  limiter: {
    max: 1,
    duration: 5000,  // Adds 5-second delay between jobs
  },
});
```

**Problem:** The limiter adds artificial 5-second delays between transcription jobs even when GPU is idle.

**Impact:**
- Unnecessary queue latency for back-to-back uploads
- Doesn't address actual bottleneck (Whisper processing time)

**Recommendation:** 
- Start with only `concurrency: 1` (sufficient for GPU safety)
- Remove limiter unless there's a specific proven need (Whisper rate-limiting, GPU thrashing)
- If needed, make duration configurable via environment variable

---

### 3.3 🟡 Missing Timeout on Whisper Polling

**Location:** [`packages/worker/src/jobs/transcriptionProcessor.ts:53-69`](file:///Users/radek/dev/therascript/packages/worker/src/jobs/transcriptionProcessor.ts#L53-L69)

```typescript
async function pollWhisperStatus(whisperJobId: string): Promise<WhisperJobStatus> {
  while (true) {  // Infinite loop!
    const { data: status } = await axios.get<WhisperJobStatus>(...);
    if (status.status === 'completed' || status.status === 'failed' || status.status === 'canceled') {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
```

**Problem:** No maximum polling duration - loop runs forever if Whisper never completes.

**Impact:**
- Job can hang indefinitely
- Worker slot blocked forever
- No user feedback on stuck jobs

**Fix:**
```typescript
async function pollWhisperStatus(whisperJobId: string, maxWaitMs = 30 * 60 * 1000): Promise<WhisperJobStatus> {
  const startTime = Date.now();
  while (true) {
    if (Date.now() - startTime > maxWaitMs) {
      throw new Error(`Whisper job ${whisperJobId} timed out after ${maxWaitMs}ms`);
    }
    // ... existing logic
  }
}
```

---

### 3.4 🟡 Elasticsearch Client Ignores URL Changes

**Location:** [`packages/elasticsearch-client/src/client.ts:5-25`](file:///Users/radek/dev/therascript/packages/elasticsearch-client/src/client.ts#L5-L25)

```typescript
export const getElasticsearchClient = (nodeUrl: string): Client => {
  if (!esClientInstance) {
    esClientInstance = new Client({ node: nodeUrl, ... });
  }
  return esClientInstance;  // Returns cached client even if nodeUrl is different
};
```

**Problem:** Subsequent calls with a different URL silently return the first client.

**Impact (single-tenant):** Minimal in production, but can cause confusing behavior in tests or if multiple configurations are attempted.

**Fix:**
```typescript
let initializedNodeUrl: string | null = null;

export const getElasticsearchClient = (nodeUrl: string): Client => {
  if (!esClientInstance) {
    esClientInstance = new Client({ node: nodeUrl, ... });
    initializedNodeUrl = nodeUrl;
  } else if (initializedNodeUrl !== nodeUrl) {
    throw new Error(`ES client already initialized with ${initializedNodeUrl}, cannot reinitialize with ${nodeUrl}`);
  }
  return esClientInstance;
};
```

---

### 3.5 🟡 Type Safety Gaps

**Locations:** Various

**Problems:**
1. `ElysiaHandlerContext` uses `body: any` ([sessionChatHandler.ts:52](file:///Users/radek/dev/therascript/packages/api/src/api/sessionChatHandler.ts#L52))
2. SQLite rows returned as `any` and cast without validation
3. Worker imports API types from compiled output (version mismatch risk)

**Impact:**
- Runtime type mismatches not caught at compile time
- Potential undefined field access crashes

**Recommendation:**
- Define shared types in `@therascript/domain`
- Add lightweight runtime validation for critical boundaries (job payloads, API request bodies)
- Use Zod or similar for request body validation in Elysia

---

## 4. Low Priority Issues

### 4.1 🟢 Redis Connection Duplication

**Locations:**
- [`packages/api/src/services/redisConnection.ts`](file:///Users/radek/dev/therascript/packages/api/src/services/redisConnection.ts)
- [`packages/worker/src/redisConnection.ts`](file:///Users/radek/dev/therascript/packages/worker/src/redisConnection.ts)

**Problem:** Both packages define their own Redis connection configuration.

**Recommendation:** Extract to `@therascript/queue` package with connection config and queue names.

---

### 4.2 🟢 Verbose Console Logging

**Problem:** Extensive `console.log` throughout codebase. For a local single-tenant app this is acceptable, but makes log output noisy.

**Recommendation:** Consider a structured logger (pino, winston) with log levels if the application grows.

---

### 4.3 🟢 Missing Analysis Processor Timeout

**Location:** [`packages/worker/src/jobs/analysisProcessor.ts`](file:///Users/radek/dev/therascript/packages/worker/src/jobs/analysisProcessor.ts)

**Problem:** No overall timeout for analysis jobs. A job analyzing many sessions could run for hours.

**Recommendation:** Add configurable job-level timeout (e.g., 30 minutes) and BullMQ job options.

---

## 5. Recommendations Summary

### Immediate Fixes (1-2 hours)

| Issue | Priority | Effort | File |
|-------|----------|--------|------|
| Clear statement cache on DB close | 🔴 Critical | 5 min | `sqliteService.ts` |
| Add HTTP status check in analysis streaming | 🔴 Critical | 10 min | `analysisProcessor.ts` |
| Add Whisper polling timeout | 🟡 Medium | 15 min | `transcriptionProcessor.ts` |
| Add ES client close function | 🟠 High | 20 min | `client.ts` + entrypoints |

### Short-term Refactors (1-2 days)

| Issue | Priority | Effort |
|-------|----------|--------|
| Remove signal handlers from library packages | 🟠 High | 2-4 hours |
| Centralize shutdown in entrypoints | 🟠 High | 2-4 hours |
| Create shared Ollama streaming adapter | 🟠 High | 4-6 hours |

### Medium-term Refactors (1 week)

| Issue | Priority | Effort |
|-------|----------|--------|
| Extract shared packages (@therascript/data, @therascript/domain) | 🔴 Critical | 2-3 days |
| Unify configuration in @therascript/config | 🟡 Medium | 1 day |
| Add abort/cancellation plumbing | 🟠 High | 1-2 days |

---

## Appendix: Affected Files Summary

| Package | Files with Issues |
|---------|-------------------|
| `packages/db` | `sqliteService.ts` |
| `packages/api` | `server.ts`, `jobQueueService.ts`, config |
| `packages/worker` | `index.ts`, `analysisProcessor.ts`, `transcriptionProcessor.ts`, config |
| `packages/elasticsearch-client` | `client.ts` |

---

*Report generated by architecture review on January 19, 2026*
