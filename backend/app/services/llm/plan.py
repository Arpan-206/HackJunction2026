"""Practice plan from scored attempts, validating and retrying model output."""

import json
import logging

from pydantic import ValidationError

from app import constants as c
from app.core.errors import LLMTimeoutError
from app.schemas.api import CoachPlanDraft, CoachPlanRequest, CoachPlanResponse
from app.services.llm.base import LLMRequest
from app.services.llm.fake import template_plan
from app.services.llm.registry import LLMState
from app.services.llm.schema import llm_schema

log = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are a warm hand-skill coach reviewing a learner's scored practice attempts. Reply with a single JSON object "
    "that matches the supplied JSON schema exactly, with no commentary. 'summary' speaks to the learner in the second "
    f"person, is encouraging and specific, and has at most {c.PLAN_SUMMARY_MAX_WORDS} words. 'drills' has "
    f"{c.PLAN_MIN_DRILLS} to {c.PLAN_MAX_DRILLS} entries, each using a step_id from the request, a focus_finger "
    "(thumb, index, middle, ring, little or null) and a short concrete exercise. 'master_note' tells the master, in the "
    "third person, where this learner struggles. Per-finger scores are 0 to 100, higher is better."
)


class PlanService:
    """Prompt, validate, retry with feedback, then fall back to the offline plan."""

    def __init__(self, llm: LLMState) -> None:
        """Use the active provider from llm."""
        self._llm = llm

    def _prompt(self, request: CoachPlanRequest, errors: str | None) -> str:
        """Compose the user prompt, appending validation errors from the previous attempt if any."""
        parts = [f"SESSION:\n{request.model_dump_json()}", f"JSON SCHEMA:\n{json.dumps(llm_schema(CoachPlanDraft))}"]
        if errors:
            parts.append(f"YOUR PREVIOUS ANSWER FAILED VALIDATION. Fix these errors and answer again:\n{errors}")
        return "\n\n".join(parts)

    async def plan(self, request: CoachPlanRequest) -> CoachPlanResponse:
        """Return a practice plan and the provider that wrote it."""
        client = self._llm.client
        errors: str | None = None
        for attempt in range(1, 2 + c.LLM_MAX_RETRIES):
            llm_request = LLMRequest(
                SYSTEM_PROMPT, self._prompt(request, errors), request.model_dump_json(), None, llm_schema(CoachPlanDraft), "plan",
            )
            try:
                draft = CoachPlanDraft.model_validate_json(await client.generate_json(llm_request))
            except ValidationError as exc:
                errors = str(exc)
            except LLMTimeoutError as exc:
                log.warning("LLM timed out (%s); falling back without retrying", exc)
                break
            except Exception as exc:
                errors = f"{type(exc).__name__}: {exc}"
                log.warning("Plan LLM call failed on attempt %d: %s", attempt, exc)
            else:
                return CoachPlanResponse(**draft.model_dump(), provider=client.name)
        log.warning("Falling back to the fake plan after failed attempts")
        return CoachPlanResponse(**template_plan(request).model_dump(), provider="fake")
