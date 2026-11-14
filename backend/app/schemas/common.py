"""Primitive contract types: sides, fingers, glove sources and per-finger value maps."""

from typing import Literal

from pydantic import BaseModel, Field

from app import constants as c

Side = Literal["left", "right"]
Finger = Literal["thumb", "index", "middle", "ring", "little"]
GloveSource = Literal["simulator", "rokoko_udp", "rokoko_sdk", "external"]
Skill = Literal[
    "table_tennis", "piano", "shadow_puppets", "surgical_grips", "crochet", "general"
]
Prop = Literal["none", "racket", "keyboard", "ball"]
Hands = Literal["left", "right", "both"]
# The learner's margin of error; see MARGINS in app/constants.py.
Margin = Literal["strict", "standard", "relaxed", "just_trying"]
Triple = tuple[float, float, float]


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

    def widened(self, margin: Margin) -> "Tolerance":
        """Return the bands the learner's margin of error asks for: both scaled by its multiplier."""
        k = c.MARGIN_MULTIPLIERS[margin]
        return Tolerance(angle_deg=self.angle_deg * k, timing_ms=self.timing_ms * k)
