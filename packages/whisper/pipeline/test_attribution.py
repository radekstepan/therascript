"""Unit tests for the model-independent attribution layer.

Run:  python3 -m pytest packages/whisper/pipeline/test_attribution.py -q
No model downloads; all inference is fixture data.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipeline.attribution import attribute_words, words_to_segments
from pipeline.schema import DiarizationSegment, Word


def W(text, start, end):
    return Word(text=text, start=start, end=end)


def D(start, end, speaker):
    return DiarizationSegment(start=start, end=end, speaker=speaker)


def test_clean_alternating_speakers():
    words = [W("Hello", 0.0, 0.5), W("Hi", 1.0, 1.5), W("Bye", 2.0, 2.5)]
    diar = [D(0.0, 0.8, "SPEAKER_00"), D(0.8, 1.8, "SPEAKER_01"), D(1.8, 3.0, "SPEAKER_00")]
    out = attribute_words(words, diar)
    assert [w.speaker for w in out] == ["SPEAKER_00", "SPEAKER_01", "SPEAKER_00"]
    assert all(not w.low_confidence for w in out)


def test_word_exactly_inside_interval():
    out = attribute_words([W("yeah", 1.0, 1.2)], [D(0.0, 5.0, "SPEAKER_01")])
    assert out[0].speaker == "SPEAKER_01"


def test_word_crossing_boundary_takes_max_overlap():
    # Word spans 0.9-1.5; A covers 0.1s, B covers 0.5s -> B wins.
    out = attribute_words(
        [W("hello", 0.9, 1.5)],
        [D(0.0, 1.0, "SPEAKER_00"), D(1.0, 2.0, "SPEAKER_01")],
    )
    assert out[0].speaker == "SPEAKER_01"
    assert out[0].overlap_speaker == "SPEAKER_00"


def test_short_interjection_from_other_speaker():
    # "mm-hmm" at 1.0-1.2 inside a small SPEAKER_01 blip within SPEAKER_00 talk.
    diar = [
        D(0.0, 1.0, "SPEAKER_00"),
        D(1.0, 1.25, "SPEAKER_01"),
        D(1.25, 3.0, "SPEAKER_00"),
    ]
    out = attribute_words([W("mm-hmm", 1.02, 1.2)], diar)
    assert out[0].speaker == "SPEAKER_01"


def test_overlapping_diarization_intervals_overlap_info_preserved():
    # Exclusive contract means overlaps shouldn't arrive, but if they do the
    # argmax still assigns one primary and records the secondary.
    out = attribute_words(
        [W("right", 1.0, 1.4)],
        [D(0.0, 1.3, "SPEAKER_00"), D(1.1, 2.0, "SPEAKER_01")],
    )
    assert out[0].speaker == "SPEAKER_00"
    assert out[0].overlap_speaker == "SPEAKER_01"


def test_small_gap_word_gets_nearest_speaker_flagged():
    out = attribute_words(
        [W("well", 1.05, 1.15)],
        [D(0.0, 1.0, "SPEAKER_00"), D(1.3, 2.0, "SPEAKER_01")],
    )
    assert out[0].speaker == "SPEAKER_00"
    assert out[0].low_confidence is True


def test_first_last_word_outside_coverage():
    diar = [D(5.0, 10.0, "SPEAKER_01")]
    first = attribute_words([W("so", 0.0, 0.5)], diar)[0]
    last = attribute_words([W("bye", 11.0, 11.5)], diar)[0]
    assert first.speaker == "SPEAKER_01" and first.low_confidence
    assert last.speaker == "SPEAKER_01" and last.low_confidence


def test_non_sequential_speaker_ids():
    out = attribute_words(
        [W("a", 0.0, 0.5), W("b", 1.0, 1.5)],
        [D(0.0, 0.8, "SPEAKER_02"), D(0.8, 2.0, "SPEAKER_07")],
    )
    assert [w.speaker for w in out] == ["SPEAKER_02", "SPEAKER_07"]


def test_empty_diarization_yields_unknown_speaker():
    out = attribute_words([W("hello", 0.0, 0.5)], [])
    assert out[0].speaker is None


def test_words_to_segments_splits_on_speaker_change():
    attributed = attribute_words(
        [W("How", 0.0, 0.4), W("are", 0.4, 0.7), W("you?", 0.7, 1.0), W("Terrible.", 1.1, 1.6)],
        [D(0.0, 1.0, "SPEAKER_00"), D(1.0, 2.0, "SPEAKER_01")],
    )
    segs = words_to_segments(attributed)
    assert len(segs) == 2
    assert segs[0]["speaker"] == "SPEAKER_00"
    assert segs[1] == {
        "start": 1.1, "end": 1.6, "text": "Terrible.", "speaker": "SPEAKER_01",
    }


def test_configured_speaker_count_passed_through():
    """Backend must forward the user's num_speakers, not assume 2."""
    seen = {}

    class FakeTurn:
        def __init__(self, start, end):
            self.start = start
            self.end = end

    class FakeAnnotation:
        def itertracks(self, yield_label=False):
            yield FakeTurn(0.0, 1.0), None, "SPEAKER_00"
            yield FakeTurn(1.0, 2.0), None, "SPEAKER_01"
            yield FakeTurn(2.0, 3.0), None, "SPEAKER_02"

    class FakePipeline:
        def __call__(self, payload, **kwargs):
            seen.update(kwargs)

            class Out:
                exclusive_speaker_diarization = FakeAnnotation()
                speaker_diarization = FakeAnnotation()

            return Out()

    import pipeline.backends as backends

    original_payload = backends._waveform_payload
    backends._waveform_payload = lambda audio: {"waveform": audio, "sample_rate": 16000}
    try:
        d = backends.CommunityDiarizer.__new__(backends.CommunityDiarizer)
        d._pipeline = FakePipeline()
        d.last_full_annotation = None
        segs = d.diarize([0.0] * 16, num_speakers=3)
    finally:
        backends._waveform_payload = original_payload
    assert seen.get("num_speakers") == 3
    assert {s.speaker for s in segs} == {"SPEAKER_00", "SPEAKER_01", "SPEAKER_02"}


