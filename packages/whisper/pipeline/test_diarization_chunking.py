"""Unit tests for chunked diarization with overlap label alignment.

Run:  python3 packages/whisper/pipeline/test_diarization_chunking.py
No model downloads; CommunityDiarizer._diarize_single is stubbed with
scripted per-chunk speaker segments.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pipeline.backends as backends
from pipeline.backends import TranscriptionCancelled
from pipeline.schema import DiarizationSegment

SR = backends.PARAKEET_SAMPLE_RATE


def _make_diarizer(chunk_sec, overlap_sec, script):
    """Diarizer with stubbed _diarize_single.

    ``script`` maps chunk index -> list of (start, end, speaker) in seconds
    RELATIVE to the chunk start. Returns (diarizer, calls) where each call
    records (chunk_len_samples, num_speakers).
    """
    d = backends.CommunityDiarizer.__new__(backends.CommunityDiarizer)
    calls = []

    def fake_single(audio, num_speakers=None):
        calls.append((len(audio), num_speakers))
        segs = script[len(calls) - 1]
        return [DiarizationSegment(s, e, sp) for (s, e, sp) in segs]

    d._diarize_single = fake_single
    backends.DIARIZATION_CHUNK_SEC = chunk_sec
    backends.DIARIZATION_CHUNK_OVERLAP_SEC = overlap_sec
    return d, calls


def _restore_defaults():
    import os as _os

    backends.DIARIZATION_CHUNK_SEC = float(
        _os.environ.get("DIARIZATION_CHUNK_SEC", "600")
    )
    backends.DIARIZATION_CHUNK_OVERLAP_SEC = float(
        _os.environ.get("DIARIZATION_CHUNK_OVERLAP_SEC", "30")
    )


def _audio(seconds):
    return [0.0] * int(seconds * SR)


def test_short_audio_single_pass():
    d, calls = _make_diarizer(600.0, 30.0, [[(0, 50, "SPEAKER_00")]])
    try:
        segs = d.diarize(_audio(100), num_speakers=2)
    finally:
        _restore_defaults()
    assert len(calls) == 1
    assert calls[0][1] == 2
    assert [(s.start, s.end, s.speaker) for s in segs] == [
        (0, 50, "SPEAKER_00")
    ]


def test_chunking_disabled_is_single_pass():
    d, calls = _make_diarizer(0.0, 0.0, [[(0, 3600, "SPEAKER_00")]])
    try:
        segs = d.diarize(_audio(3600), num_speakers=2)
    finally:
        _restore_defaults()
    assert len(calls) == 1
    assert len(segs) == 1


def test_swapped_labels_realigned_and_cut_exactly_once():
    # 18s audio, 10s windows, 4s overlap -> windows (0,10) and (6,18),
    # overlap [6,10], cut at 8. Chunk 2 labels its speakers the opposite
    # way; the merged output must use chunk 1's label space throughout
    # with contiguous, non-overlapping coverage.
    script = [
        [(0, 6, "SPEAKER_00"), (6, 10, "SPEAKER_01")],
        [(0, 4, "SPEAKER_00"), (4, 12, "SPEAKER_01")],
    ]
    d, calls = _make_diarizer(10.0, 4.0, script)
    try:
        segs = d.diarize(_audio(18), num_speakers=2)
    finally:
        _restore_defaults()
    assert len(calls) == 2
    assert calls[0] == (10 * SR, 2)
    assert calls[1] == (12 * SR, 2)
    got = [(s.start, s.end, s.speaker) for s in segs]
    assert got == [
        (0, 6, "SPEAKER_00"),
        (6, 8, "SPEAKER_01"),
        (8, 10, "SPEAKER_01"),
        (10, 18, "SPEAKER_01"),
    ], got
    # Contiguous coverage, no gaps or double-covered frames.
    assert segs[0].start == 0.0
    assert segs[-1].end == 18.0
    for s1, s2 in zip(segs, segs[1:]):
        assert abs(s2.start - s1.end) < 1e-9


def test_alignment_prefers_maximum_overlap_agreement():
    from pipeline.backends import _align_chunk_labels

    prev = [
        DiarizationSegment(6, 8, "SPEAKER_00"),
        DiarizationSegment(8, 10, "SPEAKER_01"),
    ]
    cur = [
        DiarizationSegment(6, 8, "SPEAKER_01"),
        DiarizationSegment(8, 10, "SPEAKER_00"),
    ]
    mapping = _align_chunk_labels(prev, cur, 6.0, 10.0)
    assert mapping == {"SPEAKER_00": "SPEAKER_01", "SPEAKER_01": "SPEAKER_00"}


def test_alignment_identity_when_overlap_has_no_signal():
    from pipeline.backends import _align_chunk_labels

    # Current chunk silent inside the overlap: nothing to vote with.
    prev = [DiarizationSegment(6, 10, "SPEAKER_00")]
    cur = [DiarizationSegment(10, 14, "SPEAKER_01")]
    mapping = _align_chunk_labels(prev, cur, 6.0, 10.0)
    assert mapping == {"SPEAKER_01": "SPEAKER_01"}


def test_alignment_greedy_for_unequal_label_counts():
    from pipeline.backends import _align_chunk_labels

    prev = [
        DiarizationSegment(6, 8, "SPEAKER_00"),
        DiarizationSegment(8, 10, "SPEAKER_01"),
    ]
    cur = [
        DiarizationSegment(6, 8, "SPEAKER_00"),
        DiarizationSegment(8, 9, "SPEAKER_01"),
        DiarizationSegment(9, 10, "SPEAKER_02"),
    ]
    mapping = _align_chunk_labels(prev, cur, 6.0, 10.0)
    assert mapping["SPEAKER_00"] == "SPEAKER_00"
    assert mapping["SPEAKER_01"] == "SPEAKER_01"
    assert mapping["SPEAKER_02"] == "SPEAKER_02"


def test_plan_extends_previous_window_for_degenerate_tail():
    from pipeline.backends import _plan_diarization_chunks

    chunk, overlap = 10 * SR, 4 * SR
    # 13s: the tail past (0,10) is only 3s of new audio (< 4s overlap + 1s),
    # so a single extended window covers everything.
    assert _plan_diarization_chunks(13 * SR, chunk, overlap) == [(0, 13 * SR)]
    # 16s: 6s of new audio justifies the second window.
    assert _plan_diarization_chunks(16 * SR, chunk, overlap) == [
        (0, 10 * SR),
        (6 * SR, 16 * SR),
    ]
    # Adjacent (zero-overlap) windows still tile without gaps.
    assert _plan_diarization_chunks(25 * SR, chunk, 0) == [
        (0, 10 * SR),
        (10 * SR, 20 * SR),
        (20 * SR, 25 * SR),
    ]


def test_cancellation_between_diarization_chunks():
    d, calls = _make_diarizer(
        10.0, 4.0, [[(0, 10, "SPEAKER_00")], [(0, 12, "SPEAKER_00")]]
    )
    try:
        try:
            d.diarize(_audio(18), num_speakers=2, is_cancelled=lambda: True)
        except TranscriptionCancelled:
            pass
        else:
            raise AssertionError("expected TranscriptionCancelled")
        assert calls == []
        segs = d.diarize(_audio(18), num_speakers=2, is_cancelled=lambda: False)
        assert len(calls) == 2
        assert segs[0].start == 0.0
        assert segs[-1].end == 18.0
    finally:
        _restore_defaults()


if __name__ == "__main__":
    import traceback

    fns = sorted(
        (name, fn)
        for name, fn in globals().items()
        if name.startswith("test_") and callable(fn)
    )
    failed = 0
    for name, fn in fns:
        try:
            fn()
            print(f"PASS {name}")
        except Exception:
            failed += 1
            print(f"FAIL {name}")
            traceback.print_exc()
    print(f"{len(fns) - failed}/{len(fns)} passed")
    raise SystemExit(1 if failed else 0)
