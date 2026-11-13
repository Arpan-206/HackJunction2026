"""Deterministic offline provider: lesson templates for table tennis, piano and a general fallback."""

import re

from app.core.utils import new_id
from app.schemas.common import Skill
from app.schemas.lesson import LessonBase, Step
from app.services.llm.base import LLMRequest
from app.services.moves import MoveCatalog
from app.services.storage.seed import load_seed_lessons

_KEYWORDS: dict[Skill, re.Pattern[str]] = {
    "piano": re.compile(r"piano|keyboard|keys|scale|chord|melody", re.I),
    "table_tennis": re.compile(r"table tennis|ping|pong|racket|paddle|forehand|backhand|shakehand|penhold", re.I),
}
_SEED_BY_SKILL: dict[Skill, str] = {"table_tennis": "seed-table-tennis", "piano": "seed-piano"}
_GENERAL_MOVES = ("general_pinch", "general_power_grip", "general_point")


def detect_skill(text: str, hint: Skill | None) -> Skill:
    """Pick a skill from an explicit hint or by keywords in the request."""
    if hint is not None:
        return hint
    for skill, pattern in _KEYWORDS.items():
        if pattern.search(text):
            return skill
    return "general"


def template_lesson(text: str, hint: Skill | None = None) -> LessonBase:
    """Build the deterministic template lesson for a request."""
    skill = detect_skill(text, hint)
    seed_id = _SEED_BY_SKILL.get(skill)
    if seed_id is not None:
        seed = next(lesson for lesson in load_seed_lessons() if lesson.id == seed_id)
        base = LessonBase.model_validate(seed.model_dump(exclude={"id", "created_at"}))
        return base.model_copy(update={"source": "generated", "steps": [s.model_copy(update={"id": new_id()}) for s in base.steps]})
    catalog = MoveCatalog()
    steps = []
    for number, move_id in enumerate(_GENERAL_MOVES, start=1):
        move = catalog.get(move_id)
        assert move is not None
        steps.append(Step(
            title=f"Lesson {number}: {move.name}", instruction=move.description, move_id=move.id, hands=move.hands,
            prop=move.prop, motion=move.default_motion, repetitions=move.default_repetitions,
        ))
    topic = " ".join(text.split())[:48] or "hand skill"
    return LessonBase(
        title=f"Hand skill: {topic}", skill="general", summary="A short general hand-control warm-up.",
        source="generated", steps=steps,
    )


class FakeLLM:
    """Offline provider with no network access; output depends only on the request."""

    name = "fake"

    async def generate_json(self, request: LLMRequest) -> str:
        """Return the template lesson for the request as JSON."""
        return template_lesson(request.user_text, request.skill).model_dump_json()

    async def generate_text(self, request: LLMRequest) -> str:
        """Return the supplied draft text unchanged, so coaching stays algorithmic offline."""
        return request.user_text

