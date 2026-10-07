import os
import json
import asyncio
import subprocess
import gc
import threading
import torch
from datetime import datetime
from typing import Optional, Dict, Any
from contextlib import asynccontextmanager
from enum import Enum

import httpx
from huggingface_hub import scan_cache_dir
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import uuid


# ---- Pydantic models for diarization check / prefetch endpoints ----

class DiarizationCheckResponse(BaseModel):
    hf_token_set: bool
    model_cached: bool
    ready: bool
    missing_repos: Optional[list[str]] = None
    prefetch_in_progress: bool = False
    error: Optional[str] = None


class DiarizationPrefetchResponse(BaseModel):
    started: bool
    already_cached: bool
    message: str


# ---- Diarization cache helpers ----

# pyannote Community-1 bundles segmentation/embedding/clustering sub-models.
DIARIZATION_REQUIRED_REPOS: list[str] = [
    "pyannote/speaker-diarization-community-1",
]
DIARIZATION_MODEL_ID = "pyannote/speaker-diarization-community-1"


def _get_missing_diarization_repos() -> list[str]:
    """Return list of required diarization repos that do not have a cached revision."""
    required_repos = DIARIZATION_REQUIRED_REPOS

    def _repo_cached_in_torch_cache(repo_id: str) -> bool:
        repo_cache_name = f"models--{repo_id.replace('/', '--')}"
        root = os.path.join(os.path.expanduser("~"), ".cache", "torch", "pyannote", repo_cache_name)
        snapshots_dir = os.path.join(root, "snapshots")
        if not os.path.isdir(snapshots_dir):
            return False
        try:
            return any(os.path.isdir(os.path.join(snapshots_dir, entry)) for entry in os.listdir(snapshots_dir))
        except Exception:
            return False

    cached_repo_ids: set[str] = set()
    try:
        cache = scan_cache_dir()
        cached_repo_ids = {
            repo.repo_id
            for repo in cache.repos
            if len(repo.revisions) > 0
        }

    except Exception:
        pass

    return [
        repo_id
        for repo_id in required_repos
        if repo_id not in cached_repo_ids and not _repo_cached_in_torch_cache(repo_id)
    ]


def _is_diarization_model_cached() -> bool:
    """Return True only when all required pyannote repos are cached locally."""
    return len(_get_missing_diarization_repos()) == 0


_prefetch_lock = threading.Lock()
_prefetch_running = False


def _do_prefetch_diarization_sync() -> None:
    """
    Blocking worker: calls Pipeline.from_pretrained (CPU only, no .to(device))
    to trigger the full pyannote dependency tree download and cache it.
    Run via asyncio loop.run_in_executor so it does not block the event loop.
    """
    global _prefetch_running
    try:
        print("[WhisperAPI] Prefetch: starting Pipeline.from_pretrained to cache all sub-models...", flush=True)
        from pyannote.audio import Pipeline
        pipeline = Pipeline.from_pretrained(DIARIZATION_MODEL_ID, token=HF_TOKEN)
        del pipeline
        import gc as _gc
        _gc.collect()
        print("[WhisperAPI] Prefetch: diarization models cached successfully.", flush=True)
    except Exception as e:
        err_str = str(e)
        if "401" in err_str or "403" in err_str or "gated" in err_str.lower() or "access" in err_str.lower() or "unauthorized" in err_str.lower():
            print(f"[AUTH ERROR] Prefetch failed — HF_TOKEN lacks model access: {e}", flush=True)
        else:
            print(f"[WhisperAPI] Prefetch failed: {e}", flush=True)
        raise
    finally:
        with _prefetch_lock:
            _prefetch_running = False


async def _start_prefetch_if_needed() -> tuple[bool, bool]:
    """
    Check cache and, if needed, kick off a background prefetch.
    Returns (already_cached, started).
    """
    global _prefetch_running
    if _is_diarization_model_cached():
        return True, False
    with _prefetch_lock:
        if _prefetch_running:
            return False, False  # already in progress
        _prefetch_running = True
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, _do_prefetch_diarization_sync)
    return False, True


