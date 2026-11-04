"""ASR + diarization backends behind minimal interfaces.

- ParakeetASRBackend (NeMo ``nvidia/parakeet-tdt-0.6b-v2``, native word
  timestamps, chunked long-form handling).
- CommunityDiarizer (pyannote community-1, exclusive output for attribution).

A future Nemotron/Sortformer diarizer only needs to implement ``Diarizer``
and return exclusive-style ``DiarizationSegment`` lists.
"""

import itertools
import os
from abc import ABC, abstractmethod
from typing import Any, Callable, Dict, List, Optional, Tuple

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
# fp16 halves Parakeet weights (~2.4GB -> ~1.3GB) and cuts activation memory.
# CUDA only; CPU always runs fp32. Set PARAKEET_FP16=0 to force fp32.
PARAKEET_FP16 = (
    os.environ.get("PARAKEET_FP16", "1").strip().lower()
    not in ("0", "false", "no", "off")
)
# Diarization is chunked like ASR: a full hour in one pyannote call spikes
# VRAM (embeddings over 3600s) and OOMs 12GB cards. Consecutive chunks overlap
# so speaker labels can be aligned across the boundary (see
# _align_chunk_labels); 0 disables chunking (legacy single-pass).
DIARIZATION_CHUNK_SEC = float(os.environ.get("DIARIZATION_CHUNK_SEC", "600"))
DIARIZATION_CHUNK_OVERLAP_SEC = float(
    os.environ.get("DIARIZATION_CHUNK_OVERLAP_SEC", "30")
)


