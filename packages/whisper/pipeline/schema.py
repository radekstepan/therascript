"""Normalized pipeline types.

Adapt model-specific outputs (NeMo, pyannote) into these instead of leaking
third-party structures through the application.
"""

from dataclasses import dataclass
from typing import Optional


@dataclass
class Word:
    text: str
    start: float
    end: float
    confidence: Optional[float] = None


@dataclass
class DiarizationSegment:
    start: float
    end: float
    speaker: str


@dataclass
class AttributedWord:
    text: str
    start: float
    end: float
    speaker: Optional[str] = None
    # Secondary speaker when the word overlapped >1 diarization speaker.
    # Preserved for analysis even though the transcript assigns one primary.
    overlap_speaker: Optional[str] = None
    low_confidence: bool = False
