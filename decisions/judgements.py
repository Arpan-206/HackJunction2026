"""The three judgements: pick_action, check_outcome, finger_rubric.

Each builds one Decisions API request, waits at most the budget, and falls
back to ``rules.py`` when the model gives nothing. One log line per call.
"""
from __future__ import annotations

import base64
import threading
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from . import config as C
from . import rules as R
from .client import CallResult, DecisionsClient, choice_answer, noul_answer, score_answer

_client: DecisionsClient | None = None
_client_lock = threading.Lock()


def get_client() -> DecisionsClient:
    """The process-wide client, built from the environment on first use."""
    global _client
    with _client_lock:
        if _client is None:
            _client = DecisionsClient.from_env(warm_up=C.env_flag("DECISIONS_WARMUP", True))
        return _client


def set_client(client: DecisionsClient | None) -> None:
    global _client
    with _client_lock:
        _client = client


# ---------------------------------------------------------------------- results
@dataclass(frozen=True)
class ActionDecision:
    action: str
    confidence: float
    focus: str | None
    probabilities: dict[str, float]
    source: str  # model | rule
    reason: str  # "model", or "<why the model gave nothing>:<rule that fired>"
    latency_ms: float

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class OutcomeDecision:
    answer: bool
    probability: float  # P(yes)
    confidence: float
    source: str
    reason: str
    latency_ms: float

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class FingerRubric:
    weights: dict[str, float]  # thumb..little, 0..1, the largest is 1.0
    confidence: float
    source: str
    reason: str
    latency_ms: float
    levels: dict[str, float] = field(default_factory=dict)  # expected rubric level per finger, 0..3

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------- pick_action
ACTION_INSTRUCTIONS = (
    "You are a hand-skill tutor watching one learner attempt one step of a lesson. "
    "The learner wears a motion glove; the numbers compare the learner's finger angles with the expert's "
    "recorded key pose. Pick the single best next action."
)
ACTION_CRITERIA = {
    "repeat": "Try the same step again with no change. The score is close or improving and nothing stands out.",
    "slow_down": "Go slower. Timing is early, or the score swings from attempt to attempt, or it is getting worse.",
    "isolate_finger": "Practise one finger alone. One finger carries most of the error and the others are fine.",
    "show_keyframe": "Show the expert's key pose picture again. The whole hand shape is wrong or the learner "
    "has been stuck for several seconds with a low score.",
    "move_on": "Go to the next step. The step is passed, or the learner has nearly passed several times.",
}
FOCUS_INSTRUCTIONS = "Which single finger should the learner focus on next, if any?"
FOCUS_CRITERIA = {**{f: f"The {f} finger." for f in C.FINGERS}, "none": "No single finger; the whole hand."}


def summary_text(summary: dict) -> str:
    """Compact English for the model: the whole step summary in a few lines."""
    step = summary.get("step") or {}
    lines = [
        f"Task: {summary.get('task', 'general')}. Lesson: {summary.get('lesson', '')}. "
        f"Hand: {summary.get('hand') or 'unknown'}.",
        f"Step {int(step.get('index', 0)) + 1} \"{step.get('name', '')}\" ({step.get('kind', 'hold')} step). "
        f"Attempt {summary.get('attempt', 1)}. Passed: {'yes' if summary.get('passed') else 'no'}.",
        f"Score now {float(summary.get('overall', 0.0) or 0.0):.2f} of 1.00, best this step "
        f"{float(summary.get('best', 0.0) or 0.0):.2f}, pass mark {R.TH['pass_score']:.2f}.",
    ]
    hist = summary.get("history") or []
    if hist:
        lines.append("Earlier attempts: " + ", ".join(f"{float(h):.2f}" for h in hist[-6:]) + ".")
    fingers = summary.get("fingers") or {}
    if fingers:
        parts = []
        for f in C.FINGERS:
            info = fingers.get(f)
            if isinstance(info, dict):
                hint = info.get("hint") or "off"
                parts.append(f"{f} score {float(info.get('score', 0)):.2f}, error {float(info.get('err_deg', 0)):.0f} deg, {hint}")
        lines.append("Fingers below the pass mark: " + "; ".join(parts) + ".")
        lines.append("Fingers not listed are fine.")
    else:
        lines.append("Every finger is at or above the pass mark.")
    timing = summary.get("timing_ms")
    if timing is not None:
        t = int(timing)
        lines.append(f"Timing: {abs(t)} ms {'early' if t < 0 else 'late'} (move steps only).")
    stuck = summary.get("stuck_s")
    if stuck is not None:
        lines.append(f"Stuck for {float(stuck):.1f} s without passing.")
    return "\n".join(lines)


