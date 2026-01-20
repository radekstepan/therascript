# Refactoring Plan: Worker Imports from API Compiled Output

## Problem Statement

The `packages/worker` package directly imports from `@therascript/api/dist/*`, creating a fragile dependency on the API's build artifacts:

```typescript
// transcriptionProcessor.ts
import { sessionRepository } from '@therascript/api/dist/repositories/sessionRepository.js';
import { transcriptRepository } from '@therascript/api/dist/repositories/transcriptRepository.js';
import { messageRepository } from '@therascript/api/dist/repositories/messageRepository.js';
import { chatRepository } from '@therascript/api/dist/repositories/chatRepository.js';
import { usageRepository } from '@therascript/api/dist/repositories/usageRepository.js';
import { calculateTokenCount } from '@therascript/api/dist/services/tokenizerService.js';
import { getAudioAbsolutePath } from '@therascript/api/dist/services/fileService.js';
import type { StructuredTranscript, WhisperJobStatus, WhisperSegment, TranscriptParagraphData } from '@therascript/api/dist/types/index.js';

// analysisProcessor.ts
import { analysisRepository } from '@therascript/api/dist/repositories/analysisRepository.js';
import type { AnalysisStrategy, BackendChatMessage, BackendSession, IntermediateSummary } from '@therascript/api/dist/types/index.js';
```

### Impact

- Worker depends on API's build output existing
- Breaks if API build output layout changes
- Imports internal implementation details, not stable APIs
- Makes local dev workflows fragile (watch mode, ts-node)
- Hides potential circular dependencies

## Recommended Fix

Create three shared packages to decouple the worker from the API:

1. **`@therascript/domain`** - Shared types and interfaces
2. **`@therascript/data`** - Database repositories
3. **`@therascript/services`** - Shared business logic services

---

## Phase 1: Create `@therascript/domain`

### Goals

- Centralize all shared TypeScript interfaces and types
- Provide stable type definitions for both API and Worker
- Eliminate type duplication across packages

### Actions

1. **Create package structure:**

   - Create `packages/domain/package.json` with workspace configuration
   - Create `packages/domain/tsconfig.json` extending `tsconfig.base.json`
   - Create `packages/domain/src/` directory

2. **Move type definitions:**

   - Move entire contents of `packages/api/src/types/index.ts` to `packages/domain/src/index.ts`
   - Types to move include:
     - `Template`
     - `BackendChatMessage`, `BackendChatSession`, `ChatMetadata`
     - `BackendTranscriptParagraph`, `TranscriptParagraphData`, `StructuredTranscript`
     - `WhisperSegment`, `WhisperTranscriptionResult`, `WhisperJobStatus`
     - `BackendSession`, `BackendSessionMetadata`
     - `ActionSchema`, `ApiErrorResponse`
     - `OllamaModelInfo`, `OllamaPullJobStatus`, `OllamaPullJobStatusState`
     - `DockerContainerStatus`
     - `ApiSearchResultItem`, `ApiSearchResponse`
     - `AnalysisStrategy`, `AnalysisJob`, `IntermediateSummary`
     - `IntermediateSummaryWithSessionName`, `AnalysisJobWithDetails`

3. **Configure package:**
   - Add `"main": "dist/index.js"` and `"types": "dist/index.d.ts"` to package.json
   - Add `"build": "tsc"` script
   - Add `"clean": "rm -rf dist *.tsbuildinfo"` script
   - Set `"type": "module"` for ESM

### Impact

- Both API and Worker import types from `@therascript/domain`
- No more reaching into each other's source for type definitions
- Type safety improved across workspace

---

## Phase 2: Create `@therascript/data`

### Goals

- Provide shared data access layer for all packages
- Centralize repository logic
- Enable both API and Worker to use same database operations

### Actions

1. **Create package structure:**

   - Create `packages/data/package.json` with workspace configuration
   - Create `packages/data/tsconfig.json` extending `tsconfig.base.json`
   - Create `packages/data/src/repositories/` directory
   - Create `packages/data/src/index.ts` to export all repositories

2. **Move repositories:**
   Move the following files from `packages/api/src/repositories/` to `packages/data/src/repositories/`:

   - `sessionRepository.ts`
   - `transcriptRepository.ts`
   - `messageRepository.ts`
   - `chatRepository.ts`
   - `analysisRepository.ts`
   - `usageRepository.ts`
   - `templateRepository.ts` (and its test file)

