"""Feedback after a rep in plain words: an algorithmic sentence, rewritten by the active LLM when one answers.

The score screen shows numbers (per-finger scores, degrees, a tolerance) that mean little to a visitor. This service
turns one scored rep into two short sentences anyone can follow: what went well, and one thing to try next. The facts
come from the scorer only; the model never judges the rep, it words what the scorer found.
"""

import logging
import re

from pydantic import ValidationError

from app import constants as c
from app.core.errors import RateLimitedError
from app.schemas.api import CoachReviewDraft, CoachReviewRequest, CoachReviewResponse
from app.services.llm.base import LLMRequest
from app.services.llm.chain import OFFLINE, LLMOfflineError, answered_by
from app.services.llm.rate_limit import TTLCache
from app.services.llm.registry import LLMState
from app.services.llm.schema import llm_schema

log = logging.getLogger(__name__)

ALGORITHMIC = "algorithmic"
_FINGER_WORDS = {
    "thumb": "thumb",
    "index": "index finger",
    "middle": "middle finger",
    "ring": "ring finger",
    "little": "little finger",
}
# Measuring words a visitor should never have to read.
_JARGON = re.compile(
    r"\b(tolerance|degrees?|deviation|flexion|margin|calibrat\w*|dtw|score[ds]?|points?|percent)\b|\d|%",
    re.IGNORECASE,
)

SYSTEM_PROMPT = f"""<role>
You are a warm, patient teacher of hand skills. A learner wearing smart gloves has just finished one repetition of a
move, and a scoring program has measured it. You tell the learner how it went.
</role>

<rules>
- Write at most two short sentences, {c.REVIEW_MAX_WORDS} words in total, for someone who has never done this before.
- First say what went well, as specifically as the facts allow. Then give one thing to try on the next repetition.
- If the repetition was clean and nothing is weak, praise it and tell them to repeat it the same way.
- Use only the facts given. Never invent a problem, and never contradict the scorer's note.
- Speak about fingers by their everyday names (thumb, index finger, middle finger, ring finger, little finger).
- Never mention a finger listed under "Ignore".
- No numbers at all. No measuring words: not score, points, percent, degrees, tolerance, margin, deviation, flexion.
- Plain, friendly, direct. No greetings, no questions, no emojis, no exclamation marks.
- Do not repeat the previous feedback: change the wording.
</rules>

<output>
JSON with one field, "feedback".
</output>"""


def _level(value: float) -> str:
    """A 0 to 100 score as a word the prompt can carry without a number."""
    if value >= c.REVIEW_STRONG_FROM:
        return "strong"
    if value >= c.REVIEW_GOOD_FROM:
        return "good"
    if value >= c.REVIEW_FAIR_FROM:
        return "needs a little work"
    return "needs work"


def ignored(request: CoachReviewRequest) -> list[str]:
    """Fingers the step weights too little to talk about (the scorer's focus rule)."""
    w = request.weights or {}
    return [f for f in c.FINGERS if w.get(f, 1.0) < c.FOCUS_MIN_WEIGHT]


def weakest(request: CoachReviewRequest) -> str | None:
    """The lowest-scoring finger that counts, or None when every finger that counts is at least good."""
    skip = ignored(request)
    scores = request.score.per_finger.model_dump()
    named = [f for f in c.FINGERS if f not in skip] or list(c.FINGERS)
    worst = min(named, key=lambda f: scores[f])
    return worst if scores[worst] < c.REVIEW_GOOD_FROM else None


def _direction(request: CoachReviewRequest, finger: str) -> str | None:
    """'curl' or 'relax' for a finger, read from the scorer's own hint when it names that finger."""
    hint = request.score.hint.lower()
    if finger not in hint:
        return None
    if hint.startswith("curl"):
        return "curl"
    if hint.startswith("relax"):
        return "relax"
    return None


def build_review(request: CoachReviewRequest) -> CoachReviewDraft:
    """The algorithmic feedback: two plain sentences from the scorer's result, with no number in them."""
    s = request.score
    weak = weakest(request)
    timing_weak = s.timing < c.REVIEW_GOOD_FROM
    if weak is None and not timing_weak:
        text = (
            "That was a clean one: your whole hand held the shape. Do it again the same way."
            if s.within_tolerance
            else "Your hand shape was close all the way through. Hold it a touch steadier next time."
        )
    elif weak is None:
        text = "Your hand shape was right. Next time, move with the guide hand so you land on the beat."
    else:
        word = _FINGER_WORDS[weak]
        way = _direction(request, weak)
        fix = (
            f"curl your {word} a little more"
            if way == "curl"
            else f"let your {word} relax a little"
            if way == "relax"
            else f"watch your {word} and match the guide more closely"
        )
        lead = (
            "Good rep, the rest of your hand was right."
            if s.within_tolerance
            else "Nearly there, most of your hand was right."
        )
        text = f"{lead} Next time, {fix}."
    return CoachReviewDraft(feedback=text)


