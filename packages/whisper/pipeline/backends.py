"""ASR + diarization backends behind minimal interfaces.

- ParakeetASRBackend (NeMo ``nvidia/parakeet-tdt-0.6b-v2``, native word
  timestamps, chunked long-form handling).
- CommunityDiarizer (pyannote community-1, exclusive output for attribution).

A future Nemotron/Sortformer diarizer only needs to implement ``Diarizer``
and return exclusive-style ``DiarizationSegment`` lists.
"""

import os
from abc import ABC, abstractmethod
from typing import Any, Callable, List, Optional

from .schema import DiarizationSegment, Word


class TranscriptionCancelled(Exception):
    """Raised when ``is_cancelled`` fires mid-transcription (chunk boundary)."""


PARAKEET_MODEL_ID = os.environ.get(
    "PARAKEET_MODEL_ID", "nvidia/parakeet-tdt-0.6b-v2"
)
# Single-pass attention limit; longer audio is chunked and timestamps are
# offset-merged. ~24 min is the published full-attention figure; chunk well
# below it for safety on smaller GPUs. Consecutive chunks overlap by
# PARAKEET_CHUNK_OVERLAP_SEC so no word is cut at a boundary; words in the
# overlap are deduplicated by keeping the copy whose midpoint falls in each
# chunk's exclusive core region (first/last chunks keep their outer edge).
PARAKEET_CHUNK_SEC = float(os.environ.get("PARAKEET_CHUNK_SEC", "600"))
PARAKEET_CHUNK_OVERLAP_SEC = float(os.environ.get("PARAKEET_CHUNK_OVERLAP_SEC", "10"))
PARAKEET_SAMPLE_RATE = 16000


def _waveform_payload(audio: Any) -> dict:
    """Wrap a 1-D float32 16kHz mono array for pyannote pipelines.

    Isolated (with lazy imports) so unit tests can monkeypatch it without
    numpy/torch installed.
    """
    import numpy as _np  # noqa: F401  (type check only)
    import torch as _torch

    waveform = _torch.from_numpy(audio[None, :])
    return {"waveform": waveform, "sample_rate": PARAKEET_SAMPLE_RATE}


class ASRBackend(ABC):
    name: str = "base"

    @abstractmethod
    def transcribe(
        self,
        audio: Any,
        is_cancelled: Optional[Callable[[], bool]] = None,
        on_progress: Optional[Callable[[int, int], None]] = None,
    ) -> tuple[List[Word], str]:
        """Return (words, detected_language). Audio is float32 mono at 16kHz.

        ``is_cancelled`` is polled at chunk boundaries; when it returns True
        the backend raises TranscriptionCancelled.

        ``on_progress`` (optional) receives ``(completed_chunks, total_chunks)``
        after each successfully transcribed chunk, so callers can report real
        (not time-interpolated) progress. Backends emit ``(0, total)`` on entry
        so callers can distinguish "transcription started" from "no signal
        yet". Single-chunk audio reports (0, 1) then (1, 1).
        """


class Diarizer(ABC):
    name: str = "base"

    @abstractmethod
    def diarize(
        self, audio: Any, num_speakers: Optional[int] = None
    ) -> List[DiarizationSegment]:
        """Return EXCLUSIVE segments (one speaker per frame).

        ``num_speakers`` is the user's existing selection (None/0/1 means the
        caller skips diarization entirely; backends never hard-code 2).
        """


# ---------------------------------------------------------------------------
# Parakeet (NeMo)
# ---------------------------------------------------------------------------

