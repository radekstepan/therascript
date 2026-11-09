# System Architecture

This document provides a high-level overview of Therascript's architecture, including package organization, infrastructure components, and communication patterns.

## High-Level Overview

Therascript is a **monorepo** containing 16 packages that work together to provide therapy session transcription (Parakeet ASR + Community-1 diarization) and AI-powered analysis. The system runs as three main processes backed by four Dockerized services. On a vault-capable install the API also supervises the background worker and holds the only in-memory copy of the vault keys.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              THERASCRIPT ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│   ┌─────────────┐         REST + SSE          ┌──────────────────────────────┐  │
│   │             │◄──────────────────────────► │                              │  │
│   │   React     │                             │     ElysiaJS API Server      │  │
│   │   SPA UI    │                             │                              │  │
│   │  (port 3002)│                             │         (port 3001)          │  │
│   └─────────────┘                             └──────────────────────────────┘  │
│                                                        │          │             │
│                                                        │          │             │
│                    ┌───────────────────────────────────┘          │             │
│                    │                                              │             │
│                    ▼                                              ▼             │
│   ┌────────────────────────────┐              ┌──────────────────────────────┐  │
│   │                            │   BullMQ     │                              │  │
│   │      Redis (Queues)        │◄────────────►│    Background Worker         │  │
│   │       (port 6379)          │   Jobs       │                              │  │
│   │                            │              │   • Transcription Jobs       │  │
│   └────────────────────────────┘              │   • Analysis Jobs            │  │
│              │                                └──────────────────────────────┘  │
│              │ Pub/Sub                                 │          │             │
│              │ (progress)                              │          │             │
│              ▼                                         │          │             │
│   ┌────────────────────────────┐                       │          │             │
│   │     SSE Streaming to UI    │                       │          │             │
│   └────────────────────────────┘                       │          │             │
│                                                        │          │             │
│   ┌────────────────────────────┐                       │          │             │
│   │                            │◄──────────────────────┘          │             │
│   │   Whisper (Transcription)  │  HTTP Polling                    │             │
│   │       (port 8000)          │                                  │             │
│   └────────────────────────────┘                                  │             │
│                                                                   │             │
│   ┌────────────────────────────┐                                  │             │
│   │                            │◄─────────────────────────────────┘             │
│   │     LM Studio (LLM)        │  HTTP Streaming                                │
│   │       (port 1234)          │                                                │
│   └────────────────────────────┘                                                │
│                                                                                 │
│   ┌────────────────────────────┐    ┌─────────────────────────────────────────┐ │
│   │                            │    │                                         │ │
│   │    Elasticsearch           │    │               SQLite                    │ │
│   │     (port 9200)            │    │         (Primary Storage)               │ │
│   │   (Full-Text Search)       │    │                                         │ │
│   └────────────────────────────┘    └─────────────────────────────────────────┘ │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Package Organization

The monorepo is organized into three layers: **Application**, **Shared Libraries**, and **External Services**.

```
packages/
├── Application Layer
│   ├── api/                    # ElysiaJS HTTP server
│   ├── worker/                 # BullMQ background processor (API-supervised in vault mode)
│   └── ui/                     # React SPA frontend
│
├── Shared Libraries
│   ├── config/                 # Environment/config loading
│   ├── data/                   # Repositories + data access
│   ├── db/                     # SQLite + migrations + types + FTS5
│   ├── domain/                 # Shared domain types/reductions
│   ├── elasticsearch-client/   # ES client config + search utils
│   ├── docker-utils/           # Container management helpers
│   ├── gpu-utils/              # NVIDIA GPU monitoring
│   ├── queue/                  # BullMQ queue names/stream types
│   ├── services/               # Shared service clients/helpers
│   └── vault/                  # Vault keys, generations, recordings, sessions, backups
│
└── External Service Wrappers
     ├── llama/                  # LM Studio native inference backend setup (lms CLI required)
     ├── whisper/                # Python FastAPI transcription service (Parakeet + Community-1)
     └── elasticsearch-manager/  # ES container management
```

### Application Layer

