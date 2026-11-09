# Therascript Navigation Guide

> **"Where to change what"** — A quick reference for developers and LLMs to locate code by feature area.

---

## API Layer (`packages/api/src/`)

### Entry Point

- [`server.ts`](../packages/api/src/server.ts) — Elysia app setup, route registration, vault boot/shutdown lifecycle

### Routes (`/routes/*.ts`) — HTTP endpoint definitions

| File                      | Purpose                                                                       |
| ------------------------- | ----------------------------------------------------------------------------- |
| `sessionRoutes.ts`        | Session CRUD, file upload, diarization readiness gate, speaker rename         |
| `chatRoutes.ts`           | Session-bound chat endpoints (incl. per-chat `verifications` / `verify`)      |
| `standaloneChatRoutes.ts` | Standalone chat (no session context)                                          |
| `analysisRoutes.ts`       | Multi-session analysis jobs                                                   |
| `verificationRoutes.ts`   | Fact-verification jobs, stats, statements, resets (`/api/verification/*`)     |
| `vaultRoutes.ts`          | Vault status, setup, unlock, lock, password change (`/api/vault/*`)           |
| `transcriptionRoutes.ts`  | Transcription status, polling                                                 |
| `searchRoutes.ts`         | Elasticsearch search endpoints                                                |
| `llmRoutes.ts`            | Model management (list, load, unload)                                         |
| `templateRoutes.ts`       | Prompt template CRUD                                                          |
| `systemRoutes.ts`         | System prompts management                                                     |
| `jobsRoutes.ts`           | Background job status (incl. verification counts) + transcription queue reset |
| `dockerRoutes.ts`         | Docker container management                                                   |
| `adminRoutes.ts`          | Admin/debug endpoints                                                         |
| `metaRoutes.ts`           | Health checks, readiness                                                      |

### Handlers (`/api/*.ts`) — Business logic for complex operations

| File                       | Purpose                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `sessionHandler.ts`        | Session creation/deletion logic, transcript speaker rename                                 |
| `sessionChatHandler.ts`    | RAG chat with transcript context                                                           |
| `standaloneChatHandler.ts` | General-purpose chat (no context)                                                          |
| `analysisHandler.ts`       | Strategy generation, MapReduce orchestration                                               |
| `verificationHandler.ts`   | Verification job CRUD, single-job guard, stats/statements, per-finding dismiss, SSE stream |
| `vaultHandler.ts`          | Vault setup/unlock/lock/change-password services, origin/rate-limit checks, error mapping  |
| `templateHandler.ts`       | Template management logic                                                                  |
| `jobsHandler.ts`           | Job queue operations (active count + queue reset)                                          |
| `gpuHandler.ts`            | GPU availability checks                                                                    |
| `metaHandler.ts`           | System metadata, readiness                                                                 |
| `adminHandler.ts`          | Admin operations                                                                           |

### Services (`/services/*.ts`) — External integrations & utilities

| File                           | Purpose                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `llamaCppService.test.ts`      | Tests for inference service                                                                                   |
| `llamaCppService.ts`           | Actual LM Studio API client                                                                                   |
| `llamaCppRuntime.ts`           | Model lifecycle management                                                                                    |
| `activeModelService.ts`        | Track currently loaded model                                                                                  |
| `transcriptionService.ts`      | Whisper integration + diarization readiness/prefetch checks                                                   |
| `transcriptionService.real.ts` | Actual Whisper API client                                                                                     |
| `fileService.ts`               | Audio file handling, storage                                                                                  |
| `jobQueueService.ts`           | BullMQ job submission + transcription queue obliteration/reset                                                |
| `analysisJobService.ts`        | Analysis job orchestration                                                                                    |
| `dockerManagementService.ts`   | Container start/stop                                                                                          |
| `gpuService.ts`                | GPU detection                                                                                                 |
| `tokenizerService.ts`          | Token counting                                                                                                |
| `contextUsageService.ts`       | Context window tracking                                                                                       |
| `vaultManager.ts`              | Vault boot mode, setup/unlock/lock, keys, generation lifecycle, supervised worker, request drain/stream abort |
| `vaultAudioService.ts`         | Encrypted recording storage + range playback, legacy/vault unified audio helpers                              |
| `ftsSearchService.ts`          | Vault-mode search over SQLite FTS5 (same response contract as Elasticsearch)                                  |
| `vaultMigrationPrep.ts`        | Legacy-install validation/prep shared with `scripts/prepare-vault-migration.mjs`                              |
| `streamSubscriber.ts`          | Redis pub/sub for streaming                                                                                   |
| `redisConnection.ts`           | Redis client singleton                                                                                        |

