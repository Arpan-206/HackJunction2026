"""Scoring route."""

from fastapi import APIRouter

from app.api.deps import ScoringDep
from app.schemas.records import ScoreRequest, ScoreResult

router = APIRouter(tags=["score"])


@router.post("/score", response_model=ScoreResult)
async def score(body: ScoreRequest, scoring: ScoringDep) -> ScoreResult:
    """Score an attempt against a reference recording or motion."""
    return scoring.score(body)
