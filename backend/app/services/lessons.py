"""Lesson CRUD on top of the JSON store."""

from collections.abc import Callable

from app.core.errors import NotFoundError
from app.core.utils import new_id, utc_now_iso
from app.schemas.lesson import Lesson, LessonBase
from app.services.storage.json_store import JsonStore


class LessonService:
    """Creates, reads and updates lessons."""

    def __init__(self, store: JsonStore[Lesson]) -> None:
        """Use the given store."""
        self._store = store
        # Called after a lesson is saved (the Verda export listens here).
        self.on_change: list[Callable[[], None]] = []

    def _saved(self, lesson: Lesson) -> Lesson:
        """Tell the listeners, then return the saved lesson."""
        for listener in self.on_change:
            listener()
        return lesson

    def list(self) -> list[Lesson]:
        """Return every lesson."""
        return self._store.list()

    def get(self, lesson_id: str) -> Lesson:
        """Return a lesson or raise NotFoundError."""
        lesson = self._store.get(lesson_id)
        if lesson is None:
            raise NotFoundError(f"lesson {lesson_id} not found")
        return lesson

    def create(self, body: LessonBase) -> Lesson:
        """Store a new lesson with a fresh id and timestamp."""
        return self._saved(
            self._store.save(
                Lesson(**body.model_dump(), id=new_id(), created_at=utc_now_iso())
            )
        )

    def update(self, lesson_id: str, body: LessonBase) -> Lesson:
        """Replace a lesson, keeping its creation time; creates it if the id is unknown (so generated lessons can be saved)."""
        existing = self._store.get(lesson_id)
        created = existing.created_at if existing else utc_now_iso()
        return self._saved(
            self._store.save(
                Lesson(**body.model_dump(), id=lesson_id, created_at=created)
            )
        )
