"""Word -> speaker attribution against exclusive diarization segments.

Design notes:
- Input diarization segments MUST be exclusive (one speaker per frame), e.g.
  Community-1 ``exclusive_speaker_diarization``. Overlapping diarization
  output creates ambiguous double assignments against non-overlapping ASR
  word timestamps, so callers must pass the exclusive stream.
- Assignment rule is overlap-duration argmax (not midpoint-only): robust for
  words straddling boundaries and rapid turn-taking.
- Tie-breaks: word midpoint's segment, then nearest segment by edge distance.
- Words in pauses/gaps or outside coverage get the nearest speaker and are
  flagged low_confidence (gap attribution is a guess, not a measurement).
- Overlapping-speech info is preserved via ``overlap_speaker`` whenever a
  word overlapped more than one speaker, even though one primary speaker is
  assigned for the transcript representation.
"""

import re
from typing import List, Optional

from .schema import AttributedWord, DiarizationSegment, Word

# Absolute tolerance for overlap-duration ties. Float subtraction artefacts
# (~1e-16 for second-scale timestamps) must not decide attribution; the word
# midpoint tie-break below handles genuine ties deterministically.
_OVERLAP_TIE_EPS_SEC = 1e-9

# Sentence-ending punctuation (trailing quotes/brackets allowed). Parakeet
# emits cased, punctuated text, so this restores roughly one-sentence
# segments like the previous Whisper backend produced.
_SENTENCE_END_RE = re.compile(r'[.!?…]["\'”’)\]]*\s*$')


def _overlap(a_start: float, a_end: float, b_start: float, b_end: float) -> float:
    return max(0.0, min(a_end, b_end) - max(a_start, b_start))


def normalize_diarization(
    segments: List[DiarizationSegment],
    merge_gap_sec: float = 0.2,
) -> List[DiarizationSegment]:
    """Drop zero-length segs, sort, merge same-speaker segs across small gaps."""
    cleaned = [s for s in segments if s.end > s.start]
    cleaned.sort(key=lambda s: (s.start, s.end))
    merged: List[DiarizationSegment] = []
    for seg in cleaned:
        if (
            merged
            and merged[-1].speaker == seg.speaker
            and seg.start - merged[-1].end <= merge_gap_sec
        ):
            merged[-1] = DiarizationSegment(
                start=merged[-1].start,
                end=max(merged[-1].end, seg.end),
                speaker=seg.speaker,
            )
        else:
            merged.append(DiarizationSegment(seg.start, seg.end, seg.speaker))
    return merged


def _nearest_speaker(
    segments: List[DiarizationSegment], point: float
) -> Optional[DiarizationSegment]:
    best: Optional[DiarizationSegment] = None
    best_dist = float("inf")
    for seg in segments:
        if seg.start <= point <= seg.end:
            return seg
        dist = min(abs(point - seg.start), abs(point - seg.end))
        if dist < best_dist:
            best_dist = dist
            best = seg
    return best


def attribute_words(
    words: List[Word],
    diarization: List[DiarizationSegment],
    merge_gap_sec: float = 0.2,
    tiny_segment_sec: float = 0.15,
    mark_gap_words_low_confidence: bool = True,
) -> List[AttributedWord]:
    """Assign each word to one primary speaker.

    Empty diarization -> all words keep speaker=None (caller decides whether
    that is an error, e.g. diarization was requested but produced nothing).
    """
    segs = normalize_diarization(diarization, merge_gap_sec=merge_gap_sec)
    out: List[AttributedWord] = [None] * len(words)  # type: ignore[list-item]
    if not segs:
        return [
            AttributedWord(
                text=w.text, start=w.start, end=w.end,
                speaker=None, low_confidence=True,
            )
            for w in words
        ]
    # Walk words (in time order) and segments together: both lists are sorted,
    # so each word only tests the segments around it instead of all of them.
    order = sorted(range(len(words)), key=lambda i: (words[i].start, words[i].end))
    si = 0
    for i in order:
        w = words[i]
        while si + 1 < len(segs) and segs[si].end <= w.start:
            si += 1
        overlaps = []
        j = si
        while j < len(segs) and segs[j].start < w.end:
            d = _overlap(w.start, w.end, segs[j].start, segs[j].end)
            if d > 0:
                overlaps.append((d, segs[j]))
            j += 1
        if overlaps:
            overlaps.sort(key=lambda t: t[0], reverse=True)
            primary = overlaps[0][1]
            secondary = overlaps[1][1] if len(overlaps) > 1 else None
            # Tie-break: if top overlaps are (near-)equal, prefer the segment
            # containing the word midpoint.
            if len(overlaps) > 1 and abs(overlaps[0][0] - overlaps[1][0]) <= _OVERLAP_TIE_EPS_SEC:
                mid = (w.start + w.end) / 2.0
                for _, s in overlaps:
                    if s.start <= mid <= s.end:
                        primary = s
                        break
                if secondary is primary:
                    secondary = overlaps[0][1]
            tiny = (primary.end - primary.start) < tiny_segment_sec
            out[i] = AttributedWord(
                text=w.text, start=w.start, end=w.end,
                speaker=primary.speaker,
                overlap_speaker=(
                    secondary.speaker
                    if secondary and secondary.speaker != primary.speaker
                    else None
                ),
                low_confidence=tiny,
            )
        else:
            mid = (w.start + w.end) / 2.0
            near = _nearest_speaker(segs, mid)
            out[i] = AttributedWord(
                text=w.text, start=w.start, end=w.end,
                speaker=near.speaker if near else None,
                low_confidence=mark_gap_words_low_confidence,
            )
    return out


def _ends_sentence(text: str) -> bool:
    return bool(_SENTENCE_END_RE.search(text))


def words_to_segments(
    attributed: List[AttributedWord],
    max_gap_sec: float = 1.0,
    max_words: Optional[int] = 60,
) -> List[dict]:
    """Group attributed words into transcript segments.

    Split on speaker change, on time gaps > max_gap_sec, at sentence-ending
    punctuation, and when the segment reaches max_words (None disables the
    cap). Sentence splitting keeps segments roughly sentence-sized — matching
    the previous Whisper backend's granularity that downstream paragraph
    grouping ("punctuation + 500ms gap") relies on — instead of letting
    monologues merge into huge paragraphs. Output dicts match the existing
    wire format: {start, end, text, speaker}.
    """
    segments: List[dict] = []
    cur_text: List[str] = []
    cur_start = 0.0
    cur_end = 0.0
    cur_speaker: Optional[str] = None
    prev_end: Optional[float] = None

    def flush() -> None:
        if cur_text:
            segments.append(
                {
                    "start": cur_start,
                    "end": cur_end,
                    "text": " ".join(cur_text).strip(),
                    "speaker": cur_speaker,
                }
            )

    for w in attributed:
        gap = (w.start - prev_end) if prev_end is not None else 0.0
        if cur_text and (
            w.speaker != cur_speaker
            or gap > max_gap_sec
            or (max_words is not None and len(cur_text) >= max_words)
        ):
            flush()
            cur_text = []
        if not cur_text:
            cur_start = w.start
            cur_speaker = w.speaker
        cur_text.append(w.text)
        cur_end = w.end
        prev_end = w.end
        if _ends_sentence(w.text):
            flush()
            cur_text = []
    flush()
    return [s for s in segments if s["text"]]
