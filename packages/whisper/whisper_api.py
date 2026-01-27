import os
import json
import asyncio
import subprocess
import gc
from datetime import datetime
from typing import Optional, Dict, Any
from contextlib import asynccontextmanager
from enum import Enum

import httpx
from faster_whisper import WhisperModel
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import uuid


TEMP_INPUT_DIR = os.environ.get("TEMP_INPUT_DIR", "/app/temp_inputs")
TEMP_OUTPUT_DIR = os.environ.get("TEMP_OUTPUT_DIR", "/app/temp_outputs")
DEFAULT_MODEL = os.environ.get("WHISPER_MODEL", "tiny")
MODEL_IDLE_TIMEOUT = int(os.environ.get("WHISPER_MODEL_IDLE_TIMEOUT", "300"))
TRANSCRIBE_CONCURRENCY = int(os.environ.get("WHISPER_MAX_CONCURRENCY", "1"))
JOB_RETENTION_SECONDS = int(os.environ.get("WHISPER_JOB_RETENTION", "3600"))
OLLAMA_API_URL = os.environ.get("OLLAMA_API_URL", "http://ollama:11434")


class JobStatusState(str, Enum):
    queued = "queued"
    model_loading = "model_loading"
    model_downloading = "model_downloading"
    transcribing = "transcribing"
    completed = "completed"
    failed = "failed"
    canceled = "canceled"
    canceling = "canceling"


class JobStatus(BaseModel):
    job_id: str
    status: JobStatusState
    progress: float = 0.0
    duration: Optional[float] = None
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    message: Optional[str] = None


class ModelStatus(BaseModel):
    loaded: bool
    model_name: Optional[str] = None
    device: str
    vram_allocated_mb: Optional[float] = None
    last_used: Optional[float] = None
    idle_timeout_seconds: int


class TranscribeResponse(BaseModel):
    job_id: str
    message: str


class WhisperModelManager:

    def __init__(self):
        self._model: Optional[WhisperModel] = None
        self._model_name: Optional[str] = None
        self._last_used: float = 0
        self._lock = asyncio.Lock()
        self._idle_task: Optional[asyncio.Task] = None
        self._active_jobs: int = 0

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    @property
    def model_name(self) -> Optional[str]:
        return self._model_name

    @property
    def last_used(self) -> float:
        return self._last_used

    async def acquire_model(self, model_name: str) -> WhisperModel:
        async with self._lock:
            if self._model is not None and self._model_name != model_name:
                if self._active_jobs > 0:
                    raise RuntimeError(f"Cannot switch models while {self._active_jobs} jobs active")
                print(f"[WhisperManager] Switching from {self._model_name} to {model_name}")
                await self._unload_unsafe()

            if self._model is None:
                await ensure_ollama_unloaded()

                print(f"[WhisperManager] Loading model '{model_name}'...")
                start = datetime.now()

                # Determine config
                try:
                    import torch
                    device = "cuda" if torch.cuda.is_available() else "cpu"
                except ImportError:
                    device = "cpu"

                # On CPU (Mac Docker), int8 is faster. On GPU, float16 is standard.
                compute_type = "float16" if device == "cuda" else "int8"

                self._model = WhisperModel(model_name, device=device, compute_type=compute_type)
                self._model_name = model_name

                elapsed = (datetime.now() - start).total_seconds()
                print(f"[WhisperManager] Model '{model_name}' loaded in {elapsed:.2f}s")

            self._active_jobs += 1
            self._last_used = datetime.now().timestamp()
            return self._model

    async def release_model(self):
        async with self._lock:
            self._active_jobs -= 1
            self._last_used = datetime.now().timestamp()
            self._reset_idle_timer()

    async def unload(self) -> bool:
        async with self._lock:
            if self._active_jobs > 0:
                return False
            return await self._unload_unsafe()

    async def _unload_unsafe(self) -> bool:
        if self._model is None:
            return False

        model_name = self._model_name
        print(f"[WhisperManager] Unloading model '{model_name}'...")

        # faster-whisper/CTranslate2 models are harder to explicitly unload from GPU VRAM
        # than PyTorch models. Usually deleting the object and calling GC works.
        del self._model
        self._model = None
        self._model_name = None
        gc.collect()

        print(f"[WhisperManager] Model '{model_name}' unloaded, VRAM freed")
        return True

    def _reset_idle_timer(self):
        if self._idle_task is not None:
            self._idle_task.cancel()

        if MODEL_IDLE_TIMEOUT > 0:
            self._idle_task = asyncio.create_task(self._idle_unload())

    async def _idle_unload(self):
        try:
            await asyncio.sleep(MODEL_IDLE_TIMEOUT)
            async with self._lock:
                if self._active_jobs == 0 and self._model is not None:
                    elapsed = datetime.now().timestamp() - self._last_used
                    if elapsed >= MODEL_IDLE_TIMEOUT:
                        print(f"[WhisperManager] Idle timeout ({MODEL_IDLE_TIMEOUT}s), unloading...")
                        await self._unload_unsafe()
        except asyncio.CancelledError:
            pass

    def get_status(self) -> ModelStatus:
        # Use pynvml (NVIDIA Management Library) for VRAM if available
        vram_mb = 0
        device = "cpu"
        try:
            import pynvml
            pynvml.nvmlInit()
            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            info = pynvml.nvmlDeviceGetMemoryInfo(handle)
            vram_mb = info.used / (1024 * 1024)
            pynvml.nvmlShutdown()
            device = "cuda"
        except:
            pass # Not NVIDIA or not available

        return ModelStatus(
            loaded=self.is_loaded,
            model_name=self._model_name,
            device=device,
            vram_allocated_mb=vram_mb,
            last_used=self._last_used if self._last_used > 0 else None,
            idle_timeout_seconds=MODEL_IDLE_TIMEOUT,
        )