def pick_action(step_summary: dict, *, client: DecisionsClient | None = None, budget_ms: int | None = None) -> ActionDecision:
    """Choose the tutor's next action from ``ACTIONS``. Never raises, never exceeds the budget by much."""
    cl = client or get_client()
    questions = {
        "action": {"type": "choice", "instructions": ACTION_INSTRUCTIONS, "criteria": ACTION_CRITERIA},
        "focus": {"type": "choice", "instructions": FOCUS_INSTRUCTIONS, "criteria": FOCUS_CRITERIA},
    }
    res = cl.decide("pick_action", [{"type": "text", "text": summary_text(step_summary)}], questions, budget_ms)
    dec: ActionDecision | None = None
    fail = res.reason
    if res.ok:
        parsed = choice_answer(res.answers.get("action", {}), C.ACTIONS)
        if parsed is not None:
            action, conf, probs = parsed
            focus = None
            fp = choice_answer(res.answers.get("focus", {}), (*C.FINGERS, "none"))
            if fp is not None and fp[0] != "none":
                focus = fp[0]
            if action == "isolate_finger" and focus is None:
                w = R.worst_finger(step_summary.get("fingers") or {})
                focus = w[0] if w else None
            dec = ActionDecision(action, conf, focus, probs, "model", "model", res.latency_ms)
        else:
            fail = "bad_answer"
    if dec is None:
        action, conf, focus, rule = R.rule_pick_action(step_summary)
        dec = ActionDecision(action, conf, focus, {action: conf}, "rule", f"{fail}:{rule}", res.latency_ms)
    _log(cl, res, dec.source, dec.reason, {"action": dec.action, "confidence": round(dec.confidence, 3), "focus": dec.focus},
         step=(step_summary.get("step") or {}).get("index"), hand=step_summary.get("hand"))
    return dec


# ---------------------------------------------------------------------- check_outcome
_MAGIC = {b"\xff\xd8": "image/jpeg", b"\x89PNG": "image/png", b"RIFF": "image/webp", b"GIF8": "image/gif", b"BM": "image/bmp"}
_EXT = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp"}
MAX_SIDE_PX = 512


def image_part(image: Any, resolution: str = "low", mime_type: str | None = None) -> dict | None:
    """A Decisions API image part from bytes, a file path, or an array (OpenCV BGR). None if there is no image."""
    if image is None:
        return None
    data: bytes
    if isinstance(image, (bytes, bytearray, memoryview)):
        data = bytes(image)
    elif isinstance(image, (str, Path)):
        p = Path(image)
        data = p.read_bytes()
        mime_type = mime_type or _EXT.get(p.suffix.lower())
    elif hasattr(image, "shape"):
        data = _encode_array(image)
        mime_type = "image/jpeg"
    else:
        raise TypeError(f"image must be bytes, a path or an array, not {type(image).__name__}")
    if mime_type is None:
        mime_type = next((m for magic, m in _MAGIC.items() if data.startswith(magic)), "image/jpeg")
    return {"type": "image", "mime_type": mime_type, "data": base64.b64encode(data).decode("ascii"), "resolution": resolution}


