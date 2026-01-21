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

## 3. Medium Priority Issues

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
