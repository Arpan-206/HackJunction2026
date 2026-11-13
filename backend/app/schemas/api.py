"""Request and response bodies for the HTTP API that are not core contract types."""

from typing import Literal

from pydantic import BaseModel, Field

from app import constants as c
from app.schemas.common import FingerValues, GloveSource, Side, Skill
from app.schemas.frames import GloveFrame
from app.schemas.lesson import Lesson
from app.schemas.motion import MotionSpec


class HealthResponse(BaseModel):
    """GET /health."""

    status: Literal["ok"] = "ok"
    glove_source: GloveSource
    llm_provider: str


class GenerateLessonRequest(BaseModel):
    """POST /lessons/generate."""

    prompt: str = Field(min_length=1)
    skill: Skill | None = None


class GenerateLessonResponse(BaseModel):
    """Generated lesson plus provenance."""

    lesson: Lesson
    provider: str
    attempts: int


class CalibrationRequest(BaseModel):
    """POST /calibrations."""

    side: Side
    phase: Literal["flat", "fist"]
    duration_s: float = Field(default=c.CALIBRATION_DEFAULT_DURATION_S, gt=0, le=c.CALIBRATION_MAX_DURATION_S)


class RecordingStartRequest(BaseModel):
    """POST /recordings/start."""

    lesson_id: str | None = None
    step_id: str | None = None


class RecordingStartResponse(BaseModel):
    """The id of the recording in progress."""

    recording_id: str


class MotionPreviewRequest(BaseModel):
    """POST /motion/preview."""

    motion: MotionSpec
    side: Side = "right"
    duration_s: float = Field(gt=0, le=c.MAX_PREVIEW_DURATION_S)


class MotionPreviewResponse(BaseModel):
    """Synthesised guide frames."""

    frames: list[GloveFrame]


class CoachHintRequest(BaseModel):
    """POST /coach/hint. Deviations are signed degrees per finger: positive means curled too much."""

    step_id: str | None = None
    instruction: str = ""
    deviations: FingerValues = Field(default_factory=FingerValues)
    timing_ms: float = 0.0


class CoachHintResponse(BaseModel):
    """A short spoken-style tip."""

    hint: str
    provider: str


class VisionHand(BaseModel):
    """One hand detected in a webcam image."""

    side: Side
    wrist_pos: tuple[float, float, float] | None
    landmarks: list[tuple[float, float, float]]


class VisionResponse(BaseModel):
    """POST /vision/hands."""

    hands: list[VisionHand]


class SmoothingState(BaseModel):
    """Live smoothing parameters."""

    enabled: bool
    min_cutoff: float
    beta: float


class SmoothingPatch(BaseModel):
    """Partial smoothing update."""

    enabled: bool | None = None
    min_cutoff: float | None = Field(default=None, gt=0)
    beta: float | None = Field(default=None, ge=0)


class DevState(BaseModel):
    """GET /dev/state."""

    glove_source: GloveSource
    smoothing: SmoothingState
    llm_provider: Literal["fake", "gemini", "ollama"]
    simulator_motion: MotionSpec


class DevStatePatch(BaseModel):
    """POST /dev/state: any subset of DevState."""

    glove_source: GloveSource | None = None
    smoothing: SmoothingPatch | None = None
    llm_provider: Literal["fake", "gemini", "ollama"] | None = None
    simulator_motion: MotionSpec | None = None
