"""Calibration, recording and score contract types."""

from pydantic import BaseModel, Field, field_validator, model_validator

from app import constants as c
from app.schemas.common import (
    Finger,
    FingerValues,
    Hands,
    Margin,
    Side,
    Tolerance,
    Triple,
)
from app.schemas.frames import GloveFrame
from app.schemas.media import MediaRef
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
    hands: Hands = "both"
    video: MediaRef | None = Field(
        default=None,
        description="The webcam filmed during this take (PUT /recordings/{id}/video); offset_s is the video time at "
        "frame 0.",
    )
    frames: list[GloveFrame]


class RecordingSummary(BaseModel):
    """A stored take without its frames (GET /recordings)."""

    id: str
    lesson_id: str | None = None
    step_id: str | None = None
    started_at: str
    duration_s: float
    fps: float
    hands: Hands = "both"
    video: MediaRef | None = None
    frame_count: int

    @classmethod
    def of(cls, recording: Recording) -> "RecordingSummary":
        """Summarise a recording."""
        return cls(
            **recording.model_dump(exclude={"frames"}),
            frame_count=len(recording.frames),
        )


class TakesModelRequest(BaseModel):
    """POST /recordings/model: build a step's model from the expert's takes."""

    recording_ids: list[str] = Field(
        min_length=c.TAKES_HARD_MIN, max_length=c.TAKES_MAX
    )
    side: Side | None = Field(
        default=None,
        description="The hand to model; omit to use the first hand every take has.",
    )
    timing_ms: float = Field(
        default=c.DEFAULT_TOLERANCE_TIMING_MS,
        gt=0,
        description="Timing tolerance to put in the returned tolerance (takes start at different moments, so timing "
        "is not derived from them).",
    )

    @field_validator("recording_ids")
    @classmethod
    def _distinct(cls, value: list[str]) -> list[str]:
        """Reject a take named twice."""
        if len(set(value)) != len(value):
            raise ValueError("recording_ids must be distinct")
        return value


class TakeConsistency(BaseModel):
    """How one take sits against the medoid (the chosen reference)."""

    recording_id: str
    is_reference: bool
    distance_deg: float = Field(
        description="Mean over fingers of the DTW total-flexion error against the reference; 0 for the reference."
    )
    score: float = Field(
        description="0..100: this take scored as an attempt against the reference with the derived tolerance."
    )
    error_deg: FingerValues
    worst_finger: Finger | None = Field(
        description="The finger that strays most from the reference; null for the reference itself."
    )
    outlier: bool = Field(
        description="Far from the other takes; suggest recording it again."
    )


class TakesModel(BaseModel):
    """The model built from several takes: best take (the medoid) plus a per-finger tolerance from their spread."""

    side: Side
    reference_recording_id: str
    take_ids: list[str]
    tolerance: Tolerance
    spread_deg: FingerValues = Field(
        description="Each finger's robust spread around the reference before scaling and clamping."
    )
    takes: list[TakeConsistency]
    consistency: float = Field(
        description="0..100: mean score of the non-reference takes against the reference."
    )
    steadiest_finger: Finger
    loosest_finger: Finger
    enough_takes: bool = Field(
        description=f"At least {c.TAKES_MIN} takes, the recommended minimum."
    )
    warnings: list[str] = Field(default_factory=list)


class ScoreRequest(BaseModel):
    """Compare an attempt against a reference recording or a synthesised motion."""

    reference_recording_id: str | None = None
    reference_motion: MotionSpec | None = None
    attempt_recording_id: str | None = None
    attempt_frames: list[GloveFrame] | None = Field(
        default=None, max_length=c.MAX_RECORDING_FRAMES
    )
    side: Side | None = None
    tolerance: Tolerance = Field(default_factory=Tolerance)
    margin: Margin = Field(
        default=c.DEFAULT_MARGIN,
        description="The learner's margin of error; scales the tolerance and the hint thresholds.",
    )
    use_latest_calibration: bool = False
    attempt_calibration_id: str | None = None
    reference_calibration_id: str | None = None

    @model_validator(mode="after")
    def _one_reference(self) -> "ScoreRequest":
        """Require exactly one reference source and at least one attempt source."""
        if (self.reference_recording_id is None) == (self.reference_motion is None):
            raise ValueError(
                "provide exactly one of reference_recording_id or reference_motion"
            )
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
    margin: Margin = Field(
        default=c.DEFAULT_MARGIN,
        description="The margin of error the score was judged with.",
    )
