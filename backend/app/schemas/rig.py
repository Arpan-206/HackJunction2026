"""Wire types for the real-glove status screen, the calibration area and demo mode's drift check."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app import constants as c
from app.schemas.common import GloveSource, Side, Triple

Connection = Literal["usb", "wifi", "emulated", "unknown"]
IssueCode = Literal[
    "studio_running",
    "device_busy",
    "driver_not_running",
    "solver_not_running",
    "no_usb_devices",
    "glove_missing",
    "not_streaming",
    "no_frames",
    "low_frame_rate",
    "saturation",
    "heading_unreliable",
]
QualityGrade = Literal["good", "fair", "poor"]


class SensorStatus(BaseModel):
    """One sensor of a glove (a finger, the arm or the hub) and the saturation flags set on it right now."""

    name: str
    saturated: list[str] = Field(
        default_factory=list,
        description="Saturated parts in plain words, e.g. 'magnetometer'.",
    )


class GloveDeviceStatus(BaseModel):
    """One glove as the status screen shows it. Unknown values are null."""

    side: Side
    connected: bool
    device_id: int | None = None
    connection: Connection | None = None
    fps: float | None = Field(
        default=None, description="Frames per second reaching the app for this hand."
    )
    driver_fps: float | None = Field(
        default=None, description="Frames per second the driver streams for this glove."
    )
    streaming: bool | None = Field(
        default=None,
        description="The driver sends this glove's data; false when nobody subscribed to it, null when unknown.",
    )
    last_frame_age_ms: float | None = None
    battery_pct: float | None = None
    heading_reliable: bool | None = None
    sensors: list[SensorStatus] = Field(default_factory=list)


class DriverState(BaseModel):
    """The Rokoko processes and ports on this machine."""

    driver_running: bool
    driver_port_open: bool
    solver_running: bool
    solver_port_open: bool
    rcsp_connected: bool
    studio_running: bool
    managed: bool = Field(
        description="True when this backend started rkk-hand-solver and will stop it on shutdown."
    )
    autostart: bool
    sdk_found: bool
    last_error: str | None = None


class GloveIssue(BaseModel):
    """Something wrong, with the fix step to show. Blocking issues stop the gloves from working at all."""

    code: IssueCode
    side: Side | None = None
    blocking: bool
    title: str
    fix: str


class GloveRigStatus(BaseModel):
    """GET /api/gloves/status: both gloves, the driver and what to fix, most important first."""

    checked_at: str
    source: GloveSource
    ready: bool
    driver: DriverState
    gloves: list[GloveDeviceStatus]
    issues: list[GloveIssue]


class DriverActionRequest(BaseModel):
    """Start or stop the solver (and its driver) that this backend manages."""

    action: Literal["start", "stop"]


class ReinitResult(BaseModel):
    """How many gloves accepted RCSP ReinitAlgo."""

    devices: int


def _clean_wearer(value: str) -> str:
    """Trim a wearer name and refuse an empty one."""
    name = " ".join(value.split())
    if not name:
        raise ValueError("wearer must not be empty")
    return name


class NeutralHand(BaseModel):
    """One hand's neutral pose: flexion offsets per joint (radians), the wrist yaw zero, and how still it was."""

    side: Side
    offsets: dict[str, Triple]
    yaw_zero_deg: float
    noise_deg: float
    yaw_spread_deg: float
    frames: int


class CalibrationQuality(BaseModel):
    """Noise at rest, bias from a flat hand and heading reliability, with a grade and plain-word notes."""

    noise_deg: float | None = None
    bias_deg: float | None = None
    heading_reliable: float | None = Field(
        default=None,
        description="Share of the capture (0..1) with a reliable heading; null when unknown.",
    )
    grade: QualityGrade
    notes: list[str] = Field(default_factory=list)


class WearerCalibration(BaseModel):
    """Everything calibrated for one wearer at one time: neutral pose, the flat and fist range ids, and the quality."""

    id: str
    wearer: str
    created_at: str
    neutral: list[NeutralHand]
    range_calibration_ids: dict[Side, str] = Field(default_factory=dict)
    quality: CalibrationQuality
    reinit: bool = False
    verified: bool = False


class NeutralCaptureRequest(BaseModel):
    """Capture the neutral pose: hands flat on the table, thumbs together, still."""

    wearer: str = Field(min_length=1, max_length=c.WEARER_MAX_CHARS)
    duration_s: float = Field(
        default=c.NEUTRAL_DEFAULT_DURATION_S, gt=0, le=c.NEUTRAL_MAX_DURATION_S
    )
    reinit: bool = Field(
        default=False,
        description="Send RCSP ReinitAlgo to each glove first and let it settle.",
    )

    @field_validator("wearer")
    @classmethod
    def _wearer(cls, value: str) -> str:
        """Collapse whitespace in the wearer name."""
        return _clean_wearer(value)


class CalibrationFinishRequest(BaseModel):
    """Attach the flat and fist range calibrations (POST /calibrations ids) and the verification result."""

    range_calibration_ids: dict[Side, str] | None = None
    verified: bool | None = None


class DriftCheckRequest(BaseModel):
    """Demo mode: hold still for a moment and compare with the wearer's last saved neutral pose."""

    wearer: str = Field(min_length=1, max_length=c.WEARER_MAX_CHARS)
    duration_s: float = Field(
        default=c.DRIFT_CHECK_DURATION_S, gt=0, le=c.NEUTRAL_MAX_DURATION_S
    )

    @field_validator("wearer")
    @classmethod
    def _wearer(cls, value: str) -> str:
        """Collapse whitespace in the wearer name."""
        return _clean_wearer(value)


class DriftHand(BaseModel):
    """How far one hand has drifted from the saved neutral pose."""

    side: Side
    flex_drift_deg: float
    yaw_drift_deg: float


class DriftCheckResult(BaseModel):
    """ok is true when every hand stays inside both thresholds; otherwise the wearer should recalibrate."""

    ok: bool
    calibration_id: str
    hands: list[DriftHand]
    max_flex_deg: float
    max_yaw_deg: float
    message: str