TEMP_INPUT_DIR = os.environ.get("TEMP_INPUT_DIR", "/app/temp_inputs")
TEMP_OUTPUT_DIR = os.environ.get("TEMP_OUTPUT_DIR", "/app/temp_outputs")
# NOTE: `model_name` is still accepted on /transcribe for wire compatibility
# but ignored — ASR is always Parakeet (PARAKEET_MODEL_ID). WHISPER_MODEL is
# retired; see README "Upgrading from WhisperX".
MODEL_IDLE_TIMEOUT = int(os.environ.get("WHISPER_MODEL_IDLE_TIMEOUT", "300"))
TRANSCRIBE_CONCURRENCY = int(os.environ.get("WHISPER_MAX_CONCURRENCY", "1"))
JOB_RETENTION_SECONDS = int(os.environ.get("WHISPER_JOB_RETENTION", "3600"))
LLM_UNLOAD_URL = os.environ.get("LLM_UNLOAD_URL", "http://host.docker.internal:3001/api/llm/unload")
HF_TOKEN = os.environ.get("HF_TOKEN")


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


# NOTE: The WhisperX model manager was removed with the legacy stack.
# Models are now load-once singletons below (Parakeet ASR + Community-1),
# loaded lazily on first use and freed via POST /model/unload or after
# MODEL_IDLE_TIMEOUT seconds without jobs.
_model_last_used: float = 0
_active_jobs: int = 0
_idle_unload_task = None


def _touch_models() -> None:
    global _model_last_used
    _model_last_used = datetime.now().timestamp()


def _job_acquire() -> None:
    """Mark a transcription job as active; cancel any pending idle unload."""
    # NOTE: _active_jobs is only touched on the event-loop thread
    # (run_transcription acquire/release, _idle_unload, /model/unload), so
    # no lock is needed. It must NOT take _models_lock: that lock is held
    # for minutes by model loads on executor threads, and taking it here
    # would block the event loop and freeze /health, /status and /cancel.
    global _active_jobs, _idle_unload_task
    _active_jobs += 1
    if _idle_unload_task is not None and not _idle_unload_task.done():
        _idle_unload_task.cancel()
        _idle_unload_task = None


def _job_release() -> None:
    """Mark a transcription job as done; restart the idle-unload timer."""
    # See _job_acquire: lock-free, event-loop only.
    global _active_jobs
    _active_jobs = max(0, _active_jobs - 1)
    _touch_models()
    _reset_idle_timer()


def _reset_idle_timer() -> None:
    global _idle_unload_task
    if MODEL_IDLE_TIMEOUT <= 0:
        return
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        return
    if _idle_unload_task is not None and not _idle_unload_task.done():
        _idle_unload_task.cancel()
    _idle_unload_task = loop.create_task(_idle_unload())


async def _idle_unload() -> None:
    try:
        await asyncio.sleep(MODEL_IDLE_TIMEOUT)
        # Lock-free read: _active_jobs only changes on this thread.
        active = _active_jobs
        if active == 0:
            elapsed = datetime.now().timestamp() - _model_last_used
            if elapsed >= MODEL_IDLE_TIMEOUT:
                print(f"[WhisperManager] Idle timeout ({MODEL_IDLE_TIMEOUT}s), unloading...")
                unload_models(force=True)
    except asyncio.CancelledError:
        pass


def build_model_status() -> ModelStatus:
    # Report the device actually selected by jobs (torch visibility), not just
    # host GPU presence. Falls back to live CUDA availability before any job ran.
    device = _parakeet_device or ("cuda" if torch.cuda.is_available() else "cpu")
    # Use pynvml (NVIDIA Management Library) for VRAM if available
    vram_mb = 0
    try:
        import pynvml
        pynvml.nvmlInit()
        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        info = pynvml.nvmlDeviceGetMemoryInfo(handle)
        vram_mb = info.used / (1024 * 1024)
        pynvml.nvmlShutdown()
    except:
        pass # Not NVIDIA or not available

    return ModelStatus(
        loaded=_parakeet_model is not None,
        model_name=PARAKEET_MODEL_ID if _parakeet_model is not None else None,
        device=device,
        vram_allocated_mb=vram_mb,
        last_used=_model_last_used if _model_last_used > 0 else None,
        idle_timeout_seconds=MODEL_IDLE_TIMEOUT,
    )


