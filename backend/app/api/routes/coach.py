"""Coaching hint route."""

from fastapi import APIRouter

from app.api.deps import CoachDep, PlannerDep
from app.schemas.api import CoachHintRequest, CoachHintResponse, CoachPlanRequest, CoachPlanResponse

router = APIRouter(tags=["coach"])


@router.post("/coach/hint", response_model=CoachHintResponse)
async def coach_hint(body: CoachHintRequest, coach: CoachDep) -> CoachHintResponse:
    """Return a short tip for the learner."""
    return await coach.hint(body)


@router.post("/coach/plan", response_model=CoachPlanResponse)
async def coach_plan(body: CoachPlanRequest, planner: PlannerDep) -> CoachPlanResponse:
    """Return a practice plan for the learner and a note for the master."""
    return await planner.plan(body)