async def ensure_ollama_unloaded() -> None:
    """Unload any Ollama model before loading Whisper to free VRAM."""
    try:
        print("[WhisperManager] Requesting Ollama model unload before Whisper load...")
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Setting keep_alive to 0 tells Ollama to unload the model immediately
            response = await client.post(
                f"{OLLAMA_API_URL}/api/generate",
                json={"model": "", "keep_alive": 0}
            )
            print(f"[WhisperManager] Ollama unload response: {response.status_code}")
    except httpx.ConnectError:
        # Ollama not running - that's fine, no model to unload
        print("[WhisperManager] Ollama not reachable, skipping unload")
    except Exception as e:
        # Don't fail transcription if Ollama unload fails
        print(f"[WhisperManager] Could not unload Ollama model: {e}")


model_manager = WhisperModelManager()
transcribe_semaphore = asyncio.Semaphore(TRANSCRIBE_CONCURRENCY)

jobs: Dict[str, JobStatus] = {}
cancel_flags: Dict[str, bool] = {}


def get_audio_duration(file_path: str) -> float:
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        file_path
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return float(result.stdout.strip()) if result.stdout.strip() else 0
    except Exception as e:
        print(f"[Whisper] ffprobe error: {e}")
        return 0


async def cleanup_old_jobs():
    while True:
        await asyncio.sleep(300)
        now = datetime.now().timestamp()
        to_remove = []
        for job_id, job in jobs.items():
            if job.status in [JobStatusState.completed, JobStatusState.failed, JobStatusState.canceled]:
                if job.end_time and (now - job.end_time) > JOB_RETENTION_SECONDS:
                    to_remove.append(job_id)
        for job_id in to_remove:
            del jobs[job_id]
            print(f"[Whisper] Cleaned up old job {job_id}")


