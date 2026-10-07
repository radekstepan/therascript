"""Unit tests for overlapped long-audio chunking in ParakeetASRBackend.

Run:  python3 packages/whisper/pipeline/test_backends_chunking.py
No model downloads; _transcribe_chunk is stubbed with word grids.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pipeline.backends as backends
from pipeline.backends import TranscriptionCancelled
from pipeline.schema import Word

SR = backends.PARAKEET_SAMPLE_RATE


def _make_backend(chunk_sec, overlap_sec, word_step_sec=0.01):
    """Backend instance with stubbed _transcribe_chunk emitting a word grid."""
    step = int(word_step_sec * SR)
    b = backends.ParakeetASRBackend.__new__(backends.ParakeetASRBackend)
    calls = []

    def fake_transcribe_chunk(chunk):
        calls.append(len(chunk))
        base = chunk[0]  # fake audio values are absolute sample indices
        out = []
        for k in range(0, len(chunk), step):
            s = (chunk[k] - base) / SR
            out.append(Word(text=f"w{chunk[k]}", start=s, end=s + step / SR))
        return out

    b._transcribe_chunk = fake_transcribe_chunk
    backends.PARAKEET_CHUNK_SEC = chunk_sec
    backends.PARAKEET_CHUNK_OVERLAP_SEC = overlap_sec
    return b, calls


def _restore_defaults():
    import os as _os

    backends.PARAKEET_CHUNK_SEC = float(_os.environ.get("PARAKEET_CHUNK_SEC", "600"))
    backends.PARAKEET_CHUNK_OVERLAP_SEC = float(
        _os.environ.get("PARAKEET_CHUNK_OVERLAP_SEC", "10")
    )


def test_overlap_chunks_cover_audio_exactly_once():
    b, calls = _make_backend(chunk_sec=6.0, overlap_sec=1.0)
    try:
        audio = list(range(int(15 * SR)))  # 15 s -> 3 chunks
        words, lang = b.transcribe(audio)
    finally:
        _restore_defaults()
    assert lang == "en"
    assert len(calls) == 3
    assert len(words) == 1500
    assert words[0].start == 0.0
    assert words[-1].end == 15.0
    mids = [(w.start + w.end) / 2.0 for w in words]
    assert all(b2 > b1 for b1, b2 in zip(mids, mids[1:])), "duplicate/overlapping words"
    for w1, w2 in zip(words, words[1:]):
        # Contiguous word grid up to float-arithmetic noise (~1e-13 here).
        assert abs(w2.start - w1.end) < 1e-6, "gap in merged coverage"


def test_short_audio_single_chunk():
    b, calls = _make_backend(chunk_sec=6.0, overlap_sec=1.0)
    try:
        audio = list(range(int(2 * SR)))
        words, lang = b.transcribe(audio)
    finally:
        _restore_defaults()
    assert lang == "en"
    assert len(calls) == 1
    assert len(words) == 200
    assert words[0].start == 0.0
    assert words[-1].end == 2.0


def test_trailing_chunk_shorter_than_overlap():
    # Regression: a final chunk shorter than the overlap used to leave a gap
    # (e.g. 10.0-10.5s dropped for 10.5s audio with 6s chunks / 1s overlap).
    for total, expected in ((10.5, 1050), (15.8, 1580)):
        b, _ = _make_backend(chunk_sec=6.0, overlap_sec=1.0)
        try:
            audio = list(range(int(total * SR)))
            words, lang = b.transcribe(audio)
        finally:
            _restore_defaults()
        assert lang == "en"
        assert len(words) == expected, f"{total}s: got {len(words)} words"
        assert words[0].start == 0.0
        assert abs(words[-1].end - total) < 1e-6
        for w1, w2 in zip(words, words[1:]):
            assert abs(w2.start - w1.end) < 1e-6, f"gap in merged coverage ({total}s)"


def test_cancelled_before_or_during_chunks():
    b, _ = _make_backend(chunk_sec=6.0, overlap_sec=1.0)
    try:
        audio = list(range(int(15 * SR)))
        try:
            b.transcribe(audio, is_cancelled=lambda: True)
        except TranscriptionCancelled:
            pass
        else:
            raise AssertionError("expected TranscriptionCancelled")
        # Not cancelled -> works.
        words, _ = b.transcribe(audio, is_cancelled=lambda: False)
        assert len(words) == 1500
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
