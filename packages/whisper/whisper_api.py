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
import numpy as np
import pandas as pd
import whisperx
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import uuid


# ---------------------------------------------------------------------------
# Compatibility shim for pyannote.audio 3.3.x
# whisperx.DiarizationPipeline calls Pipeline.from_pretrained(token=...) but
# pyannote 3.3.x still uses use_auth_token=... and returns an Annotation
# directly (not an object with .speaker_diarization). This class replicates
# whisperx's DiarizationPipeline interface against the installed pyannote API.
# ---------------------------------------------------------------------------
class _DiarizationPipeline:
    SAMPLE_RATE = 16000

    def __init__(self, token: str, device: str = "cpu"):
        from pyannote.audio import Pipeline
        device_obj = torch.device(device) if isinstance(device, str) else device
        print("[WhisperManager] Loading pyannote/speaker-diarization-3.1...")
        try:
            self.model = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-3.1",
                use_auth_token=token,
            ).to(device_obj)
        except Exception as e:
            err_str = str(e)
            if "401" in err_str or "403" in err_str or "gated" in err_str.lower() or "access" in err_str.lower() or "unauthorized" in err_str.lower():
                raise RuntimeError(
                    f"[AUTH ERROR] HF_TOKEN lacks access to pyannote/speaker-diarization-3.1 — "
                    f"accept the model terms at https://huggingface.co/pyannote/speaker-diarization-3.1 "
                    f"and https://huggingface.co/pyannote/segmentation-3.0 — original: {e}"
                ) from e
            if torch.cuda.is_available() and "out of memory" in err_str.lower():
                raise RuntimeError(
                    f"[CUDA OOM] Not enough VRAM to load diarization model — "
                    f"free VRAM or use a smaller ASR model — original: {e}"
                ) from e
            raise

    def __call__(
        self,
        audio,
        num_speakers=None,
        min_speakers=None,
        max_speakers=None,
        hook=None,
    ) -> pd.DataFrame:
        if isinstance(audio, np.ndarray):
            audio_data = {
                "waveform": torch.from_numpy(audio[None, :]),
                "sample_rate": self.SAMPLE_RATE,
            }
        else:
            audio_data = audio
        call_kwargs = dict(
            num_speakers=num_speakers,
            min_speakers=min_speakers,
            max_speakers=max_speakers,
        )
        if hook is not None:
            call_kwargs["hook"] = hook
        diarization = self.model(audio_data, **call_kwargs)
        diarize_df = pd.DataFrame(
            diarization.itertracks(yield_label=True),
            columns=["segment", "label", "speaker"],
        )
        diarize_df["start"] = diarize_df["segment"].apply(lambda x: x.start)
        diarize_df["end"] = diarize_df["segment"].apply(lambda x: x.end)
        return diarize_df
# ---------------------------------------------------------------------------


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

