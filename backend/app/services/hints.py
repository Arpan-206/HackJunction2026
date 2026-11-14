"""Algorithmic, plain-language tips derived from per-finger deviations and timing."""

from app import constants as c
from app.schemas.api import CoachHintRequest, HintDraft, Severity
from app.schemas.common import Finger


def worst_finger(deviations_deg: dict[str, float]) -> Finger:
    """Return the finger with the largest absolute deviation."""
    return max(c.FINGERS, key=lambda f: abs(deviations_deg.get(f, 0.0)))  # type: ignore[return-value]


def build_hint(deviations_deg: dict[str, float], timing_ms: float) -> str:
    """Describe the biggest problem. Deviation is signed degrees of total finger flexion, summed over its joints (positive: curled too much); timing is positive when late."""
    finger = worst_finger(deviations_deg)
    deviation = deviations_deg.get(finger, 0.0)
    if abs(deviation) >= c.HINT_MIN_DEVIATION_DEG:
        if deviation > 0:
            return f"Relax your {finger} finger, it is curled about {abs(deviation):.0f} degrees (in total) too much."
        return f"Curl your {finger} finger more, it is about {abs(deviation):.0f} degrees (in total) too straight."
    if abs(timing_ms) >= c.HINT_TIMING_MS:
        word = "late" if timing_ms > 0 else "early"
        return f"Your finger shapes are right, but you are about {abs(timing_ms):.0f} ms {word}. Match the guide hand's beat."
    return "Great match. Keep the same shape and rhythm."


_JOINT_PHRASES = ("from the knuckle", "at the middle joint", "at the fingertip")
_WRIST_WORDS = {
    ("pitch", True): "Lower your wrist {a}.", ("pitch", False): "Raise your wrist {a}.",
    ("yaw", True): "Turn your wrist {a} to the left.", ("yaw", False): "Turn your wrist {a} to the right.",
    ("roll", True): "Roll your wrist {a} counter-clockwise.", ("roll", False): "Roll your wrist {a} clockwise.",
}


def _finger_label(finger: str) -> str:
    """Return the spoken name of a finger."""
    return "thumb" if finger == "thumb" else f"{finger} finger"


def _amount(deg: float) -> str:
    """Describe a deviation size as a short adverb phrase."""
    if deg < c.HINT_SLIGHT_DEG:
        return "slightly"
    return "a little" if deg < c.HINT_LOT_DEG else "a lot"


def _severity(ratio: float) -> Severity:
    """Map error divided by tolerance to a severity."""
    if ratio < c.HINT_SEVERITY_MEDIUM:
        return "low"
    return "medium" if ratio < c.HINT_SEVERITY_HIGH else "high"


def _worst_joint_phrase(joints: list[float] | None) -> str | None:
    """Name the joint that carries most of a finger's error, if one clearly does."""
    if not joints or len(joints) != c.JOINTS_PER_FINGER:
        return None
    total = sum(abs(j) for j in joints)
    if total <= 0:
        return None
    index = max(range(len(joints)), key=lambda i: abs(joints[i]))
    return _JOINT_PHRASES[index] if abs(joints[index]) / total >= c.HINT_JOINT_SHARE else None


def _pick(candidates: list[str], last_hint: str | None) -> str:
    """Return the first candidate within the word limit that differs from the last hint, else the first within the limit."""
    fits = [t for t in candidates if len(t.split()) <= c.HINT_MAX_WORDS] or candidates[:1]
    last = (last_hint or "").strip().lower()
    return next((t for t in fits if t.lower() != last), fits[0])


def _finger_hint(request: CoachHintRequest, finger: str, deviation: float) -> HintDraft:
    """Build a curl or extend cue for one finger."""
    label, size = _finger_label(finger), abs(deviation)
    amount = _amount(size)
    joint = _worst_joint_phrase((request.joint_deviations or {}).get(finger))  # type: ignore[call-overload]
    too_curled = deviation > 0
    verb = "Lift" if too_curled else "Curl"
    reason = "it is curled too far" if too_curled else "it is too straight"
    where = f" {joint}" if joint else ""
    move = " ".join((request.move_name or "").split()[:3]).lower()
    candidates = [
        f"{verb} your {label} {amount}{where}, {reason}.",
        f"{verb} your {label} {amount}, about {size:.0f} degrees off.",
        f"{'Straighten' if too_curled else 'Bend'} your {label} {amount} more.",
    ]
    if move:
        candidates.insert(0, f"Off on the {move}: {verb.lower()} your {label} {amount}{where}.")
    text = _pick(candidates, request.last_hint)
    return HintDraft(
        hint=text, focus_finger=finger, cue_type="extend" if too_curled else "curl",  # type: ignore[arg-type]
        severity=_severity(size / request.tolerance_deg),
    )


def _timing_hint(request: CoachHintRequest) -> HintDraft:
    """Build a timing cue."""
    late, size = request.timing_ms > 0, abs(request.timing_ms)
    candidates = [
        f"Start sooner, you are about {size:.0f} ms late." if late else f"Wait for the beat, you are about {size:.0f} ms early.",
        "Move earlier and follow the guide hand's rhythm." if late else "Hold back and let the guide hand lead.",
    ]
    return HintDraft(
        hint=_pick(candidates, request.last_hint), focus_finger=None, cue_type="timing",
        severity=_severity(size / c.DEFAULT_TOLERANCE_TIMING_MS),
    )


def _wrist_hint(request: CoachHintRequest) -> HintDraft:
    """Build a wrist cue from the signed error about its axis."""
    error = request.wrist_error_deg or 0.0
    template = _WRIST_WORDS.get((request.wrist_axis or "", error > 0))
    amount = _amount(abs(error))
    candidates = [template.format(a=amount) if template else "Relax your wrist and match the guide hand's angle."]
    candidates.append("Match the guide hand's wrist angle.")
    return HintDraft(
        hint=_pick(candidates, request.last_hint), focus_finger=None, cue_type="wrist",
        severity=_severity(abs(error) / c.HINT_WRIST_TOLERANCE_DEG),
    )


def build_hint_draft(request: CoachHintRequest) -> HintDraft:
    """Choose the biggest problem relative to its tolerance and phrase it as one imperative cue; praise if nothing stands out."""
    finger = worst_finger(request.deviations.model_dump())
    deviation = getattr(request.deviations, finger)
    scored: list[tuple[float, str]] = []
    if abs(deviation) >= c.HINT_MIN_DEVIATION_DEG:
        scored.append((abs(deviation) / request.tolerance_deg, "finger"))
    if abs(request.timing_ms) >= c.HINT_TIMING_MS:
        scored.append((abs(request.timing_ms) / c.DEFAULT_TOLERANCE_TIMING_MS, "timing"))
    if request.wrist_error_deg is not None and abs(request.wrist_error_deg) >= c.HINT_WRIST_MIN_DEG:
        scored.append((abs(request.wrist_error_deg) / c.HINT_WRIST_TOLERANCE_DEG, "wrist"))
    if not scored:
        praise = _pick(["Great match, hold that shape.", "Nice and steady, keep it going."], request.last_hint)
        return HintDraft(hint=praise, focus_finger=None, cue_type="praise", severity="low")
    kind = max(scored)[1]
    if kind == "finger":
        return _finger_hint(request, finger, deviation)
    return _timing_hint(request) if kind == "timing" else _wrist_hint(request)
