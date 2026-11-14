"""Moves of skills taken off the catalogue (crochet, touch typing), kept as test fixtures for the engines that still use them.

The catalogue (app/data/moves.json) now holds only the four demo skills. The keyframe engine (two-handed keys, wrist roll)
and the touch typing drills are still tested against these motions, which live in tests/fixtures/retired_moves.json.
"""

import json
from pathlib import Path
from typing import Literal

from app import constants as c
from app.schemas.common import Prop, Side
from app.schemas.motion import MotionSpec
from pydantic import BaseModel

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "retired_moves.json"


class RetiredMove(BaseModel):
    """A MoveKind whose skill id is no longer on the wire, so the skill is a plain string here."""

    id: str
    skill: str
    name: str
    description: str
    hands: Side | Literal["both"]
    prop: Prop
    default_motion: MotionSpec
    default_repetitions: int = c.DEFAULT_REPETITIONS


def load_retired_moves() -> list[RetiredMove]:
    """Load and validate every retired move from the fixture file."""
    return [
        RetiredMove.model_validate(m)
        for m in json.loads(FIXTURE.read_text(encoding="utf-8"))
    ]