class ParakeetASRBackend(ASRBackend):
    """English ASR via NeMo Parakeet TDT 0.6B v2 with native word timestamps."""

    name = "parakeet"

    def __init__(self, device: Optional[str] = None):
        import torch as _torch
        import nemo.collections.asr as nemo_asr  # lazy: heavy dep

        self.device = device or ("cuda" if _torch.cuda.is_available() else "cpu")
        self._model = nemo_asr.models.ASRModel.from_pretrained(PARAKEET_MODEL_ID)
        try:
            self._model = self._model.to(self.device)
        except Exception as e:
            print(f"[Parakeet] WARNING: could not move ASR model to {self.device} ({e}); running on default device")
        self._model.eval()

    def _transcribe_chunk(self, chunk: Any) -> List[Word]:
        import tempfile
        import torch as _torch
        import soundfile as sf

        words: List[Word] = []
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as tmp:
            sf.write(tmp.name, chunk, PARAKEET_SAMPLE_RATE)
            with _torch.no_grad():
                output = self._model.transcribe([tmp.name], timestamps=True)
        hyp = output[0]
        ts = (hyp.timestamp or {}).get("word", []) if hasattr(hyp, "timestamp") else []
        if ts:
            for entry in ts:
                text = entry.get("word", "").strip()
                if not text:
                    continue
                words.append(
                    Word(
                        text=text,
                        start=float(entry.get("start", 0.0)),
                        end=float(entry.get("end", 0.0)),
                        confidence=entry.get("score"),
                    )
                )
        else:
            # No word timestamps (unexpected NeMo output shape or version
            # change) — degrade to one chunk-spanning word rather than
            # dropping the audio. Loud on purpose: silent fallback here
            # would mask an attribution-quality regression.
            print(
                "[Parakeet] WARNING: no word timestamps returned for a "
                f"{len(chunk) / PARAKEET_SAMPLE_RATE:.1f}s chunk; falling back "
                "to a single chunk-spanning word (speaker attribution for "
                "this span will be coarse)."
            )
            text = hyp.text if hasattr(hyp, "text") else str(hyp)
            if text and text.strip():
                words.append(
                    Word(text=text.strip(), start=0.0, end=len(chunk) / PARAKEET_SAMPLE_RATE)
                )
        return words

    def transcribe(
        self,
        audio: Any,
        is_cancelled: Optional[Callable[[], bool]] = None,
        on_progress: Optional[Callable[[int, int], None]] = None,
    ) -> tuple[List[Word], str]:
        # Parakeet is English-only; language is fixed, not detected.
        chunk_len = int(PARAKEET_CHUNK_SEC * PARAKEET_SAMPLE_RATE)
        overlap_len = max(
            0, min(int(PARAKEET_CHUNK_OVERLAP_SEC * PARAKEET_SAMPLE_RATE), chunk_len - 1)
        )
        if len(audio) <= chunk_len:
            if is_cancelled is not None and is_cancelled():
                raise TranscriptionCancelled("cancelled before transcription")
            if on_progress is not None:
                on_progress(0, 1)
            words = self._transcribe_chunk(audio)
            if on_progress is not None:
                on_progress(1, 1)
            return words, "en"
        stride = chunk_len - overlap_len
        positions = list(range(0, len(audio), stride))
        # Drop a trailing chunk when the previous chunk already reaches the
        # end of the audio. Otherwise the second-to-last chunk's clipped core
        # ends half_overlap before the true end while the tiny last chunk's
        # core starts half_overlap after its own start, and words in between
        # are dropped by both.
        while len(positions) > 1 and positions[-2] + chunk_len >= len(audio):
            positions.pop()
        n_chunks = len(positions)
        half_overlap_sec = (overlap_len / PARAKEET_SAMPLE_RATE) / 2.0
        words: List[Word] = []
        if on_progress is not None:
            on_progress(0, n_chunks)
        for i, start in enumerate(positions):
            if is_cancelled is not None and is_cancelled():
                raise TranscriptionCancelled(
                    f"cancelled at chunk {i + 1}/{n_chunks}"
                )
            chunk = audio[start : start + chunk_len]
            offset = start / PARAKEET_SAMPLE_RATE
            chunk_start = offset
            chunk_end = (start + len(chunk)) / PARAKEET_SAMPLE_RATE
            # Exclusive core region: duplicates in the overlap are kept exactly
            # once — the copy whose midpoint lies in this chunk's core.
            core_start = chunk_start + half_overlap_sec if i > 0 else float("-inf")
            core_end = chunk_end - half_overlap_sec if i < n_chunks - 1 else float("inf")
            for w in self._transcribe_chunk(chunk):
                abs_start = w.start + offset
                abs_end = w.end + offset
                mid = (abs_start + abs_end) / 2.0
                if not (core_start <= mid < core_end):
                    continue
                words.append(
                    Word(
                        text=w.text,
                        start=abs_start,
                        end=abs_end,
                        confidence=w.confidence,
                    )
                )
            if on_progress is not None:
                on_progress(i + 1, n_chunks)
        return words, "en"


# ---------------------------------------------------------------------------
# Diarizer
# ---------------------------------------------------------------------------

def _annotation_to_segments(annotation) -> List[DiarizationSegment]:
    """Convert a pyannote Annotation to exclusive-style segments."""
    segs: List[DiarizationSegment] = []
    for turn, _, speaker in annotation.itertracks(yield_label=True):
        segs.append(
            DiarizationSegment(start=float(turn.start), end=float(turn.end), speaker=str(speaker))
        )
    return segs


class CommunityDiarizer(Diarizer):
    """pyannote speaker-diarization-community-1.

    Uses ``exclusive_speaker_diarization`` for transcript attribution: exactly
    one speaker per frame (most likely to be transcribed wins), which matches
    non-overlapping ASR word timestamps. The regular overlapping annotation
    is available via ``last_full_annotation`` for analytics only.
    """

    MODEL_ID = "pyannote/speaker-diarization-community-1"
    name = "pyannote_community"

    def __init__(self, token: str, device: str = "cpu"):
        import torch as _torch
        from importlib.metadata import version as _pkg_version

        try:
            _major = int((_pkg_version("pyannote.audio") or "0").split(".")[0])
        except Exception:
            _major = 0
        if _major < 4:
            raise RuntimeError(
                "Community-1 diarization requires pyannote.audio>=4.0 "
                "(rebuild the transcription image — see README)."
            )
        from pyannote.audio import Pipeline

        self._pipeline = Pipeline.from_pretrained(self.MODEL_ID, token=token)
        try:
            self._pipeline.to(_torch.device(device))
        except Exception as e:
            print(f"[Diarizer] WARNING: could not move pipeline to {device} ({e}); running on default device")
        self.last_full_annotation = None

    def diarize(
        self, audio: Any, num_speakers: Optional[int] = None
    ) -> List[DiarizationSegment]:
        payload = _waveform_payload(audio)
        kwargs: dict = {}
        if num_speakers and num_speakers >= 2:
            kwargs["num_speakers"] = num_speakers
        output = self._pipeline(payload, **kwargs)
        # pyannote.audio 4.x returns DiarizeOutput with both streams.
        exclusive = getattr(output, "exclusive_speaker_diarization", None)
        full = getattr(output, "speaker_diarization", None)
        self.last_full_annotation = full if full is not None else output
        target = exclusive if exclusive is not None else output
        return _annotation_to_segments(target)