def _is_dtype_error(error: BaseException) -> bool:
    """True when an exception looks like an fp16/dtype kernel failure."""
    msg = str(error).lower()
    return (
        "half" in msg or "dtype" in msg or "expected scalar type" in msg
    )


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
        self,
        audio: Any,
        num_speakers: Optional[int] = None,
        is_cancelled: Optional[Callable[[], bool]] = None,
    ) -> List[DiarizationSegment]:
        """Return EXCLUSIVE segments (one speaker per frame).

        ``num_speakers`` is the user's existing selection (None/0/1 means the
        caller skips diarization entirely; backends never hard-code 2).
        ``is_cancelled`` is polled at chunk boundaries; when it returns True
        the backend raises TranscriptionCancelled.
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
        self._fp16 = bool(PARAKEET_FP16) and self.device == "cuda"
        if self._fp16:
            try:
                self._model.half()
                print("[Parakeet] Running fp16 on CUDA (~1.3GB weights)")
            except Exception as e:
                print(f"[Parakeet] WARNING: .half() failed ({e}); running fp32")
                self._fp16 = False
        self._model.eval()

    def _transcribe_chunk(self, chunk: Any) -> List[Word]:
        try:
            return self._transcribe_chunk_inner(chunk)
        except RuntimeError as e:
            # fp16 is the default but not all NeMo builds/ops tolerate it;
            # a dtype-shaped failure retries once in fp32 rather than
            # failing the whole job. One-way latch for the process.
            if self._fp16 and _is_dtype_error(e):
                print(f"[Parakeet] WARNING: fp16 inference failed ({e}); falling back to fp32")
                self._model.float()
                self._fp16 = False
                return self._transcribe_chunk_inner(chunk)
            raise

    def _transcribe_chunk_inner(self, chunk: Any) -> List[Word]:
        import tempfile
        import torch as _torch
        import soundfile as sf

        words: List[Word] = []
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as tmp:
            sf.write(tmp.name, chunk, PARAKEET_SAMPLE_RATE)
            with _torch.no_grad():
                if self._fp16:
                    # Autocast pairs with .half() weights: fp32 frontend
                    # features are cast on entry so half kernels accept them.
                    with _torch.autocast("cuda", dtype=_torch.float16):
                        output = self._model.transcribe([tmp.name], timestamps=True)
                else:
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


def _plan_diarization_chunks(
    total_len: int, chunk_len: int, overlap_len: int
) -> List[Tuple[int, int]]:
    """Split sample audio into ``(start, end)`` diarization windows.

    A single window covers short audio (legacy single-pass). Otherwise
    consecutive windows overlap by ``overlap_len`` so speaker labels can be
    aligned across the boundary; a trailing window must contribute at least
    1s of new audio or the previous window extends to the end instead.
    """
    if chunk_len <= 0 or total_len <= chunk_len:
        return [(0, total_len)]
    overlap_len = max(0, min(overlap_len, chunk_len - 1))
    positions: List[Tuple[int, int]] = []
    start = 0
    min_new = overlap_len + PARAKEET_SAMPLE_RATE
    while True:
        end = start + chunk_len
        if end >= total_len or total_len - end < min_new:
            positions.append((start, total_len))
            break
        positions.append((start, end))
        start = end - overlap_len
    return positions


def _clip_segments_to_window(
    segs: List[DiarizationSegment], start: float, end: float
) -> List[DiarizationSegment]:
    """Restrict segments to ``[start, end)``, clipping straddlers."""
    out: List[DiarizationSegment] = []
    for s in segs:
        lo, hi = max(s.start, start), min(s.end, end)
        if hi > lo:
            out.append(DiarizationSegment(start=lo, end=hi, speaker=s.speaker))
    return out


def _overlap_agreement(
    prev: List[DiarizationSegment],
    cur: List[DiarizationSegment],
    mapping: Dict[str, str],
) -> float:
    """Total seconds where ``cur`` (relabeled via ``mapping``) agrees with ``prev``."""
    total = 0.0
    prev_sorted = sorted(prev, key=lambda s: s.start)
    i = 0
    for c in sorted(cur, key=lambda s: s.start):
        want = mapping.get(c.speaker)
        if want is None:
            continue
        while i < len(prev_sorted) and prev_sorted[i].end <= c.start:
            i += 1
        j = i
        while j < len(prev_sorted) and prev_sorted[j].start < c.end:
            p = prev_sorted[j]
            if p.speaker == want:
                total += max(0.0, min(p.end, c.end) - max(p.start, c.start))
            j += 1
    return total


def _align_chunk_labels(
    prev_segs: List[DiarizationSegment],
    cur_segs: List[DiarizationSegment],
    overlap_start: float,
    overlap_end: float,
) -> Dict[str, str]:
    """Map current-chunk labels onto the previous chunk's label space.

    pyannote labels each chunk independently (chunk 2's ``SPEAKER_00`` may be
    chunk 1's ``SPEAKER_01``), so the overlap region votes: the mapping that
    maximizes same-speaker overlap duration wins. With ``num_speakers``
    fixed the label sets match and an exhaustive permutation search (<=120
    for <=5 speakers) is optimal and deterministic (ties keep the first,
    i.e. identity, ordering). No-information cases (empty overlap, one side
    silent) fall back to identity.
    """
    cur_labels = sorted({s.speaker for s in cur_segs})
    if overlap_end <= overlap_start:
        return {label: label for label in cur_labels}
    prev = _clip_segments_to_window(prev_segs, overlap_start, overlap_end)
    cur = _clip_segments_to_window(cur_segs, overlap_start, overlap_end)
    prev_labels = sorted({s.speaker for s in prev})
    cur_labels = sorted({s.speaker for s in cur})
    if not prev_labels or not cur_labels:
        return {label: label for label in sorted({s.speaker for s in cur_segs})}
    if len(prev_labels) == len(cur_labels) and len(cur_labels) <= 6:
        best: Dict[str, str] = {}
        best_score = -1.0
        for perm in itertools.permutations(prev_labels):
            mapping = dict(zip(cur_labels, perm))
            score = _overlap_agreement(prev, cur, mapping)
            if score > best_score:
                best_score = score
                best = mapping
        # Labels silent in the overlap keep their names (no signal to remap).
        for label in sorted({s.speaker for s in cur_segs}):
            best.setdefault(label, label)
        return best
    # Unequal label counts (pyannote quirk): greedy per-label argmax.
    # A label with no unused candidate keeps its own name (a new speaker in
    # the merged timeline) rather than merging into an already-taken one.
    mapping: Dict[str, str] = {}
    used: set = set()
    for label in cur_labels:
        candidates = [p for p in prev_labels if p not in used]
        if not candidates:
            mapping[label] = label
            continue
        top, top_score = label, 0.0
        own = [s for s in cur if s.speaker == label]
        for cand in candidates:
            score = _overlap_agreement(prev, own, {label: cand})
            if score > top_score:
                top, top_score = cand, score
        mapping[label] = top
        used.add(top)
    for label in sorted({s.speaker for s in cur_segs}):
        mapping.setdefault(label, label)
    return mapping


def _cut_segments_at(
    segs: List[DiarizationSegment], cut: float, keep: str
) -> List[DiarizationSegment]:
    """Keep the ``before``/``after`` side of ``cut``, clipping straddlers."""
    out: List[DiarizationSegment] = []
    for s in segs:
        if keep == "before":
            if s.start >= cut:
                continue
            out.append(
                DiarizationSegment(start=s.start, end=min(s.end, cut), speaker=s.speaker)
                if s.end > cut
                else s
            )
        else:
            if s.end <= cut:
                continue
            out.append(
                DiarizationSegment(start=max(s.start, cut), end=s.end, speaker=s.speaker)
                if s.start < cut
                else s
            )
    return [s for s in out if s.end > s.start]


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

    def _diarize_single(
        self, audio: Any, num_speakers: Optional[int] = None
    ) -> List[DiarizationSegment]:
        """Diarize one audio buffer; segments are relative to its start."""
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

    def diarize(
        self,
        audio: Any,
        num_speakers: Optional[int] = None,
        is_cancelled: Optional[Callable[[], bool]] = None,
    ) -> List[DiarizationSegment]:
        chunk_len = int(DIARIZATION_CHUNK_SEC * PARAKEET_SAMPLE_RATE)
        overlap_len = int(DIARIZATION_CHUNK_OVERLAP_SEC * PARAKEET_SAMPLE_RATE)
        positions = _plan_diarization_chunks(len(audio), chunk_len, overlap_len)
        if len(positions) == 1:
            return self._diarize_single(audio, num_speakers)
        print(
            f"[Diarizer] Chunked diarization: {len(positions)} windows "
            f"({DIARIZATION_CHUNK_SEC:.0f}s + {DIARIZATION_CHUNK_OVERLAP_SEC:.0f}s overlap)"
        )
        merged: List[DiarizationSegment] = []
        prev_aligned: List[DiarizationSegment] = []
        prev_end = 0
        for i, (start, end) in enumerate(positions):
            if is_cancelled is not None and is_cancelled():
                raise TranscriptionCancelled(
                    f"cancelled at diarization chunk {i + 1}/{len(positions)}"
                )
            chunk = audio[start:end]
            offset = start / PARAKEET_SAMPLE_RATE
            absolute = [
                DiarizationSegment(
                    start=s.start + offset, end=s.end + offset, speaker=s.speaker
                )
                for s in self._diarize_single(chunk, num_speakers)
            ]
            if i > 0:
                # Consecutive windows overlap by construction (chunk start <
                # previous chunk end); align the new window's labels onto the
                # previous window's, then cut both at the overlap midpoint so
                # each frame is covered exactly once.
                overlap_start = start / PARAKEET_SAMPLE_RATE
                overlap_end = prev_end / PARAKEET_SAMPLE_RATE
                mapping = _align_chunk_labels(
                    prev_aligned, absolute, overlap_start, overlap_end
                )
                absolute = [
                    DiarizationSegment(
                        start=s.start,
                        end=s.end,
                        speaker=mapping.get(s.speaker, s.speaker),
                    )
                    for s in absolute
                ]
                prev_aligned = absolute
                cut = (overlap_start + overlap_end) / 2.0
                merged = _cut_segments_at(merged, cut, keep="before")
                absolute = _cut_segments_at(absolute, cut, keep="after")
            else:
                prev_aligned = absolute
            merged.extend(absolute)
            prev_end = end
        return merged
