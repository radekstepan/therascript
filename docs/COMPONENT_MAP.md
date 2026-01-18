# Component & Library Map

This document provides a detailed breakdown of the monorepo's package structure, the libraries used within each, and their specific responsibilities. Use this as a reference for understanding the tech stack and locating implementation details.

## 1. Backend API (`packages/api`)
**Type:** Node.js HTTP Server (ElysiaJS)
**Location:** `packages/api`
**Entry Point:** `src/server.ts`

### Responsibilities
- **REST API:** Exposes endpoints for the UI to manage sessions, chats, and analysis jobs.
- **Orchestration:** Coordinators interactions between the Database, Search Engine, Redis Queue, and AI Services (Ollama, Whisper).
- **Context Management:** Calculates token usage and manages LLM context windows (`src/services/contextUsageService.ts`).
- **Service Management:** Monitors and manages Docker containers for AI services (`src/services/dockerManagementService.ts`).

### Key Libraries
- **`elysia`**: High-performance TypeScript web framework. Used for routing and handling requests.
- **`@sinclair/typebox`**: Runtime type validation for API request bodies and parameters.
- **`better-sqlite3`** (via `@therascript/db`): Synchronous SQLite driver.
- **`bullmq`**: Redis-based message queue for offloading heavy tasks (transcription, analysis) to the Worker.
- **`@elastic/elasticsearch`**: Client for full-text search operations.
- **`dockerode`**: Docker API client for monitoring and managing containers.
- **`@dqbd/tiktoken`**: Tokenizer for OpenAI-compatible token counting (used for context estimation).

## 2. Background Worker (`packages/worker`)
**Type:** Node.js Background Processor
**Location:** `packages/worker`
**Entry Point:** `src/index.ts`

### Responsibilities
- **Job Consumption:** Consumes jobs from Redis queues (`transcription-jobs`, `analysis-jobs`).
- **Transcription Processing:** coordinates file handling and status polling with the Whisper Service (`src/jobs/transcriptionProcessor.ts`).
- **Analysis Execution:** Executes MapReduce strategies using Ollama to analyze multiple sessions (`src/jobs/analysisProcessor.ts`).
- **Data Indexing:** Pushes processed transcripts and analysis results to Elasticsearch.

### Key Libraries
- **`bullmq`**: For defining and processing job workers.
- **`axios`**: For communicating with the Whisper and Ollama HTTP APIs.
- **`ioredis`**: Low-level Redis client used by BullMQ.

## 3. Frontend UI (`packages/ui`)
**Type:** React Single Page Application (SPA)
**Location:** `packages/ui`
**Entry Point:** `src/index.tsx`

### Responsibilities
- **User Interaction:** Provides interfaces for uploading audio, chatting with AI, and viewing results.
- **State Management:** Manages local UI state (theme, sidebar) and server state (caching, optimistic updates).
- **Streaming:** Handles Server-Sent Events (SSE) for real-time chat responses (`src/hooks/useMessageStream.ts`).

### Key Libraries
- **`react` / `react-dom`**: v19. Core UI library.
- **`@radix-ui/themes` & Primitives**: Accessible, unstyled component primitives and pre-styled theme components.
- **`tailwindcss`**: Utility-first CSS framework for styling.
- **`@tanstack/react-query`**: Manages async server state, caching, and background refetching.
- **`jotai`**: Atomic state management for global UI state (sidebar width, theme).
- **`react-markdown`**: Renders Markdown responses from the AI.
- **`react-router-dom`**: Client-side routing.

## 4. Whisper Service (`packages/whisper`)
**Type:** Python FastAPI Service (Dockerized)
**Location:** `packages/whisper`
**Entry Point:** `src/server.ts` (Node wrapper) -> `transcribe.py` (Python logic)

### Responsibilities
- **Audio Transcoding:** Accepts audio files via HTTP.
- **Inference:** Runs OpenAI's Whisper model (via PyTorch/CUDA) to transcribe audio.
- **Status Reporting:** Exposes endpoints to poll job status and retrieve JSON results.

### Key Libraries
- **`fastapi` / `uvicorn`**: Python web server.
- **`openai-whisper`**: Core transcription model.
- **`torch`**: PyTorch deep learning framework (with CUDA support for GPU).
- **`ffmpeg`**: System dependency for audio processing.

## 5. Shared Utilities
### Database (`packages/db`)
- **Lib:** `better-sqlite3`
- **Role:** Singleton database connection, migration runner (`src/sqliteService.ts`), and type definitions.

### Elasticsearch Client (`packages/elasticsearch-client`)
- **Lib:** `@elastic/elasticsearch`
- **Role:** Centralized client configuration, index mappings (`src/mappings.ts`), and helper functions for bulk indexing/searching.

### Docker Utilities (`packages/docker-utils`)
- **Lib:** `dockerode`
- **Role:** Helpers to ensure containers are running, healthy, and to stop them gracefully.

### GPU Utilities (`packages/gpu-utils`)
- **Role:** Parses `nvidia-smi` XML output to provide real-time GPU stats to the API/UI.
- **Exports:** GPU utilization, VRAM usage, temperature, power draw, per-process stats.

### Elasticsearch Manager (`packages/elasticsearch-manager`)
- **Lib:** `@therascript/docker-utils`
- **Role:** Manages the Elasticsearch Docker container lifecycle (start, stop, health checks).
- **Entry Point:** `src/index.ts`

## 6. Ollama Service (`packages/ollama`)
**Type:** Docker Container + Node.js Manager
**Location:** `packages/ollama`

### Responsibilities
- **LLM Hosting:** Runs local language models (Llama 3, Mistral, Gemma, etc.) via Ollama.
- **Model Management:** Pull, load, unload, and delete models.
- **Container Orchestration:** Multiple Docker Compose variants for GPU/non-GPU setups.

### Configuration
- `docker-compose.yml`: Default GPU configuration
- `docker-compose.gpu.yml`: Explicit GPU passthrough
- `docker-compose.no-gpu.yml`: CPU-only fallback
