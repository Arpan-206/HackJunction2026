"""Recording routes: capture takes, list and delete them, and build a step model from several."""

from fastapi import APIRouter, Response

from app.api.deps import RecorderDep, TakesDep
from app.schemas.api import RecordingStartRequest, RecordingStartResponse
from app.schemas.records import (
    Recording,
    RecordingSummary,
    TakesModel,
    TakesModelRequest,
)

router = APIRouter(tags=["recordings"])


@router.get("/recordings", response_model=list[RecordingSummary])
async def list_recordings(
    recorder: RecorderDep, step_id: str | None = None, lesson_id: str | None = None
) -> list[RecordingSummary]:
    """List stored takes without their frames, oldest first, optionally for one step or lesson."""
    return recorder.summaries(step_id=step_id, lesson_id=lesson_id)


@router.post("/recordings/start", response_model=RecordingStartResponse)
async def start_recording(
    body: RecordingStartRequest, recorder: RecorderDep
) -> RecordingStartResponse:
    """Begin capturing the live glove stream."""
    return RecordingStartResponse(
        recording_id=recorder.start(body.lesson_id, body.step_id, body.hands)
    )


@router.post("/recordings/model", response_model=TakesModel)
def build_takes_model(body: TakesModelRequest, takes: TakesDep) -> TakesModel:
    """Turn 2 to 5 takes into a model: the medoid take as reference and a per-finger tolerance from their spread.

    A plain def so the DTW work runs in the threadpool and never stalls the glove WebSocket.
    """
    return takes.model(body)


@router.post("/recordings/{recording_id}/stop", response_model=Recording)
async def stop_recording(recording_id: str, recorder: RecorderDep) -> Recording:
    """Finish a recording and return it."""
    return recorder.stop(recording_id)


@router.get("/recordings/{recording_id}", response_model=Recording)
async def get_recording(recording_id: str, recorder: RecorderDep) -> Recording:
    """Return a stored recording."""
    return recorder.get(recording_id)


@router.delete("/recordings/{recording_id}", status_code=204)
async def delete_recording(recording_id: str, recorder: RecorderDep) -> Response:
    """Delete a stored take, or discard one still recording."""
    recorder.delete(recording_id)
    return Response(status_code=204)