def _encode_array(arr: Any) -> bytes:
    import cv2
    import numpy as np

    a = np.asarray(arr)
    h, w = a.shape[:2]
    scale = MAX_SIDE_PX / float(max(h, w))
    if scale < 1.0:
        a = cv2.resize(a, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", a, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
    if not ok:
        raise ValueError("could not encode the image")
    return bytes(buf)


def context_text(context: dict) -> str:
    bits = []
    curl = context.get("curl")
    if isinstance(curl, dict) and curl:
        bits.append("Glove reading at the same instant: " + R.curl_words({f: float(v) for f, v in curl.items() if f in C.FINGERS}) + ".")
    pinch = context.get("pinch")
    if isinstance(pinch, dict) and any(pinch.values()):
        bits.append("Thumb touches: " + ", ".join(f for f, v in pinch.items() if v) + ".")
    note = context.get("note")
    if note:
        bits.append(str(note))
    return " ".join(bits)


def check_outcome(
    image: Any,
    question: str,
    *,
    context: dict | None = None,
    yes_means: str | None = None,
    no_means: str | None = None,
    resolution: str = "low",
    client: DecisionsClient | None = None,
    budget_ms: int | None = None,
) -> OutcomeDecision:
    """A yes/no check on a camera frame, for example "Is the hand closed around the object?".

    ``context`` may carry the glove's ``curl`` and ``pinch`` for the same instant; the model sees it as
    text and the rule fallback judges from it alone.
    """
    cl = client or get_client()
    part = image_part(image, resolution)
    parts: list[dict] = [part] if part is not None else []
    if context:
        ctx = context_text(context)
        if ctx:
            parts.append({"type": "text", "text": ctx})
    q: dict[str, Any] = {"type": "noul", "instructions": question}
    if yes_means or no_means:
        q["criteria"] = {k: v for k, v in (("true_description", yes_means), ("false_description", no_means)) if v}
    if part is not None:
        res = cl.decide("check_outcome", parts, {"outcome": q}, budget_ms)
    else:  # no picture: nothing for the model to look at, the rules judge from the glove context alone
        res = CallResult("check_outcome", None, "no_image", 0.0)
        cl.calls += 1
    dec: OutcomeDecision | None = None
    fail = res.reason
    if res.ok:
        parsed = noul_answer(res.answers.get("outcome", {}))
        if parsed is not None:
            p, conf = parsed
            dec = OutcomeDecision(p >= 0.5, round(p, 3), round(conf, 3), "model", "model", res.latency_ms)
        else:
            fail = "bad_answer"
    if dec is None:
        answer, p, conf, rule = R.rule_check_outcome(question, context)
        dec = OutcomeDecision(answer, p, conf, "rule", f"{fail}:{rule}", res.latency_ms)
    _log(cl, res, dec.source, dec.reason, {"answer": dec.answer, "probability": dec.probability, "confidence": dec.confidence},
         question=question[:120], image_bytes=_decoded_size(part))
    return dec


def _decoded_size(part: dict | None) -> int:
    """Bytes of the image a part carries, from the base64 length. The data itself is never logged."""
    if not part:
        return 0
    d = part["data"]
    return len(d) * 3 // 4 - d[-2:].count("=")


# ---------------------------------------------------------------------- finger_rubric
RUBRIC_LEVELS = [
    "Does not matter. This finger can be in any position during the step.",
    "Matters a little. A rough position is enough.",
    "Matters. It should be close to the expert's position.",
    "Essential. The step is about this finger.",
]
RUBRIC_INSTRUCTIONS = (
    "A learner copies one step of a hand-skill lesson recorded by an expert with a motion glove. "
    "How much does the {finger} finger's position matter for scoring this step?"
)


def step_text(keyframe: dict | None, step: dict | None, lesson: dict | None = None) -> str:
    step = step or {}
    keyframe = keyframe if isinstance(keyframe, dict) else {}
    lines = []
    if lesson:
        lines.append(f"Lesson: {lesson.get('title', '')}. Task: {lesson.get('task', step.get('task', 'general'))}.")
    lines.append(f"Step {int(step.get('index', 0)) + 1}: \"{step.get('name', '')}\" ({step.get('kind', 'hold')} step"
                 + (f", hold {int(step['hold_ms'])} ms" if step.get("hold_ms") else "") + ").")
    if step.get("note"):
        lines.append(f"Expert's note: {step['note']}")
    curl = keyframe.get("curl") if isinstance(keyframe.get("curl"), dict) else None
    if curl is None:
        curl = R.curl_from_key_angles(keyframe.get("key_angles") or step.get("key_angles"))
    if curl:
        lines.append("Key pose: " + R.curl_words(curl) + ".")
    weights = step.get("weights") or {}
    static = [f for f in C.FINGERS if float(weights.get(f, 1.0)) < 1.0]
    if static:
        lines.append("Fingers that barely moved while the expert recorded: " + ", ".join(static) + ".")
    return "\n".join(lines)


def finger_rubric(
    keyframe: Any,
    step: dict | None,
    *,
    lesson: dict | None = None,
    client: DecisionsClient | None = None,
    budget_ms: int | None = None,
) -> FingerRubric:
    """Weights 0..1 per finger for the scorer. ``keyframe`` is the step's key pose (a dict with
    ``key_angles`` or ``curl``) or a picture of it (bytes, path or array)."""
    cl = client or get_client()
    parts: list[dict] = []
    pose = keyframe if isinstance(keyframe, dict) else None
    if keyframe is not None and pose is None:
        img = image_part(keyframe, "low")
        if img is not None:
            parts.append(img)
    parts.append({"type": "text", "text": step_text(pose, step, lesson)})
    questions = {
        f: {"type": "score", "instructions": RUBRIC_INSTRUCTIONS.format(finger=f), "criteria": RUBRIC_LEVELS}
        for f in C.FINGERS
    }
    res = cl.decide("finger_rubric", parts, questions, budget_ms)
    rub: FingerRubric | None = None
    fail = res.reason
    if res.ok:
        levels: dict[str, float] = {}
        confs: list[float] = []
        for f in C.FINGERS:
            parsed = score_answer(res.answers.get(f, {}), len(RUBRIC_LEVELS))
            if parsed is None:
                break
            levels[f] = round(parsed[0], 3)
            confs.append(parsed[1])
        if len(levels) == len(C.FINGERS):
            top = max(levels.values())
            if top <= 0.0:
                weights = {f: 1.0 for f in C.FINGERS}
            else:
                weights = {f: round(levels[f] / top, 3) for f in C.FINGERS}
            rub = FingerRubric(weights, round(sum(confs) / len(confs), 3), "model", "model", res.latency_ms, levels)
        else:
            fail = "bad_answer"
    if rub is None:
        weights, conf, rule = R.rule_finger_rubric(pose, step)
        rub = FingerRubric(weights, conf, "rule", f"{fail}:{rule}", res.latency_ms)
    _log(cl, res, rub.source, rub.reason, {"weights": rub.weights, "confidence": rub.confidence},
         step=(step or {}).get("index"))
    return rub


# ---------------------------------------------------------------------- logging
def _log(cl: DecisionsClient, res: CallResult, source: str, reason: str, result: dict, **extra: Any) -> None:
    rec = {**res.record(), "model": cl.model, "budget_ms": cl.budget_ms, "source": source, "why": reason, "result": result}
    rec.update({k: v for k, v in extra.items() if v is not None})
    cl.log.write(rec)