| Package           | Type            | Port | Description                                                                                                                          |
| ----------------- | --------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/api`    | ElysiaJS Server | 3001 | REST API, orchestration, SSE streaming, service management, vault gate/supervision                                                   |
| `packages/worker` | BullMQ Worker   | —    | Consumes `transcription-jobs`, `analysis-jobs`, and `verification-jobs`; API-supervised in vault mode, standalone in legacy fallback |
| `packages/ui`     | React 19 SPA    | 3002 | User interface with Radix UI, Tailwind, TanStack Query, Jotai, vault screen                                                          |

### Shared Libraries

| Package                         | Primary Library                   | Purpose                                                                                 |
| ------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/config`               | Node env                          | Environment/config loading                                                              |
| `packages/data`                 | better-sqlite3                    | Repositories and shared data access                                                     |
| `packages/db`                   | better-sqlite3 / multiple-ciphers | Database connection, migrations, types, FTS5 search, vault DB handshake                 |
| `packages/domain`               | TypeScript                        | Shared domain types and reduction logic                                                 |
| `packages/elasticsearch-client` | @elastic/elasticsearch            | Index mappings, search utilities, bulk operations (legacy mode)                         |
| `packages/docker-utils`         | dockerode                         | Container health checks, start/stop helpers                                             |
| `packages/gpu-utils`            | nvidia-smi (CLI)                  | GPU stats parsing for monitoring UI                                                     |
| `packages/queue`                | BullMQ                            | Queue names and stream event types                                                      |
| `packages/services`             | TypeScript                        | Shared service clients/helpers (LLM, files, thinking)                                   |
| `packages/vault`                | Node crypto + hash-wasm           | Argon2id key wrapping, generations, encrypted recordings/backups, sessions, worker pipe |

### External Service Wrappers

| Package          | Technology       | Purpose                                                                   |
| ---------------- | ---------------- | ------------------------------------------------------------------------- |
| `packages/llama` | lms CLI (native) | LM Studio headless engine — native on all platforms (macOS/Linux/Windows) |

| `packages/whisper` | Python/FastAPI | Audio transcription + diarization service (Parakeet + Community-1) |
| `packages/elasticsearch-manager` | dockerode | ES container health and management |

## Vault Mode

When the cipher-capable SQLite binding (`better-sqlite3-multiple-ciphers`) is available, the API boots in **vault mode**:

```
password ──Argon2id──► unwrap keys.json envelope
                              │
                              ▼
              { database key, recordings key } (memory only)
                              │
              ┌───────────────┴────────────────┐
              ▼                                ▼
     encrypted vault.db                 supervised worker
     (SQLite + FTS5)                    (keys over fd 3 pipe)
```

- **Boot:** HTTP starts with status `locked`; the database is not attached and the worker is not running. First run shows the setup screen (legacy data is migrated into a staged generation). Later boots show the unlock screen.
- **Unlock:** the password unwraps the keys, the generation's `vault.db` is opened, and the API spawns the worker with the keys over an inherited private pipe. The API and worker then share the same vault generation.
- **Lock/shutdown:** sessions are revoked, in-flight requests are drained, SSE streams are aborted, the worker is stopped, the database is closed, and keys are zeroed. Shutdown does this automatically after model unload (which still needs the open database for settings).
- **Search:** vault mode uses external-content SQLite FTS5 tables (`transcript_search`, `message_search`) and skips Elasticsearch entirely.
- **Recordings:** audio is stored as AES-256-GCM chunked `.enc` containers inside the generation; HTTP range playback decrypts only the covered chunks.
- **Backups:** exports are sealed `.tvbak` archives (Argon2id + AES-GCM); imports are staged, verified, and committed atomically.

If cipher support is missing and no vault exists, the API falls back to the historical plaintext SQLite + Elasticsearch boot. If a vault exists without cipher support, it fails closed. See [`packages/vault/README.md`](../packages/vault/README.md) for formats and migration safety.

### Vault storage layout

