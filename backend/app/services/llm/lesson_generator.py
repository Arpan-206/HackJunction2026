"""Generate a Lesson from a master's free-text request, validating and retrying model output."""

import json
import logging

from pydantic import ValidationError

from app import constants as c
from app.core.errors import LLMTimeoutError
from app.core.utils import new_id, utc_now_iso
from app.schemas.api import GenerateLessonResponse
from app.schemas.common import Skill
from app.schemas.lesson import Lesson, LessonBase
from app.services.llm.base import LLMRequest
from app.services.llm.fake import template_lesson
from app.services.llm.registry import LLMState
from app.services.llm.schema import llm_schema
from app.services.moves import MoveCatalog

log = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You design short hand-skill lessons for the Apprentice smart-glove trainer. "
    "Reply with a single JSON object that matches the supplied JSON schema exactly, with no commentary. "
    "Angles are not needed: describe each step with a motion preset. Use between 2 and 4 steps, titled "
    "'Lesson N: ...', with a plain-language instruction a beginner understands. Prefer move ids from the catalogue."
)


class LessonGenerator:
    """Prompt, validate, retry with feedback, then fall back to the offline template."""

    def __init__(self, llm: LLMState, moves: MoveCatalog) -> None:
        """Use the active provider from llm and the move catalogue for the prompt."""
        self._llm = llm
        self._moves = moves

    def _prompt(self, text: str, skill: Skill | None, errors: str | None) -> str:
        """Compose the user prompt, appending validation errors from the previous attempt if any."""
        catalogue = "\n".join(f"- {m.id}: {m.name} ({m.skill}, motion preset {m.default_motion.preset})" for m in self._moves.list(skill))
        parts = [f"MASTER REQUEST:\n{text}", f"MOVE CATALOGUE:\n{catalogue}", f"JSON SCHEMA:\n{json.dumps(llm_schema(LessonBase))}"]
        if errors:
            parts.append(f"YOUR PREVIOUS ANSWER FAILED VALIDATION. Fix these errors and answer again:\n{errors}")
        return "\n\n".join(parts)

    def _finalise(self, draft: LessonBase) -> Lesson:
        """Mark the lesson as generated, drop unknown move ids, and assign server fields."""
        steps = [s.model_copy(update={"move_id": s.move_id if s.move_id and self._moves.get(s.move_id) else None}) for s in draft.steps]
        data = draft.model_copy(update={"source": "generated", "steps": steps}).model_dump()
        return Lesson(**data, id=new_id(), created_at=utc_now_iso())

    async def generate_from_video(
        self, text: str, skill: Skill | None, video_path: str, mime_type: str, filename: str
    ) -> GenerateLessonResponse:
        """Generate a lesson from a video; providers without video support get the template plus a note."""
        client = self._llm.client
        if not getattr(client, "supports_video", False):
            draft = template_lesson(f"{text} {filename}", skill)
            draft = draft.model_copy(update={"summary": f"{c.VIDEO_FAKE_NOTE} {draft.summary}".strip()})
            return GenerateLessonResponse(lesson=self._finalise(draft), provider="fake", attempts=0)
        return await self.generate(text or c.VIDEO_DEFAULT_PROMPT, skill, video=(video_path, mime_type))

    async def generate(self, text: str, skill: Skill | None, video: tuple[str, str] | None = None) -> GenerateLessonResponse:
        """Return a lesson, the provider that produced it, and the number of model attempts used."""
        client = self._llm.client
        video_path, video_mime = video if video else (None, None)
        errors: str | None = None
        attempts = 0
        for _ in range(1 + c.LLM_MAX_RETRIES):
            attempts += 1
            request = LLMRequest(SYSTEM_PROMPT, self._prompt(text, skill, errors), text, skill, llm_schema(LessonBase),
                                 video_path=video_path, video_mime=video_mime)
            try:
                raw = await client.generate_json(request)
                draft = LessonBase.model_validate_json(raw)
            except ValidationError as exc:
                errors = str(exc)
            except LLMTimeoutError as exc:
                log.warning("LLM timed out (%s); falling back without retrying", exc)
                break
            except Exception as exc:
                errors = f"{type(exc).__name__}: {exc}"
                log.warning("LLM call failed on attempt %d: %s", attempts, exc)
            else:
                return GenerateLessonResponse(lesson=self._finalise(draft), provider=client.name, attempts=attempts)
        log.warning("Falling back to the fake template after %d failed attempts", attempts)
        return GenerateLessonResponse(lesson=self._finalise(template_lesson(text, skill)), provider="fake", attempts=attempts)
