"""Request and response bodies for the HTTP API that are not core contract types."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app import constants as c
from app.schemas.common import Finger, FingerValues, GloveSource, Side, Skill
from app.schemas.frames import GloveFrame
from app.schemas.lesson import Lesson
from app.schemas.motion import MotionSpec
from app.schemas.records import ScoreResult


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


class PlanStep(BaseModel):
    """A lesson step named in a practice-plan request."""

    step_id: str = Field(max_length=c.PLAN_TEXT_MAX_CHARS)
    title: str = Field(max_length=c.PLAN_TEXT_MAX_CHARS)


class PlanAttempt(BaseModel):
    """One scored attempt at a step."""

    step_id: str = Field(max_length=c.PLAN_TEXT_MAX_CHARS)
    score: ScoreResult


class CoachPlanRequest(BaseModel):
    """POST /coach/plan."""

    lesson_title: str = Field(max_length=c.PLAN_TEXT_MAX_CHARS)
    steps: list[PlanStep] = Field(max_length=c.PLAN_MAX_STEPS)
    attempts: list[PlanAttempt] = Field(max_length=c.PLAN_MAX_ATTEMPTS)


class Drill(BaseModel):
    """One practice exercise for a step."""

    step_id: str
    focus_finger: Finger | None = None
    exercise: str


class CoachPlanResponse(BaseModel):
    """What to practise next, plus a note for the master."""

    summary: str
    drills: list[Drill] = Field(min_length=c.PLAN_MIN_DRILLS, max_length=c.PLAN_MAX_DRILLS)
    master_note: str
    provider: str


class CoachPlanDraft(BaseModel):
    """The model-written part of a practice plan (the provider is added by the server)."""

    summary: str
    drills: list[Drill] = Field(min_length=c.PLAN_MIN_DRILLS, max_length=c.PLAN_MAX_DRILLS)
    master_note: str

    @field_validator("summary")
    @classmethod
    def _short_summary(cls, value: str) -> str:
        """Reject summaries longer than the word limit."""
        if len(value.split()) > c.PLAN_SUMMARY_MAX_WORDS:
            raise ValueError(f"summary must be at most {c.PLAN_SUMMARY_MAX_WORDS} words")
        return value


class MotionFromTextRequest(BaseModel):
    """POST /motion/from_text."""

    text: str = Field(min_length=1, max_length=c.MOTION_TEXT_MAX_CHARS)
    side: Side | None = None


class MotionDraft(BaseModel):
    """The model-written part of a text-to-motion answer."""

    motion: MotionSpec
    explanation: str

    @model_validator(mode="after")
    def _beat_in_bounds(self) -> "MotionDraft":
        """Reject beat lengths outside the supported range."""
        beat = getattr(self.motion, "beat_ms", None)
        if beat is not None and not c.MOTION_MIN_BEAT_MS <= beat <= c.MOTION_MAX_BEAT_MS:
            raise ValueError(f"beat_ms must be between {c.MOTION_MIN_BEAT_MS} and {c.MOTION_MAX_BEAT_MS}")
        return self


class MotionFromTextResponse(BaseModel):
    """A motion chosen for a free-text request."""

    motion: MotionSpec
    explanation: str
    provider: str
