"""Algorithmic, plain-language tips derived from per-finger deviations and timing."""

from dataclasses import dataclass

from app import constants as c
from app.schemas.api import CoachHintRequest, HintDraft, Severity
from app.schemas.common import Margin


@dataclass(frozen=True)
class Thresholds:
    """The sizes from which a hint speaks up, and the tolerances severity is measured against, after the margin of error."""

    finger_deg: float
    timing_ms: float
    wrist_deg: float
    angle_tol_deg: float
    timing_tol_ms: float
    wrist_tol_deg: float


def thresholds(
    margin: Margin = c.DEFAULT_MARGIN,
    angle_tol_deg: float = c.DEFAULT_TOLERANCE_ANGLE_DEG,
    timing_tol_ms: float = c.DEFAULT_TOLERANCE_TIMING_MS,
) -> Thresholds:
    """Scale every hint threshold and tolerance by the margin's multiplier.

    The tolerances passed in are the step's own (not yet widened). A quiet margin (relaxed and looser) also raises each
    threshold to its widened tolerance, so nothing inside the band is ever corrected. "standard" returns the constants.
    """
    k = c.MARGIN_MULTIPLIERS[margin]
    angle, timing, wrist = (
        angle_tol_deg * k,
        timing_tol_ms * k,
        c.HINT_WRIST_TOLERANCE_DEG * k,
    )
    finger_min, timing_min, wrist_min = (
        c.HINT_MIN_DEVIATION_DEG * k,
        c.HINT_TIMING_MS * k,
        c.HINT_WRIST_MIN_DEG * k,
    )
    if margin in c.MARGIN_QUIET:
        finger_min, timing_min, wrist_min = (
            max(finger_min, angle),
            max(timing_min, timing),
            max(wrist_min, wrist),
        )
    return Thresholds(finger_min, timing_min, wrist_min, angle, timing, wrist)


STANDARD = thresholds()


def focus_finger(
    deviations_deg: dict[str, float], per_finger: dict[str, Thresholds]
) -> str | None:
    """Return the finger to correct, or None: among fingers past their own hint threshold, the furthest outside its own tolerance.

    With the same thresholds for every finger this is the finger with the largest absolute deviation (ties go to the
    first in thumb to little order), the behaviour before per-finger tolerances existed.
    """
    over = [
        f
        for f in c.FINGERS
        if abs(deviations_deg.get(f, 0.0)) >= per_finger[f].finger_deg
    ]
    if not over:
        return None
    return max(
        over,
        key=lambda f: abs(deviations_deg.get(f, 0.0)) / per_finger[f].angle_tol_deg,
    )


def build_hint(
    deviations_deg: dict[str, float],
    timing_ms: float,
    limits: Thresholds = STANDARD,
    per_finger: dict[str, Thresholds] | None = None,
) -> str:
    """Describe the biggest problem. Deviation is signed degrees of total finger flexion, summed over its joints (positive: curled too much); timing is positive when late.

    per_finger gives each finger its own thresholds (a step with per-finger tolerance); without it every finger uses limits.
    """
    finger = focus_finger(
        deviations_deg, per_finger or dict.fromkeys(c.FINGERS, limits)
    )
    if finger is not None:
        deviation = deviations_deg[finger]
        if deviation > 0:
            return f"Relax your {finger} finger, it is curled about {abs(deviation):.0f} degrees (in total) too much."
        return f"Curl your {finger} finger more, it is about {abs(deviation):.0f} degrees (in total) too straight."
    if abs(timing_ms) >= limits.timing_ms:
        word = "late" if timing_ms > 0 else "early"
        return f"Your finger shapes are right, but you are about {abs(timing_ms):.0f} ms {word}. Match the guide hand's beat."
    return "Great match. Keep the same shape and rhythm."


