"""The one prompt and the one filter every part of the lane shares: labelling, training, evaluation and serving.

An example is a dict with: task, step_name, step_index, kind ("hold" or "move"), hand ("left" or "right"),
score (0 to 100), errors (list of {finger, hint, err_deg}, most important first) and lang ("en", "de", "fi").
The hints are the core scorer's: too_flat, too_curled, too_spread, too_closed (core/scorer.py hint_for).
"""

from __future__ import annotations

import re

FINGERS = ("thumb", "index", "middle", "ring", "little")
HINTS = ("too_flat", "too_curled", "too_spread", "too_closed")
LANG_NAMES = {"en": "English", "de": "German", "fi": "Finnish"}
MAX_WORDS = 14

# What the learner must do to fix each hint, in plain words for the prompt.
FIX = {
    "too_flat": "curl it more",
    "too_curled": "straighten it",
    "too_spread": "bring it closer to its neighbour",
    "too_closed": "spread it away from its neighbour",
}

SYSTEM = (
    "You are a hand-skills coach. You see the scorer's result for one learner attempt. "
    "Write one coaching line: one sentence, at most 14 words, in the requested language. "
    "Name the single most important finger and say the fix as a physical cue. "
    "Never use numbers or degrees. Be direct and kind. Reply with the line only."
)


def describe_error(e: dict) -> str:
    return f"{e['finger']} {e['hint'].replace('_', ' ')} by {round(float(e['err_deg']))} degrees (fix: {FIX[e['hint']]})"


def user_prompt(ex: dict) -> str:
    errors = "; ".join(describe_error(e) for e in ex["errors"][:3]) or "none"
    return (
        f"Task: {ex['task']}. Step {ex['step_index'] + 1}: {ex['step_name']} ({ex['kind']}). "
        f"Hand: {ex['hand']}. Score: {round(float(ex['score']))} of 100. "
        f"Top errors: {errors}. Language: {LANG_NAMES[ex['lang']]}."
    )


def messages(ex: dict) -> list[dict]:
    """Chat messages for any OpenAI-compatible server. Gemma's template folds the system turn into the first user turn."""
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user_prompt(ex)}]


# -- filter -----------------------------------------------------------------------------------------------------------
# Word stems per language. A line passes when it names the right finger, uses a stem of the right fix and no stem of
# the opposite fix, keeps to one sentence of at most MAX_WORDS words, and has no digits or degree words.

FINGER_WORDS = {
    "en": {"thumb": ["thumb"], "index": ["index", "pointer", "first finger", "forefinger"], "middle": ["middle"],
           "ring": ["ring"], "little": ["little", "pinky", "pinkie", "small finger"]},
    "de": {"thumb": ["daumen"], "index": ["zeigefinger"], "middle": ["mittelfinger"], "ring": ["ringfinger"],
           "little": ["kleine finger", "kleinen finger", "kleiner finger", "kleinfinger"]},
    "fi": {"thumb": ["peukalo", "peukku", "peukal"], "index": ["etusor"], "middle": ["keskisor"],
           "ring": ["nimetön", "nimettö", "nimetöm"], "little": ["pikkusor", "pikkurill"]},
}

FIX_WORDS = {
    "en": {
        "too_flat": ["curl", "bend", "fold", "tuck", "hook", "round"],
        "too_curled": ["straighten", "straight", "extend", "uncurl", "open", "lengthen", "unfold", "flatten"],
        "too_spread": ["together", "closer", "toward", "towards", "in against", "squeeze", "narrow", "tuck it in", "draw it in", "bring it in"],
        "too_closed": ["spread", "apart", "away", "fan", "wider", "widen", "outward", "out from"],
    },
    "de": {
        "too_flat": ["beug", "krümm", "einroll", "anwinkel", "rund", "einkrall"],
        "too_curled": ["streck", "gerade", "öffne", "lang"],
        "too_spread": ["zusammen", "näher", "heran", "anlegen", "ran ", "an den", "an die"],
        "too_closed": ["spreiz", "auseinander", "weg von", "weiter weg", "ab vom", "abspreiz", "nach außen"],
    },
    "fi": {
        "too_flat": ["koukist", "taivuta", "taivut", "koukkuun", "kippura", "kiepu", "pyöristä"],
        "too_curled": ["ojenna", "suorista", "suoraksi", "suoremm", "avaa", "oikaise"],
        "too_spread": ["yhteen", "lähemmä", "lähelle", "vierekkäin", "kiinni", "viereen"],
        "too_closed": ["levitä", "erilleen", "erille", "harita", "kauemma", "irti", "ulospäin"],
    },
}

OPPOSITE = {"too_flat": "too_curled", "too_curled": "too_flat", "too_spread": "too_closed", "too_closed": "too_spread"}
NUMBER_RE = re.compile(r"\d|degree|grad\b|astetta|astee", re.IGNORECASE)


def clean(line: str) -> str:
    line = (line or "").strip().strip('"').strip("“”„").strip()
    return line.splitlines()[0].strip() if line else ""


def words(line: str) -> int:
    return len([w for w in re.split(r"\s+", line) if re.search(r"\w", w)])


def sentences(line: str) -> int:
    return max(1, len([s for s in re.split(r"(?<=[.!?])\s+", line.strip()) if s.strip()]))


def has_any(text: str, stems: list[str]) -> bool:
    return any(s in text for s in stems)


def names_finger(line: str, finger: str, lang: str) -> bool:
    low = line.lower()
    if not has_any(low, FINGER_WORDS[lang][finger]):
        return False
    # "ring" inside "bring" must not count as the ring finger in English.
    if lang == "en" and finger == "ring" and not re.search(r"\bring\b", low):
        return False
    return True


def names_other_finger(line: str, finger: str, lang: str) -> bool:
    low = line.lower()
    for f in FINGERS:
        if f == finger:
            continue
        if f == "ring" and lang == "en":
            if re.search(r"\bring\b", low):
                return True
            continue
        if f == "index" and lang == "en" and "first finger" in low:
            return True
        if has_any(low, FINGER_WORDS[lang][f]):
            return True
    return False


def right_direction(line: str, hint: str, lang: str) -> bool:
    low = line.lower()
    return has_any(low, FIX_WORDS[lang][hint]) and not has_any(low, FIX_WORDS[lang][OPPOSITE[hint]])


def check(line: str, finger: str, hint: str, lang: str) -> dict:
    """Per-rule verdicts for one line, plus `ok` when all pass. Shared by the label filter and the evaluation."""
    line = clean(line)
    finger_ok = names_finger(line, finger, lang)
    direction_ok = right_direction(line, hint, lang)
    style_ok = bool(line) and words(line) <= MAX_WORDS and sentences(line) == 1 and not NUMBER_RE.search(line)
    return {
        "line": line,
        "finger_ok": finger_ok,
        "direction_ok": direction_ok,
        "style_ok": style_ok,
        "single_finger": not names_other_finger(line, finger, lang),
        "ok": finger_ok and direction_ok and style_ok,
    }