def unload_models(force: bool = False) -> bool:
    """Free Parakeet + diarizer singletons. Returns True if anything was loaded.

    Refuses while jobs are active (unless force=True, e.g. idle timeout racing
    a just-finished job or process shutdown) so a chat-model load cannot pull
    VRAM out from under a running transcription.
    """
    global _parakeet_model, _parakeet_device, _diarizer, _diarizer_device
    # Fast refuse before taking _models_lock: the lock may be held for minutes
    # by a model load on an executor thread, and this runs on the event loop.
    # (_active_jobs only changes on the event loop, so the check is race-free
    # here; force=True still takes the lock and unloads.)
    if not force and _active_jobs > 0:
        print(f"[WhisperManager] Unload refused — {_active_jobs} job(s) still active")
        return False
    with _models_lock:
        if _parakeet_model is None and _diarizer is None:
            return False
        print("[WhisperManager] Unloading Parakeet + diarizer, freeing VRAM...")
        _parakeet_model = None
        _parakeet_device = None
        _diarizer = None
        _diarizer_device = None
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    print("[WhisperManager] Models unloaded, VRAM freed")
    return True


async def ensure_llm_unloaded() -> None:
    """Unload any LLM model before loading Whisper to free VRAM."""
    try:
        print("[WhisperManager] Requesting LLM model unload before Whisper load...")
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(LLM_UNLOAD_URL)
            print(f"[WhisperManager] LLM unload response: {response.status_code}")
    except httpx.ConnectError:
        print("[WhisperManager] LLM API not reachable, skipping unload")
    except Exception as e:
        print(f"[WhisperManager] Could not unload LLM model: {e}")


transcribe_semaphore = asyncio.Semaphore(TRANSCRIBE_CONCURRENCY)


# ---------------------------------------------------------------------------
# Models: Parakeet ASR + pyannote Community-1 diarization.
# Load-once singletons (not per request) to avoid repeated multi-GB loads.
# ---------------------------------------------------------------------------
try:
    from pipeline.attribution import attribute_words, words_to_segments
    from pipeline.backends import (
        PARAKEET_MODEL_ID,
        CommunityDiarizer,
        ParakeetASRBackend,
        TranscriptionCancelled,
    )

    _PIPELINE_AVAILABLE = True
except Exception as _pipeline_import_error:  # pragma: no cover - import guard
    print(f"[WhisperAPI] pipeline package unavailable: {_pipeline_import_error}")
    _PIPELINE_AVAILABLE = False
    PARAKEET_MODEL_ID = os.environ.get(
        "PARAKEET_MODEL_ID", "nvidia/parakeet-tdt-0.6b-v2"
    )

    class TranscriptionCancelled(Exception):  # type: ignore[no-redef]
        """Fallback when the pipeline package failed to import."""

_models_lock = threading.Lock()
_parakeet_model = None
_parakeet_device: Optional[str] = None
_diarizer = None
_diarizer_device: Optional[str] = None


def _require_pipeline() -> None:
    if not _PIPELINE_AVAILABLE:
        raise RuntimeError("Transcription pipeline package failed to import.")


def _get_parakeet_model(device: str):
    """Load-once Parakeet ASR singleton (thread-safe)."""
    global _parakeet_model, _parakeet_device
    _require_pipeline()
    with _models_lock:
        if _parakeet_model is None:
            print(f"[WhisperManager] Loading Parakeet ASR ({PARAKEET_MODEL_ID})...")
            start = datetime.now()
            _parakeet_model = ParakeetASRBackend(device=device)
            _parakeet_device = device
            elapsed = (datetime.now() - start).total_seconds()
            print(f"[WhisperManager] Parakeet ASR loaded in {elapsed:.2f}s")
        _touch_models()
        return _parakeet_model


