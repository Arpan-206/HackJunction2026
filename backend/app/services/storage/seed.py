"""Bundled seed lessons."""

import json
from functools import lru_cache

from app import constants as c
from app.schemas.lesson import Lesson
from app.services.storage.json_store import JsonStore


@lru_cache
def load_seed_lessons() -> tuple[Lesson, ...]:
    """Load and validate the seed lessons shipped in app/data/seed."""
    files = sorted(c.SEED_DIR.glob("*.json"))
    return tuple(
        Lesson.model_validate(json.loads(p.read_text(encoding="utf-8"))) for p in files
    )


def install_seed_lessons(store: JsonStore[Lesson]) -> None:
    """Write any missing seed lessons into the store, never overwriting edits."""
    for lesson in load_seed_lessons():
        if store.get(lesson.id) is None:
            store.save(lesson)
