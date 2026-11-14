"""Rule fallbacks. Deterministic, instant, offline.

Each function returns the same kind of answer the model path returns, plus the
name of the rule that fired, so the log says why. Thresholds come from the
core's config.toml ``[score]`` section (read-only) with safe defaults.
"""

from __future__ import annotations

import re
from typing import Any

from .config import FINGERS, score_thresholds

TH = score_thresholds()

# Angle feature slots, as core/hand.py lays them out: 0-1 thumb (MCP, IP),
# 2-13 index, middle, ring, little x (MCP, PIP, DIP), 14-17 spreads.
FLEXION_SLOTS = {
    "thumb": [0, 1],
    "index": [2, 3, 4],
    "middle": [5, 6, 7],
    "ring": [8, 9, 10],
    "little": [11, 12, 13],
}
CURL_FULL_DEG = {
    "thumb": 60.0,
    "index": 90.0,
    "middle": 90.0,
    "ring": 90.0,
    "little": 90.0,
}


# ---------------------------------------------------------------------- shared helpers
def worst_finger(fingers: dict[str, dict]) -> tuple[str, float] | None:
    """The finger with the largest error in a step summary's ``fingers`` block."""
    best: tuple[str, float] | None = None
    for f, info in (fingers or {}).items():
        if f not in FINGERS or not isinstance(info, dict):
            continue
        err = float(info.get("err_deg", 0.0))
        if best is None or err > best[1]:
            best = (f, err)
    return best


def curl_from_key_angles(angles: Any) -> dict[str, float] | None:
    """Per-finger curl 0..1 from the 18 angle features, as core.hand.curl_from_angles does."""
    if angles is None:
        return None
    try:
        a = [float(x) for x in angles]
    except (TypeError, ValueError):
        return None
    if len(a) < 14:
        return None
    out = {}
    for f in FINGERS:
        mean = sum(a[i] for i in FLEXION_SLOTS[f]) / len(FLEXION_SLOTS[f])
        out[f] = min(max(mean / CURL_FULL_DEG[f], 0.0), 1.0)
    return out


def curl_words(curl: dict[str, float]) -> str:
    def word(c: float) -> str:
        return "straight" if c < 0.25 else "half bent" if c < 0.6 else "curled"

    return ", ".join(f"{f} {word(curl[f])}" for f in FINGERS if f in curl)


# ---------------------------------------------------------------------- pick_action
def rule_pick_action(summary: dict) -> tuple[str, float, str | None, str]:
    """(action, confidence, focus_finger, rule_name) for one step summary.

    Order of the rules: passed, early, one finger carries the error, stuck with a
    low score, nearly passed several times, getting worse, stuck, repeat.
    """
    fingers = summary.get("fingers") or {}
    if summary.get("passed"):
        return "move_on", 0.95, None, "passed"
    timing = summary.get("timing_ms")
    if timing is not None and float(timing) <= -TH["timing_hint_ms"]:
        return "slow_down", 0.75, None, "early"
    stuck_s = summary.get("stuck_s")
    overall = float(summary.get("overall", 0.0) or 0.0)
    best = float(summary.get("best", overall) or overall)
    attempt = int(summary.get("attempt", 1) or 1)
    history = [float(x) for x in (summary.get("history") or [])]
    worst = worst_finger(fingers)
    if worst is not None:
        f, err = worst
        others = [
            float(v.get("err_deg", 0.0))
            for k, v in fingers.items()
            if k != f and isinstance(v, dict)
        ]
        second = max(others) if others else 0.0
        if err >= TH["wrong_deg"] / 2.0 and err >= 2.0 * second:
            return "isolate_finger", 0.8, f, "one_finger"
    stuck = stuck_s is not None and float(stuck_s) >= TH["stuck_s"]
    if stuck and overall < 0.6:
        return "show_keyframe", 0.8, None, "stuck_low"
    if attempt >= 4 and best >= TH["pass_score"] - 0.05:
        return "move_on", 0.6, None, "nearly_passed"
    if history and overall < history[-1] - 0.1:
        return "slow_down", 0.6, None, "getting_worse"
    if stuck:
        return "show_keyframe", 0.6, None, "stuck"
    return "repeat", 0.6, (worst[0] if worst else None), "default"


# ---------------------------------------------------------------------- check_outcome
PINCH_WORDS = (
    "pinch",
    "ok sign",
    "thumb and index",
    "thumb to index",
    "fingertips touch",
    "tips touch",
)
POINT_WORDS = ("point", "index finger out", "index extended", "index straight")
CLOSED_WORDS = (
    "closed",
    "fist",
    "grip",
    "grasp",
    "hold",
    "around",
    "wrap",
    "clench",
    "squeez",
    "curl",
)
OPEN_WORDS = ("open", "flat", "straight", "extended", "relaxed", "spread", "release")