### Middleware (`/middleware/*.ts`)

| File            | Purpose                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------- |
| `vaultGuard.ts` | Session gate for every non-public route; tracks in-flight requests for lock-time draining |

### Repositories (`/repositories/*.ts`) — Database access patterns

| File                      | Purpose                            |
| ------------------------- | ---------------------------------- |
| `sessionRepository.ts`    | Sessions table operations          |
| `chatRepository.ts`       | Chats table operations             |
| `messageRepository.ts`    | Messages table operations          |
| `transcriptRepository.ts` | Transcript paragraphs + ES queries |
| `analysisRepository.ts`   | Analysis jobs table operations     |
| `templateRepository.ts`   | Templates table operations         |

---

## Worker (`packages/worker/src/`)

### Entry Point

- [`index.ts`](../packages/worker/src/index.ts) — BullMQ worker initialization; supervised vault boot (keys over fd 3) or legacy standalone boot

### Boot Policy

- [`standaloneBoot.ts`](../packages/worker/src/standaloneBoot.ts) — decides whether a standalone worker should run; exits 0 when a vault exists or vault support is available
- [`vaultContext.ts`](../packages/worker/src/vaultContext.ts) — worker-side vault keys/generation/recordings context

### Job Processors (`/jobs/*.ts`)

| File                        | Purpose                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `transcriptionProcessor.ts` | "The Ears" — transcription job processing, encrypted-recording access, ES/FTS5 indexing |
| `analysisProcessor.ts`      | "The Analyst" — MapReduce analysis execution                                            |
| `verificationProcessor.ts`  | "The Judge" — per-message fact verification, span resolution, evidence hydration        |

### Services (`/services/*.ts`)

| File                 | Purpose                                     |
| -------------------- | ------------------------------------------- |
| `streamPublisher.ts` | Redis pub/sub for real-time streaming to UI |

### Other Files

| File                 | Purpose                                                                  |
| -------------------- | ------------------------------------------------------------------------ |
| `redisConnection.ts` | Redis client for BullMQ                                                  |
| `llmWorkerMutex.ts`  | Cross-queue mutex serializing LLM load/unload (analysis vs verification) |
| `types.ts`           | Worker-specific type definitions                                         |

---

## UI (`packages/ui/src/`)

### Entry Points

- [`index.tsx`](../packages/ui/src/index.tsx) — React DOM render
- [`App.tsx`](../packages/ui/src/App.tsx) — Root component, routing, theme, layout

### Routes (defined in `App.tsx`)

| Path                                 | Component                                |
| ------------------------------------ | ---------------------------------------- |
| `/`                                  | `LandingPage`                            |
| `/sessions/:sessionId`               | `SessionView`                            |
| `/sessions/:sessionId/chats/:chatId` | `SessionView`                            |
| `/chats/:chatId`                     | `StandaloneChatView`                     |
| `/sessions-list`                     | `SessionsPage`                           |
| `/chats-list`                        | `StandaloneChatsPage`                    |
| `/templates`                         | `TemplatesPage`                          |
| `/analysis-jobs`                     | `AnalysisJobsPage`                       |
| `/verification`                      | `VerificationAuditPage` (Fact Check hub) |
| `/settings`                          | `SettingsPage`                           |

### Deep-links

- `?highlightMsg=<messageId>` on a session chat route scrolls to and flashes that message, opening its modeless Fact Check panel (docked left of the transcript) when verified (`ChatMessages.tsx`; used by the Issues feed and Job History failure details).
- `#paragraph-<id>` scrolls the session transcript to that paragraph with a brief highlight (`Transcription.tsx` virtuoso scroll; the desktop panel is always active, small screens auto-switch to the Transcript tab via `shouldActivateTranscriptTab`). Fact Check evidence `¶N` references link here (same-page hash, so chat context is preserved).

### Pages (`/components/*.tsx`)

| File                      | Purpose                     |
| ------------------------- | --------------------------- |
| `SessionsPage.tsx`        | Sessions list view          |
| `StandaloneChatsPage.tsx` | Standalone chats list       |
| `SettingsPage.tsx`        | App settings                |
| `TemplatesPage.tsx`       | Prompt templates management |
| `SystemPromptsPage.tsx`   | System prompts editor       |

### Feature Components (`/components/{Feature}/`)