```
<VAULT_DIR>/
  CURRENT                       active generation id
  STAGING                       generation being built (setup/restore)
  CLEANUP.json                  legacy paths awaiting deletion
  generations/<genId>/
    vault.db                    encrypted database (+ -wal/-shm)
    keys.json                   wrapped keys (0600)
    SEALED                      fsync marker before cutover
    recordings/<id>.enc         encrypted recordings
```

## Infrastructure Layer

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DATA STORAGE                                 │
├─────────────────────────────┬───────────────────────────────────────┤
│     SQLite / vault.db       │     Elasticsearch (legacy mode)       │
│   (Primary Data Store)      │        Search Index                   │
├─────────────────────────────┼───────────────────────────────────────┤
│ • sessions                  │ • therascript_transcripts             │
│ • transcript_paragraphs     │   (full-text search on transcripts)   │
│ • chats                     │                                       │
│ • messages                  │ • therascript_messages                │
│ • analysis_jobs             │   (full-text search on chat history)  │
│ • intermediate_summaries    │                                       │
│ • message_templates         │  Vault mode: skipped entirely;        │
│ • settings                  │  SQLite FTS5 tables are used instead  │
│ • system_prompts            │                                       │
│ • FTS5 search tables        │                                       │
└─────────────────────────────┴───────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                     JOB QUEUE (Redis + BullMQ)                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   transcription-jobs                 analysis-jobs                  │
│   ┌──────────────────┐              ┌──────────────────┐            │
│   │ sessionId        │              │ jobId            │            │
│   │ numSpeakers      │              │ strategy (JSON)  │            │
│   │ modelName        │              │ sessionIds[]     │            │
│   └──────────────────┘              └──────────────────┘            │
│                                                                     │
│   Redis Pub/Sub Channels:                                           │
│   • analysis-progress:{jobId}  →  Real-time token streaming to UI   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                      AI SERVICES (Docker)                           │
├──────────────────────────────────┬──────────────────────────────────┤
│         LM Studio                │           Whisper                │
│        (port 1234)               │         (port 8000)              │
├──────────────────────────────────┼──────────────────────────────────┤
│ • LLM inference                  │ • ASR + diarization + attribution│
│ • Model management               │ • Parakeet + Community-1 pipeline│
│   (pull, load, unload, delete)   │ • GPU acceleration (CUDA) / CPU fp32 │
│ • Streaming responses            │ • Status polling + readiness checks │
│ • Context window management      │                                  │
└──────────────────────────────────┴──────────────────────────────────┘
```

## Communication Patterns

### 1. API ↔ UI: REST + Server-Sent Events

```
UI                                  API
│                                    │
│──── POST /api/sessions ──────────► │  (Upload audio)
│◄─── { sessionId, status } ──────── │
│                                    │
│──── POST /api/chats/:id/messages ─►│  (Send chat message)
│◄═══ SSE: token stream ═══════════  │  (Streaming response)
│                                    │
│──── GET /api/analysis-jobs/:id/stream ─►│
│◄═══ SSE: progress updates ════════ │  (Real-time analysis progress)
```

> **SSE disconnect caveat (Elysia 1.2.25):** The server's `ReadableStream.cancel()` callback is not invoked on client disconnect because of an inverted-condition bug in Elysia's web-standard adapter (`handler.mjs:262`). Endpoints that need to react to client disconnects (e.g. cancelling the upstream LLM fetch and unloading the model) must be triggered from the client side. See `DATA_FLOWS.md` §6.

> **Shutdown & remote model unload:** The API and worker each maintain a process-local registry of loaded LLM instances keyed by base URL (`loadedModelsTracker`); on `SIGINT` / `SIGTERM` they iterate that registry to unload every URL, including per-request remote URLs the active-URL unload alone would miss. The wrapper scripts (`scripts/run-dev.js`, `scripts/run-prod.js`) send `SIGTERM` to the `concurrently` group with a **25-second** grace period before falling back to `SIGKILL`, so the API and worker actually get a chance to run their shutdown handlers. In vault mode the API first drains requests/aborts SSE, unloads models while the DB is still open, then locks the vault (stops the worker, closes the DB, clears keys, revokes sessions). See `DATA_FLOWS.md` §8.

### 2. API ↔ Worker: BullMQ Job Queues

```
API                         Redis (BullMQ)                    Worker
│                                │                               │
│── add(transcription-jobs) ───► │                               │
│                                │ ◄── process(transcription) ── │
│                                │                               │
│── add(analysis-jobs) ────────► │                               │
│                                │ ◄── process(analysis) ─────── │
│                                │                               │
│                                │ ◄── publish(progress) ─────── │
│◄─ subscribe(progress) ──────── │                               │
```

In vault mode the API also spawns the worker on unlock/setup and writes the data keys to its inherited fd 3 pipe; the worker opens the same encrypted generation and only then starts the BullMQ consumers. A separately started worker exits cleanly because it has no keys. See `DATA_FLOWS.md` §0.

### 3. API/Worker ↔ Whisper: Readiness + HTTP Polling

```
API / Worker                         Whisper Service
│                                        │
│─── GET /diarization/check ───────────► │  (readiness gate before enqueue)
│◄── { ready, hf_token_set, ... } ───── │
│                                        │
│─── POST /transcribe (audio file + num_speakers) ────► │
│◄── { job_id, status: "processing" } ── │
│                                        │
│─── GET /status/{job_id} ─────────────► │  (poll every N seconds)
│◄── { status: "processing" } ────────── │
│                                        │
│─── GET /status/{job_id} ─────────────► │
│◄── { status: "completed", result } ─── │
```

### 4. API/Worker ↔ LM Studio: HTTP Streaming

```
API/Worker                          LM Studio Service
│                                        │
│─── POST /api/chat (stream: true) ────► │
│◄═══ chunked response (tokens) ═══════  │  (streaming)
│◄═══ chunked response (tokens) ═══════  │
│◄─── { done: true } ──────────────────  │
```

### 5. Real-Time Progress: Redis Pub/Sub

```
Worker                    Redis                       API                      UI
│                           │                          │                        │
│── PUBLISH progress ─────► │                          │                        │
│                           │ ─── message ───────────► │                        │
│                           │                          │ ═══ SSE stream ══════► │
```

## Data Flow Summary

### Transcription Pipeline

```
┌──────┐    ┌─────┐    ┌───────┐    ┌────────┐    ┌─────────┐    ┌────────┐
│  UI  │───►│ API │───►│ Redis │───►│ Worker │───►│ Whisper │───►│ SQLite │
└──────┘    └─────┘    └───────┘    └────────┘    └─────────┘    │   ES   │
                                                                 └────────┘
 1. Upload audio + readiness check   2. Queue job (numSpeakers)   3. Process   4. Transcribe + diarize + attribute   5. Store with speaker labels
