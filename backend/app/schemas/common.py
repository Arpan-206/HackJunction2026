"""Primitive contract types: sides, fingers, glove sources and per-finger value maps."""

from typing import Annotated, Literal

from pydantic import BaseModel, Field

from app import constants as c

Side = Literal["left", "right"]
Finger = Literal["thumb", "index", "middle", "ring", "little"]
GloveSource = Literal["simulator", "rokoko_udp", "rokoko_sdk", "external"]
Skill = Literal[
    "table_tennis",
    "piano",
    "finnish_fingerspelling",
    "fingerspelling",
    "shadow_puppets",
    "general",
]
Prop = Literal["none", "racket", "keyboard", "ball"]
Hands = Literal["left", "right", "both"]
# The learner's margin of error; see MARGINS in app/constants.py.
Margin = Literal["strict", "standard", "relaxed", "just_trying"]
Triple = tuple[float, float, float]
PositiveDeg = Annotated[float, Field(gt=0)]


class FingerValues(BaseModel):
    """One float per finger, serialised as a Record<Finger, number>."""

    thumb: float = 0.0
    index: float = 0.0
    middle: float = 0.0
    ring: float = 0.0
    little: float = 0.0

    def as_list(self) -> list[float]:
        """Return the values in thumb to little order."""
        return [getattr(self, f) for f in c.FINGERS]

    @classmethod
    def from_list(cls, values: list[float]) -> "FingerValues":
        """Build from five values in thumb to little order."""
        return cls(**{f: float(v) for f, v in zip(c.FINGERS, values, strict=True)})


class Tolerance(BaseModel):
    """Room for error on a step."""

    angle_deg: float = Field(default=c.DEFAULT_TOLERANCE_ANGLE_DEG, gt=0)
    timing_ms: float = Field(default=c.DEFAULT_TOLERANCE_TIMING_MS, gt=0)
    finger_angle_deg: dict[Finger, PositiveDeg] | None = Field(
        default=None,
        description="Per-finger angle tolerance (degrees of total flexion), e.g. from POST /recordings/model; "
        "a finger left out uses angle_deg.",
        json_schema_extra={c.LLM_SCHEMA_SKIP_KEY: True},
    )

    def angle_for(self, finger: str) -> float:
        """Return the angle tolerance for one finger: its own when set, else angle_deg."""
        if self.finger_angle_deg is not None and finger in self.finger_angle_deg:
            return self.finger_angle_deg[finger]  # type: ignore[index]
        return self.angle_deg

    def widened(self, margin: Margin) -> "Tolerance":
        """Return the bands the learner's margin of error asks for: all scaled by its multiplier."""
        k = c.MARGIN_MULTIPLIERS[margin]
        fingers = (
            None
            if self.finger_angle_deg is None
            else {f: v * k for f, v in self.finger_angle_deg.items()}
        )
        return Tolerance(
            angle_deg=self.angle_deg * k,
            timing_ms=self.timing_ms * k,
            finger_angle_deg=fingers,
        )
