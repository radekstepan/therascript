# @therascript/api — Developer Notes

Purpose: ElysiaJS HTTP API server for sessions, chat, search, jobs, and service management.

## Key entrypoints
- Startup: `src/server.ts`
- Config: `src/config/index.ts` (reads `.env.api.*`)
- Routes: `src/routes/*`
- Services: `src/services/*`
- Repositories: `src/repositories/*`

## Build/Run
- Build: `yarn build` (tsc)
- Dev: `yarn dev` (tsc --watch + nodemon)
- Start: `yarn start` (runs `dist/server.js`)

## Environment
- `PORT` (default 3001)
- `CORS_ORIGIN` (default http://localhost:3002)
- `DB_PATH`, `DB_UPLOADS_DIR`
- `ELASTICSEARCH_URL` (default http://localhost:9200)
- `REDIS_HOST`, `REDIS_PORT`
- `OLLAMA_BASE_URL` (default http://localhost:11434)
- `OLLAMA_MODEL`, `OLLAMA_CHAT_KEEP_ALIVE`
- `WHISPER_API_URL` (default http://localhost:8000)
- `WHISPER_MODEL`

## Data & Dependencies
- SQLite via `@therascript/db`; migrations auto-run on boot
- Elasticsearch indices initialized on boot via `@therascript/elasticsearch-client`
- Background jobs published to BullMQ (Redis); consumed by `@therascript/worker`

## Common tasks
- Add endpoint: create `src/routes/ThingRoutes.ts`, call into `src/services/*`, persist via `src/repositories/*`, wire in `src/server.ts`
- Enqueue transcription/analysis: see `src/services/jobQueueService.ts` and `src/routes/{transcriptionRoutes,analysisRoutes}.ts`
- File paths and limits: `src/services/fileService.ts` and `src/config/index.ts`

## Gotchas
- Ensure API and Worker share the same `DB_PATH` in dev
- If ES is down, API logs errors but continues; search endpoints will be degraded
- Swagger docs at `/api/docs`