```

### Chat Pipeline (RAG)

```
┌──────┐    ┌─────┐    ┌────────┐    ┌────────┐    ┌──────┐
│  UI  │◄══►│ API │───►│ SQLite │    │LM Studio│◄───│ API  │
└──────┘SSE └─────┘    └────────┘    └────────┘    └──────┘
                            │                         │
                   1. Fetch context          2. Stream inference
```

### Multi-Session Analysis (MapReduce)

```
┌──────┐    ┌─────┐    ┌───────┐    ┌────────┐    ┌────────┐    ┌────────┐
│  UI  │───►│ API │───►│ Redis │───►│ Worker │───►│LM Studio│───►│ SQLite │
└──────┘    └─────┘    └───────┘    └────────┘    └────────┘    └────────┘
              │                          │              │
         1. Generate              2. Map Phase    3. Reduce Phase
            Strategy              (per session)   (aggregate)
              │                          │              │
              │                     token/thinking  token/thinking
              ▼                       events          events
         ┌──────────────────────────────────────────────────┐
         │     Redis Pub/Sub (type: token | thinking)       │
         └──────────────────────────────────────────────────┘
                              │
                              ▼
                         ┌──────┐
                         │  UI  │  (SSE streaming — content + thinking displayed separately)
                         └──────┘