def rule_check_outcome(
    question: str, context: dict | None
) -> tuple[bool, float, float, str]:
    """(answer, probability_yes, confidence, rule_name).

    Without a model the only evidence is the live hand: ``context`` may carry
    ``curl`` (per finger 0..1) and ``pinch`` (per finger bool) from the glove
    frame taken with the picture. Confidence 0 means no rule could judge.
    """
    q = (question or "").lower()
    ctx = context or {}
    curl = {f: float(v) for f, v in (ctx.get("curl") or {}).items() if f in FINGERS}
    pinch = {f: bool(v) for f, v in (ctx.get("pinch") or {}).items()}
    if not curl and not pinch:
        return False, 0.5, 0.0, "no_context"

    def verdict(p: float, rule: str) -> tuple[bool, float, float, str]:
        p = min(max(p, 0.05), 0.95)
        return p > 0.5, round(p, 3), round(min(1.0, abs(p - 0.5) * 2.0), 3), rule

    four = [
        curl[f] for f in ("index", "middle", "ring", "little") if f in curl
    ] or list(curl.values())
    mean_curl = sum(four) / len(four) if four else 0.5
    if any(w in q for w in PINCH_WORDS):
        if pinch:
            return verdict(0.9 if any(pinch.values()) else 0.1, "pinch")
        return verdict(
            0.5 + (0.45 if 0.25 <= curl.get("index", 0.0) <= 0.75 else -0.3),
            "pinch_from_curl",
        )
    if any(w in q for w in POINT_WORDS) and "index" in curl:
        rest = [curl[f] for f in ("middle", "ring", "little") if f in curl]
        if rest:
            gap = (sum(rest) / len(rest)) - curl["index"]
            return verdict(0.5 + gap, "point")
    if any(w in q for w in CLOSED_WORDS):
        return verdict(0.5 + (mean_curl - 0.5) * 1.5, "closed")
    if any(w in q for w in OPEN_WORDS):
        return verdict(0.5 + (0.5 - mean_curl) * 1.5, "open")
    return False, 0.5, 0.0, "no_rule"


# ---------------------------------------------------------------------- finger_rubric
_ALL = {f: 1.0 for f in FINGERS}
SHAPE_WORDS: dict[str, dict[str, float]] = {
    "pinch": {"thumb": 1.0, "index": 1.0, "middle": 0.4, "ring": 0.3, "little": 0.3},
    "ok": {"thumb": 1.0, "index": 1.0, "middle": 0.5, "ring": 0.5, "little": 0.5},
    "point": {"thumb": 0.6, "index": 1.0, "middle": 0.6, "ring": 0.6, "little": 0.6},
    "thumb": {"thumb": 1.0, "index": 0.5, "middle": 0.5, "ring": 0.5, "little": 0.5},
    "peace": {"thumb": 0.5, "index": 1.0, "middle": 1.0, "ring": 0.5, "little": 0.5},
    "two": {"thumb": 0.5, "index": 1.0, "middle": 1.0, "ring": 0.5, "little": 0.5},
    "fist": dict(_ALL),
    "grip": dict(_ALL),
    "closed": dict(_ALL),
    "open": dict(_ALL),
    "flat": dict(_ALL),
    "spread": dict(_ALL),
}


def rule_finger_rubric(
    keyframe: dict | None, step: dict | None
) -> tuple[dict[str, float], float, str]:
    """(weights 0..1 with the largest at 1.0, confidence, rule_name).

    Starts from the recorder's per-step weights (static fingers already at 0.5),
    then a shape word in the step name or note, else the fingers whose curl
    stands out from the rest of the hand in the key pose.
    """
    step = step or {}
    keyframe = keyframe or {}
    base = {f: float((step.get("weights") or {}).get(f, 1.0)) for f in FINGERS}
    text = f"{step.get('name') or ''} {step.get('note') or ''}".lower()
    out = dict(base)
    rule = "recorder_weights"
    shape = next(
        (w for word, w in SHAPE_WORDS.items() if re.search(rf"\b{word}", text)), None
    )
    if shape is not None:
        out = {f: base[f] * shape[f] for f in FINGERS}
        rule = "shape_word"
    else:
        curl = keyframe.get("curl") if isinstance(keyframe.get("curl"), dict) else None
        if curl is None:
            curl = curl_from_key_angles(keyframe.get("key_angles"))
        if curl and all(f in curl for f in FINGERS):
            mean = sum(curl[f] for f in FINGERS) / 5.0
            dev = {f: abs(curl[f] - mean) for f in FINGERS}
            mx = max(dev.values())
            if mx >= 0.15:
                out = {f: base[f] * (0.5 + 0.5 * dev[f] / mx) for f in FINGERS}
                rule = "shape_from_curl"
    mx = max(out.values()) if out else 0.0
    if mx <= 0.0:
        out = dict(_ALL)
    else:
        out = {f: round(v / mx, 3) for f, v in out.items()}
    return out, (0.5 if rule != "recorder_weights" else 0.4), rule