def test_words_to_segments_splits_at_sentence_end():
    from pipeline.attribution import words_to_segments
    from pipeline.schema import AttributedWord

    def A(text, start, end, speaker="SPEAKER_00"):
        return AttributedWord(text=text, start=start, end=end, speaker=speaker)

    words = [
        A("Hello", 0.0, 0.3), A("world.", 0.3, 0.6),
        A("How", 0.7, 0.9), A("are", 0.9, 1.1), A("you?", 1.1, 1.4),
        A("Fine", 1.5, 1.8),
    ]
    segs = words_to_segments(words)
    assert [s["text"] for s in segs] == ["Hello world.", "How are you?", "Fine"]
    assert all(s["speaker"] == "SPEAKER_00" for s in segs)


def test_words_to_segments_caps_long_monologue():
    from pipeline.attribution import words_to_segments
    from pipeline.schema import AttributedWord

    words = [
        AttributedWord(text=f"w{i}", start=i * 0.3, end=i * 0.3 + 0.25, speaker="SPEAKER_00")
        for i in range(130)
    ]
    segs = words_to_segments(words, max_words=60)
    assert len(segs) == 3
    assert [len(s["text"].split()) for s in segs] == [60, 60, 10]
    # Cap disabled with None.
    assert len(words_to_segments(words, max_words=None)) == 1


def test_near_tie_overlap_uses_midpoint_not_float_noise():
    # Overlaps differ by exactly 1e-10 (float noise scale, within the 1e-9 tie
    # tolerance). The word midpoint is only in SPEAKER_01, so it must win over
    # the marginally larger overlap in SPEAKER_00. Exact-`==` comparison would
    # pick SPEAKER_00 here.
    out = attribute_words(
        [W("word", 0.0, 1.0)],
        [D(0.6, 1.0, "SPEAKER_00"), D(0.1000000001, 0.5, "SPEAKER_01")],
    )
    assert out[0].speaker == "SPEAKER_01"
    assert out[0].overlap_speaker == "SPEAKER_00"


def test_tie_break_swap_keeps_overlap_speaker():
    # Exact tie (both overlaps exactly 0.25), midpoint only in the second
    # segment: primary swaps to B, so the secondary must follow to A. Without
    # the fix the secondary stays on B and overlap_speaker comes out None.
    out = attribute_words(
        [W("word", 0.0, 1.0)],
        [D(0.0, 0.25, "SPEAKER_00"), D(0.25, 0.5, "SPEAKER_01")],
    )
    assert out[0].speaker == "SPEAKER_01"
    assert out[0].overlap_speaker == "SPEAKER_00"


def test_unsorted_words_keep_input_order():
    words = [W("b", 1.0, 1.5), W("a", 0.0, 0.5)]
    diar = [D(0.0, 0.8, "SPEAKER_00"), D(0.8, 2.0, "SPEAKER_01")]
    out = attribute_words(words, diar)
    assert [w.text for w in out] == ["b", "a"]
    assert [w.speaker for w in out] == ["SPEAKER_01", "SPEAKER_00"]


if __name__ == "__main__":
    # Minimal runner so the suite executes without any test framework:
    #   python3 packages/whisper/pipeline/test_attribution.py
    # (Also collected by pytest: plain test_* functions.)
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
