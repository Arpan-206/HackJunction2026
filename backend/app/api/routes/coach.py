"""Coaching hint route."""

from fastapi import APIRouter

from app.api.deps import CoachDep
from app.schemas.api import CoachHintRequest, CoachHintResponse

router = APIRouter(tags=["coach"])


@router.post("/coach/hint", response_model=CoachHintResponse)
async def coach_hint(body: CoachHintRequest, coach: CoachDep) -> CoachHintResponse:
    """Return a short tip for the learner."""
    return await coach.hint(body)
