"""Live coaching hints: an algorithmic cue, refined by the active LLM when the request budget allows."""

import json
import logging

from pydantic import ValidationError

from app import constants as c
from app.core.errors import RateLimitedError
from app.schemas.api import CoachHintRequest, CoachHintResponse, HintDraft
from app.services import hints
from app.services.llm.base import LLMRequest
from app.services.llm.rate_limit import TTLCache
from app.services.llm.registry import LLMState
from app.services.llm.schema import llm_schema

log = logging.getLogger(__name__)

ALGORITHMIC = "algorithmic"

_SYSTEM_TEMPLATE = f"""<role>
You are the live coach inside a smart-glove hand-skill trainer. A learner is copying a guide hand while you watch
their finger angles. You speak one short cue per request, like a patient teacher standing next to them.
</role>

<rules>
- Write exactly one imperative sentence of at most {c.HINT_MAX_WORDS} words.
- Name exactly one finger (thumb, index, middle, ring, little) or the wrist, and exactly one direction.
- Use the measurements and the analysis given. Deviations are signed degrees of total finger flexion:
  positive means curled MORE than the guide (so tell them to lift, straighten or relax), negative means too
  straight (so tell them to curl or bend). Never invert this.
- Say how much only with words such as slightly, a little or a lot, or one number copied from the input.
- Never repeat the previous hint: change the wording or the angle of advice.
- Warm and plain. No greetings, no questions, no emojis, no technical jargon such as flexion or deviation.
- If nothing needs fixing, praise briefly with cue_type "praise" and focus_finger null.
</rules>

<fields>
cue_type: "extend" when the finger is curled too much, "curl" when too straight, "timing" for early or late,
"wrist" for wrist angle, "praise" when nothing needs fixing. focus_finger is null unless the cue is about one finger.
severity: copied from the analysis.
</fields>

{{EXAMPLES}}"""


def _round(value: float, step: int) -> int:
    """Round to the nearest step, so near-identical live frames share one cache key."""
    return int(round(value / step) * step)


def build_prompt(request: CoachHintRequest, draft: HintDraft) -> str:
    """Compose the user turn: measurements first, the analysed focus last, then the task."""
    lines = [f"Move: {request.move_name or 'unknown'}", f"Step: {request.instruction or 'none'}", f"Attempt: {request.attempt}"]
    deviations = request.deviations.model_dump()
    for finger in c.FINGERS:
        value = _round(deviations[finger], c.HINT_PROMPT_DEG_STEP)
        joints = (request.joint_deviations or {}).get(finger)
        extra = f" (knuckle {joints[0]:+.0f}, middle {joints[1]:+.0f}, tip {joints[2]:+.0f})" if joints and len(joints) == c.JOINTS_PER_FINGER else ""
        lines.append(f"{finger}: {value:+d}{extra}")
    if abs(request.timing_ms) >= c.HINT_TIMING_MS:
        lines.append(f"Timing: {_round(abs(request.timing_ms), c.HINT_PROMPT_MS_STEP)} ms {'late' if request.timing_ms > 0 else 'early'}")
    if request.wrist_error_deg is not None:
        lines.append(f"Wrist {request.wrist_axis or 'angle'}: {_round(request.wrist_error_deg, c.HINT_PROMPT_DEG_STEP):+d}")
    if request.last_hint:
        lines.append(f"Last hint: {request.last_hint}")
    if draft.cue_type == "praise":
        lines.append("Analysis: nothing to fix.")
    else:
        target = f"{draft.focus_finger} finger, " if draft.focus_finger else ""
        lines.append(f"Analysis: {target}{draft.cue_type}, severity {draft.severity}.")
    lines.append("Give the cue.")
    return "\n".join(lines)


def _example(request: CoachHintRequest, hint: str, cue_type: str, focus: str | None) -> str:
    """Render one few-shot example in exactly the format the live prompt uses."""
    analysed = hints.build_hint_draft(request)
    answer = json.dumps({"hint": hint, "focus_finger": focus, "cue_type": cue_type, "severity": analysed.severity})
    return f"Input:\n{build_prompt(request, analysed)}\nOutput: {answer}"


