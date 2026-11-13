"""Turn a free-text request into a MotionSpec, validating and retrying model output."""

import json
import logging

from pydantic import ValidationError

from app import constants as c
from app.core.errors import LLMTimeoutError
from app.schemas.api import MotionDraft, MotionFromTextRequest, MotionFromTextResponse
from app.services.llm.base import LLMRequest
from app.services.llm.fake import template_motion
from app.services.llm.registry import LLMState
from app.services.llm.schema import llm_schema

log = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You choose a hand motion preset for the Apprentice glove simulator. Reply with a single JSON object that matches "
    "the supplied JSON schema exactly, with no commentary. Pick exactly one preset and fill its parameters: "
    "finger_sequence for piano style finger runs, grip_and_swing for table tennis grips and strokes, pinch for thumb "
    "and finger pinches, hold_pose for static poses (curl 0 open to 1 curled), idle for a relaxed hand. Words such as "
    f"'slow' mean a longer beat_ms. Keep beat_ms between {c.MOTION_MIN_BEAT_MS:g} and {c.MOTION_MAX_BEAT_MS:g}. "
    "'explanation' is one short sentence saying what you chose."
)


class MotionTextService:
    """Prompt, validate, retry with feedback, then fall back to keyword rules."""

    def __init__(self, llm: LLMState) -> None:
        """Use the active provider from llm."""
        self._llm = llm

    def _prompt(self, request: MotionFromTextRequest, errors: str | None) -> str:
        """Compose the user prompt, appending validation errors from the previous attempt if any."""
        side = f"\nHAND: {request.side}" if request.side else ""
        parts = [f"REQUEST:\n{request.text}{side}", f"JSON SCHEMA:\n{json.dumps(llm_schema(MotionDraft))}"]
        if errors:
            parts.append(f"YOUR PREVIOUS ANSWER FAILED VALIDATION. Fix these errors and answer again:\n{errors}")
        return "\n\n".join(parts)

    async def from_text(self, request: MotionFromTextRequest) -> MotionFromTextResponse:
        """Return a motion, a short explanation and the provider that chose it."""
        client = self._llm.client
        errors: str | None = None
        for attempt in range(1, 2 + c.LLM_MAX_RETRIES):
            llm_request = LLMRequest(
                SYSTEM_PROMPT, self._prompt(request, errors), request.text, None, llm_schema(MotionDraft), "motion",
            )
            try:
                draft = MotionDraft.model_validate_json(await client.generate_json(llm_request))
            except ValidationError as exc:
                errors = str(exc)
            except LLMTimeoutError as exc:
                log.warning("LLM timed out (%s); falling back without retrying", exc)
                break
            except Exception as exc:
                errors = f"{type(exc).__name__}: {exc}"
                log.warning("Motion LLM call failed on attempt %d: %s", attempt, exc)
            else:
                return MotionFromTextResponse(**draft.model_dump(), provider=client.name)
        log.warning("Falling back to keyword rules after failed attempts")
        return MotionFromTextResponse(**template_motion(request.text).model_dump(), provider="fake")