def _get_missing_diarization_repos() -> list[str]:
    """Return list of required diarization repos that do not have a cached revision."""
    required_repos = [
        "pyannote/speaker-diarization-3.1",
        "pyannote/segmentation-3.0",
    ]

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
        pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=HF_TOKEN,
        )
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
DEFAULT_MODEL = os.environ.get("WHISPER_MODEL", "tiny")
MODEL_IDLE_TIMEOUT = int(os.environ.get("WHISPER_MODEL_IDLE_TIMEOUT", "300"))
TRANSCRIBE_CONCURRENCY = int(os.environ.get("WHISPER_MAX_CONCURRENCY", "1"))
JOB_RETENTION_SECONDS = int(os.environ.get("WHISPER_JOB_RETENTION", "3600"))
LLM_UNLOAD_URL = os.environ.get("LLM_UNLOAD_URL", "http://host.docker.internal:3001/api/llm/unload")
HF_TOKEN = os.environ.get("HF_TOKEN")
DEFAULT_NUM_SPEAKERS = int(os.environ.get("WHISPER_NUM_SPEAKERS", "2"))


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
        self._asr_model = None
        self._diarize_model = None
        self._model_name: Optional[str] = None
        self._device: Optional[str] = None
        self._last_used: float = 0
        self._lock = asyncio.Lock()
        self._idle_task: Optional[asyncio.Task] = None
        self._active_jobs: int = 0

    @property
    def is_loaded(self) -> bool:
        return self._asr_model is not None

    @property
    def model_name(self) -> Optional[str]:
        return self._model_name

    @property
    def last_used(self) -> float:
        return self._last_used

    async def acquire_model(self, model_name: str):
        async with self._lock:
            if self._asr_model is not None and self._model_name != model_name:
                if self._active_jobs > 0:
                    raise RuntimeError(f"Cannot switch models while {self._active_jobs} jobs active")
                print(f"[WhisperManager] Switching from {self._model_name} to {model_name}")
                await self._unload_unsafe()

            if self._asr_model is None:
                await ensure_llm_unloaded()

                print(f"[WhisperManager] Loading model '{model_name}'...")
                start = datetime.now()

                device = "cuda" if torch.cuda.is_available() else "cpu"
                compute_type = "float16" if device == "cuda" else "int8"
                self._device = device

                # Load ASR model
                # Use Silero VAD to avoid pyannote.audio 3.3.2 API incompatibility:
                # latest whisperx passes token= to pyannote VoiceActivityDetection
                # but 3.3.2's Inference class does not accept that kwarg.
                self._asr_model = whisperx.load_model(
                    model_name, device, compute_type=compute_type, vad_method="silero"
                )
                self._model_name = model_name

                # Load diarization pipeline (required — fails hard without HF_TOKEN)
                if not HF_TOKEN:
                    raise RuntimeError("HF_TOKEN is not set — diarization pipeline cannot be loaded. Set HF_TOKEN and restart.")
                print(f"[WhisperManager] Loading diarization pipeline...")
                self._diarize_model = _DiarizationPipeline(
                    token=HF_TOKEN, device=device
                )

                elapsed = (datetime.now() - start).total_seconds()
                print(f"[WhisperManager] Model '{model_name}' loaded in {elapsed:.2f}s")

            self._active_jobs += 1
            self._last_used = datetime.now().timestamp()
            return self

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
        if self._asr_model is None:
            return False

        model_name = self._model_name
        print(f"[WhisperManager] Unloading model '{model_name}'...")

        del self._asr_model
        self._asr_model = None
        if self._diarize_model is not None:
            del self._diarize_model
            self._diarize_model = None
        self._model_name = None
        self._device = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

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
                if self._active_jobs == 0 and self._asr_model is not None:
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


