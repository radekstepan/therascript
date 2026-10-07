# Transcription Service (`packages/whisper`)

Containerized transcription + diarization service for Therascript.
Stack: **Parakeet TDT 0.6B v2** (NeMo) for English ASR with native word
timestamps, **pyannote Community-1** for speaker diarization. Full details in
[`docs/TRANSCRIPTION_BACKENDS.md`](../../docs/TRANSCRIPTION_BACKENDS.md);
upgrade path from the old WhisperX stack in the root
[README](../../README.md#upgrading-from-whisperx).

## Components

*   **`whisper_api.py`:** FastAPI app (port 8001 inside the container).
    *   `POST /transcribe` — accepts audio + `num_speakers` (0 disables
        diarization, ≥2 enables it), queues a job, returns `job_id`.
        `model_name` is accepted but ignored (ASR is always Parakeet).
    *   `GET /status/{job_id}` — job state incl. `result.segments`
        (`[{start, end, text, speaker}]`).
    *   `POST /cancel/{job_id}`, `POST /model/unload`, `GET /model/status`,
        `GET /diarization/check`, `POST /diarization/prefetch`,
        `GET /health`.
    *   Pipeline: audio → Parakeet words → Community-1 exclusive diarization
        → attribution → segments. No alignment stage.
*   **`pipeline/`:** model-independent code — `schema.py` (normalized
    `Word` / `DiarizationSegment` / `AttributedWord`), `attribution.py`
    (word→speaker reconciliation), `backends.py` (`ASRBackend` /
    `Diarizer` ABCs + Parakeet/Community-1 adapters).
    Tests: `python3 pipeline/test_attribution.py` (no model downloads).
*   **`eval/compare_backends.py`:** standalone WER / DER / cpWER scoring
    against a speaker-labelled reference (stdlib only).
*   **`src/` (Node/Express, port 8000):** thin proxy in front of the Python
    API (`server.ts` → `routes.ts` → `jobManager.ts`).
*   **`Dockerfile` / `Dockerfile.gpu`:** CPU (Python 3.11-slim, torch 2.8)
    and GPU (CUDA 12.6, torch 2.8 cu126) images, both supervised
    (`supervisord.conf` runs Python API + Node proxy).

## Usage

Built and run via the root `docker-compose.yml`:

```bash
docker compose up -d --build                                     # CPU
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build  # GPU
```

*   Port `8000` on the host maps to the Node proxy in the container.
*   Named volumes persist caches: `whisper_models` (`/root/.cache/whisper`),
    `hf_cache` (`/root/.cache/huggingface`), `torch_cache`
    (`/root/.cache/torch`) — Parakeet (~2.5GB) and Community-1 weights live
    here after first download.
*   Requires `HF_TOKEN` with accepted Community-1 conditions (see root README
    setup). Check `GET /diarization/check` (`ready: true`) before uploading.
