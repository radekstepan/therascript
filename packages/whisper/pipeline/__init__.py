"""Normalized transcription/diarization pipeline.

Internal representation decouples model-specific outputs (NeMo, pyannote)
from the rest of the application. The FastAPI wire format
(segments with start/end/text/speaker) is unchanged.
"""

from .schema import AttributedWord, DiarizationSegment, Word
from .attribution import attribute_words, words_to_segments

__all__ = [
    "Word",
    "DiarizationSegment",
    "AttributedWord",
    "attribute_words",
    "words_to_segments",
]
