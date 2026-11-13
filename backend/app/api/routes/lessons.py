"""Lesson routes."""

from fastapi import APIRouter

from app.api.deps import GeneratorDep, LessonsDep
from app.schemas.api import GenerateLessonRequest, GenerateLessonResponse
from app.schemas.lesson import Lesson, LessonBase

router = APIRouter(tags=["lessons"])


@router.get("/lessons", response_model=list[Lesson])
async def list_lessons(lessons: LessonsDep) -> list[Lesson]:
    """Return all lessons."""
    return lessons.list()


@router.post("/lessons/generate", response_model=GenerateLessonResponse)
async def generate_lesson(body: GenerateLessonRequest, generator: GeneratorDep) -> GenerateLessonResponse:
    """Generate (but do not store) a lesson from a free-text request."""
    return await generator.generate(body.prompt, body.skill)


@router.get("/lessons/{lesson_id}", response_model=Lesson)
async def get_lesson(lesson_id: str, lessons: LessonsDep) -> Lesson:
    """Return one lesson."""
    return lessons.get(lesson_id)


@router.post("/lessons", response_model=Lesson, status_code=201)
async def create_lesson(body: LessonBase, lessons: LessonsDep) -> Lesson:
    """Store a new lesson."""
    return lessons.create(body)


@router.put("/lessons/{lesson_id}", response_model=Lesson)
async def update_lesson(lesson_id: str, body: LessonBase, lessons: LessonsDep) -> Lesson:
    """Replace a lesson."""
    return lessons.update(lesson_id, body)
