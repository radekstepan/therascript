# System Architecture

This document provides a high-level overview of Therascript's architecture, including package organization, infrastructure components, and communication patterns.

## High-Level Overview

Therascript is a **monorepo** containing 10 packages that work together to provide therapy session transcription (WhisperX + diarization) and AI-powered analysis. The system runs as three main processes backed by four Dockerized services.

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
│   ├── worker/                 # BullMQ background processor
│   └── ui/                     # React SPA frontend
│
├── Shared Libraries
│   ├── db/                     # SQLite + migrations + types
│   ├── elasticsearch-client/   # ES client config + search utils
│   ├── docker-utils/           # Container management helpers
│   └── gpu-utils/              # NVIDIA GPU monitoring
│
└── External Service Wrappers
     ├── llama/                  # LM Studio native inference backend setup (lms CLI required)

     ├── whisper/                # Python FastAPI WhisperX service
     └── elasticsearch-manager/  # ES container management
```

### Application Layer

| Package | Type | Port | Description |
|---------|------|------|-------------|
| `packages/api` | ElysiaJS Server | 3001 | REST API, orchestration, SSE streaming, service management |
| `packages/worker` | BullMQ Worker | — | Consumes `transcription-jobs` and `analysis-jobs` queues |
| `packages/ui` | React 19 SPA | 3002 | User interface with Radix UI, Tailwind, TanStack Query, Jotai |

### Shared Libraries

| Package | Primary Library | Purpose |
|---------|-----------------|---------|
| `packages/db` | better-sqlite3 | Database connection, migrations, shared TypeScript types |
| `packages/elasticsearch-client` | @elastic/elasticsearch | Index mappings, search utilities, bulk operations |
| `packages/docker-utils` | dockerode | Container health checks, start/stop helpers |
| `packages/gpu-utils` | nvidia-smi (CLI) | GPU stats parsing for monitoring UI |

### External Service Wrappers

| Package | Technology | Purpose |
|---------|------------|---------|
| `packages/llama` | lms CLI (native) | LM Studio headless engine — native on all platforms (macOS/Linux/Windows) |

| `packages/whisper` | Python/FastAPI | Audio transcription + diarization service (WhisperX + pyannote) |
| `packages/elasticsearch-manager` | dockerode | ES container health and management |

## Infrastructure Layer

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DATA STORAGE                                 │
├─────────────────────────────┬───────────────────────────────────────┤
│         SQLite              │           Elasticsearch               │
│   (Primary Data Store)      │        (Search Index)                 │
├─────────────────────────────┼───────────────────────────────────────┤
│ • sessions                  │ • therascript_transcripts             │
│ • transcript_paragraphs     │   (full-text search on transcripts)   │
│ • chats                     │                                       │
│ • messages                  │ • therascript_messages                │
│ • analysis_jobs             │   (full-text search on chat history)  │
│ • intermediate_summaries    │                                       │
│ • message_templates         │                                       │
│ • settings                  │                                       │
│ • system_prompts            │                                       │
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
│ • LLM inference                  │ • ASR + alignment + diarization  │
│ • Model management               │ • WhisperX + pyannote pipeline   │
│   (pull, load, unload, delete)   │ • GPU acceleration (CUDA) / CPU int8 │
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
1. Upload audio + readiness check   2. Queue job (numSpeakers)   3. Process   4. Transcribe + align + diarize   5. Store with speaker labels
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

| Phase | Formula | Example (32k ctx) |
|-------|---------|-------------------|
| **Map** | `round(context_size × 0.25)` | 8,192 tokens |
| **Reduce** | `round(context_size × 0.40)` | 13,107 tokens |

Fallback when `context_size` is null: 8,192 is used as the base. The LLM backend additionally enforces an absolute ceiling of `context_size − prompt_tokens`.

> **Relationship to `thinking_budget`:** `thinking_budget` maps to `reasoning_budget` in the LM Studio request and controls how many tokens a thinking model may spend on internal reasoning. `max_tokens` caps the **total** output (thinking + response combined). Always set `max_tokens` ≥ `thinking_budget` + expected answer length.

#### Thinking Token Streaming

Both phases detect thinking chunks (native `reasoning_content` field or inline `<think>…</think>` tags from the LLM) and publish them on a separate Redis event type:

| Event `type` | Content | UI destination |
|---|---|---|
| `token` | Visible answer text | `mapLogs` / `reduceLog` |
| `thinking` | Model reasoning text | `mapThinkingLogs` / `reduceThinkingLog` |

The `<think>…</think>` envelope is stripped before the emptiness guard so a thinking-only response does not falsely trigger an "empty result" error.

## Port Reference

| Service | Default Port | Purpose |
|---------|--------------|---------|
| UI | 3002 | React SPA (Webpack Dev Server) |
| API | 3001 | ElysiaJS REST API |
| Redis | 6379 | BullMQ job queues + Pub/Sub |
| Elasticsearch | 9200 | Full-text search API |
| Kibana | 5601 | ES data exploration (dev only) |
| LM Studio | 1234 | LLM inference API |
| Whisper | 8000 | Transcription API |

## Technology Stack Summary

| Layer | Technology |
|-------|------------|
| **Frontend** | React 19, TypeScript, Radix UI, Tailwind CSS, TanStack Query, Jotai |
| **Backend** | ElysiaJS, TypeScript, BullMQ |
| **Database** | SQLite (better-sqlite3) |
| **Search** | Elasticsearch 8.x |
| **Job Queue** | Redis + BullMQ |
| **LLM** | LM Studio (Llama, Mistral, Gemma) |
| **Transcription** | WhisperX + pyannote (PyTorch/CUDA or CPU int8) |
| **Containerization** | Docker, Docker Compose |
| **Monorepo** | Turborepo, Yarn Workspaces |

## Related Documentation

- [Component Map](COMPONENT_MAP.md) - Detailed package breakdown and library usage
- [Data Flows](DATA_FLOWS.md) - Step-by-step operational workflows
- [Schema Reference](SCHEMA_REFERENCE.md) - SQLite tables and ES indices