def _get_diarizer(device: str):
    """Load-once Community-1 diarizer singleton (thread-safe)."""
    global _diarizer, _diarizer_device
    _require_pipeline()
    if not HF_TOKEN:
        raise RuntimeError(
            "HF_TOKEN is not set — cannot load diarization pipeline. "
            "Set HF_TOKEN and restart, or submit with num_speakers=0."
        )
    with _models_lock:
        if _diarizer is None:
            print("[WhisperManager] Loading diarizer 'pyannote/speaker-diarization-community-1'...")
            _diarizer = CommunityDiarizer(token=HF_TOKEN, device=device)
            _diarizer_device = device
            print("[WhisperManager] Diarizer loaded.")
        _touch_models()
        return _diarizer


def load_audio_16k(file_path: str):
    """Load any ffmpeg-decodable audio as float32 mono at 16kHz.

    Decodes via ffmpeg so container formats libsndfile cannot open
    (m4a/aac/mp4/webm/mov/avi/mkv/flv/mpeg) work the same as wav/flac/ogg.
    Falls back to soundfile only if ffmpeg fails.
    """
    import numpy as _np

    cmd = [
        "ffmpeg", "-v", "error",
        "-i", file_path,
        "-f", "f32le", "-ac", "1", "-ar", "16000",
        "-",
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, check=True)
        if result.stdout:
            return _np.frombuffer(result.stdout, dtype=_np.float32).copy()
        raise ValueError("ffmpeg decoded 0 bytes")
    except Exception as ffmpeg_err:
        detail = str(ffmpeg_err)
        stderr = getattr(ffmpeg_err, "stderr", None)
        if stderr:
            try:
                stderr_text = stderr.decode().strip() if isinstance(stderr, bytes) else str(stderr).strip()
            except Exception:
                stderr_text = ""
            if stderr_text:
                detail = f"{detail} | ffmpeg stderr: {stderr_text}"
        print(f"[Whisper] ffmpeg decode failed ({detail}), falling back to soundfile")
        import soundfile as sf

        data, sr = sf.read(file_path, dtype="float32", always_2d=False)
        if data.ndim > 1:
            data = data.mean(axis=-1)
        if sr != 16000:
            import torch
            import torchaudio.functional as F

            tensor = torch.from_numpy(data).unsqueeze(0)
            tensor = F.resample(tensor, sr, 16000)
            data = tensor.squeeze(0).numpy()
        return data


def run_pipeline(
    audio,
    num_speakers: int,
    diarize: bool,
    device: str,
    on_stage=None,
    is_cancelled=None,
) -> tuple[list, str]:
    """Run Parakeet ASR + Community-1 diarization + attribution.

    Returns (segments_out, language) in the wire format:
    [{start, end, text, speaker}]. ``num_speakers`` is the user's selection
    passed straight through (never hard-coded). ``on_stage`` (optional)
    receives "transcribing" / "diarizing" / "attributing" as each phase
    starts so progress reporting tracks the real work. ``is_cancelled``
    (optional) aborts between ASR chunks; diarization itself is one
    uninterruptible call.
    """
    if on_stage is not None:
        on_stage("transcribing")
    print("[Whisper] Transcribing with Parakeet (native word timestamps, no alignment)...")
    asr = _get_parakeet_model(device)
    words, language = asr.transcribe(audio, is_cancelled=is_cancelled)

    print(f"[Whisper] {len(words)} words, language={language}")
    if diarize:
        if on_stage is not None:
            on_stage("diarizing")
        print(f"[Whisper] Diarizing with Community-1 (num_speakers={num_speakers}, exclusive segments)...")
        diarizer = _get_diarizer(device)
        segments = diarizer.diarize(audio, num_speakers=num_speakers)
        print(f"[Whisper] {len(segments)} diarization segments")
        if on_stage is not None:
            on_stage("attributing")
        attributed = attribute_words(words, segments)
        n_unknown = sum(1 for w in attributed if w.speaker is None)
        if n_unknown:
            print(f"[Whisper] {n_unknown}/{len(attributed)} words without speaker (gaps/edges)")
    else:
        print("[Whisper] Diarization disabled — words unattributed")
        from pipeline.schema import AttributedWord as _AW

        attributed = [
            _AW(text=w.text, start=w.start, end=w.end, speaker=None) for w in words
        ]
    segments_out = words_to_segments(attributed)
    return segments_out, language

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


