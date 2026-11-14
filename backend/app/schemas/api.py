"""Request and response bodies for the HTTP API that are not core contract types."""

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app import constants as c
from app.schemas.common import (
    Finger,
    FingerValues,
    GloveSource,
    Hands,
    Margin,
    PositiveDeg,
    Side,
    Skill,
)
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
    phase: Literal["flat", "fist", "thumb"]
    duration_s: float = Field(
        default=c.CALIBRATION_DEFAULT_DURATION_S, gt=0, le=c.CALIBRATION_MAX_DURATION_S
    )


class RecordingStartRequest(BaseModel):
    """POST /recordings/start."""

    lesson_id: str | None = None
    step_id: str | None = None
    hands: Hands = "both"


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


CueType = Literal["curl", "extend", "timing", "wrist", "praise"]
Severity = Literal["low", "medium", "high"]


class CoachHintRequest(BaseModel):
    """POST /coach/hint. Deviations are signed degrees per finger of TOTAL flexion: positive means curled more than the guide.

    Only instruction, deviations and timing_ms are needed; the other fields make the hint more specific.
    """

    step_id: str | None = None
    instruction: str = Field(default="", max_length=c.HINT_TEXT_MAX_CHARS)
    move_name: str | None = Field(default=None, max_length=c.HINT_TEXT_MAX_CHARS)
    deviations: FingerValues = Field(default_factory=FingerValues)
    joint_deviations: dict[Finger, list[float]] | None = Field(
        default=None,
        description="Optional per finger [knuckle, middle joint, fingertip] signed degrees.",
    )
    timing_ms: float = 0.0
    wrist_error_deg: float | None = Field(
        default=None, description="Signed wrist error about wrist_axis, in degrees."
    )
    wrist_axis: Literal["pitch", "yaw", "roll"] | None = None
    tolerance_deg: float = Field(default=c.DEFAULT_TOLERANCE_ANGLE_DEG, gt=0)
    finger_tolerance_deg: dict[Finger, PositiveDeg] | None = Field(
        default=None,
        description="Optional per-finger angle tolerance (the step's tolerance.finger_angle_deg); a finger left out "
        "uses tolerance_deg.",
    )
    margin: Margin = Field(
        default=c.DEFAULT_MARGIN,
        description="The learner's margin of error; scales tolerance_deg and the hint thresholds.",
    )
    attempt: int = Field(default=1, ge=1, le=c.HINT_MAX_ATTEMPT)
    last_hint: str | None = Field(default=None, max_length=c.HINT_TEXT_MAX_CHARS)


class HintDraft(BaseModel):
    """One live coaching cue: the model-written (or algorithmic) part of a hint response."""

    hint: str = Field(
        description=f"One imperative sentence of at most {c.HINT_MAX_WORDS} words naming one finger (or the wrist) and one direction."
    )
    focus_finger: Finger | None = Field(
        default=None,
        description="The single finger the hint is about; null for timing, wrist or praise.",
    )
    cue_type: CueType = Field(
        description="curl: bend more. extend: straighten or lift. timing: early or late. wrist: wrist angle. praise: nothing to fix."
    )
    severity: Severity = Field(
        description="low: within tolerance, medium: up to twice the tolerance, high: beyond that."
    )

    @field_validator("hint")
    @classmethod
    def _short_hint(cls, value: str) -> str:
        """Reject empty hints and hints over the word limit."""
        value = value.strip()
        if not value or len(value.split()) > c.HINT_MAX_WORDS:
            raise ValueError(f"hint must be 1 to {c.HINT_MAX_WORDS} words")
        return value


class CoachHintResponse(HintDraft):
    """A short live tip; provider says who wrote it (fake, algorithmic, gemini, openai or 'fake (rate limited)')."""

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


class GeminiBudget(BaseModel):
    """Read-only Gemini request budget for one model (see services/llm/rate_limit.py)."""

    model: str
    rpm_budget: int
    rpm_remaining: int
    rpd_budget: int
    rpd_remaining: int
    free_rpm: int
    free_rpd: int


class DevState(BaseModel):
    """GET /dev/state."""

    glove_source: GloveSource
    smoothing: SmoothingState
    llm_provider: Literal["fake", "gemini", "openai"]
    simulator_motion: MotionSpec
    gemini_budget: list[GeminiBudget] = Field(default_factory=list)
    llm_chain: list[str] = Field(default_factory=list)
    llm_answered_by: str | None = None


class DevStatePatch(BaseModel):
    """POST /dev/state: any subset of DevState."""

    glove_source: GloveSource | None = None
    smoothing: SmoothingPatch | None = None
    llm_provider: Literal["fake", "gemini", "openai"] | None = None
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
    drills: list[Drill] = Field(
        min_length=c.PLAN_MIN_DRILLS, max_length=c.PLAN_MAX_DRILLS
    )
    master_note: str
    provider: str


class CoachPlanDraft(BaseModel):
    """The model-written part of a practice plan (the provider is added by the server)."""

    summary: str
    drills: list[Drill] = Field(
        min_length=c.PLAN_MIN_DRILLS, max_length=c.PLAN_MAX_DRILLS
    )
    master_note: str

    @field_validator("summary")
    @classmethod
    def _short_summary(cls, value: str) -> str:
        """Reject summaries longer than the word limit."""
        if len(value.split()) > c.PLAN_SUMMARY_MAX_WORDS:
            raise ValueError(
                f"summary must be at most {c.PLAN_SUMMARY_MAX_WORDS} words"
            )
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
        if (
            beat is not None
            and not c.MOTION_MIN_BEAT_MS <= beat <= c.MOTION_MAX_BEAT_MS
        ):
            raise ValueError(
                f"beat_ms must be between {c.MOTION_MIN_BEAT_MS} and {c.MOTION_MAX_BEAT_MS}"
            )
        return self


class MotionFromTextResponse(BaseModel):
    """A motion chosen for a free-text request."""

    motion: MotionSpec
    explanation: str
    provider: str


FileKind = Literal["recording", "lesson", "draft", "export", "calibration", "media"]


class RevealRequest(BaseModel):
    """POST /dev/reveal: which stored file to show in the file manager."""

    kind: FileKind
    id: str = Field(min_length=1, max_length=160)


class GloveCompareSave(BaseModel):
    """POST /dev/glove_compare: one guided capture of the glove compare page, saved as JSON (and a PNG snapshot)."""

    session: str = Field(pattern=c.SAFE_ID_PATTERN)
    index: int = Field(ge=0, le=99)
    slug: str = Field(pattern=c.SAFE_ID_PATTERN)
    data: dict[str, Any]
    png: str | None = Field(
        default=None,
        description="Side by side snapshot as a data:image/png;base64 URL.",
    )


class GloveCompareSaved(BaseModel):
    """Where POST /dev/glove_compare wrote the capture."""

    json_path: str
    png_path: str | None = None


class FileLocation(BaseModel):
    """POST /dev/reveal and GET /dev/locate: the stored file's absolute path, and whether a file manager was opened."""

    kind: FileKind
    id: str
    path: str
    opened: bool = False
