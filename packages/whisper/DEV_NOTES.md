# @therascript/whisper — Developer Notes

Purpose: Express service wrapping a Python `transcribe.py` process; exposes `/transcribe`, `/status/:job_id`, `/cancel/:job_id`, `/health`.

## Key entrypoints
- Server: `src/server.ts`
- Routes: `src/routes.ts`
- Job manager (spawns python): `src/jobManager.ts`
- Python script: `transcribe.py`
- Dockerfile: `packages/whisper/Dockerfile` (used by root docker-compose)

## Build/Run
- Build: `yarn build`
- Start: `yarn start` (runs `dist/index.js` but the service endpoints are in `src/server.ts` — ensure you build the TS to dist if running directly)
- In dev via root: `docker compose up -d --build whisper`

## Environment
- `PORT` (default 8000)
- `TEMP_INPUT_DIR` (default `/app/temp_inputs`), `TEMP_OUTPUT_DIR` (default `/app/temp_outputs`)

## Flow
- POST `/transcribe` accepts file + model; returns `job_id`
- Background process streams progress; state kept in-memory in `jobManager.ts`
- GET `/status/:job_id` returns status/result; `/cancel/:job_id` sends SIGTERM to child

## Gotchas
- Large files require enough Docker RAM; OOM kills appear as `exitSignal` in logs
- Model download progress comes via stderr; job manager parses and updates status