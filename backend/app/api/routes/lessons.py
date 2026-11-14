"""Lesson routes."""

import contextlib
import os
import tempfile
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, File, Form, UploadFile

from app import constants as c
from app.api.deps import BundlesDep, GeneratorDep, LessonsDep
from app.core.errors import AppError
from app.schemas.api import GenerateLessonRequest, GenerateLessonResponse
from app.schemas.common import Skill
from app.schemas.lesson import Lesson, LessonBase

router = APIRouter(tags=["lessons"])


@router.get("/lessons", response_model=list[Lesson])
async def list_lessons(lessons: LessonsDep) -> list[Lesson]:
    """Return all lessons."""
    return lessons.list()


@router.post("/lessons/generate", response_model=GenerateLessonResponse)
async def generate_lesson(
    body: GenerateLessonRequest, generator: GeneratorDep
) -> GenerateLessonResponse:
    """Generate (but do not store) a lesson from a free-text request."""
    return await generator.generate(body.prompt, body.skill)


class UnsupportedMediaError(AppError):
    """The uploaded file is not an accepted video type."""

    status_code = 415


class PayloadTooLargeError(AppError):
    """The uploaded file exceeds the size cap."""

    status_code = 413


@router.post("/lessons/generate_from_video", response_model=GenerateLessonResponse)
async def generate_lesson_from_video(
    generator: GeneratorDep,
    video: Annotated[UploadFile, File()],
    prompt: Annotated[str, Form()] = "",
    skill: Annotated[Skill | None, Form()] = None,
) -> GenerateLessonResponse:
    """Generate (but do not store) a lesson from an uploaded video; the temporary file is deleted afterwards."""
    mime = (video.content_type or "").split(";")[0].strip().lower()
    if mime not in c.VIDEO_MIME_TYPES:
        raise UnsupportedMediaError(
            f"video must be one of {', '.join(c.VIDEO_MIME_TYPES)}"
        )
    fd, path = tempfile.mkstemp(suffix=c.VIDEO_SUFFIXES[mime])
    try:
        size = 0
        with os.fdopen(fd, "wb") as out:
            while chunk := await video.read(c.VIDEO_UPLOAD_CHUNK_BYTES):
                size += len(chunk)
                if size > c.VIDEO_MAX_BYTES:
                    raise PayloadTooLargeError(
                        f"video is larger than {c.VIDEO_MAX_BYTES // (1024 * 1024)} MB"
                    )
                out.write(chunk)
        return await generator.generate_from_video(
            prompt.strip(), skill, path, mime, video.filename or ""
        )
    finally:
        with contextlib.suppress(OSError):
            os.unlink(path)


@router.get("/lessons/{lesson_id}", response_model=Lesson)
async def get_lesson(lesson_id: str, lessons: LessonsDep) -> Lesson:
    """Return one lesson."""
    return lessons.get(lesson_id)


@router.post("/lessons", response_model=Lesson, status_code=201)
async def create_lesson(
    body: LessonBase,
    lessons: LessonsDep,
    bundles: BundlesDep,
    background: BackgroundTasks,
) -> Lesson:
    """Store a new lesson, then write its backup bundle to data/exports (after the response, off the event loop)."""
    lesson = lessons.create(body)
    background.add_task(bundles.write_backup, lesson.id)
    return lesson


@router.put("/lessons/{lesson_id}", response_model=Lesson)
async def update_lesson(
    lesson_id: str,
    body: LessonBase,
    lessons: LessonsDep,
    bundles: BundlesDep,
    background: BackgroundTasks,
) -> Lesson:
    """Replace a lesson, then write its backup bundle to data/exports."""
    lesson = lessons.update(lesson_id, body)
    background.add_task(bundles.write_backup, lesson.id)
    return lesson
