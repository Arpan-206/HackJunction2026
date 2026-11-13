"""Motion preview route."""

from fastapi import APIRouter

from app.schemas.api import MotionPreviewRequest, MotionPreviewResponse
from app.services.motion import synthesiser

router = APIRouter(tags=["motion"])


@router.post("/motion/preview", response_model=MotionPreviewResponse)
async def preview_motion(body: MotionPreviewRequest) -> MotionPreviewResponse:
    """Synthesise guide-hand frames for a motion."""
    return MotionPreviewResponse(frames=synthesiser.synthesise(body.motion, body.side, body.duration_s))
