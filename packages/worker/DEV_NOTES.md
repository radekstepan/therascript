# @therascript/worker — Developer Notes

Purpose: BullMQ consumers for long-running jobs (transcription, multi-session analysis).

## Key entrypoints

- Startup: `src/index.ts`
- Jobs: `src/jobs/transcriptionProcessor.ts`, `src/jobs/analysisProcessor.ts`
- Config: `src/config/index.ts`
- Redis connection: `src/redisConnection.ts`
- Job types: `src/types.ts`

## Build/Run

- Build: `yarn build`
- Dev: `yarn dev` (tsc --watch + nodemon)
- Start: `yarn start` (runs `dist/index.js`)

## Environment

- `NODE_ENV`, `APP_MODE`
- `DB_PATH` (defaults to `../api/data/therapy-analyzer-dev.sqlite` resolved from package dir)
- `REDIS_HOST`, `REDIS_PORT`
- `WHISPER_API_URL`, `WHISPER_MODEL`
- `OLLAMA_BASE_URL`, `ELASTICSEARCH_URL`

## Data & Dependencies

- Uses `@therascript/api` build artifacts for repository/service types and helpers (reads from `@therascript/api/dist/...`)
- Stores transcripts and messages into SQLite via API repositories; indexes docs to Elasticsearch

## Common tasks

- Adjust paragraph grouping or Whisper polling: `src/jobs/transcriptionProcessor.ts`
- Change Map/Reduce prompts or logic: `src/jobs/analysisProcessor.ts`
- Add a new job type: create a processor in `src/jobs/*`, wire a `Worker` in `src/index.ts`, expose enqueue endpoints in API

## Gotchas

- Concurrency is limited to 1 for transcription to prevent GPU memory exhaustion
- Do not increase transcription concurrency unless you have confirmed adequate GPU VRAM
- Ensure `DB_PATH` matches the API’s DB in dev
