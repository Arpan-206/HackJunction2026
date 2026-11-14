"""Expert media contract types: stored videos and the references lessons and takes keep to them."""

from pydantic import BaseModel, Field

from app import constants as c


class MediaInfo(BaseModel):
    """A stored video (POST /media)."""

    id: str
    url: str = Field(
        description="Where the browser fetches the file: /api/media/{id}, with HTTP range support."
    )
    duration_s: float | None = Field(
        default=None,
        description="Length in seconds as the uploader stated it; null when unknown.",
    )
    content_type: str
    size_bytes: int
    created_at: str


class MediaRef(BaseModel):
    """A video attached to a step (its tutorial) or to a take (the webcam during the take), with its sync point."""

    media_id: str
    url: str
    offset_s: float = Field(
        default=0.0,
        ge=-c.MEDIA_MAX_OFFSET_S,
        le=c.MEDIA_MAX_OFFSET_S,
        description="Seconds into the video at which the take's frame 0 (the reference take for a tutorial) plays; "
        "negative when the camera started after the take.",
    )


class MediaAttachRequest(BaseModel):
    """PUT /recordings/{id}/video: attach a stored video to a take."""

    media_id: str
    offset_s: float = Field(
        default=0.0, ge=-c.MEDIA_MAX_OFFSET_S, le=c.MEDIA_MAX_OFFSET_S
    )


def media_url(media_id: str) -> str:
    """Return the URL a stored video is served from."""
    return f"{c.MEDIA_URL_PREFIX}{media_id}"
