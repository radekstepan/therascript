# Therascript: TL;DR for Copilot

Use this as a fast-loading, minimal context file. It links to deeper docs.

## What this repo is
- Monorepo (Yarn workspaces, Lerna) for a therapy session analyzer.
- Services: API (Elysia), Worker (BullMQ), UI (React), Whisper (Express+Python), Ollama manager, Elasticsearch client, DB (SQLite), Docker utils, GPU utils.

## Core paths
- API: packages/api/src/server.ts (routes in src/routes, services in src/services, repos in src/repositories)
- Worker: packages/worker/src/index.ts (jobs in src/jobs/*)
- Whisper: packages/whisper/src/server.ts → src/routes.ts → transcribe.py
- Ollama: packages/ollama/src/ollamaClient.ts, src/dockerManager.ts
- ES: packages/elasticsearch-client/src/{client,mappings,searchUtils}.ts
- DB: packages/db/src/sqliteService.ts (migrations up to version 7)
- UI: packages/ui/src/App.tsx, api clients in packages/ui/src/api/*
- Orchestration: scripts/run-dev.js, scripts/run-prod.js, docker-compose.yml (whisper, elasticsearch, redis, kibana)

## Data flow (short)
1) API creates session → enqueues transcription (BullMQ→Redis)
2) Worker calls Whisper → stores paragraphs (SQLite) → indexes to Elasticsearch → posts initial AI message
3) Session chat & standalone chat → API↔Ollama → store messages → index to ES
4) Multi-session analysis → Worker map/reduce via Ollama → store final result

## Queues
- transcription-jobs, analysis-jobs

## Environment quick refs
- API/Worker: DB_PATH, ELASTICSEARCH_URL, OLLAMA_BASE_URL, WHISPER_API_URL, CORS_ORIGIN, PORT
- Whisper: PORT, TEMP_INPUT_DIR, TEMP_OUTPUT_DIR

## Docs
- Architecture: docs/ARCHITECTURE.md
- Navigation (task → files): docs/NAVIGATION.md
- Root README: README.md

## Gotchas
- Ensure API and Worker point to the same SQLite file in dev
- Elasticsearch indices initialized by API on startup
- Whisper and Ollama run in Docker; run `yarn dev` or `docker compose up -d` for services
