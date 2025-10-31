# Therascript Architecture Overview

This document gives a high-level map of the system so you can quickly find the right place to implement features or fix bugs.

## Services and Packages

- API (`packages/api`)
  - Tech: Node.js (Elysia), TypeScript, SQLite (`better-sqlite3`), Elasticsearch client, BullMQ producer
  - Entrypoint: `src/server.ts`
  - Config: `src/config/index.ts`
  - Routes: `src/routes/*` (REST endpoints)
  - Services: `src/services/*` (business logic and integrations)
  - Repositories: `src/repositories/*` (DB access via shared @therascript/db)
  - Types: `src/types/*`
  - Responsibilities:
    - Session CRUD, file upload pathing, transcript paragraphs
    - Chat (session-bound and standalone) and templates
    - Kicks off transcription and analysis jobs (BullMQ) via Redis
    - Search endpoints (Elasticsearch)
    - Docker/Ollama management passthrough endpoints and system utilities

- Worker (`packages/worker`)
  - Tech: Node.js (BullMQ), TypeScript
  - Entrypoint: `src/index.ts`
  - Jobs: `src/jobs/transcriptionProcessor.ts`, `src/jobs/analysisProcessor.ts`
  - Config: `src/config/index.ts`, Redis: `src/redisConnection.ts`
  - Responsibilities:
    - Consumes BullMQ queues from Redis
    - Transcription job calls Whisper service and stores transcript paragraphs; indexes to Elasticsearch; seeds initial AI message for the session chat
    - Analysis job performs MapReduce over per-session transcripts using the Ollama chat API

- Whisper (`packages/whisper`)
  - Tech: Express (TypeScript), Python `transcribe.py`
  - Entrypoint: `src/server.ts` → `src/routes.ts` → `src/jobManager.ts`
  - Endpoints:
    - POST `/transcribe` (multipart form with file) → returns `job_id`
    - GET `/status/:job_id` → job state and result
    - POST `/cancel/:job_id`
    - GET `/health`
  - Responsibilities:
    - Run Python transcription in a subprocess, track progress, and expose job status

- Ollama (`packages/ollama`)
  - Tech: Node.js TypeScript
  - Key: `src/ollamaClient.ts`, `src/dockerManager.ts`, `src/chatManager.ts`
  - Responsibilities:
    - Ensure Ollama Docker service is running and healthy
    - Stream model pulls, check model availability, simple chat helper

- Elasticsearch Client (`packages/elasticsearch-client`)
  - Tech: `@elastic/elasticsearch`
  - Files: `src/client.ts`, `src/mappings.ts`, `src/searchUtils.ts`
  - Responsibilities:
    - Client singleton, index mappings, index init, indexing helpers, querying helpers, and common types
    - Index names: `therascript_transcripts`, `therascript_messages`

- Database (`packages/db`)
  - Tech: `better-sqlite3`
  - Files: `src/sqliteService.ts`, `src/config.ts`
  - Responsibilities:
    - Initialize SQLite, run migrations (LATEST_SCHEMA_VERSION = 7)
    - Seed system prompt templates
    - Provide thin helpers for running queries

- Docker Utils (`packages/docker-utils`)
  - Tech: Node.js, Dockerode, docker compose CLI
  - File: `src/index.ts`
  - Responsibilities:
    - Start/stop/check services using compose + Dockerode
    - Health check helpers (HTTP or running)

- GPU Utils (`packages/gpu-utils`)
  - Tech: Node.js, nvidia-smi
  - File: `src/index.ts`
  - Responsibilities:
    - Parse `nvidia-smi -q -x` for UI GPU status

- UI (`packages/ui`)
  - Tech: React 19, TS, Radix UI, Tailwind, Webpack
  - Entrypoint: `src/index.tsx`, App: `src/App.tsx`
  - API client modules: `src/api/*`
  - Main feature areas: `src/components/*`

## Runtime Topology

- Root `docker-compose.yml` manages:
  - whisper (127.0.0.1:8000), elasticsearch (127.0.0.1:9200), kibana (127.0.0.1:5601), redis (127.0.0.1:6379)
  - Whisper has GPU access when available
- Ollama is managed by `packages/ollama/docker-compose.yml`
- Dev and prod-like orchestration:
  - `yarn dev` → runs API, UI, Worker, Whisper manager, ES manager via `scripts/run-dev.js`
  - `yarn start` → prod-like via `scripts/run-prod.js`

## Data Flow (Happy Path)

1) Upload audio via API → session created (SQLite)
2) API enqueues transcription job (BullMQ → Redis)
3) Worker transcription job:
   - Calls Whisper `/transcribe`, polls `/status/:job_id`
   - Groups segments to paragraphs; inserts into SQLite
   - Indexes transcript paragraphs to Elasticsearch
   - Marks session status completed; creates initial AI message; indexes message to Elasticsearch
4) User chats about a session (API) → uses Ollama chat via HTTP, stores messages in SQLite and indexes to Elasticsearch
5) Multi-session analysis request (API) → enqueue analysis job
6) Worker analysis job:
   - Map: For each selected session, ask Ollama to produce a per-session intermediate answer
   - Reduce: Ask Ollama to synthesize a final answer from intermediates
   - Store final result in SQLite

## Key Queues

- Transcription: `transcription-jobs`
- Analysis: `analysis-jobs`

## Important Environment Variables

- API: `PORT` (default 3001), `CORS_ORIGIN`, `DB_PATH`, `DB_UPLOADS_DIR`, `ELASTICSEARCH_URL`, `REDIS_HOST/PORT`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `WHISPER_API_URL`, `WHISPER_MODEL`
- Worker: similar to API (`DB_PATH`, service URLs)
- Whisper: `PORT`, `TEMP_INPUT_DIR`, `TEMP_OUTPUT_DIR`

## Health and Startup

- API boot: configures DB path, checks Elasticsearch health and initializes indices (`initializeIndices`) and logs model/context
- Whisper: `/health` for compose healthcheck
- Elasticsearch: healthcheck via `_cat/health`
- Run wrappers (`scripts/run-dev.js`, `scripts/run-prod.js`) ensure Redis is up and handle shutdown + cleanup

## Indexing Schema (Elasticsearch)

- Transcripts index (`therascript_transcripts`): paragraph-level docs with stemmed sub-field
- Messages index (`therascript_messages`): chat messages with stemmed sub-field and metadata

## Database Schema Highlights

- sessions, transcript_paragraphs, chats, messages, templates
- analysis_jobs, analysis_job_sessions, intermediate_summaries
- Migrations in `packages/db/src/sqliteService.ts` up to version 7 (adds `system` sender, strategy fields, unique templates, etc.)

## Where To Implement

- New REST API endpoint → `packages/api/src/routes/*` + service + repository
- New background job → `packages/worker/src/jobs/*` + add worker wiring in `src/index.ts`
- Change transcription behavior → Worker `transcriptionProcessor.ts` and Whisper service
- Change multi-session analysis → Worker `analysisProcessor.ts` and API service that creates jobs
- Search-related behavior → `packages/elasticsearch-client` helpers and `api/src/routes/searchRoutes.ts`
- Ollama model mgmt → `packages/ollama/src/*` and `api/src/routes/ollamaRoutes.ts`
- DB schema change → `packages/db/src/sqliteService.ts` (new migration version) and repositories
- UI features → `packages/ui/src/components/*` and API bindings in `src/api/*`
