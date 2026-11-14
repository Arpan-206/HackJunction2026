"""The tuned coach: a small Gemma 4 fine-tuned on our own glove data (coach_tune/), served by vLLM on Verda.

It answers live finger hints only. It rebuilds the prompt it was trained on (coach_tune/prompt.py) from the hint
request, asks the OpenAI-compatible server for one line, and wraps that line in the HintDraft JSON the coach expects.
Timing, wrist and praise cues are not its job: it raises, and the chain moves on to the next provider.
Off unless COACH_MODEL=tuned and TUNED_BASE_URL are set (registry.py).
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx

from app import constants as c
from app.core.errors import LLMTimeoutError, ServiceUnavailableError
from app.schemas.api import CoachHintRequest
from app.services import hints
from app.services.llm.base import LLMRequest

CHAT_PATH = "/v1/chat/completions"
TUNED_MAX_TOKENS = 40

# Copied from coach_tune/prompt.py (the training prompt). backend/tests/test_tuned_coach.py keeps the two equal.
SYSTEM = (
    "You are a hand-skills coach. You see the scorer's result for one learner attempt. "
    "Write one coaching line: one sentence, at most 14 words, in the requested language. "
    "Name the single most important finger and say the fix as a physical cue. "
    "Never use numbers or degrees. Be direct and kind. Reply with the line only."
)
FIX = {
    "too_flat": "curl it more",
    "too_curled": "straighten it",
    "too_spread": "bring it closer to its neighbour",
    "too_closed": "spread it away from its neighbour",
}
LANG_NAMES = {"en": "English", "de": "German", "fi": "Finnish"}


class NotAFingerCue(ValueError):
    """The request is about timing, the wrist or praise; the tuned coach leaves it to the next provider."""


def user_prompt(ex: dict) -> str:
    """Same text as coach_tune/prompt.py user_prompt."""
    errors = "; ".join(
        f"{e['finger']} {e['hint'].replace('_', ' ')} by {round(float(e['err_deg']))} degrees (fix: {FIX[e['hint']]})"
        for e in ex["errors"][:3]
    ) or "none"
    return (
        f"Task: {ex['task']}. Step {ex['step_index'] + 1}: {ex['step_name']} ({ex['kind']}). "
        f"Hand: {ex['hand']}. Score: {round(float(ex['score']))} of 100. "
        f"Top errors: {errors}. Language: {LANG_NAMES[ex['lang']]}."
    )


def example_from_request(request: CoachHintRequest, lang: str = "en") -> tuple[dict, dict]:
    """The training-format example for one hint request, plus the algorithmic draft it must agree with."""
    draft = hints.build_hint_draft(request)
    if draft.cue_type not in ("curl", "extend") or not draft.focus_finger:
        raise NotAFingerCue(draft.cue_type)
    dev = request.deviations.model_dump()
    # Positive deviation: curled more than the guide (too_curled); negative: too straight (too_flat).
    ranked = sorted((f for f in c.FINGERS if abs(dev[f]) > 0), key=lambda f: (f != draft.focus_finger, -abs(dev[f])))
    errors = [{"finger": f, "hint": "too_curled" if dev[f] > 0 else "too_flat", "err_deg": abs(dev[f])} for f in ranked]
    worst = max(abs(dev[f]) for f in c.FINGERS)
    score = max(0.0, min(100.0, 100.0 * (1.0 - max(0.0, worst - 15.0) / 45.0)))
    ex = {
        "task": request.move_name or "practice",
        "step_name": request.instruction or "current step",
        "step_index": 0,
        "kind": "move",
        "hand": "right",
        "score": score,
        "errors": errors,
        "lang": lang,
    }
    return ex, draft.model_dump()


class TunedCoachLLM:
    """OpenAI-compatible client for the tuned coach; returns HintDraft JSON for hint requests only."""

    name = "tuned"
    supports_video = False

    def __init__(
        self,
        base_url: str,
        api_key: str | None,
        model: str,
        lang: str = "en",
        timeout_s: float = c.TUNED_TIMEOUT_S,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        """Remember the server; nothing is contacted until a call is made."""
        self._url = base_url.rstrip("/") + CHAT_PATH
        self._headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        self._model = model
        self._lang = lang if lang in LANG_NAMES else "en"
        self._timeout = timeout_s
        self._transport = transport

    async def _line(self, ex: dict) -> str:
        body: dict[str, Any] = {
            "model": self._model,
            "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user_prompt(ex)}],
            "temperature": 0.2,
            "max_tokens": TUNED_MAX_TOKENS,
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout, headers=self._headers, transport=self._transport) as client:
                response = await client.post(self._url, json=body)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise ServiceUnavailableError(f"tuned coach request failed: {exc}") from exc
        text = (response.json()["choices"][0]["message"].get("content") or "").strip().strip('"').strip()
        return text.splitlines()[0].strip() if text else ""

    async def generate_json(self, request: LLMRequest) -> str:
        """HintDraft JSON for a finger hint. Anything else raises so the chain tries the next provider."""
        if request.task != "hint":
            raise NotAFingerCue(request.task)
        hint_request = CoachHintRequest.model_validate_json(request.user_text)
        ex, draft = example_from_request(hint_request, self._lang)
        try:
            line = await asyncio.wait_for(self._line(ex), timeout=self._timeout)
        except TimeoutError as exc:
            raise LLMTimeoutError(f"tuned coach did not answer within {self._timeout:g} s") from exc
        if not line:
            raise ServiceUnavailableError("tuned coach gave an empty line")
        return json.dumps({**draft, "hint": line})

    async def generate_text(self, request: LLMRequest) -> str:
        """Plain text is not this model's job."""
        raise NotAFingerCue(request.task)