```

#### LLM Parameter Snapshotting

The API process and the worker process have **separate in-memory states**. When an analysis job is created, `analysisHandler.ts` reads the current "Set Model" configuration from `activeModelService` and persists it onto the `analysis_jobs` DB row:

```
activeModelService (API process)
  temperature, top_p, repeat_penalty,
  num_gpu_layers, thinking_budget
          │
          │  snapshotted at POST /api/analysis-jobs
          ▼
  analysis_jobs (SQLite)
          │
          │  read by worker at job start
          ▼
  analysisProcessor.ts → streamLlmChatDetailed()
```

This is the same pattern used for `model_name` and `context_size`, extended in schema migration **v15**.

#### Completion Token Budget

`max_tokens` (the per-request completion cap sent to LM Studio) is derived at runtime from the job's `context_size` — **not** hardcoded — so the budget scales correctly across all model sizes and thinking models:

| Phase      | Formula                      | Example (32k ctx) |
| ---------- | ---------------------------- | ----------------- |
| **Map**    | `round(context_size × 0.25)` | 8,192 tokens      |
| **Reduce** | `round(context_size × 0.40)` | 13,107 tokens     |

Fallback when `context_size` is null: 8,192 is used as the base. The LLM backend additionally enforces an absolute ceiling of `context_size − prompt_tokens`.

> **Relationship to `thinking_budget`:** `thinking_budget` maps to `reasoning_budget` in the LM Studio request and controls how many tokens a thinking model may spend on internal reasoning. `max_tokens` caps the **total** output (thinking + response combined). Always set `max_tokens` ≥ `thinking_budget` + expected answer length.

#### Thinking Token Streaming

Both phases detect thinking chunks (native `reasoning_content` field or inline `<think>…</think>` tags from the LLM) and publish them on a separate Redis event type:

| Event `type` | Content              | UI destination                          |
| ------------ | -------------------- | --------------------------------------- |
| `token`      | Visible answer text  | `mapLogs` / `reduceLog`                 |
| `thinking`   | Model reasoning text | `mapThinkingLogs` / `reduceThinkingLog` |

The `<think>…</think>` envelope is stripped before the emptiness guard so a thinking-only response does not falsely trigger an "empty result" error.

## Port Reference

| Service       | Default Port | Purpose                                                         |
| ------------- | ------------ | --------------------------------------------------------------- |
| UI            | 3002         | React SPA (Webpack Dev Server)                                  |
| API           | 3001         | ElysiaJS REST API                                               |
| Redis         | 6379         | BullMQ job queues + Pub/Sub                                     |
| Elasticsearch | 9200         | Full-text search API (legacy mode; vault mode uses SQLite FTS5) |
| Kibana        | 5601         | ES data exploration (dev only)                                  |
| LM Studio     | 1234         | LLM inference API                                               |
| Whisper       | 8000         | Transcription API                                               |

## Technology Stack Summary

| Layer                | Technology                                                          |
| -------------------- | ------------------------------------------------------------------- |
| **Frontend**         | React 19, TypeScript, Radix UI, Tailwind CSS, TanStack Query, Jotai |
| **Backend**          | ElysiaJS, TypeScript, BullMQ                                        |
| **Database**         | SQLite (better-sqlite3 / multiple-ciphers vault)                    |
| **Search**           | SQLite FTS5 (vault) / Elasticsearch 8.x (legacy)                    |
| **Job Queue**        | Redis + BullMQ                                                      |
| **LLM**              | LM Studio (Llama, Mistral, Gemma)                                   |
| **Transcription**    | Parakeet (NeMo) + pyannote Community-1 (PyTorch/CUDA or CPU)        |
| **Containerization** | Docker, Docker Compose                                              |
| **Monorepo**         | Turborepo, Yarn Workspaces                                          |

## Related Documentation

- [Component Map](COMPONENT_MAP.md) - Detailed package breakdown and library usage
- [Data Flows](DATA_FLOWS.md) - Step-by-step operational workflows
- [Schema Reference](SCHEMA_REFERENCE.md) - SQLite tables and ES indices
