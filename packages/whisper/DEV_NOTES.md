# @therascript/whisper — Developer Notes

Purpose: Express proxy (`src/server.ts`) in front of the Python FastAPI
transcription service (`whisper_api.py`: Parakeet ASR + Community-1
diarization). Exposes `/transcribe`, `/status/:job_id`, `/cancel/:job_id`,
`/health`, `/diarization/check|prefetch`, `/model/status|unload`.

## Key entrypoints
- Server: `src/server.ts`
- Routes: `src/routes.ts`
- Job manager (proxies to Python API): `src/jobManager.ts`
- Python API + orchestration: `whisper_api.py`
- Normalized pipeline (no model deps at import): `pipeline/`
- Dockerfile: `packages/whisper/Dockerfile` (used by root docker-compose)

## Build/Run
- Build: `yarn build`
- In dev via root: `docker compose up -d --build whisper`
- Rebuild `packages/whisper/dist` on the host (`yarn build:whisper`) before
  rebuilding images; use `--force-recreate` if routes 404 after changes.

## Environment
- `PORT` (default 8000, Node proxy), `WHISPER_PYTHON_URL` (default `http://localhost:8001`)
- `TEMP_INPUT_DIR` (default `/app/temp_inputs`), `TEMP_OUTPUT_DIR` (default `/app/temp_outputs`)
- `HF_TOKEN` (Community-1 access), `PARAKEET_MODEL_ID`, `PARAKEET_CHUNK_SEC`
- `model_name` on `/transcribe` is accepted but ignored (always Parakeet)

## Flow
- POST `/transcribe` accepts file + `num_speakers`; returns `job_id`
- Python runs Parakeet → Community-1 (exclusive) → attribution in an executor;
  progress published on the job record
- GET `/status/:job_id` returns status/result; `/cancel/:job_id` sets a flag

## Gotchas
- Large files require enough Docker RAM; first boot downloads ~2.5GB Parakeet
  weights + Community-1 into persistent HF/torch cache volumes
- Models are load-once singletons; `POST /model/unload` frees VRAM
