"""Calibration, recording and score contract types."""

from pydantic import BaseModel, Field, field_validator, model_validator

from app import constants as c
from app.schemas.common import Finger, FingerValues, Side, Tolerance, Triple
from app.schemas.frames import GloveFrame
from app.schemas.motion import MotionSpec


def _zero_flexion() -> dict[str, Triple]:
    """Return an all-zero flexion map."""
    return {f: (0.0, 0.0, 0.0) for f in c.FINGERS}


class Calibration(BaseModel):
    """Averaged flexion for a flat hand and a loose fist."""

    id: str
    side: Side
    flat: dict[str, Triple] = Field(default_factory=_zero_flexion)
    fist: dict[str, Triple] = Field(default_factory=_zero_flexion)
    created_at: str

    @field_validator("flat", "fist")
    @classmethod
    def _all_fingers(cls, value: dict[str, Triple]) -> dict[str, Triple]:
        """Require exactly the five fingers."""
        if set(value) != set(c.FINGERS):
            raise ValueError(f"expected exactly the keys {list(c.FINGERS)}")
        return value


class Recording(BaseModel):
    """A captured take of smoothed glove frames."""

    id: str
    lesson_id: str | None = None
    step_id: str | None = None
    started_at: str
    duration_s: float
    fps: float
    frames: list[GloveFrame]


class ScoreRequest(BaseModel):
    """Compare an attempt against a reference recording or a synthesised motion."""

    reference_recording_id: str | None = None
    reference_motion: MotionSpec | None = None
    attempt_recording_id: str | None = None
    attempt_frames: list[GloveFrame] | None = Field(default=None, max_length=c.MAX_RECORDING_FRAMES)
    side: Side | None = None
    tolerance: Tolerance = Field(default_factory=Tolerance)
    use_latest_calibration: bool = False
    attempt_calibration_id: str | None = None
    reference_calibration_id: str | None = None

    @model_validator(mode="after")
    def _one_reference(self) -> "ScoreRequest":
        """Require exactly one reference source and at least one attempt source."""
        if (self.reference_recording_id is None) == (self.reference_motion is None):
            raise ValueError("provide exactly one of reference_recording_id or reference_motion")
        if self.attempt_recording_id is None and self.attempt_frames is None:
            raise ValueError("provide attempt_recording_id or attempt_frames")
        return self


class ScoreResult(BaseModel):
    """The outcome of a comparison."""

    overall: float
    per_finger: FingerValues
    timing: float
    within_tolerance: bool
    worst_finger: Finger
    hint: str
    warnings: list[str] = Field(default_factory=list)