3. **Update repository imports:**

   - Update all repositories to import from `@therascript/db` (already exists)
   - Update type imports to use `@therascript/domain` instead of local types
   - Example change:

     ```typescript
     // Before
     import type {
       BackendSession,
       BackendSessionMetadata,
     } from '../types/index.js';

     // After
     import type {
       BackendSession,
       BackendSessionMetadata,
     } from '@therascript/domain';
     ```

4. **Configure package:**
   - Add dependency on `@therascript/db` and `@therascript/domain` in package.json
   - Add `better-sqlite3` as dependency (if needed directly)
   - Add `"main": "dist/index.js"` and `"types": "dist/index.d.ts"`
   - Add build and clean scripts
   - Set `"type": "module"`

### Dependencies

- Depends on: `@therascript/db` (SQLite connection)
- Depends on: `@therascript/domain` (Type definitions)

### Impact

- Both API and Worker use same repository implementations
- Database operations consistent across workspace
- No more importing repositories from compiled API output

---

## Phase 3: Create `@therascript/services`

### Goals

- Extract shared business logic services
- Provide common utilities for both API and Worker
- Decouple services from API-specific configuration

### Actions

1. **Create package structure:**

   - Create `packages/services/package.json` with workspace configuration
   - Create `packages/services/tsconfig.json` extending `tsconfig.base.json`
   - Create `packages/services/src/` directory
   - Create `packages/services/src/index.ts` to export all services

2. **Move and refactor services:**

   **A. tokenizerService.ts** (Simple move)

   - Move `packages/api/src/services/tokenizerService.ts` to `packages/services/src/`
   - Move `packages/api/src/services/tokenizerService.test.ts` to `packages/services/src/`
   - Already independent of API-specific config
   - Only depends on `@dqbd/tiktoken` npm package

   **B. helpers.ts** (Simple move)

   - Move `packages/api/src/utils/helpers.ts` to `packages/services/src/`
   - Move `packages/api/src/utils/helpers.test.ts` to `packages/services/src/`
   - Contains:
     - `isNodeError` - Used by fileService.ts
     - `cleanLlmOutput` - Useful for worker's analysisProcessor
     - `createSessionListDTO` - API-specific, can remain or be moved
   - Update type imports to use `@therascript/domain`

   **C. fileService.ts** (Refactoring required)

   - Move from `packages/api/src/services/fileService.ts` to `packages/services/src/`
   - **Refactor:** Decouple from `packages/api/src/config/index.ts`
   - Update import of `isNodeError` to local path (since helpers.ts moves too)
   - Create initialization function:

     ```typescript
     let uploadsDir: string;

     export function configureFileService(dir: string) {
       uploadsDir = dir;
     }

     export const getUploadsDir = (): string => uploadsDir;
     ```

   - API calls `configureFileService(config.db.uploadsDir)` on startup
   - Worker calls `configureFileService(config.db.uploadsDir)` on startup

   **D. ollamaService.ts** (Optional - currently not used by Worker)

   > **Note:** The Worker currently uses raw `fetch` calls to communicate with Ollama directly, not the ollamaService. This move is optional and can be deferred.

   If moving:
   - Move entire directory structure:
     - `packages/api/src/services/ollamaService.ts`
     - `packages/api/src/services/ollamaService.real.ts`
     - `packages/api/src/services/ollamaService.mock.ts`
     - `packages/api/src/services/ollamaRuntime.ts`
   - **Refactor:** Decouple from API config
   - Create initialization function:

     ```typescript
     export interface OllamaServiceConfig {
       baseURL: string;
       model: string;
       keepAlive: string;
       runtime: 'docker' | 'native';
       appMode: 'production' | 'development' | 'mock';
     }

     export function configureOllamaService(config: OllamaServiceConfig) {
       // Store config for later use
     }
     ```

   - API calls `configureOllamaService(config.ollama, config.server.appMode)`
   - Worker could use if refactored to use shared service

3. **Services NOT to move** (API-specific):

   - `gpuService.ts` - API-only GPU management
   - `streamSubscriber.ts` - API-only Redis streaming logic
   - `redisConnection.ts` - API-only Redis connection management
   - `transcriptionService.ts` (+ `.mock.ts`, `.real.ts`) - API-only Whisper orchestration
   - `dockerManagementService.ts` - API-only Docker control
   - `jobQueueService.ts` - API-only BullMQ queue management
   - `analysisJobService.ts` - API-only analysis job orchestration
   - `activeModelService.ts` (+ `.test.ts`) - API-only model tracking
   - `contextUsageService.ts` (+ `.test.ts`) - API-only context usage tracking