async def run_transcription(job_id: str, input_path: str, model_name: str):
    job = jobs.get(job_id)
    if not job:
        return

    output_path = os.path.join(TEMP_OUTPUT_DIR, f"{job_id}.json")

    try:
        async with transcribe_semaphore:
            job.status = JobStatusState.model_loading
            job.message = f"Loading model '{model_name}'..."
            job.start_time = datetime.now().timestamp()

            if cancel_flags.get(job_id):
                job.status = JobStatusState.canceled
                job.message = "Canceled before model load"
                return

            duration = get_audio_duration(input_path)
            if duration <= 0:
                raise ValueError("Could not determine audio duration")
            job.duration = duration

            model = await model_manager.acquire_model(model_name)

            if cancel_flags.get(job_id):
                job.status = JobStatusState.canceled
                job.message = "Canceled after model load"
                return

            job.status = JobStatusState.transcribing
            job.message = "Transcribing audio..."
            job.progress = 1.0  # Show initial progress

            # Use asyncio to run transcription in executor and periodically check progress
            # We'll use a shared state to track the last processed segment
            last_segment_end = [0.0]  # Mutable container so the closure can update it
            
            def transcribe_sync():
                segments, info = model.transcribe(input_path, beam_size=5)
                segment_list = []
                
                # Process segments and track progress
                for segment in segments:
                    segment_list.append({
                        "id": segment.id,
                        "start": segment.start,
                        "end": segment.end,
                        "text": segment.text.strip(),
                    })
                    # Update the last segment end time for progress tracking
                    last_segment_end[0] = segment.end
                
                return {
                    "text": "".join([s["text"] for s in segment_list]),
                    "segments": segment_list,
                    "language": info.language
                }, info
            
            # Run transcription in background and update progress periodically
            loop = asyncio.get_event_loop()
            transcription_task = loop.run_in_executor(None, transcribe_sync)
            
            # Poll progress while transcription is running
            while not transcription_task.done():
                await asyncio.sleep(0.5)  # Update progress every 0.5 seconds
                if duration > 0 and last_segment_end[0] > 0:
                    # Cap at 95% until we're actually done to avoid showing 100% prematurely
                    progress_pct = min(95.0, (last_segment_end[0] / duration) * 100.0)
                    if progress_pct != job.progress:  # Only log when progress changes
                        print(f"[Whisper] Job {job_id} progress: {progress_pct:.1f}% ({last_segment_end[0]:.1f}s / {duration:.1f}s)")
                    job.progress = progress_pct
            
            # Get the result
            result, info = await transcription_task

            if cancel_flags.get(job_id):
                job.status = JobStatusState.canceled
                job.message = "Canceled during transcription"
                return

            with open(output_path, "w") as f:
                json.dump(result, f, indent=2)

            job.status = JobStatusState.completed
            job.progress = 100.0
            job.result = {
                "text": result.get("text", ""),
                "segments": result.get("segments", []),
                "language": result.get("language", "en"),
            }
            job.message = "Transcription completed"
            job.end_time = datetime.now().timestamp()

    except Exception as e:
        job.status = JobStatusState.failed
        job.error = str(e)
        job.message = f"Transcription failed: {e}"
        job.end_time = datetime.now().timestamp()
        print(f"[Whisper] Job {job_id} failed: {e}")

    finally:
        try:
            if os.path.exists(input_path):
                os.unlink(input_path)
        except Exception as e:
            print(f"[Whisper] Cleanup error: {e}")

        cancel_flags.pop(job_id, None)
        await model_manager.release_model()


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(TEMP_INPUT_DIR, exist_ok=True)
    os.makedirs(TEMP_OUTPUT_DIR, exist_ok=True)
    print(f"[Whisper API] Ready. Model idle timeout: {MODEL_IDLE_TIMEOUT}s")
    cleanup_task = asyncio.create_task(cleanup_old_jobs())
    yield
    cleanup_task.cancel()
    await model_manager.unload()


app = FastAPI(
    title="Whisper Transcription Service",
    version="2.0.0",
    lifespan=lifespan,
)


@app.get("/")
async def root():
    return {"message": "Whisper Transcription Service running."}


@app.get("/health")
async def health():
    return {"status": "healthy", "model_loaded": model_manager.is_loaded}


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    model_name: str = Form(DEFAULT_MODEL),
):
    job_id = str(uuid.uuid4())

    input_path = os.path.join(TEMP_INPUT_DIR, f"{job_id}_{file.filename}")

    with open(input_path, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            f.write(chunk)

    job = JobStatus(
        job_id=job_id,
        status=JobStatusState.queued,
        message="Job queued",
    )
    jobs[job_id] = job
    cancel_flags[job_id] = False

    background_tasks.add_task(run_transcription, job_id, input_path, model_name)

    print(f"[Whisper] Queued job {job_id} for {file.filename} with model '{model_name}'")
    return TranscribeResponse(job_id=job_id, message="Transcription job queued.")


@app.get("/status/{job_id}", response_model=JobStatus)
async def get_status(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job ID not found")
    return job


@app.post("/cancel/{job_id}")
async def cancel_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job ID not found")

    if job.status in [JobStatusState.completed, JobStatusState.failed, JobStatusState.canceled]:
        return {"job_id": job_id, "message": f"Job already in state: {job.status}"}

    cancel_flags[job_id] = True
    job.status = JobStatusState.canceling
    job.message = "Cancellation requested"

    return {"job_id": job_id, "message": "Cancellation request sent"}


@app.post("/model/unload")
async def unload_model():
    was_loaded = await model_manager.unload()
    return {
        "success": True,
        "was_loaded": was_loaded,
        "message": "Model unloaded, VRAM freed" if was_loaded else "No model was loaded or jobs still active",
    }


@app.get("/model/status", response_model=ModelStatus)
async def get_model_status():
    return model_manager.get_status()


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("WHISPER_PYTHON_PORT", "8001"))
    uvicorn.run(app, host="0.0.0.0", port=port)
