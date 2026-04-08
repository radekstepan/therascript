# Architecture

## System Overview

Therascript is a **monorepo-based therapy session analysis platform** consisting of three main application processes and four Dockerized infrastructure services.

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        THERASCRIPT SYSTEM                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐  REST/SSE  ┌──────────────────────────────────┐  │
│  │   React UI   │◄──────────►│        ElysiaJS API Server       │  │
│  │  (port 3002) │            │            (port 3001)           │  │
│  └──────────────┘            └──────────────────────────────────┘  │
│                                          │           │              │
│                    ┌─────────────────────┘           │              │
│                    │                                  │              │
│                    ▼                                  ▼              │
│  ┌─────────────────────────────┐    ┌────────────────────────────┐  │
│  │      Redis (BullMQ)         │    │     Background Worker      │  │
│  │       (port 6379)           │◄──►│                            │  │
│  │                             │    │  • Transcription Jobs      │  │
│  └─────────────────────────────┘    │  • Analysis Jobs           │  │
│           │                         └────────────────────────────┘  │
│           │                                  │           │          │
│           ▼                                  ▼           ▼          │
│  ┌─────────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │    WhisperX     │  │  LM Studio   │  │    Elasticsearch     │  │
│  │   (port 8000)   │  │  (variable)  │  │      (port 9200)     │  │
│  └─────────────────┘  └──────────────┘  └──────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                        SQLite                                 │ │
│  │                  (Primary Database)                           │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

## Architectural Patterns

### 1. Monorepo with Layered Architecture

The codebase follows a **three-layer architecture**:

```
packages/
├── Application Layer (deployable units)
│   ├── api/         — HTTP server (ElysiaJS)
│   ├── worker/      — Background job processor (BullMQ)
│   └── ui/          — Frontend SPA (React)
│
├── Shared Libraries (internal packages)
│   ├── config/      — Configuration management
│   ├── domain/      — Domain schemas and validators
│   ├── data/        — Data access (repositories)
│   ├── db/          — Database connection and migrations
│   ├── queue/       — Queue definitions
│   ├── services/    — Shared service clients
│   ├── elasticsearch-client/  — ES client wrapper
│   ├── gpu-utils/   — GPU monitoring
│   └── docker-utils/ — Docker management
│
└── External Service Wrappers
    ├── whisper/     — Python FastAPI transcription service
    ├── llama/       — LM Studio inference backend
    └── elasticsearch-manager/ — ES container management
```

### 2. Repository Pattern

Data access is abstracted through repositories:

```
packages/data/src/repositories/
├── sessionRepository.ts      — Session CRUD
├── messageRepository.ts      — Chat messages
├── transcriptRepository.ts   — Transcript paragraphs
├── chatRepository.ts         — Chat sessions
├── templateRepository.ts     — Prompt templates
├── analysisRepository.ts     — Analysis jobs
└── usageRepository.ts        — Usage tracking
```

**Pattern:**

- Repositories use prepared statements (cached for performance)
- Raw SQL queries with parameterized inputs
- Domain types from `packages/domain` for type safety
- No ORM — direct `better-sqlite3` usage

### 3. Service-Oriented Design

Business logic is encapsulated in services:

```
packages/api/src/services/
├── activeModelService.ts     — LLM model management
├── analysisJobService.ts     — Analysis job orchestration
├── jobQueueService.ts        — BullMQ queue management
├── transcriptionService.ts   — Transcription workflow
├── dockerManagementService.ts — Docker container ops
├── gpuService.ts             — GPU monitoring
├── llamaCppService.ts        — LM Studio client
├── llamaCppRuntime.ts        — LLM runtime lifecycle
├── contextUsageService.ts    — Token/usage tracking
└── streamSubscriber.ts       — SSE streaming
```

### 4. Event-Driven Background Processing

**Job Queue Architecture:**

```
API Server                    Redis                      Worker
    │                           │                          │
    ├──► Queue Job ────────────►│                          │
    │   (transcription/analysis)│                          │
    │                           ├─── Job Available ───────►│
    │                           │                          │
    │                           │◄── Progress Events ──────│
    │                           │    (Pub/Sub)             │
    │◄── SSE Stream ────────────┤                          │
    │   (real-time updates)     │                          │
    │                           │                          │
```

**Job Types:**

- **Transcription Jobs:** Audio → Text with speaker diarization
- **Analysis Jobs:** MapReduce-style multi-session analysis

### 5. Streaming Responses

**SSE (Server-Sent Events) for:**

- Job progress updates
- LLM response streaming
- Real-time UI updates

**Implementation:**

- `packages/api/src/services/streamSubscriber.ts` — Redis Pub/Sub subscriber
- `packages/ui/src/hooks/useMessageStream.ts` — React hook for SSE
- `packages/ui/src/hooks/useAnalysisStream.ts` — Analysis streaming hook

## Data Flow

### 1. Audio Upload & Transcription Flow

