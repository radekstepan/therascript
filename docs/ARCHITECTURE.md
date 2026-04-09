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
              ▼                          ▼              ▼
         ┌──────────────────────────────────────────────────┐
         │           Redis Pub/Sub (progress updates)       │
         └──────────────────────────────────────────────────┘
                              │
                              ▼
                         ┌──────┐
                         │  UI  │  (SSE streaming)
                         └──────┘
```

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