| Directory             | Purpose                                                                                                                                                                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Analysis/`           | Analysis jobs UI, `AnalysisJobsPage.tsx`                                                                                                                                                                                                                               |
| `Verification/`       | Fact Check hub: `VerificationAuditPage.tsx`, `StartVerificationModal.tsx`, `CoverageTab.tsx`, `IssuesFeedTab.tsx`, `JobHistoryTab.tsx`, `StatementVerdictModal.tsx`, analytics cards (model ids render via `utils/modelDisplay.ts`, raw ids stay as filter/API values) |
| `SessionView/`        | Session detail, chat, transcript display, speaker rename modal                                                                                                                                                                                                         |
| `StandaloneChatView/` | Standalone chat interface                                                                                                                                                                                                                                              |
| `Search/`             | Search UI components                                                                                                                                                                                                                                                   |
| `Transcription/`      | Transcription progress, display                                                                                                                                                                                                                                        |
| `UploadModal/`        | File upload modal                                                                                                                                                                                                                                                      |
| `Layout/`             | Sidebar, toolbar, background                                                                                                                                                                                                                                           |
| `LandingPage/`        | Home/landing page                                                                                                                                                                                                                                                      |
| `Shared/`             | Reusable UI components                                                                                                                                                                                                                                                 |
| `Jobs/`               | Job status components                                                                                                                                                                                                                                                  |
| `User/`               | User-related components                                                                                                                                                                                                                                                |
| `Vault/`              | Vault setup/unlock screen (`VaultScreen.tsx`)                                                                                                                                                                                                                          |

### API Clients (`/api/*.ts`) — Typed API wrappers

| File               | Purpose                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `api.ts`           | Base axios configuration                                                                       |
| `session.ts`       | Session API calls (including `PATCH /sessions/:id/speakers`)                                   |
| `chat.ts`          | Chat API calls                                                                                 |
| `analysis.ts`      | Analysis job API calls                                                                         |
| `search.ts`        | Search API calls                                                                               |
| `llm.ts`           | Model management API                                                                           |
| `transcription.ts` | Transcription API                                                                              |
| `templates.ts`     | Templates API                                                                                  |
| `system.ts`        | System prompts API                                                                             |
| `jobs.ts`          | Jobs API (active count + reset transcription queue)                                            |
| `verification.ts`  | Verification API calls (jobs, stats, statements, per-finding dismiss, per-chat verify, resets) |
| `docker.ts`        | Docker management API                                                                          |
| `meta.ts`          | Health/readiness API (explicit 200/503 readiness handling)                                     |
| `vault.ts`         | Vault status/setup/unlock/change-password API + 401 refresh interceptor                        |

### React Hooks (`/hooks/*.ts`)

| File                       | Purpose                                                               |
| -------------------------- | --------------------------------------------------------------------- |
| `useMessageStream.ts`      | SSE streaming for chat messages                                       |
| `useAnalysisStream.ts`     | SSE streaming for analysis results                                    |
| `useVerificationStream.ts` | SSE streaming for verification job progress                           |
| `useVaultStatus.ts`        | Vault gate state; polls status and clears cached queries while locked |
| `useAnimatedText.tsx`      | Text animation effects                                                |

### Utilities (`/utils/*.ts`)

| File                             | Purpose                                                                                                                                                                                                                                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `highlightVerifiedStatements.ts` | Inline verdict highlighting: worker-span validation + normalized quote search for plain-text and Markdown (`rehypeHighlightStatements`) paths                                                                                                                                                                           |
| `modelDisplay.ts`                | Human-readable LLM display names: `formatModelDisplayName` maps stored ids (`gemma3:12b-it-qat` → `gemma3-12b`, `qwen/qwen3.5-9b` → `qwen3.5-9b`, missing → `Unknown Model`) for Fact Check + Settings usage logs; `mergeModelAccuracyStatsByDisplayName` folds same-name `byModel` rows into one (DB values unchanged) |

### State Management (`/store/*.ts`) — Jotai atoms

| Directory/File                      | Purpose                            |
| ----------------------------------- | ---------------------------------- |
| `action/`                           | Action-related atoms               |
| `chat/`                             | Chat state atoms                   |
| `navigation/`                       | Navigation state (currentPageAtom) |
| `session/`                          | Session state atoms                |
| `ui/`                               | UI state (sidebar, theme, modals)  |
| `analysisJobSortCriteriaAtom.ts`    | Analysis sorting state             |
| `standaloneChatSortCriteriaAtom.ts` | Chat sorting state                 |

---

## Shared Packages

### Database (`packages/db/src/`)

| File               | Purpose                                                |
| ------------------ | ------------------------------------------------------ |
| `sqliteService.ts` | Schema definition, migrations, system prompt templates |
| `config.ts`        | Database path configuration                            |
| `types.ts`         | Database type definitions                              |

### Elasticsearch (`packages/elasticsearch-client/src/`)

| File             | Purpose                                  |
| ---------------- | ---------------------------------------- |
| `mappings.ts`    | Index mappings (therascript_transcripts) |
| `client.ts`      | ES client singleton                      |
| `searchUtils.ts` | Search query builders                    |

### Vault (`packages/vault/src/`)

| File             | Purpose                                                                           |
| ---------------- | --------------------------------------------------------------------------------- |
| `keys.ts`        | Argon2id key wrapping, verification, rewrap, key clearing                         |
| `generations.ts` | Generation directories, staging, sealing, atomic `CURRENT` cutover, cleanup       |
| `recordings.ts`  | Chunked AES-GCM recording encryption + range decryption                           |
| `backup.ts`      | Sealed `.tvbak` export/import primitives                                          |
| `sessions.ts`    | Memory-only session tokens, cookie helpers, unlock rate limiter, origin allowlist |
| `workerPipe.ts`  | API→worker key payload over inherited fd 3                                        |
| `mutex.ts`       | Exclusive vault transitions (setup/unlock/lock)                                   |
| `index.ts`       | Public exports                                                                    |

---

## Common Tasks Quick Reference

| Task                                | Where to Change                                                                                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Add new API endpoint**            | 1. `packages/api/src/routes/*.ts` (define route)<br>2. `packages/api/src/api/*.ts` (add handler if complex)                                           |
| **Add new SQLite table**            | `packages/db/src/sqliteService.ts` (schema + add migration in `runMigrations()`)                                                                      |
| **Add new ES index**                | `packages/elasticsearch-client/src/mappings.ts`                                                                                                       |
| **Add new background job**          | 1. `packages/worker/src/jobs/*.ts` (processor)<br>2. `packages/api/src/services/jobQueueService.ts` (queue submission)                                |
| **Change vault boot/lock behavior** | `packages/api/src/services/vaultManager.ts`; UI gate in `packages/ui/src/hooks/useVaultStatus.ts` + `components/Vault/VaultScreen.tsx`                |
| **Add a vault-protected API route** | Add it to a route group mounted after `setupRoutes()`; `middleware/vaultGuard.ts` gates it automatically. Only explicitly public paths skip the gate. |
| **Change encryption/backup format** | `packages/vault/src/recordings.ts`, `keys.ts`, `backup.ts`; migration/versioning rules in `packages/vault/README.md`                                  |
| **Change search backend**           | `packages/api/src/services/ftsSearchService.ts` (vault FTS5) and `packages/api/src/routes/searchRoutes.ts` (legacy Elasticsearch branch)              |
| **Modify system prompts**           | `packages/db/src/sqliteService.ts` (`SYSTEM_PROMPT_TEMPLATES`)                                                                                        |
| **Add new UI page**                 | 1. `packages/ui/src/components/*.tsx` (page component)<br>2. `packages/ui/src/App.tsx` (add route)                                                    |
| **Add new API client**              | `packages/ui/src/api/*.ts`                                                                                                                            |
| **Add new Jotai atom**              | `packages/ui/src/store/*.ts`                                                                                                                          |
| **Add new React hook**              | `packages/ui/src/hooks/*.ts`                                                                                                                          |
| **Add new repository**              | `packages/api/src/repositories/*.ts`                                                                                                                  |
| **Add new service**                 | `packages/api/src/services/*.ts`                                                                                                                      |

---

## Key Files Summary

```
packages/
├── api/src/
│   ├── server.ts              # API entry point + shutdown
│   ├── routes/*.ts            # HTTP endpoints
│   ├── api/*.ts               # Business logic handlers
│   ├── services/*.ts          # External integrations + vault manager
│   ├── middleware/*.ts        # Vault guard
│   └── repositories/*.ts      # Database access
├── worker/src/
│   ├── index.ts               # Worker entry point (supervised/legacy boot)
│   ├── standaloneBoot.ts      # Standalone worker boot policy
│   ├── vaultContext.ts        # Worker vault keys/recordings context
│   └── jobs/*.ts              # Job processors
├── ui/src/
│   ├── App.tsx                # UI entry + routing + vault gate
│   ├── components/*.tsx       # Pages
│   ├── components/{Feature}/  # Feature components
│   ├── api/*.ts               # API clients
│   ├── hooks/*.ts             # React hooks
│   └── store/*.ts             # Jotai state
├── db/src/
│   └── sqliteService.ts       # Schema + prompts + FTS5 + vault DB handshake
├── vault/src/                 # Keys, generations, recordings, backups, sessions
└── elasticsearch-client/src/
    └── mappings.ts            # ES index definitions (legacy mode)
```