def _build_examples() -> str:
    """Return five worked examples covering extend, curl, timing, wrist and praise cues."""
    def req(**kw: object) -> CoachHintRequest:
        return CoachHintRequest.model_validate(kw)

    examples = [
        _example(req(move_name="Pinch", instruction="Touch thumb and index", deviations={"index": 14}, joint_deviations={"index": [2, 8, 4]}),
                 "Off on the pinch: lift your index finger slightly.", "extend", "index"),
        _example(req(move_name="Piano scale", deviations={"ring": -22}, joint_deviations={"ring": [-3, -9, -10]}, attempt=2,
                     last_hint="Curl your ring finger a little."),
                 "Bend your ring fingertip further down onto the key.", "curl", "ring"),
        _example(req(move_name="Forehand grip", deviations={"middle": 2}, timing_ms=210),
                 "Start sooner, you are about 200 ms late.", "timing", None),
        _example(req(move_name="Forehand grip", attempt=3, wrist_error_deg=16, wrist_axis="yaw"),
                 "Turn your wrist slightly to the left.", "wrist", None),
        _example(req(move_name="Pinch", attempt=4, deviations={"thumb": 3}, timing_ms=40),
                 "Great pinch, hold that shape.", "praise", None),
    ]
    return "<examples>\n" + "\n\n".join(examples) + "\n</examples>"


SYSTEM_PROMPT = _SYSTEM_TEMPLATE.replace("{EXAMPLES}", _build_examples())


class CoachService:
    """Builds a cue from the measurements; the LLM only rewords it, and any failure keeps the algorithmic cue."""

    def __init__(self, llm: LLMState) -> None:
        """Use the active provider from llm."""
        self._llm = llm
        self._cache: TTLCache[HintDraft] = TTLCache(c.HINT_CACHE_TTL_S, c.HINT_CACHE_MAX_ENTRIES)

    def _accept(self, draft: HintDraft, fallback: HintDraft, request: CoachHintRequest) -> bool:
        """Check a model cue is consistent with the measurements and is not a repeat."""
        if draft.cue_type != fallback.cue_type or draft.focus_finger != fallback.focus_finger:
            return False
        if draft.focus_finger and draft.focus_finger not in draft.hint.lower():
            return False
        return draft.hint.strip().lower() != (request.last_hint or "").strip().lower()

    async def hint(self, request: CoachHintRequest) -> CoachHintResponse:
        """Return one short cue for the learner."""
        fallback = hints.build_hint_draft(request)
        client = self._llm.client
        fake = client.name == "fake"
        if fallback.cue_type == "praise" and not fake:
            return CoachHintResponse(**fallback.model_dump(), provider=ALGORITHMIC)
        prompt = build_prompt(request, fallback)
        cached = self._cache.get(prompt)
        if cached is not None:
            return CoachHintResponse(**cached.model_dump(), provider=client.name)
        llm_request = LLMRequest(
            SYSTEM_PROMPT, prompt, request.model_dump_json(), None, llm_schema(HintDraft), "hint", model=self._llm.hint_model,
        )
        try:
            draft = HintDraft.model_validate_json(await client.generate_json(llm_request))
        except RateLimitedError as exc:
            log.info("Coach LLM rate limited (%s); using algorithmic hint", exc)
            return CoachHintResponse(**fallback.model_dump(), provider=c.PROVIDER_RATE_LIMITED)
        except (ValidationError, ValueError) as exc:
            log.warning("Coach LLM gave an invalid hint (%s); using algorithmic hint", exc)
            return CoachHintResponse(**fallback.model_dump(), provider=ALGORITHMIC)
        except Exception as exc:
            log.warning("Coach LLM unavailable (%s); using algorithmic hint", exc)
            return CoachHintResponse(**fallback.model_dump(), provider=ALGORITHMIC)
        if not self._accept(draft, fallback, request):
            log.warning("Coach LLM hint rejected: %s", json.dumps(draft.model_dump()))
            return CoachHintResponse(**fallback.model_dump(), provider=ALGORITHMIC)
        self._cache.put(prompt, draft)
        return CoachHintResponse(**draft.model_dump(), provider=client.name)
