"""coach_tune: the shared line filter and the synthetic perturbations. Offline, no capture, no Verda."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

LANE = Path(__file__).resolve().parent.parent / "coach_tune"
sys.path.insert(0, str(LANE))

import build_dataset as B  # noqa: E402
import prompt as P  # noqa: E402

from core.config import load_config  # noqa: E402


@pytest.mark.parametrize(
    "line,finger,hint,lang,ok",
    [
        ("Curl your index finger a little more.", "index", "too_flat", "en", True),
        ("Straighten your ring finger, nice and long.", "ring", "too_curled", "en", True),
        ("Bring your little finger closer to the ring finger.", "little", "too_spread", "en", True),
        ("Spread your thumb away from your hand.", "thumb", "too_closed", "en", True),
        ("Bring your thumb in a bit.", "ring", "too_spread", "en", False),  # "bring" is not the ring finger
        ("Curl your index finger 20 degrees more.", "index", "too_flat", "en", False),  # numbers
        ("Straighten your index finger.", "index", "too_flat", "en", False),  # wrong direction
        ("Beuge den Zeigefinger etwas mehr.", "index", "too_flat", "de", True),
        ("Spreize den kleinen Finger etwas ab.", "little", "too_closed", "de", True),
        ("Ojenna keskisormesi suoraksi.", "middle", "too_curled", "fi", True),
        ("Tuo nimetön lähemmäs keskisormea.", "ring", "too_spread", "fi", True),
        ("Koukista peukaloa vähän enemmän, hienoa työtä, jatka samaan malliin ja hengitä rauhassa nyt vain koko ajan.",
         "thumb", "too_flat", "fi", False),  # too long
    ],
)
def test_check(line, finger, hint, lang, ok):
    assert P.check(line, finger, hint, lang)["ok"] is ok


def test_user_prompt_has_no_missing_fields():
    ex = {"task": "Held fist", "step_name": "Fist", "step_index": 0, "kind": "hold", "hand": "right", "score": 61.2,
          "errors": [{"finger": "index", "hint": "too_flat", "err_deg": 41.0}], "lang": "de"}
    text = P.user_prompt(ex)
    assert "index too flat" in text and "German" in text and "Step 1" in text


def test_every_finger_and_hint_comes_back_from_the_scorer():
    sc = B.Scoring(load_config(None))
    rng = np.random.default_rng(0)
    target = np.array([20, 10] + [10] * 12 + [30, 8, 5, 8], dtype=float)
    weights = {f: 1.0 for f in B.H.FINGERS}
    for f in B.H.FINGERS:
        for h in P.HINTS:
            hits = 0
            for _ in range(40):
                body = sc.score("right", B.perturb(target, f, h, 60.0, rng), target, weights)
                hits += body is not None and body["top_finger"] == f and body["top_hint"] == h
            assert hits >= 20, (f, h, hits)
