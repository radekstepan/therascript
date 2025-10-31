# Therascript Navigation Cheatsheet

Use this as a fast map from common tasks to the exact files and modules to touch.

## Quick Pointers

- Start all services (dev): root `scripts/run-dev.js` → `yarn dev`
- Start core services (compose): root `docker-compose.yml` → whisper, elasticsearch, redis, kibana
- API server: `packages/api/src/server.ts`
- API config and envs: `packages/api/src/config/index.ts` (reads `.env.api.*`)
- Worker entry: `packages/worker/src/index.ts` (reads `.env.worker.*`)
- Whisper service: `packages/whisper/src/server.ts` + `src/routes.ts` + `transcribe.py`
- Ollama management: `packages/ollama/src/dockerManager.ts`, `src/ollamaClient.ts`
- DB migrations: `packages/db/src/sqliteService.ts`
- Elasticsearch mappings: `packages/elasticsearch-client/src/mappings.ts`
- UI app: `packages/ui/src/App.tsx`, feature components in `src/components/*`

### Per-package developer notes

- API: packages/api/DEV_NOTES.md
- Worker: packages/worker/DEV_NOTES.md
- Whisper: packages/whisper/DEV_NOTES.md
- Ollama: packages/ollama/DEV_NOTES.md
- Elasticsearch Client: packages/elasticsearch-client/DEV_NOTES.md
- Elasticsearch Manager: packages/elasticsearch-manager/DEV_NOTES.md
- DB (SQLite): packages/db/DEV_NOTES.md
- Docker Utils: packages/docker-utils/DEV_NOTES.md
- GPU Utils: packages/gpu-utils/DEV_NOTES.md
- UI: packages/ui/DEV_NOTES.md

## Common Scenarios

1) Add a new API endpoint
- Create a route in `packages/api/src/routes/YourThingRoutes.ts`
- Add business logic in `packages/api/src/services/YourThingService.ts`
- Persist/Query via `packages/api/src/repositories/*`
- Wire the route into the app in `src/server.ts` with `.use(yourRoutes)`
- Add UI calls in `packages/ui/src/api/yourThing.ts` and components under `src/components`

2) Fix a bug in transcription flow
- Worker job: `packages/worker/src/jobs/transcriptionProcessor.ts`
- API routes kicking off jobs: `packages/api/src/routes/transcriptionRoutes.ts`
- Whisper backend: `packages/whisper/src/routes.ts`, `src/jobManager.ts`, and `transcribe.py`
- ES indexing helpers: `packages/elasticsearch-client/src/searchUtils.ts`
- DB schema/columns: `packages/db/src/sqliteService.ts`

3) Change multi-session analysis behavior
- Worker job: `packages/worker/src/jobs/analysisProcessor.ts`
- Strategy generation or job creation: `packages/api/src/services/analysisJobService.ts` and route `src/routes/analysisRoutes.ts`
- Types and repository access: `packages/api/src/types/*`, `src/repositories/analysisRepository.ts`

4) Update search behavior
- Query code and helpers: `packages/elasticsearch-client/src/searchUtils.ts`
- Index mappings: `packages/elasticsearch-client/src/mappings.ts`
- API search routes: `packages/api/src/routes/searchRoutes.ts`
- UI search: `packages/ui/src/components/Search/*` and `src/api/search.ts`

5) Add a new background job type
- Define processor in `packages/worker/src/jobs/*`
- Export queue name from the job module
- Wire a Worker in `packages/worker/src/index.ts`
- Expose API endpoints to enqueue or monitor in `packages/api/src/routes/jobsRoutes.ts`

6) Change how files are stored or located
- File resolution and upload constraints: `packages/api/src/services/fileService.ts` and `src/config/index.ts`
- DB `uploadsDir` and `DB_PATH` come from env via the config

7) Ollama model issues (not pulled, bad health)
- Health/ensure/start: `packages/ollama/src/dockerManager.ts` and `@therascript/docker-utils`
- Model chat and list: `packages/ollama/src/ollamaClient.ts`
- API routes: `packages/api/src/routes/ollamaRoutes.ts`

8) GPU stats not showing correctly
- Stats collector: `packages/gpu-utils/src/index.ts`
- UI consumption: search in `packages/ui` for GPU-related hooks/components

9) Database migrations or seeding
- Add a migration step by increasing `LATEST_SCHEMA_VERSION` and appending steps in `packages/db/src/sqliteService.ts`
- Seed system templates in the same file (see `SYSTEM_PROMPT_TEMPLATES`)

10) Dev and prod-like run issues
- Wrappers: `scripts/run-dev.js` and `scripts/run-prod.js` (they ensure Redis, manage shutdown, and clean up containers)
- Environment files: `.env.api.dev`, `.env.worker.dev`, `.env.api.prod`, `.env.worker.prod`

## Important Types and Contracts

- Analysis job types: `packages/api/src/types/*` and DB tables in `packages/db/src/sqliteService.ts`
- Transcription types and ES documents: `packages/elasticsearch-client/src/searchUtils.ts`
- Worker job data: `packages/worker/src/types.ts`
- Chat message type: `packages/api/src/types/index.ts` (sender: 'user' | 'ai' | 'system') maps to DB and ES

## Fast Grep Targets

- Enqueue transcription: `addJob('transcription-jobs'` in API services/routes
- Enqueue analysis: `addJob('analysis-jobs'` in API services/routes
- ES index names: `TRANSCRIPTS_INDEX`, `MESSAGES_INDEX`
- Whisper endpoints: `/transcribe`, `/status/:job_id`
- Ollama chat: POST `${OLLAMA_BASE_URL}/api/chat`

## Cross-Cutting Notes

- API and Worker both configure DB paths on boot based on their own `.env` files; ensure both point to the same SQLite file in dev
- Elasticsearch indices are initialized on API startup; worker uses the same client helpers for indexing
- Routes wire order in `api/src/server.ts` matters only for docs grouping; errors handled centrally with helpful logs
