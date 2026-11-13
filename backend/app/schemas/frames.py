"""Glove frame types streamed over the WebSocket and stored in recordings."""

from typing import Literal

from pydantic import BaseModel, field_validator

from app import constants as c
from app.schemas.common import FingerValues, GloveSource, Side, Triple


class HandFrame(BaseModel):
    """One hand at one instant. Flexion is [MCP, PIP, DIP] (thumb [CMC, MCP, IP]); 0 straight, positive curled."""

    side: Side
    wrist_quat: tuple[float, float, float, float]
    wrist_pos: tuple[float, float, float] | None = None
    flexion: dict[str, Triple]
    spread: FingerValues | None = None

    @field_validator("flexion")
    @classmethod
    def _all_fingers(cls, value: dict[str, Triple]) -> dict[str, Triple]:
        """Require exactly the five fingers."""
        if set(value) != set(c.FINGERS):
            raise ValueError(f"flexion must have exactly the keys {list(c.FINGERS)}")
        return value


class GloveFrame(BaseModel):
    """What the glove stream emits, about 60 Hz."""

    t: float
    source: GloveSource | Literal["replay"]
    hands: list[HandFrame]

    def hand(self, side: Side) -> HandFrame | None:
        """Return the hand with the given side, if present."""
        return next((h for h in self.hands if h.side == side), None)
