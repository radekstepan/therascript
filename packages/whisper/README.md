# Whisper Transcription Service (`packages/whisper`)

This package contains the Docker configuration (`Dockerfile`) and Python code (`server.py`, `transcribe.py`) for running an OpenAI Whisper transcription service as part of the Therascript application.

## Purpose

*   Provide a dedicated, containerized service for performing audio transcription using OpenAI's Whisper model.
*   Expose a simple REST API (built with FastAPI) for other services (specifically `packages/api`) to submit transcription jobs and check their status.
*   Leverage GPU acceleration via Docker if available on the host machine.

## Key Components

*   **`Dockerfile`:** Defines the Docker image build process.
    *   Installs Python, system dependencies (like `ffmpeg`), and Python libraries (`requirements.txt`).
    *   Installs PyTorch with CUDA support separately for better compatibility.
    *   Copies the Python application code (`server.py`, `transcribe.py`).
    *   Exposes port 8000.
    *   Sets the entry point to run the FastAPI server using `uvicorn`.
*   **`server.py`:** Implements the FastAPI application.
    *   Defines API endpoints:
        *   `/transcribe` (POST): Accepts an audio file upload and model name, queues a transcription job, and returns a job ID. Runs the actual transcription in a background process using `asyncio.create_subprocess_exec`.
        *   `/status/{job_id}` (GET): Returns the current status (queued, processing, completed, failed, canceled) and progress of a specific job.
        *   `/cancel/{job_id}` (POST): Attempts to cancel an ongoing job (by sending SIGTERM to the subprocess).
        *   `/health` (GET): Simple health check endpoint.
    *   Manages job state (status, results, errors) in an in-memory dictionary (`jobs`).
    *   Parses stdout/stderr from the `transcribe.py` subprocess to update job progress and status.
*   **`transcribe.py`:** A standalone Python script responsible for the actual Whisper transcription.
    *   Takes input audio file path, output JSON file path, and model name as command-line arguments.
    *   Loads the specified Whisper model (leveraging GPU if available via PyTorch).
    *   Uses `whisper.transcribe()` to perform the transcription.
    *   Writes the JSON result (including text and segments) to the output file.
    *   Prints JSON status updates (loading, started, completed, error, progress hints) to stdout/stderr, which are parsed by `server.py`.
    *   Includes signal handling (`SIGTERM`, `SIGINT`) to attempt graceful cancellation.
*   **`requirements.txt`:** Lists Python dependencies (FastAPI, Uvicorn, OpenAI Whisper, etc.).
*   **`src/dockerManager.ts` / `src/index.ts`:** Node.js scripts used by the *root* `run-dev.js` script to manage the lifecycle (start, health check, stop) of the Whisper Docker container during development. Uses `docker compose` commands targeting the *root* `docker-compose.yml`.

## Usage

This service is intended to be run as a Docker container, managed by the root `docker-compose.yml` file.

1.  **Build:** The Docker image (`therascript/whisper`) is built automatically when running `docker compose up` from the project root.
2.  **Run:** The service (`therascript_whisper_service`) is started by the root `docker-compose.yml`.
    *   The root compose file maps port `8000` on the host to port `8000` in the container.
    *   It mounts a named volume (`whisper_models`) to `/root/.cache` inside the container to persist downloaded Whisper models.
    *   It includes `deploy` configuration for GPU access.
3.  **Interaction:** The `packages/api` service interacts with this service via HTTP requests to its FastAPI endpoints (e.g., `POST /transcribe`, `GET /status/{job_id}`) using the URL defined in its environment (`WHISPER_API_URL`, typically `http://localhost:8000` for local development).

## Notes

*   Ensure Docker and potentially the NVIDIA Container Toolkit are installed and configured correctly on the host machine.
*   Transcription performance is significantly enhanced by GPU acceleration.
*   The service relies on the `api` package to manage the lifecycle of uploaded audio files and the final transcript data storage. This service only handles the transcription process itself.