def build_prompt(request: CoachReviewRequest, fallback: CoachReviewDraft) -> str:
    """Compose the user turn: the facts in words, never in numbers."""
    s = request.score
    skip = ignored(request)
    scores = s.per_finger.model_dump()
    lines = [
        f"Move: {request.move_name or 'unknown'}",
        f"Step: {request.instruction or 'none'}",
        f"Repetition: {request.attempt}",
        f"Result: {'clean' if s.within_tolerance else 'not clean yet'}",
        f"Overall: {_level(s.overall)}",
    ]
    for finger in c.FINGERS:
        if finger not in skip:
            lines.append(f"{_FINGER_WORDS[finger]}: {_level(scores[finger])}")
    lines.append(
        f"Timing: {'on the beat' if s.timing >= c.REVIEW_GOOD_FROM else 'off the beat'}"
    )
    if skip:
        lines.append("Ignore: " + ", ".join(_FINGER_WORDS[f] for f in skip))
    weak = weakest(request)
    if weak is not None:
        way = _direction(request, weak)
        note = {
            "curl": "too straight, it should curl more",
            "relax": "curled too much, it should relax",
        }.get(way or "", "least like the guide")
        lines.append(f"Scorer's note: the {_FINGER_WORDS[weak]} was {note}.")
    else:
        lines.append("Scorer's note: no finger needs fixing.")
    if request.previous_overall is not None:
        delta = s.overall - request.previous_overall
        lines.append(
            "Compared with the last repetition: "
            + (
                "better"
                if delta >= c.REVIEW_CHANGE_POINTS
                else "worse"
                if delta <= -c.REVIEW_CHANGE_POINTS
                else "about the same"
            )
        )
    if request.last_feedback:
        lines.append(f"Previous feedback: {request.last_feedback}")
    lines.append(f"A plain version you may improve on: {fallback.feedback}")
    lines.append("Give the feedback.")
    return "\n".join(lines)


def acceptable(text: str, request: CoachReviewRequest) -> bool:
    """A model answer is shown only if it is short, has no number or measuring word, and names no ignored finger."""
    t = text.strip()
    if (
        not t
        or len(t.split()) > c.REVIEW_MAX_WORDS + c.REVIEW_WORD_SLACK
        or _JARGON.search(t)
    ):
        return False
    low = t.lower()
    if any(
        _FINGER_WORDS[f] in low or (f == "little" and "pinky" in low)
        for f in ignored(request)
    ):
        return False
    return low != (request.last_feedback or "").strip().lower()


class ReviewService:
    """Words one scored rep for the learner; any model failure keeps the algorithmic sentences."""

    def __init__(self, llm: LLMState) -> None:
        """Use the active provider from llm."""
        self._llm = llm
        self._cache: TTLCache[tuple[CoachReviewDraft, str]] = TTLCache(
            c.HINT_CACHE_TTL_S, c.HINT_CACHE_MAX_ENTRIES
        )

    async def review(self, request: CoachReviewRequest) -> CoachReviewResponse:
        """Return the feedback for one rep and who wrote it."""
        fallback = build_review(request)
        client = self._llm.client_for("review")
        prompt = build_prompt(request, fallback)
        cached = self._cache.get(prompt)
        if cached is not None:
            draft, provider = cached
            return CoachReviewResponse(feedback=draft.feedback, provider=provider)
        llm_request = LLMRequest(
            SYSTEM_PROMPT,
            prompt,
            request.model_dump_json(),
            None,
            llm_schema(CoachReviewDraft),
            "review",
            model=self._llm.hint_model,
        )
        try:
            draft = CoachReviewDraft.model_validate_json(
                await client.generate_json(llm_request)
            )
        except LLMOfflineError as exc:
            log.info("Review offline (%s); using the algorithmic feedback", exc)
            return CoachReviewResponse(feedback=fallback.feedback, provider=OFFLINE)
        except RateLimitedError as exc:
            log.info(
                "Review LLM rate limited (%s); using the algorithmic feedback", exc
            )
            return CoachReviewResponse(
                feedback=fallback.feedback, provider=c.PROVIDER_RATE_LIMITED
            )
        except (ValidationError, ValueError) as exc:
            log.warning(
                "Review LLM gave an invalid answer (%s); using the algorithmic feedback",
                exc,
            )
            return CoachReviewResponse(feedback=fallback.feedback, provider=ALGORITHMIC)
        except Exception as exc:
            log.warning(
                "Review LLM unavailable (%s); using the algorithmic feedback", exc
            )
            return CoachReviewResponse(feedback=fallback.feedback, provider=ALGORITHMIC)
        if not acceptable(draft.feedback, request):
            log.warning("Review LLM answer rejected: %s", draft.feedback)
            return CoachReviewResponse(feedback=fallback.feedback, provider=ALGORITHMIC)
        provider = answered_by(client.name)
        draft = CoachReviewDraft(feedback=draft.feedback.strip())
        self._cache.put(prompt, (draft, provider))
        return CoachReviewResponse(feedback=draft.feedback, provider=provider)
