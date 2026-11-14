"""The catalogue of moves a master can pick when starting from scratch."""

import json
from functools import lru_cache

from app import constants as c
from app.schemas.common import Skill
from app.schemas.lesson import MoveKind


@lru_cache
def load_moves() -> tuple[MoveKind, ...]:
    """Load and validate the bundled moves catalogue."""
    raw = json.loads(c.MOVES_FILE.read_text(encoding="utf-8"))
    return tuple(MoveKind.model_validate(item) for item in raw)


class MoveCatalog:
    """Read access to the moves catalogue."""

    def list(self, skill: Skill | None = None) -> list[MoveKind]:
        """Return all moves, optionally filtered by skill."""
        return [m for m in load_moves() if skill is None or m.skill == skill]

    def get(self, move_id: str) -> MoveKind | None:
        """Return one move by id, or None."""
        return next((m for m in load_moves() if m.id == move_id), None)
