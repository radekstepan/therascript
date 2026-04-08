# Integrations

## External Services

### LM Studio (LLM Inference)

- **Type:** Local LLM provider
- **Connection:** HTTP API (base URL from config)
- **Authentication:** None (local service)
- **Purpose:** Chat completion, analysis, strategy generation
- **Management:**
  - Auto-starts daemon and server on first use via `lms` CLI
  - Model management: list, pull, load, unload, delete
  - Context size configuration
  - Runtime detection: `packages/api/src/services/llamaCppRuntime.ts`
- **Key Files:**
  - `packages/api/src/services/llamaCppService.ts`
  - `packages/api/src/services/llamaCppRuntime.ts`
  - `packages/llama/` — LM Studio setup and configuration

### WhisperX (Transcription)

- **Type:** Python FastAPI service (Dockerized)
- **Connection:** HTTP API at `http://localhost:8000`
- **Authentication:** None (local service)
- **Purpose:** Audio transcription with speaker diarization
- **Endpoints:**
  - `POST /transcribe` — Submit audio for transcription
  - `GET /transcribe/:jobId` — Poll job status
  - `GET /diarization/check` — Check diarization readiness
- **Dependencies:**
  - HuggingFace token (`HF_TOKEN`) for Pyannote models
  - GPU (optional, via CUDA) for faster inference
- **Key Files:**
  - `packages/whisper/src/routes.ts`
  - `packages/whisper/src/jobManager.ts`
  - `packages/whisper/src/dockerManager.ts`
  - `packages/api/src/services/transcriptionService.ts`

### Elasticsearch (Search)

- **Type:** Search engine (Dockerized)
- **Connection:** HTTP at `http://localhost:9200`
- **Authentication:** None (security disabled in dev)
- **Purpose:** Full-text search across transcripts and chat messages
- **Indices:**
  - `therascript_transcripts` — Transcript paragraphs
  - `therascript_messages` — Chat messages
- **Features:**
  - Index mappings in `packages/elasticsearch-client/src/mappings.ts`
  - Auto-initialization on API startup
  - Bulk operations for indexing
  - Search utilities with highlighting
- **Key Files:**
  - `packages/elasticsearch-client/src/client.ts`
  - `packages/elasticsearch-client/src/searchUtils.ts`
  - `packages/elasticsearch-client/src/initializeIndices.ts`
  - `packages/elasticsearch-manager/src/index.ts`

### Redis (Job Queue)

- **Type:** In-memory data store (Dockerized)
- **Connection:** `redis://localhost:6379`
- **Authentication:** None (local service)
- **Purpose:** BullMQ job queue backend
- **Queues:**
  - `transcription-jobs` — Audio transcription processing
  - `analysis-jobs` — Multi-session analysis (MapReduce)
- **Features:**
  - Pub/Sub for real-time job progress
  - SSE streaming to UI for job updates
  - Job retry and failure handling
- **Key Files:**
  - `packages/queue/src/connection.ts`
  - `packages/queue/src/types.ts`
  - `packages/queue/src/constants.ts`
  - `packages/api/src/services/jobQueueService.ts`

## Database

### SQLite (Primary Storage)

- **Type:** Embedded relational database
- **Driver:** `better-sqlite3` (synchronous)
- **Location:** Configurable via `config.db.sqlitePath`
- **Purpose:** Primary data store for sessions, messages, templates, jobs
- **Tables:**
  - `sessions` — Therapy session metadata
  - `messages` — Chat messages (session and standalone)
  - `transcripts` — Transcript paragraphs
  - `chats` — Chat sessions
  - `templates` — Prompt templates
  - `analysis_jobs` — Analysis job tracking
  - `intermediate_summaries` — MapReduce intermediate results
  - `usage` — API usage tracking
- **Migrations:** Handled by `packages/db`
- **Key Files:**
  - `packages/db/src/sqliteService.ts`
  - `packages/db/src/queryWrapper.ts`
  - `packages/data/src/repositories/` — Repository implementations

## Docker Integration

### Container Management

- **Library:** `dockerode` (`@types/dockerode@^3.3.34`)
- **Purpose:** Manage Docker containers programmatically
- **Capabilities:**
  - Start/stop containers
  - Health checks
  - Log streaming
  - Image management
- **Key Files:**
  - `packages/api/src/services/dockerManagementService.ts`
  - `packages/docker-utils/src/index.ts`
  - `packages/whisper/src/dockerManager.ts`
  - `packages/elasticsearch-manager/src/dockerManager.ts`

### Compose Files

- `docker-compose.yml` — Core services (Whisper, ES, Redis, Kibana)
- `docker-compose.gpu.yml` — GPU overrides for Whisper
- `packages/ollama/docker-compose.yml` — Ollama service (legacy)

## File System

### Upload Storage

- **Location:** `config.db.uploadsDir`
- **Purpose:** Store uploaded audio files
- **Management:**
  - Multer middleware for file uploads
  - Path resolution and validation
  - Cleanup on session deletion
- **Key Files:**
  - `packages/services/src/fileService.ts`
  - `packages/api/src/routes/transcriptionRoutes.ts`

### Export/Import

- **Format:** `.tar` archives
- **Purpose:** Database backup and restore
- **Components:**
  - SQLite database file
  - Uploaded audio files
  - Tar-stream for efficient streaming
- **Key Files:**
  - `packages/api/src/routes/systemRoutes.ts`

## GPU Monitoring

### NVIDIA GPU

- **Source:** `nvidia-smi` CLI output
- **Purpose:** Real-time GPU/VRAM monitoring
- **Metrics:**
  - GPU utilization percentage
  - VRAM usage
  - Temperature
  - Power draw
  - Per-process VRAM usage
- **Key Files:**
  - `packages/gpu-utils/src/index.ts`
  - `packages/gpu-utils/src/types.ts`
  - `packages/api/src/services/gpuService.ts`
  - `packages/ui/src/components/User/GpuStatusModal.tsx`

## HTTP Client

### Axios

- **Version:** `axios@^1.8.4`
- **Usage:**
  - API calls from UI to backend
  - Service-to-service communication (API → Whisper, API → LM Studio)
  - Worker → Whisper API polling
- **Configuration:**
  - Base URL from config
  - Timeout settings for large file uploads
  - SSE streaming support

## Token Counting

### TikToken

- **Library:** `@dqbd/tiktoken@^1.0.15`
- **Purpose:** Count tokens for LLM context window management
- **Usage:**
  - Transcript token counting
  - Context size validation
  - Cost estimation
- **Key Files:**
  - `packages/services/src/tokenizerService.ts`

## Environment Configuration

### Infisical

- **File:** `.infisical.json`
- **Purpose:** Secure secrets management
- **Integration:** Environment variable injection

### Config Package

- **Location:** `packages/config/src/index.ts`
- **Purpose:** Centralized configuration management
- **Features:**
  - Environment variable parsing
  - Type-safe configuration
  - Multi-environment support (dev, mock, prod)
  - Pricing/cost configuration (`packages/config/src/pricing.ts`)

---

_Last updated: 2026-04-08 after codebase mapping_
