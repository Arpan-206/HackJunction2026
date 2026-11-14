"""Expert media routes: upload, serve (with HTTP range requests, so a video can seek) and delete stored videos."""

from typing import Annotated

from fastapi import APIRouter, File, Form, Response, UploadFile
from fastapi.responses import FileResponse

from app import constants as c
from app.api.deps import MediaDep, RecorderDep
from app.core.errors import BadRequestError
from app.schemas.media import MediaAttachRequest, MediaInfo, MediaRef
from app.schemas.records import RecordingSummary

router = APIRouter(tags=["media"])


@router.post("/media", response_model=MediaInfo, status_code=201)
async def upload_media(
    media: MediaDep,
    video: Annotated[UploadFile, File()],
    duration_s: Annotated[float | None, Form()] = None,
) -> MediaInfo:
    """Store a video (webm, mp4 or mov; 415 otherwise, 413 above the size cap)."""
    if duration_s is not None and not 0 <= duration_s <= c.MEDIA_MAX_DURATION_S:
        raise BadRequestError(
            f"duration_s must be between 0 and {c.MEDIA_MAX_DURATION_S:g}"
        )
    return await media.save(video, duration_s)


@router.get("/media/{media_id}")
async def get_media(media_id: str, media: MediaDep) -> FileResponse:
    """Serve a stored video; Range requests answer 206 with the asked bytes, so the player can seek."""
    path, info = media.path(media_id)
    return FileResponse(path, media_type=info.content_type)


@router.delete("/media/{media_id}", status_code=204)
async def delete_media(media_id: str, media: MediaDep) -> Response:
    """Delete a stored video. Lessons or takes that still point at it show their still instead."""
    media.delete(media_id)
    return Response(status_code=204)


@router.put("/recordings/{recording_id}/video", response_model=RecordingSummary)
async def attach_take_video(
    recording_id: str, body: MediaAttachRequest, media: MediaDep, recorder: RecorderDep
) -> RecordingSummary:
    """Attach the webcam video filmed during a take, with the video time of the take's frame 0."""
    info = media.get(body.media_id)
    return recorder.set_video(
        recording_id, MediaRef(media_id=info.id, url=info.url, offset_s=body.offset_s)
    )


@router.delete("/recordings/{recording_id}/video", response_model=RecordingSummary)
async def detach_take_video(
    recording_id: str, recorder: RecorderDep
) -> RecordingSummary:
    """Detach a take's video (the stored file stays until DELETE /media/{id})."""
    return recorder.set_video(recording_id, None)
