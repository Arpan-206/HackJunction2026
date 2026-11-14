"""Motion preview route."""

from fastapi import APIRouter

from app.api.deps import MotionTextDep
from app.schemas.api import MotionFromTextRequest, MotionFromTextResponse, MotionPreviewRequest, MotionPreviewResponse
from app.services.motion import synthesiser

router = APIRouter(tags=["motion"])


@router.post("/motion/preview", response_model=MotionPreviewResponse)
async def preview_motion(body: MotionPreviewRequest) -> MotionPreviewResponse:
    """Synthesise guide-hand frames for a motion."""
    return MotionPreviewResponse(frames=synthesiser.synthesise(body.motion, body.side, body.duration_s))


@router.post("/motion/from_text", response_model=MotionFromTextResponse)
async def motion_from_text(body: MotionFromTextRequest, service: MotionTextDep) -> MotionFromTextResponse:
    """Choose a motion preset for a free-text request."""
    return await service.from_text(body)
