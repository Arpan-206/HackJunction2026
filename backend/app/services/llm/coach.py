"""Coaching hints: an algorithmic tip, optionally rephrased by the active LLM."""

import logging

from app.schemas.api import CoachHintRequest, CoachHintResponse
from app.services import hints
from app.services.llm.base import LLMRequest
from app.services.llm.registry import LLMState

log = logging.getLogger(__name__)

ALGORITHMIC = "algorithmic"
SYSTEM_PROMPT = (
    "You are a warm, concise hand-skill coach. Rewrite the draft tip in one or two short spoken sentences. "
    "Keep every number and finger name from the draft. Do not add new advice."
)


class CoachService:
    """Builds a hint from deviations; falls back to the algorithmic text if the LLM fails."""

    def __init__(self, llm: LLMState) -> None:
        """Use the active provider from llm."""
        self._llm = llm

    async def hint(self, request: CoachHintRequest) -> CoachHintResponse:
        """Return a short tip for the learner."""
        draft = hints.build_hint(request.deviations.model_dump(), request.timing_ms)
        client = self._llm.client
        prompt = f"Step instruction: {request.instruction}\nDraft tip: {draft}"
        try:
            text = (await client.generate_text(LLMRequest(SYSTEM_PROMPT, prompt, draft))).strip()
        except Exception as exc:
            log.warning("Coach LLM unavailable (%s); using algorithmic hint", exc)
            return CoachHintResponse(hint=draft, provider=ALGORITHMIC)
        return CoachHintResponse(hint=text or draft, provider=client.name)
