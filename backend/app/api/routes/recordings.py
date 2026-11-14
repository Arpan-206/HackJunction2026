"""Recording routes."""

from fastapi import APIRouter

from app.api.deps import RecorderDep
from app.schemas.api import RecordingStartRequest, RecordingStartResponse
from app.schemas.records import Recording

router = APIRouter(tags=["recordings"])


@router.post("/recordings/start", response_model=RecordingStartResponse)
async def start_recording(body: RecordingStartRequest, recorder: RecorderDep) -> RecordingStartResponse:
    """Begin capturing the live glove stream."""
    return RecordingStartResponse(recording_id=recorder.start(body.lesson_id, body.step_id, body.hands))


@router.post("/recordings/{recording_id}/stop", response_model=Recording)
async def stop_recording(recording_id: str, recorder: RecorderDep) -> Recording:
    """Finish a recording and return it."""
    return recorder.stop(recording_id)


@router.get("/recordings/{recording_id}", response_model=Recording)
async def get_recording(recording_id: str, recorder: RecorderDep) -> Recording:
    """Return a stored recording."""
    return recorder.get(recording_id)