4. **Configure package:**
   - Add dependencies in package.json:
     - `@therascript/domain` (for types like BackendChatMessage, BackendSession)
     - `@dqbd/tiktoken` (for tokenizerService)
     - `ollama` (for ollamaService, if moved)
   - Add dev dependencies for types
   - Add `"main": "dist/index.js"` and `"types": "dist/index.d.ts"`
   - Add build and clean scripts
   - Set `"type": "module"`

### Dependencies

- Depends on: `@therascript/domain` (Type definitions)
- Depends on: `@dqbd/tiktoken` (npm)
- Depends on: `ollama` (npm, only if ollamaService is moved)

### Impact

- Tokenizer service shared between API and Worker
- File operations shared with configurable paths
- Ollama client shared with configuration injection
- No circular dependencies between API and Worker

---

## Phase 4: Integration & Cleanup

### Goals

- Update all imports across the codebase
- Ensure build order is correct
- Verify everything compiles and runs

### Actions

1. **Update Worker:**

   - Modify `packages/worker/src/jobs/transcriptionProcessor.ts`:

     ```typescript
     // Old imports
     import { sessionRepository } from '@therascript/api/dist/repositories/sessionRepository.js';
     import { transcriptRepository } from '@therascript/api/dist/repositories/transcriptRepository.js';
     import { messageRepository } from '@therascript/api/dist/repositories/messageRepository.js';
     import { chatRepository } from '@therascript/api/dist/repositories/chatRepository.js';
     import { usageRepository } from '@therascript/api/dist/repositories/usageRepository.js';
     import { calculateTokenCount } from '@therascript/api/dist/services/tokenizerService.js';
     import { getAudioAbsolutePath } from '@therascript/api/dist/services/fileService.js';
     import type { StructuredTranscript, WhisperJobStatus, WhisperSegment, TranscriptParagraphData } from '@therascript/api/dist/types/index.js';

     // New imports
     import {
       sessionRepository,
       transcriptRepository,
       messageRepository,
       chatRepository,
       usageRepository,
     } from '@therascript/data';
     import {
       calculateTokenCount,
       getAudioAbsolutePath,
     } from '@therascript/services';
     import type {
       StructuredTranscript,
       WhisperJobStatus,
       WhisperSegment,
       TranscriptParagraphData,
     } from '@therascript/domain';
     ```

   - Modify `packages/worker/src/jobs/analysisProcessor.ts`:

     ```typescript
     // Old imports
     import { analysisRepository } from '@therascript/api/dist/repositories/analysisRepository.js';
     import { transcriptRepository } from '@therascript/api/dist/repositories/transcriptRepository.js';
     import { sessionRepository } from '@therascript/api/dist/repositories/sessionRepository.js';
     import { usageRepository } from '@therascript/api/dist/repositories/usageRepository.js';
     import type { AnalysisStrategy, BackendChatMessage, BackendSession, IntermediateSummary } from '@therascript/api/dist/types/index.js';

     // New imports
     import {
       analysisRepository,
       transcriptRepository,
       sessionRepository,
       usageRepository,
     } from '@therascript/data';
     import type {
       AnalysisStrategy,
       BackendChatMessage,
       BackendSession,
       IntermediateSummary,
     } from '@therascript/domain';
     ```
   - Add `uploadsDir` to worker config (`packages/worker/src/config/index.ts`):

     ```typescript
     db: {
       sqlitePath: path.resolve(...),
       uploadsDir: path.resolve(
         packageWorkerDir,
         getEnvVar('DB_UPLOADS_DIR', '../api/data/uploads')
       ),
     },
     ```

   - Add initialization call in `packages/worker/src/index.ts`:

     ```typescript
     import { configureFileService } from '@therascript/services';
     import config from './config/index.js';

     configureFileService(config.db.uploadsDir);
     ```

2. **Update API:**

   - Update all repository imports in handlers:

     ```typescript
     // Old
     import { sessionRepository } from '../repositories/sessionRepository.js';

     // New
     import { sessionRepository } from '@therascript/data';
     ```

   - Update service imports:

     ```typescript
     // Old
     import { calculateTokenCount } from '../services/tokenizerService.js';

     // New
     import { calculateTokenCount } from '@therascript/services';
     ```

   - Update type imports to use `@therascript/domain`
   - Add initialization call in `packages/api/src/server.ts`:

     ```typescript
     import { configureFileService } from '@therascript/services';
     import config from './config/index.js';

     configureFileService(config.db.uploadsDir);

     // If ollamaService was moved to @therascript/services:
     // import { configureOllamaService } from '@therascript/services';
     // configureOllamaService({
     //   ...config.ollama,
     //   appMode: config.server.appMode,
     // });
     ```

