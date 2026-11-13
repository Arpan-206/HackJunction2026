"""Webcam hand detection route."""

from fastapi import APIRouter, UploadFile
from fastapi.concurrency import run_in_threadpool

from app.api.deps import VisionDep
from app.schemas.api import VisionResponse

router = APIRouter(tags=["vision"])


@router.post("/vision/hands", response_model=VisionResponse)
async def detect_hands(image: UploadFile, vision: VisionDep) -> VisionResponse:
    """Detect hands in an uploaded JPEG."""
    return await run_in_threadpool(vision.detect, await image.read())