async def run_transcription(
    job_id: str,
    input_path: str,
    model_name: str,
    num_speakers: int,
    diarize: bool = False,
):
    # NOTE: `model_name` is accepted for wire compatibility but ignored —
    # ASR is always Parakeet. See README "Upgrading from WhisperX".
    job = jobs.get(job_id)
    if not job:
        return

    output_path = os.path.join(TEMP_OUTPUT_DIR, f"{job_id}.json")

    try:
        async with transcribe_semaphore:
            _job_acquire()
            try:
                job.status = JobStatusState.model_loading
                job.message = "Loading transcription models..."
                job.start_time = datetime.now().timestamp()

                if cancel_flags.get(job_id):
                    job.status = JobStatusState.canceled
                    job.message = "Canceled before model load"
                    job.end_time = datetime.now().timestamp()
                    return

                duration = get_audio_duration(input_path)
                if duration <= 0:
                    raise ValueError("Could not determine audio duration")
                job.duration = duration

                device = "cuda" if torch.cuda.is_available() else "cpu"
                print(f"[Whisper] Job {job_id}: using device={device}")

                # Free LLM VRAM for transcription models; fail fast when
                # diarization was requested but HF_TOKEN is missing.
                await ensure_llm_unloaded()
                if diarize and not HF_TOKEN:
                    raise RuntimeError(
                        "HF_TOKEN is not set — cannot load diarization pipeline. "
                        "Set HF_TOKEN and restart, or submit with num_speakers=0."
                    )

                if cancel_flags.get(job_id):
                    job.status = JobStatusState.canceled
                    job.message = "Canceled before transcription"
                    job.end_time = datetime.now().timestamp()
                    return

                job.status = JobStatusState.transcribing
                job.message = "Transcribing audio..."
                job.progress = 1.0

                last_stage = ["transcribing"]
                stage_start_time = [datetime.now().timestamp()]

                def _on_stage(stage: str) -> None:
                    last_stage[0] = stage
                    stage_start_time[0] = datetime.now().timestamp()

                # Parakeet emits word timestamps natively — no alignment stage.
                if diarize:
                    stage_progress_range = {
                        "transcribing": (1.0, 60.0),
                        "diarizing":    (60.0, 88.0),
                        "attributing":  (88.0, 95.0),
                    }
                else:
                    stage_progress_range = {
                        "transcribing": (1.0, 95.0),
                    }

                def transcribe_sync():
                    print(f"[Whisper] Job {job_id}: Transcribing (duration={duration:.1f}s, asr={PARAKEET_MODEL_ID})...", flush=True)
                    print(f"[Whisper] Job {job_id}: NOTE Parakeet ASR is English-only; non-English audio will transcribe poorly.", flush=True)
                    audio = load_audio_16k(input_path)
                    segments_out, language = run_pipeline(
                        audio, num_speakers, diarize, device,
                        on_stage=_on_stage,
                        is_cancelled=lambda: cancel_flags.get(job_id, False),
                    )
                    print(f"[Whisper] Job {job_id}: Done - {len(segments_out)} segments, language={language}", flush=True)
                    for i, seg in enumerate(segments_out):
                        speaker_tag = f"[{seg.get('speaker', 'UNKNOWN')}] "
                        print(f"[Whisper] Job {job_id}:   seg {i+1:03d} [{seg.get('start',0):.2f}s-{seg.get('end',0):.2f}s] {speaker_tag}{seg.get('text','').strip()}", flush=True)
                    return {"segments": segments_out, "language": language}

                # Run transcription in background and update progress periodically
                loop = asyncio.get_event_loop()
                transcription_task = loop.run_in_executor(None, transcribe_sync)

                # Rough time budget per stage for interpolation (seconds).
                # CPU Community-1 diarization is typically 1–3× realtime.
                stage_time_budget = {
                    "transcribing":  max(duration * 0.05, 30),
                    "diarizing":     max(duration * 2.5, 60),   # pessimistic CPU estimate
                    "attributing":   5,
                }

                while not transcription_task.done():
                    await asyncio.sleep(1.0)
                    stage = last_stage[0]
                    elapsed_stage = datetime.now().timestamp() - stage_start_time[0]
                    elapsed_total = datetime.now().timestamp() - job.start_time
                    p_start, p_end = stage_progress_range.get(stage, (1.0, 60.0))
                    budget = stage_time_budget.get(stage, 60)
                    fraction = min(elapsed_stage / budget, 0.95)
                    stage_labels = {
                        "transcribing":  "Transcribing audio",
                        "diarizing":     "Diarizing speakers",
                        "attributing":   "Attributing speakers",
                    }
                    job.progress = round(p_start + fraction * (p_end - p_start), 1)
                    job.message = f"{stage_labels.get(stage, stage)} ({elapsed_total:.0f}s elapsed)"

                result = await transcription_task

                if cancel_flags.get(job_id):
                    job.status = JobStatusState.canceled
                    job.message = "Canceled during transcription"
                    job.end_time = datetime.now().timestamp()
                    return

                with open(output_path, "w") as f:
                    json.dump(result, f, indent=2)

                job.status = JobStatusState.completed
                job.progress = 100.0
                job.result = {
                    "segments": result.get("segments", []),
                    "language": result.get("language", "en"),
                }
                job.message = "Transcription completed"
                job.end_time = datetime.now().timestamp()
                elapsed = job.end_time - job.start_time
                print(f"[Whisper] Job {job_id}: DONE in {elapsed:.1f}s — {len(result.get('segments', []))} segments, language={result.get('language', '?')}")
            finally:
                _job_release()

    except Exception as e:
        if cancel_flags.get(job_id) or isinstance(e, TranscriptionCancelled):
            job.status = JobStatusState.canceled
            job.message = "Canceled during transcription"
            job.end_time = datetime.now().timestamp()
            print(f"[Whisper] Job {job_id} canceled during transcription")
            return
        err_str = str(e)
        # Prefix well-known failure categories so callers can surface them clearly.
        if err_str.startswith("[CUDA OOM]") or (torch.cuda.is_available() and "out of memory" in err_str.lower()):
            tagged = err_str if err_str.startswith("[CUDA OOM]") else f"[CUDA OOM] {err_str}"
        elif err_str.startswith("[AUTH ERROR]") or "401" in err_str or "403" in err_str or ("gated" in err_str.lower() and "huggingface" in err_str.lower()):
            tagged = err_str if err_str.startswith("[AUTH ERROR]") else f"[AUTH ERROR] {err_str}"
        else:
            tagged = err_str
        job.status = JobStatusState.failed
        job.error = tagged
        job.message = f"Transcription failed: {tagged}"
        job.end_time = datetime.now().timestamp()
        print(f"[Whisper] Job {job_id} failed: {tagged}")

    finally:
        try:
            if os.path.exists(input_path):
                os.unlink(input_path)
        except Exception as e:
            print(f"[Whisper] Cleanup error: {e}")

        cancel_flags.pop(job_id, None)


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(TEMP_INPUT_DIR, exist_ok=True)
    os.makedirs(TEMP_OUTPUT_DIR, exist_ok=True)
    print("[Whisper API] Ready. Stack: Parakeet-TDT-0.6B-v2 ASR + pyannote Community-1 diarization.")
    # Device selection is automatic (torch.cuda.is_available()); the effective
    # choice comes from the image (CUDA torch wheels) + GPU device reservation.
    if torch.cuda.is_available():
        try:
            print(f"[Whisper API] CUDA available — GPU: {torch.cuda.get_device_name(0)}")
        except Exception:
            print("[Whisper API] CUDA available.")
    else:
        print("[Whisper API] CUDA not available — running on CPU (slow; GPU image recommended).")
    cleanup_task = asyncio.create_task(cleanup_old_jobs())
    # Startup pre-warm: if HF_TOKEN is set and models are not cached, start downloading in background.
    if HF_TOKEN:
        if not _is_diarization_model_cached():
            print("[WhisperAPI] Startup: pyannote models not cached — triggering background prefetch...", flush=True)
            await _start_prefetch_if_needed()
        else:
            print("[WhisperAPI] Startup: pyannote models already cached — no prefetch needed.", flush=True)
    else:
        print("[WhisperAPI] Startup: HF_TOKEN not set — diarization prefetch skipped.", flush=True)
    yield
    cleanup_task.cancel()
    if _idle_unload_task is not None and not _idle_unload_task.done():
        _idle_unload_task.cancel()
    unload_models(force=True)


