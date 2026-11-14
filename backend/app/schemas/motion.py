"""Parametric motion specifications shared by the simulator, the move catalogue and the LLM."""

from typing import Annotated, Literal

from pydantic import BaseModel, Field

from app import constants as c
from app.schemas.common import FingerValues


class FingerSequence(BaseModel):
    """Press fingers in order, one per beat (1 thumb .. 5 little)."""

    preset: Literal["finger_sequence"] = "finger_sequence"
    sequence: list[Literal[1, 2, 3, 4, 5]] = Field(min_length=1)
    beat_ms: float = Field(default=c.SEQUENCE_DEFAULT_BEAT_MS, gt=0)


class GripAndSwing(BaseModel):
    """Hold a racket grip and swing."""

    preset: Literal["grip_and_swing"] = "grip_and_swing"
    grip: Literal["shakehand", "penhold"]
    swing: Literal["forehand", "backhand"]
    beat_ms: float = Field(default=c.SWING_DEFAULT_BEAT_MS, gt=0)


class Pinch(BaseModel):
    """Pinch the thumb against index (2) and or middle (3)."""

    preset: Literal["pinch"] = "pinch"
    fingers: list[Literal[2, 3]] = Field(min_length=1)
    beat_ms: float = Field(default=c.PINCH_DEFAULT_BEAT_MS, gt=0)


class HoldPose(BaseModel):
    """Hold a static pose, curl 0 open .. 1 curled per finger."""

    preset: Literal["hold_pose"] = "hold_pose"
    pose: FingerValues
    left_pose: FingerValues | None = None
    """The left hand's pose when the two hands make different shapes; None mirrors `pose`."""


class Keyframe(BaseModel):
    """One key of a keyframed motion: per-finger curls plus wrist angles in radians, reached and held over `ms`."""

    pose: FingerValues
    ms: float = Field(gt=0)
    yaw: float = 0.0
    pitch: float = 0.0
    roll: float = 0.0


class Keyframes(BaseModel):
    """Loop through key poses: the hand eases into each key, then holds it for the rest of its slot.

    Wrist angles are radians in hand space: positive pitch lifts the fingers, positive roll turns the thumb down
    (pronation of the right hand). `left_keys` gives the left hand its own keys, stretched to the right hand's period;
    None mirrors `keys`.
    """

    preset: Literal["keyframes"] = "keyframes"
    keys: list[Keyframe] = Field(min_length=1)
    left_keys: list[Keyframe] | None = Field(default=None, min_length=1)


class Idle(BaseModel):
    """A relaxed hand."""

    preset: Literal["idle"] = "idle"


MotionSpec = Annotated[
    FingerSequence | GripAndSwing | Pinch | HoldPose | Keyframes | Idle,
    Field(discriminator="preset"),
]