3. **Update Root Configuration:**

   - Update root `package.json` to ensure correct build order:
     - Lerna should handle order automatically based on dependencies
     - Verify with `lerna run build` command

4. **Update TypeScript Project References:**

   - Update `tsconfig.base.json` to include new packages in `references` if needed
   - Ensure composite builds work correctly

5. **Clean up old files:**

   - Delete `packages/api/src/repositories/` (moved to data)
   - Delete `packages/api/src/types/index.ts` (moved to domain)
   - Delete moved service files from `packages/api/src/services/`:
     - `tokenizerService.ts` and `tokenizerService.test.ts`
     - `fileService.ts`
     - `ollamaService.*` files (if moved)
   - Delete `packages/api/src/utils/helpers.ts` and `helpers.test.ts` (moved to services)
   - Update `packages/api/src/index.ts` if it exports these items

6. **Build and Test:**
   - Run `yarn clean:dist`
   - Run `yarn build` to verify build order
   - Run `yarn dev` to verify runtime operation
   - Run `yarn test` if tests exist

---

## Migration Path

To minimize disruption, follow this sequence:

1. **Create packages** (no breaking changes yet)

   - Create `packages/domain`, build it
   - Create `packages/data`, build it
   - Create `packages/services`, build it

2. **Migrate Worker first** (Worker has fewer dependencies)

   - Update Worker imports to use new packages
   - Initialize services in Worker
   - Test Worker independently

3. **Migrate API second**

   - Update API imports to use new packages
   - Initialize services in API
   - Remove old files from API

4. **Final verification**
   - Full workspace build
   - Integration testing
   - Clean up any remaining issues

---

## Configuration Handling Strategy

### File Service

```typescript
// packages/services/src/fileService.ts
let uploadsDir: string;

export function configureFileService(dir: string) {
  uploadsDir = dir;
}

// Implementation uses uploadsDir
```

**API:**

```typescript
// packages/api/src/server.ts
import { configureFileService } from '@therascript/services';
import config from './config/index.js';

configureFileService(config.db.uploadsDir);
```

**Worker:**

```typescript
// packages/worker/src/index.ts
import { configureFileService } from '@therascript/services';
import config from './config/index.js';

configureFileService(config.db.uploadsDir);
```

### Ollama Service (Optional)

If ollamaService is moved to `@therascript/services`:

```typescript
// packages/services/src/ollamaService.ts
let serviceConfig: OllamaServiceConfig;

export function configureOllamaService(config: OllamaServiceConfig) {
  serviceConfig = config;
  // Re-initialize service with new config
}
```

API would call this on startup. Worker currently uses raw fetch calls and doesn't need this service.

---

## Benefits

1. **Stable Dependencies:** Worker depends on published packages, not build artifacts
2. **Better Local Dev:** ts-node and watch mode work correctly without build step
3. **Clear Separation:** Shared logic clearly separated from package-specific logic
4. **No Circular Dependencies:** Clear dependency graph: domain → data → services → api/worker
5. **Easier Testing:** Can test shared packages in isolation
6. **Future-Proof:** New packages can depend on these shared foundations

---

## Package Dependency Graph

```
@therascript/domain (types only)
    ↑
    |
@therascript/db (SQLite connection)
    ↑
    |
@therascript/data (repositories)
    ↑
    |
@therascript/services (business logic)
    ↑
    |____ @therascript/api
    |
    |____ @therascript/worker
```

---

## Risk Mitigation

1. **Incremental Migration:** Move one package at a time
2. **Keep Old Code:** Don't delete old files until new imports verified
3. **Type Safety:** Leverage TypeScript to catch import errors
4. **Testing:** Run tests after each phase
5. **Rollback Plan:** Keep git commits granular for easy reversion

---

## Success Criteria

- [ ] Worker compiles without importing from `@therascript/api/dist/*`
- [ ] API compiles without local repositories or types (moved to `@therascript/data` and `@therascript/domain`)
- [ ] All imports use stable package names (`@therascript/domain`, `@therascript/data`, `@therascript/services`)
- [ ] Full workspace builds successfully with `yarn build`
- [ ] Development workflow (watch mode) works without pre-build steps
- [ ] No circular dependencies detected
- [ ] Existing tests pass (`yarn test`)
