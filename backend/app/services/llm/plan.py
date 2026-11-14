"""Practice plan from scored attempts, validating and retrying model output."""

import logging

from pydantic import ValidationError

from app import constants as c
from app.core.errors import LLMTimeoutError, RateLimitedError
from app.schemas.api import CoachPlanDraft, CoachPlanRequest, CoachPlanResponse
from app.services.llm.base import LLMRequest
from app.services.llm.fake import template_plan
from app.services.llm.registry import LLMState
from app.services.llm.schema import llm_schema

log = logging.getLogger(__name__)

SYSTEM_PROMPT = f"""<role>
You are a warm, specific hand-skill coach reviewing a learner's scored practice attempts from the Geppetto
smart-glove trainer. You write a short practice plan for the learner and a note for the expert who made the lesson.
</role>

<rules>
- Output only the JSON object that matches the response schema. No commentary.
- summary: speak to the learner in the second person, encouraging and specific, at most {c.PLAN_SUMMARY_MAX_WORDS} words.
  Mention one thing that went well and the single biggest thing to fix.
- drills: {c.PLAN_MIN_DRILLS} to {c.PLAN_MAX_DRILLS} entries, weakest step first. step_id must be copied exactly from the
  request. focus_finger is thumb, index, middle, ring or little, or null for a whole-hand drill. exercise is one
  concrete, doable sentence (for example "Repeat the pinch slowly five times, keeping your index finger relaxed").
- master_note: third person, for the expert, saying where this learner struggles and which step might need a clearer demo.
- Per-finger scores run 0 to 100, higher is better. A finger scoring under 60 is a problem. Do not invent attempts or numbers.
- If there are no attempts, tell the learner to do one slow pass to set a baseline.
</rules>"""


class PlanService:
    """Prompt, validate, retry with feedback, then fall back to the offline plan."""

    def __init__(self, llm: LLMState) -> None:
        """Use the active provider from llm."""
        self._llm = llm

    def _prompt(self, request: CoachPlanRequest, errors: str | None) -> str:
        """Compose the user prompt, appending validation errors from the previous attempt if any."""
        parts = [f"SESSION:\n{request.model_dump_json()}"]
        if errors:
            parts.append(
                f"YOUR PREVIOUS ANSWER FAILED VALIDATION. Fix these errors and answer again:\n{errors}"
            )
        return "\n\n".join(parts)

    async def plan(self, request: CoachPlanRequest) -> CoachPlanResponse:
        """Return a practice plan and the provider that wrote it."""
        client = self._llm.client
        errors: str | None = None
        fallback_provider = "fake"
        for attempt in range(1, 2 + c.LLM_MAX_RETRIES):
            llm_request = LLMRequest(
                SYSTEM_PROMPT,
                self._prompt(request, errors),
                request.model_dump_json(),
                None,
                llm_schema(CoachPlanDraft),
                "plan",
            )
            try:
                draft = CoachPlanDraft.model_validate_json(
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
                log.warning("Plan LLM call failed on attempt %d: %s", attempt, exc)
            else:
                return CoachPlanResponse(**draft.model_dump(), provider=client.name)
        log.warning("Falling back to the fake plan after failed attempts")
        return CoachPlanResponse(
            **template_plan(request).model_dump(), provider=fallback_provider
        )