_JOINT_PHRASES = ("from the knuckle", "at the middle joint", "at the fingertip")
_WRIST_WORDS = {
    ("pitch", True): "Lower your wrist {a}.",
    ("pitch", False): "Raise your wrist {a}.",
    ("yaw", True): "Turn your wrist {a} to the left.",
    ("yaw", False): "Turn your wrist {a} to the right.",
    ("roll", True): "Roll your wrist {a} counter-clockwise.",
    ("roll", False): "Roll your wrist {a} clockwise.",
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
    return (
        _JOINT_PHRASES[index]
        if abs(joints[index]) / total >= c.HINT_JOINT_SHARE
        else None
    )


def _pick(candidates: list[str], last_hint: str | None) -> str:
    """Return the first candidate within the word limit that differs from the last hint, else the first within the limit."""
    fits = [t for t in candidates if len(t.split()) <= c.HINT_MAX_WORDS] or candidates[
        :1
    ]
    last = (last_hint or "").strip().lower()
    return next((t for t in fits if t.lower() != last), fits[0])


def _limits(request: CoachHintRequest, finger: str | None = None) -> Thresholds:
    """The hint thresholds for a live request: its own tolerance (the finger's own when it sends one) widened by its margin."""
    per = request.finger_tolerance_deg or {}
    tolerance = (
        per.get(finger, request.tolerance_deg) if finger else request.tolerance_deg
    )  # type: ignore[call-overload]
    return thresholds(request.margin, tolerance)


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
        candidates.insert(
            0, f"Off on the {move}: {verb.lower()} your {label} {amount}{where}."
        )
    text = _pick(candidates, request.last_hint)
    return HintDraft(
        hint=text,
        focus_finger=finger,
        cue_type="extend" if too_curled else "curl",  # type: ignore[arg-type]
        severity=_severity(size / _limits(request, finger).angle_tol_deg),
    )


def _timing_hint(request: CoachHintRequest) -> HintDraft:
    """Build a timing cue."""
    late, size = request.timing_ms > 0, abs(request.timing_ms)
    candidates = [
        f"Start sooner, you are about {size:.0f} ms late."
        if late
        else f"Wait for the beat, you are about {size:.0f} ms early.",
        "Move earlier and follow the guide hand's rhythm."
        if late
        else "Hold back and let the guide hand lead.",
    ]
    return HintDraft(
        hint=_pick(candidates, request.last_hint),
        focus_finger=None,
        cue_type="timing",
        severity=_severity(size / _limits(request).timing_tol_ms),
    )


def _wrist_hint(request: CoachHintRequest) -> HintDraft:
    """Build a wrist cue from the signed error about its axis."""
    error = request.wrist_error_deg or 0.0
    template = _WRIST_WORDS.get((request.wrist_axis or "", error > 0))
    amount = _amount(abs(error))
    candidates = [
        template.format(a=amount)
        if template
        else "Relax your wrist and match the guide hand's angle."
    ]
    candidates.append("Match the guide hand's wrist angle.")
    return HintDraft(
        hint=_pick(candidates, request.last_hint),
        focus_finger=None,
        cue_type="wrist",
        severity=_severity(abs(error) / _limits(request).wrist_tol_deg),
    )


def build_hint_draft(request: CoachHintRequest) -> HintDraft:
    """Choose the biggest problem relative to its tolerance and phrase it as one imperative cue; praise if nothing stands out."""
    limits = _limits(request)
    per_finger = {f: _limits(request, f) for f in c.FINGERS}
    finger = focus_finger(request.deviations.model_dump(), per_finger)
    deviation = getattr(request.deviations, finger) if finger else 0.0
    scored: list[tuple[float, str]] = []
    if finger is not None:
        scored.append((abs(deviation) / per_finger[finger].angle_tol_deg, "finger"))
    if abs(request.timing_ms) >= limits.timing_ms:
        scored.append((abs(request.timing_ms) / limits.timing_tol_ms, "timing"))
    if (
        request.wrist_error_deg is not None
        and abs(request.wrist_error_deg) >= limits.wrist_deg
    ):
        scored.append((abs(request.wrist_error_deg) / limits.wrist_tol_deg, "wrist"))
    if not scored:
        praise = _pick(
            ["Great match, hold that shape.", "Nice and steady, keep it going."],
            request.last_hint,
        )
        return HintDraft(
            hint=praise, focus_finger=None, cue_type="praise", severity="low"
        )
    kind = max(scored)[1]
    if kind == "finger" and finger is not None:
        return _finger_hint(request, finger, deviation)
    return _timing_hint(request) if kind == "timing" else _wrist_hint(request)