app = FastAPI(
    title="Therascript Transcription Service",
    version="3.0.0",
    lifespan=lifespan,
)


@app.get("/")
async def root():
    return {"message": "Whisper Transcription Service running."}


@app.get("/health")
async def health():
    return {"status": "healthy", "model_loaded": _parakeet_model is not None}


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    # Accepted for wire compatibility but ignored — ASR is always Parakeet.
    model_name: str = Form("parakeet-tdt-0.6b-v2"),
    # 0 disables diarization; >=2 enables it with that many speakers.
    num_speakers: int = Form(0),
):
    job_id = str(uuid.uuid4())
    diarize = num_speakers >= 2

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

    background_tasks.add_task(
        run_transcription, job_id, input_path, model_name, num_speakers,
        diarize,
    )

    print(f"[Whisper] Queued job {job_id} for {file.filename} with num_speakers={num_speakers}, diarize={diarize}")
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
    was_loaded = unload_models()
    if was_loaded:
        message = "Model unloaded, VRAM freed"
    elif _active_jobs > 0:
        message = "No model was unloaded — jobs still active"
    else:
        message = "No model was loaded"
    return {
        "success": True,
        "was_loaded": was_loaded,
        "message": message,
    }


@app.get("/model/status", response_model=ModelStatus)
async def get_model_status():
    return build_model_status()


