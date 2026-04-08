# Tech Stack

## Languages & Runtime

| Technology     | Version                    | Purpose                                       |
| -------------- | -------------------------- | --------------------------------------------- |
| **TypeScript** | 5.5.4+                     | Primary language for all Node.js packages     |
| **Node.js**    | v23.10.0 (from `.nvmrc`)   | Runtime for API, Worker, and shared libraries |
| **Python**     | 3.x (in Whisper container) | WhisperX transcription service                |
| **ES Modules** | `"type": "module"`         | All Node.js packages use ESM                  |

## Frameworks

### Backend

- **ElysiaJS** (`elysia@^1.2.25`) — Fast, type-safe HTTP server framework for the API
  - `@elysiajs/cors@^1.1.0` — CORS middleware
  - `@elysiajs/swagger@^1.1.0` — OpenAPI/Swagger docs at `/api/docs`
- **BullMQ** (`bullmq@^5.10.3`) — Redis-based job queue for background processing
- **better-sqlite3** (`better-sqlite3@^11.1.2`) — Synchronous SQLite driver (used in `packages/db`)

### Frontend

- **React 19** (`react@^19.1.0`) — UI library
- **Radix UI** — Accessible component primitives
  - `@radix-ui/themes@^3.2.1` — Complete theme system
  - Individual primitives: Dialog, Select, Label, Slot, Alert-dialog, dropdown-menu, scroll-area, toast
- **Tailwind CSS 3.4** (`tailwindcss@3.4.17`) — Utility-first CSS framework
  - `tailwindcss-animate`, `@tailwindcss/forms` — Plugins
  - `class-variance-authority`, `clsx`, `tailwind-merge` — Class composition utilities
- **Webpack 5** — Build tool and dev server
- **React Router DOM 7** (`react-router-dom@^7.4.1`) — Client-side routing
- **TanStack Query 5** (`@tanstack/react-query@^5.51.15`) — Server state management
- **Jotai** (`jotai@^2.12.2`) — Atomic UI state management
- **Framer Motion** (`framer-motion@^12.9.2`) — Animation library

### AI/ML Services

- **WhisperX** — Python-based transcription with forced alignment and diarization
  - Pyannote models for speaker diarization (`pyannote/speaker-diarization-3.1`, `pyannote/segmentation-3.0`)
  - Requires HuggingFace token (`HF_TOKEN`)
- **LM Studio** (`lms` CLI) — Local LLM inference (replaced Ollama)
  - Auto-detects Metal (macOS) and CUDA (Linux)
- **Elasticsearch 8.14.1** — Full-text search engine

## Key Dependencies

### API Server (`packages/api`)

```json
{
  "@dqbd/tiktoken": "^1.0.15", // Token counting for LLM context
  "axios": "^1.8.4", // HTTP client for service calls
  "dockerode": "^4.0.6", // Docker API client
  "form-data": "^4.0.0", // Multipart form handling
  "ioredis": "^5.4.1", // Redis client
  "multer": "^1.4.5-lts.1", // File upload handling
  "tar-stream": "^3.1.7", // Tar archive streaming
  "zod": "^3.23.8" // Runtime validation
}
```

### Worker (`packages/worker`)

```json
{
  "axios": "^1.8.4", // HTTP client for Whisper API
  "form-data": "^4.0.0", // Multipart form handling
  "ioredis": "^5.4.1" // Redis client for job processing
}
```

### Shared Libraries

- **`@therascript/config`** — Centralized configuration management
- **`@therascript/domain`** — Zod schemas for API requests and DB entities
- **`@therascript/data`** — Repository pattern implementations for data access
- **`@therascript/db`** — SQLite connection, migrations, query wrappers
- **`@therascript/queue`** — BullMQ queue definitions and connection management
- **`@therascript/services`** — Shared service clients (LLM, file, tokenizer)
- **`@therascript/elasticsearch-client`** — ES client wrapper, mappings, search utilities
- **`@therascript/gpu-utils`** — NVIDIA GPU stats via `nvidia-smi` parsing
- **`@therascript/docker-utils`** — Docker container management helpers

## Build & Tooling

### Monorepo Management

- **Turborepo** (`turbo@^2.5.0`) — Build system with caching and parallel execution
- **Yarn Workspaces** (v1.22.22) — Package management

### Development

- **Vitest** (`vitest@0.34.6`) — Unit testing framework
- **Prettier** (`prettier@^3.5.3`) — Code formatting
- **Husky** (`husky@^9.1.7`) — Git hooks
- **lint-staged** (`lint-staged@^15.5.1`) — Pre-commit linting
- **ts-node** (`ts-node@^10.9.2`) — TypeScript execution
- **nodemon** — Dev server auto-reload
- **concurrently** — Run multiple commands in parallel

### TypeScript Configuration

- **Base config** (`tsconfig.base.json`):
  - `strict: true`
  - `target: ES2022`
  - `moduleResolution: NodeNext`
  - `composite: true` (project references)
  - `experimentalDecorators: true` (for Elysia/TypeBox)
  - `sourceMap`, `declaration`, `declarationMap` enabled

## Infrastructure

### Docker Services (docker-compose.yml)

| Service           | Image                                                  | Port | Purpose                            |
| ----------------- | ------------------------------------------------------ | ---- | ---------------------------------- |
| **whisper**       | `therascript/whisper:cpu`                              | 8000 | Transcription API (Python FastAPI) |
| **elasticsearch** | `docker.elastic.co/elasticsearch/elasticsearch:8.14.1` | 9200 | Full-text search                   |
| **kibana**        | `docker.elastic.co/kibana/kibana:8.14.1`               | 5601 | ES data exploration (dev)          |
| **redis**         | `redis:7.2-alpine`                                     | 6379 | Job queue backend                  |

### GPU Support

- **docker-compose.gpu.yml** — Overrides Whisper service for NVIDIA GPU
- **NVIDIA Container Toolkit** required for GPU passthrough
- **`packages/gpu-utils`** — GPU monitoring via `nvidia-smi`

### Container Volumes

- `whisper_models` — Whisper model cache
- `hf_cache` — HuggingFace model cache
- `torch_cache` — PyTorch cache
- `es_data` — Elasticsearch data
- `redis_data` — Redis persistence

## Configuration

### Environment Files

- `.env` — Root environment (shared, includes `HF_TOKEN`)
- `.env.api.dev` — API development configuration
- `.env.api.mock` — API mock mode (stubbed services)
- `.env.api.prod` — API production configuration
- `.env.worker.dev` — Worker development configuration
- `.env.worker.prod` — Worker production configuration

### Infisical Integration

- `.infisical.json` — Secrets management configuration
- Used for secure environment variable injection

## Notable Technical Decisions

1. **LM Studio over Ollama** — Migrated from Ollama to LM Studio for LLM inference
2. **ElysiaJS over Express** — Chosen for performance and type safety
3. **Synchronous SQLite** — `better-sqlite3` for simplicity (no connection pooling needed)
4. **Radix UI Themes** — Complete design system for consistent, accessible UI
5. **Webpack over Vite** — Existing investment, works well with Radix UI
6. **Repository Pattern** — Data access abstracted through repositories in `packages/data`
7. **Schema Validation** — Zod schemas in `packages/domain` for runtime type safety

---

_Last updated: 2026-04-08 after codebase mapping_
