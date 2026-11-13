"""Move catalogue route."""

from fastapi import APIRouter

from app.api.deps import MovesDep
from app.schemas.common import Skill
from app.schemas.lesson import MoveKind

router = APIRouter(tags=["moves"])


@router.get("/moves", response_model=list[MoveKind])
async def list_moves(moves: MovesDep, skill: Skill | None = None) -> list[MoveKind]:
    """Return the move catalogue, optionally filtered by skill."""
    return moves.list(skill)
