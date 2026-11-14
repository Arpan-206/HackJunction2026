"""Stores expert videos (tutorials and take webcams) under <data_dir>/media: one file plus one JSON record each."""

import contextlib
import os
import tempfile
from pathlib import Path

from fastapi import UploadFile

from app import constants as c
from app.core.errors import AppError, BadRequestError, NotFoundError
from app.core.utils import new_id, utc_now_iso
from app.schemas.media import MediaInfo, media_url
from app.services.storage.json_store import JsonStore


class UnsupportedMediaError(AppError):
    """The uploaded file is not an accepted video type."""

    status_code = 415


class PayloadTooLargeError(AppError):
    """The uploaded file exceeds the size cap."""

    status_code = 413


def mime_of(upload: UploadFile) -> str:
    """Return the upload's media type without parameters (``video/webm;codecs=vp9`` is ``video/webm``)."""
    return (upload.content_type or "").split(";")[0].strip().lower()


class MediaService:
    """Saves, finds and deletes stored videos."""

    def __init__(self, directory: Path) -> None:
        """Keep files and their JSON records side by side in one directory."""
        self._dir = directory
        self._records = JsonStore(directory, MediaInfo)

    def _file(self, info: MediaInfo) -> Path:
        """Return the video file of a record."""
        return self._dir / f"{info.id}{c.MEDIA_SUFFIXES[info.content_type]}"

    async def save(
        self, upload: UploadFile, duration_s: float | None = None
    ) -> MediaInfo:
        """Stream an upload to disk, enforcing the type (415) and size (413) limits, and return its record."""
        mime = mime_of(upload)
        if mime not in c.MEDIA_MIME_TYPES:
            raise UnsupportedMediaError(
                f"video must be one of {', '.join(c.MEDIA_MIME_TYPES)}"
            )
        media_id = new_id()
        fd, tmp = tempfile.mkstemp(dir=self._dir, suffix=".part")
        size = 0
        try:
            with os.fdopen(fd, "wb") as out:
                while chunk := await upload.read(c.VIDEO_UPLOAD_CHUNK_BYTES):
                    size += len(chunk)
                    if size > c.MEDIA_MAX_BYTES:
                        raise PayloadTooLargeError(
                            f"video is larger than {c.MEDIA_MAX_BYTES // (1024 * 1024)} MB"
                        )
                    out.write(chunk)
            if size == 0:
                raise BadRequestError("video file is empty")
            info = MediaInfo(
                id=media_id,
                url=media_url(media_id),
                duration_s=duration_s,
                content_type=mime,
                size_bytes=size,
                created_at=utc_now_iso(),
            )
            os.replace(tmp, self._file(info))
        except BaseException:
            with contextlib.suppress(OSError):
                os.unlink(tmp)
            raise
        return self._records.save(info)

    def get(self, media_id: str) -> MediaInfo:
        """Return a stored video's record, or raise NotFoundError (also when its file has gone)."""
        info = self._records.get(media_id)
        if info is None or not self._file(info).exists():
            raise NotFoundError(f"media {media_id} not found")
        return info

    def path(self, media_id: str) -> tuple[Path, MediaInfo]:
        """Return the file and record of a stored video."""
        info = self.get(media_id)
        return self._file(info), info

    def delete(self, media_id: str) -> None:
        """Delete a stored video and its record, or raise NotFoundError."""
        info = self._records.get(media_id)
        if info is None:
            raise NotFoundError(f"media {media_id} not found")
        with contextlib.suppress(OSError):
            self._file(info).unlink()
        self._records.delete(media_id)