@app.get("/diarization/check", response_model=DiarizationCheckResponse)
async def diarization_check():
    """Fast (no-network) check: is HF_TOKEN set and are required pyannote repos cached locally?"""
    token_set = bool(HF_TOKEN)
    missing_repos = _get_missing_diarization_repos()
    cached = len(missing_repos) == 0
    prefetch_in_progress = _prefetch_running

    if not token_set:
        return DiarizationCheckResponse(
            hf_token_set=False,
            model_cached=False,
            ready=False,
            missing_repos=missing_repos,
            prefetch_in_progress=prefetch_in_progress,
            error="HF_TOKEN is not set — diarization is disabled.",
        )

    error_msg = None
    if not cached:
        missing_text = ", ".join(missing_repos)
        error_msg = (
            f"Missing local HF cache for required diarization repos: {missing_text}. "
            + ("A prefetch is currently in progress." if prefetch_in_progress else "Call POST /diarization/prefetch to start downloading.")
        )

    return DiarizationCheckResponse(
        hf_token_set=True,
        model_cached=cached,
        ready=cached,
        missing_repos=missing_repos,
        prefetch_in_progress=prefetch_in_progress,
        error=error_msg,
    )


@app.post("/diarization/prefetch", response_model=DiarizationPrefetchResponse)
async def diarization_prefetch():
    """Trigger a background download of pyannote model files. Idempotent."""
    if not HF_TOKEN:
        raise HTTPException(
            status_code=400,
            detail="HF_TOKEN is not set — cannot prefetch diarization models.",
        )
    already_cached, started = await _start_prefetch_if_needed()
    if already_cached:
        return DiarizationPrefetchResponse(
            started=False,
            already_cached=True,
            message="Models already cached — nothing to do.",
        )
    if started:
        return DiarizationPrefetchResponse(
            started=True,
            already_cached=False,
            message="Background download started. Call GET /diarization/check to monitor progress.",
        )
    # Prefetch was already running
    return DiarizationPrefetchResponse(
        started=False,
        already_cached=False,
        message="Prefetch already in progress — call GET /diarization/check to monitor.",
    )


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("WHISPER_PYTHON_PORT", "8001"))
    uvicorn.run(app, host="0.0.0.0", port=port)
