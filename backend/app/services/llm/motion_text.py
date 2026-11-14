"""Turn a free-text request into a MotionSpec, validating and retrying model output."""

import logging

from pydantic import ValidationError

from app import constants as c
from app.core.errors import LLMTimeoutError, RateLimitedError
from app.schemas.api import MotionDraft, MotionFromTextRequest, MotionFromTextResponse
from app.services.llm.base import LLMRequest
from app.services.llm.chain import answered_by
from app.services.llm.fake import template_motion
from app.services.llm.registry import LLMState
from app.services.llm.schema import llm_schema

log = logging.getLogger(__name__)

SYSTEM_PROMPT = f"""<role>
You choose a hand motion preset for the Geppetto glove simulator from a short free-text request.
</role>

<rules>
- Output only the JSON object that matches the response schema. No commentary.
- Pick exactly one preset and fill its parameters:
  finger_sequence: piano style finger runs, sequence is finger numbers 1 (thumb) to 5 (little).
  grip_and_swing: table tennis grip (shakehand or penhold) plus swing (forehand or backhand).
  pinch: thumb against index (2) and or middle (3).
  hold_pose: a static pose, curl 0 open to 1 fully curled for each finger.
  idle: a relaxed hand, for anything else.
- Words such as slow mean a longer beat_ms and fast a shorter one. Keep beat_ms between
  {c.MOTION_MIN_BEAT_MS:g} and {c.MOTION_MAX_BEAT_MS:g}. Omit nothing that the preset needs.
- explanation: one short sentence saying what you chose and why.
</rules>

<example>
Request: slow pinch with the middle finger
Output: {{"motion": {{"preset": "pinch", "fingers": [3], "beat_ms": 1600}}, "explanation": "A slow thumb to middle finger pinch."}}
</example>"""


class MotionTextService:
    """Prompt, validate, retry with feedback, then fall back to keyword rules."""

    def __init__(self, llm: LLMState) -> None:
        """Use the active provider from llm."""
        self._llm = llm

    def _prompt(self, request: MotionFromTextRequest, errors: str | None) -> str:
        """Compose the user prompt, appending validation errors from the previous attempt if any."""
        side = f"\nHAND: {request.side}" if request.side else ""
        parts = [f"REQUEST:\n{request.text}{side}"]
        if errors:
            parts.append(
                f"YOUR PREVIOUS ANSWER FAILED VALIDATION. Fix these errors and answer again:\n{errors}"
            )
        return "\n\n".join(parts)

    async def from_text(self, request: MotionFromTextRequest) -> MotionFromTextResponse:
        """Return a motion, a short explanation and the provider that chose it."""
        client = self._llm.client_for("motion")
        errors: str | None = None
        fallback_provider = "fake"
        for attempt in range(1, 2 + c.LLM_MAX_RETRIES):
            llm_request = LLMRequest(
                SYSTEM_PROMPT,
                self._prompt(request, errors),
                request.text,
                None,
                llm_schema(MotionDraft),
                "motion",
            )
            try:
                draft = MotionDraft.model_validate_json(
                    await client.generate_json(llm_request)
                )
            except ValidationError as exc:
                errors = str(exc)
            except LLMTimeoutError as exc:
                log.warning(
                    "LLM timed out or rate limited (%s); falling back without retrying",
                    exc,
                )
                fallback_provider = (
                    c.PROVIDER_RATE_LIMITED
                    if isinstance(exc, RateLimitedError)
                    else "fake"
                )
                break
            except Exception as exc:
                errors = f"{type(exc).__name__}: {exc}"
                log.warning("Motion LLM call failed on attempt %d: %s", attempt, exc)
            else:
                return MotionFromTextResponse(
                    **draft.model_dump(), provider=answered_by(client.name)
                )
        log.warning("Falling back to keyword rules after failed attempts")
        return MotionFromTextResponse(
            **template_motion(request.text).model_dump(), provider=fallback_provider
        )