```
User Upload → API (multer) → Save Audio → Create Session (SQLite)
    ↓
Queue Transcription Job (BullMQ)
    ↓
Worker Picks Up Job
    ↓
Submit to Whisper API (HTTP) → Poll for Completion
    ↓
Parse Transcript (speaker segments)
    ↓
Store in SQLite + Index in Elasticsearch
    ↓
Create Initial Chat Message
```

### 2. Session Chat Flow

```
User Query → API → Fetch Transcript (SQLite)
    ↓
Build Context (transcript + history)
    ↓
Send to LM Studio (HTTP streaming)
    ↓
Stream Response (SSE) → UI
    ↓
Save Message (SQLite)
```

### 3. Multi-Session Analysis Flow

```
User Query → API → Strategy Generator (LLM)
    ↓
Generate JSON Plan:
  - intermediate_question
  - final_synthesis_instructions
    ↓
Queue Analysis Job (BullMQ)
    ↓
MAP Phase: Process each session individually
    ↓
REDUCE Phase: Synthesize all intermediate results
    ↓
Store Final Answer → Stream to UI
```

## Component Boundaries

### API Server (`packages/api`)

**Responsibilities:**

- HTTP request handling (REST)
- Authentication/authorization (none currently)
- Business logic orchestration
- Service coordination (Whisper, LM Studio, ES)
- Job queue management
- SSE streaming
- Swagger documentation

**Routes:**

- `sessionRoutes` — Session CRUD
- `chatRoutes` — Session chat
- `standaloneChatRoutes` — Standalone chat
- `transcriptionRoutes` — Transcription jobs
- `analysisRoutes` — Analysis jobs
- `templateRoutes` — Prompt templates
- `llmRoutes` — LLM management
- `dockerRoutes` — Docker container ops
- `systemRoutes` — System actions (export/import/reset)
- `searchRoutes` — Full-text search
- `jobsRoutes` — Job monitoring
- `usageRoutes` — Usage tracking
- `metaRoutes` — Health/schema
- `adminRoutes` — Admin actions (re-index)

### Worker (`packages/worker`)

**Responsibilities:**

- Consume jobs from Redis queues
- Execute transcription pipeline
- Execute analysis pipeline (MapReduce)
- Report progress via Pub/Sub
- Handle job failures and retries

**Job Processors:**

- `transcriptionProcessor.ts` — WhisperX integration
- `analysisProcessor.ts` — MapReduce analysis

### UI (`packages/ui`)

**Responsibilities:**

- User interface rendering
- API communication (Axios)
- Server state management (TanStack Query)
- UI state management (Jotai atoms)
- Client-side routing
- Real-time updates (SSE hooks)

**Key Pages:**

- Landing page (session list)
- Sessions page (with filters)
- Session view (transcript + chat)
- Standalone chats page
- Analysis jobs page
- Templates page
- System prompts page
- Settings page

## Abstraction Layers

### 1. Configuration Abstraction

```
packages/config/
  └── Centralized config with type safety
      └── Used by: api, worker, services
```

### 2. Domain Schema Abstraction

```
packages/domain/
  ├── schemas/db/      — Database entity schemas (Zod)
  ├── schemas/api/     — API request/response schemas
  └── schemas/jobs/    — Job payload schemas
      └── Used by: api, worker, data
```

### 3. Data Access Abstraction

```
packages/data/
  └── repositories/    — CRUD operations
      └── Used by: api, worker
```

### 4. Database Abstraction

```
packages/db/
  ├── Connection management
  ├── Migrations
  ├── Query wrappers
  └── Schema validation
      └── Used by: data
```

## Entry Points

### API Server

- **File:** `packages/api/src/server.ts`
- **Port:** 3001
- **Startup:**
  1. Configure database
  2. Ensure directories exist
  3. Initialize Elysia app with middleware
  4. Register all routes
  5. Check LM Studio connection
  6. Initialize Elasticsearch indices
  7. Start HTTP server
  8. Register shutdown handlers

### Worker

- **File:** `packages/worker/src/index.ts`
- **Startup:**
  1. Initialize Redis connection
  2. Create job processors
  3. Start listening to queues

### UI

- **File:** `packages/ui/src/index.tsx`
- **Port:** 3002 (dev server)
- **Startup:**
  1. React app initialization
  2. Query client setup
  3. Router configuration
  4. Theme/accent color initialization

### Whisper Service

- **File:** `packages/whisper/src/server.ts`
- **Port:** 8000
- **Runtime:** Python FastAPI in Docker

## Build Order

```
1. config/         (no dependencies)
2. domain/         (depends on: config)
3. db/             (depends on: config, domain)
4. services/       (depends on: config, domain)
5. data/           (depends on: db, domain, services)
6. queue/          (depends on: config)
7. elasticsearch-client/ (depends on: config)
8. gpu-utils/      (no dependencies)
9. docker-utils/   (depends on: config)
10. api/           (depends on: all above except ui, worker)
11. worker/        (depends on: config, data, domain, services, db, queue, elasticsearch-client)
12. ui/            (standalone, builds separately)
```

---

_Last updated: 2026-04-08 after codebase mapping_