async def run_transcription(job_id: str, input_path: str, model_name: str, num_speakers: int):
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

            manager = await model_manager.acquire_model(model_name)

            if cancel_flags.get(job_id):
                job.status = JobStatusState.canceled
                job.message = "Canceled after model load"
                return

            job.status = JobStatusState.transcribing
            job.message = "Transcribing audio..."
            job.progress = 1.0

            last_stage = ["transcribing"]
            stage_start_time = [datetime.now().timestamp()]
            align_progress = [0.0]  # 0.0..1.0, updated per batch during alignment
            align_total_segs = [0]   # total segment count, set before batching starts
            diarize_progress = [0.0]  # 0.0..1.0, updated via pyannote hook

            def transcribe_sync():
                # Step 1: Transcribe
                print(f"[Whisper] Job {job_id}: Step 1/4 - Transcribing (duration={duration:.1f}s, model={model_name})...", flush=True)
                audio = whisperx.load_audio(input_path)
                result = manager._asr_model.transcribe(audio, batch_size=16, print_progress=True, verbose=True)
                detected_language = result.get("language", "en")
                segments = result.get("segments", [])
                print(f"[Whisper] Job {job_id}: Transcription done - language={detected_language}, segments={len(segments)}", flush=True)
                for i, seg in enumerate(segments):
                    speaker_tag = f"[{seg.get('speaker', '?')}] " if seg.get("speaker") else ""
                    print(f"[Whisper] Job {job_id}:   seg {i+1:03d} [{seg.get('start',0):.2f}s-{seg.get('end',0):.2f}s] {speaker_tag}{seg.get('text','').strip()}", flush=True)

                # Step 2: Align (word-level timestamps) — batched for progress visibility
                align_segs_input = result["segments"]
                total_align_segs = len(align_segs_input)
                align_total_segs[0] = total_align_segs
                ALIGN_BATCH = 20
                # Sub-stage: loading alignment model (time-based progress)
                last_stage[0] = "loading_align"
                stage_start_time[0] = datetime.now().timestamp()
                print(f"[Whisper] Job {job_id}: Step 2/4 - Loading alignment model for language '{detected_language}'...", flush=True)
                align_model, metadata = whisperx.load_align_model(
                    language_code=detected_language, device=manager._device
                )
                # Sub-stage: running alignment batches (batch-based progress)
                last_stage[0] = "aligning"
                stage_start_time[0] = datetime.now().timestamp()
                print(f"[Whisper] Job {job_id}: Aligning {total_align_segs} segments in batches of {ALIGN_BATCH}...", flush=True)
                aligned_segments = []
                aligned_word_segments = []
                for batch_start in range(0, total_align_segs, ALIGN_BATCH):
                    batch = align_segs_input[batch_start:batch_start + ALIGN_BATCH]
                    batch_result = whisperx.align(
                        batch, align_model, metadata, audio,
                        manager._device, return_char_alignments=False
                    )
                    aligned_segments.extend(batch_result.get("segments", []))
                    aligned_word_segments.extend(batch_result.get("word_segments", []))
                    done = min(batch_start + ALIGN_BATCH, total_align_segs)
                    align_progress[0] = done / total_align_segs if total_align_segs > 0 else 1.0
                    elapsed_align = datetime.now().timestamp() - stage_start_time[0]
                    print(f"[Whisper] Job {job_id}:   aligned {done}/{total_align_segs} segments ({align_progress[0]*100:.0f}%, {elapsed_align:.1f}s)", flush=True)
                result = {"segments": aligned_segments, "word_segments": aligned_word_segments}
                print(f"[Whisper] Job {job_id}: Alignment done - {len(aligned_segments)} segments", flush=True)
                # Free alignment model immediately
                del align_model
                gc.collect()
                if manager._device == "cuda":
                    torch.cuda.empty_cache()

                # Step 3: Diarize (required — fails hard if model is not loaded)
                if manager._diarize_model is None:
                    raise RuntimeError("Diarization model is not loaded — cannot proceed without speaker diarization.")

                last_stage[0] = "diarizing"
                stage_start_time[0] = datetime.now().timestamp()
                diarize_progress[0] = 0.0
                print(f"[Whisper] Job {job_id}: Step 3/4 - Diarizing with {num_speakers} speakers...", flush=True)

                # pyannote hook: maps sub-step names → fractional progress
                # Steps (approximate): segmentation ~30%, embedding ~80%, clustering ~95%
                _DIARIZE_STEP_FRACTIONS = {
                    "segmentation": 0.30,
                    "speaker embedding": 0.75,
                    "embeddings": 0.75,
                    "clustering": 0.90,
                    "discrete diarization": 0.92,
                    "diarization": 0.97,
                }
                def _diarize_hook(step_name=None, *args, **kwargs):
                    if step_name is None and args:
                        step_name = args[0]
                    name = str(step_name).lower() if step_name else ""
                    for key, frac in _DIARIZE_STEP_FRACTIONS.items():
                        if key in name:
                            diarize_progress[0] = frac
                            print(f"[Whisper] Job {job_id}: diarize hook '{name}' → {frac*100:.0f}%", flush=True)
                            break

                diarize_segments = manager._diarize_model(
                    audio,
                    min_speakers=num_speakers,
                    max_speakers=num_speakers,
                    hook=_diarize_hook,
                )
                # Step 4: Assign speakers to segments
                last_stage[0] = "assigning"
                stage_start_time[0] = datetime.now().timestamp()
                print(f"[Whisper] Job {job_id}: Step 4/4 - Assigning speakers...", flush=True)
                result = whisperx.assign_word_speakers(diarize_segments, result)
                # Log each final segment with speaker label
                final_segs = result.get("segments", [])
                print(f"[Whisper] Job {job_id}: Speaker assignment done - {len(final_segs)} segments", flush=True)
                for i, seg in enumerate(final_segs):
                    speaker_tag = f"[{seg.get('speaker', 'UNKNOWN')}] "
                    print(f"[Whisper] Job {job_id}:   seg {i+1:03d} [{seg.get('start',0):.2f}s-{seg.get('end',0):.2f}s] {speaker_tag}{seg.get('text','').strip()}", flush=True)

                segments_out = []
                for seg in result.get("segments", []):
                    segments_out.append({
                        "start": seg.get("start", 0),
                        "end": seg.get("end", 0),
                        "text": seg.get("text", "").strip(),
                        "speaker": seg.get("speaker"),
                    })

                return {
                    "segments": segments_out,
                    "language": detected_language,
                }

            # Run transcription in background and update progress periodically
            loop = asyncio.get_event_loop()
            transcription_task = loop.run_in_executor(None, transcribe_sync)

            # Progress ranges per stage
            stage_progress_range = {
                "transcribing":  (1.0,  55.0),
                "loading_align": (55.0, 62.0),
                "aligning":      (62.0, 72.0),
                "diarizing":     (72.0, 88.0),
                "assigning":     (88.0, 95.0),
            }
            # Rough time budget per stage for interpolation (seconds)
            # Used as fallback when hook-based progress isn't available.
            # CPU pyannote diarization is typically 1–3× realtime.
            stage_time_budget = {
                "transcribing":  max(duration * 0.05, 30),
                "loading_align": 20,
                "aligning":      max(duration * 0.02, 10),
                "diarizing":     max(duration * 2.5, 60),   # pessimistic CPU estimate
                "assigning":     5,
            }

            while not transcription_task.done():
                await asyncio.sleep(1.0)
                stage = last_stage[0]
                elapsed_stage = datetime.now().timestamp() - stage_start_time[0]
                elapsed_total = datetime.now().timestamp() - job.start_time
                p_start, p_end = stage_progress_range.get(stage, (1.0, 55.0))
                if stage == "aligning":
                    # Use actual batch completion ratio
                    fraction = min(align_progress[0], 0.99)
                    n = align_total_segs[0]
                    done_segs = round(align_progress[0] * n)
                    job.message = f"Aligning {done_segs}/{n} segments ({elapsed_total:.0f}s elapsed)"
                    job.progress = round(p_start + fraction * (p_end - p_start), 1)
                    continue
                elif stage == "diarizing" and diarize_progress[0] > 0:
                    # Hook gave us real sub-step progress — use it
                    fraction = min(diarize_progress[0], 0.99)
                else:
                    budget = stage_time_budget.get(stage, 60)
                    fraction = min(elapsed_stage / budget, 0.95)
                stage_labels = {
                    "transcribing":  "Transcribing audio",
                    "loading_align": "Loading alignment model",
                    "diarizing":     "Diarizing speakers",
                    "assigning":     "Assigning speakers",
                }
                job.progress = round(p_start + fraction * (p_end - p_start), 1)
                job.message = f"{stage_labels.get(stage, stage)} ({elapsed_total:.0f}s elapsed)"

            result = await transcription_task

            if cancel_flags.get(job_id):
                job.status = JobStatusState.canceled
                job.message = "Canceled during transcription"
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

    except Exception as e:
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
        await model_manager.release_model()


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(TEMP_INPUT_DIR, exist_ok=True)
    os.makedirs(TEMP_OUTPUT_DIR, exist_ok=True)
    print(f"[Whisper API] Ready. Model idle timeout: {MODEL_IDLE_TIMEOUT}s")
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
    num_speakers: int = Form(DEFAULT_NUM_SPEAKERS),
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

    background_tasks.add_task(run_transcription, job_id, input_path, model_name, num_speakers)

    print(f"[Whisper] Queued job {job_id} for {file.filename} with model '{model_name}', num_speakers={num_speakers}")
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
