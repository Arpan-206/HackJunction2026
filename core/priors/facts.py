"""Extra facts for the coach from the priors, behind environment flags.

    PRIORS_ASL=1     letter reading on fingerspelling steps
    PRIORS_PIANO=1   expert posture ranges on piano steps

Both are off by default. The flags are environment variables only (no
config.toml key), read on every call, so a test or the demo can flip them
without a restart. With both off, ``add_prior_facts`` returns the summary
unchanged and loads nothing.

The step summary gains one key, ``priors``:

    "priors": {
      "facts": ["reads as S, target A"],          # short lines, coach-ready
      "asl": {"read_as": "s", "read_conf": 0.62,
              "second": "a", "second_conf": 0.21,
              "target": "a", "matches_target": false},
      "piano": {"pressing": null,
                "outside": [{"joint": "index_mcp", "value": 3.1, "lo": 15.2,
                             "hi": 48.9, "by_deg": 12.1,
                             "direction": "flatter"}]}
    }

``asl`` is present only on a fingerspelling step, ``piano`` only on a
piano step. Class names may be merged groups such as "h/u/v" when the
18 angles cannot tell the letters apart (core/priors/asl.py). The scorer's
numbers are never changed: these are facts next to them.
"""

from __future__ import annotations

import os
import re
from functools import lru_cache

import numpy as np

from . import asl as A
from . import piano as P

LETTER_RE = re.compile(r"\bletter\s+([a-z])\b", re.IGNORECASE)
MAX_PIANO_ITEMS = 3
# Real-capture check (core/priors/out/real_check.json): the glove solver bends
# each end joint (DIP) about as much as the middle joint, pianists about half
# as much, so DIP facts would fire on every glove frame. They are left out,
# and a joint must sit at least PIANO_MIN_BY_DEG outside the band to count.
PIANO_SKIP_JOINTS = ("index_dip", "middle_dip", "ring_dip", "little_dip")
PIANO_MIN_BY_DEG = 10.0


def flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


@lru_cache(maxsize=1)
def _letter_model() -> A.LetterModel | None:
    return A.LetterModel.load() if A.MODEL_FILE.exists() else None


@lru_cache(maxsize=1)
def _piano_ranges() -> P.PianoRanges | None:
    return P.PianoRanges.load() if P.RANGES_FILE.exists() else None


def is_fingerspelling(summary: dict) -> bool:
    text = (
        f"{summary.get('lesson', '')} {summary.get('step', {}).get('name', '')}".lower()
    )
    return "fingerspell" in text or bool(LETTER_RE.search(text))


def is_piano(summary: dict) -> bool:
    text = f"{summary.get('task', '')} {summary.get('lesson', '')}".lower()
    return "piano" in text


def target_letter(summary: dict) -> str | None:
    m = LETTER_RE.search(str(summary.get("step", {}).get("name", "")))
    return m.group(1).lower() if m else None


def asl_fact(
    learner: np.ndarray, target_angles: np.ndarray | None, letter: str | None
) -> dict | None:
    model = _letter_model()
    if model is None:
        return None
    (c1, p1), (c2, p2) = model.top2(learner)
    if letter is not None and model.class_of_letter(letter) is not None:
        target = model.classes[model.class_of_letter(letter)]
    elif target_angles is not None:
        target = model.top2(target_angles)[0][0]
    else:
        target = None
    return {
        "read_as": c1,
        "read_conf": p1,
        "second": c2,
        "second_conf": p2,
        "target": target,
        "matches_target": None if target is None else c1 == target,
    }


def piano_fact(
    learner: np.ndarray, pressing: bool | None, slot_weights: np.ndarray | None
) -> dict | None:
    ranges = _piano_ranges()
    if ranges is None:
        return None
    items = [
        i
        for i in ranges.check(learner, pressing, slot_weights)
        if i["joint"] not in PIANO_SKIP_JOINTS and i["by_deg"] >= PIANO_MIN_BY_DEG
    ]
    return {"pressing": pressing, "outside": items[:MAX_PIANO_ITEMS]}


def _upper(c: str) -> str:
    return c.upper()


def facts_lines(pri: dict) -> list[str]:
    out = []
    a = pri.get("asl")
    if a and a.get("target") and not a.get("matches_target"):
        out.append(f"reads as {_upper(a['read_as'])}, target {_upper(a['target'])}")
    p = pri.get("piano")
    if p:
        out += [P.describe(i) for i in p["outside"]]
    return out


def add_prior_facts(
    summary: dict,
    learner: np.ndarray | None,
    target_angles: np.ndarray | None = None,
    slot_weights: np.ndarray | None = None,
    pressing: bool | None = None,
) -> dict:
    """The summary with a ``priors`` key when a flag is on and the step fits; else unchanged."""
    use_asl = flag("PRIORS_ASL") and is_fingerspelling(summary)
    use_piano = flag("PRIORS_PIANO") and is_piano(summary)
    if learner is None or not (use_asl or use_piano):
        return summary
    learner = np.asarray(learner, dtype=float)
    pri: dict = {}
    try:
        if use_asl:
            f = asl_fact(learner, target_angles, target_letter(summary))
            if f:
                pri["asl"] = f
        if use_piano:
            f = piano_fact(learner, pressing, slot_weights)
            if f:
                pri["piano"] = f
    except Exception:  # noqa: BLE001 - a prior must never break the session
        return summary
    if not pri:
        return summary
    pri["facts"] = facts_lines(pri)
    return {**summary, "priors": pri}


def from_scorer(summary: dict, sc) -> dict:
    """add_prior_facts with the learner's last frame and the step's key pose from a StepScorer."""
    if not (flag("PRIORS_ASL") or flag("PRIORS_PIANO")):
        return summary
    seq = getattr(sc, "learner_seq", None) or []
    learner = seq[-1][1] if seq else None
    step = getattr(sc, "step", None)
    target = getattr(step, "key_angles", None)
    return add_prior_facts(summary, learner, target, getattr(sc, "slot_weights", None))
