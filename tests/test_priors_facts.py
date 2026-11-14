"""The priors reach the coach only behind PRIORS_ASL / PRIORS_PIANO, off by default."""

from __future__ import annotations

import numpy as np
import pytest

from core import hand as H
from core.coach import RuleCoach
from core.priors import asl, facts, piano


def _summary(lesson="Fingerspelling", step_name="Letter A", task="general"):
    return {
        "task": task,
        "lesson": lesson,
        "hand": "right",
        "step": {"index": 0, "name": step_name, "kind": "hold"},
        "passed": False,
        "fingers": {"index": {"score": 0.4, "err_deg": 30.0, "hint": "too_curled"}},
        "timing_ms": None,
    }


def test_flags_off_leave_summary_unchanged(monkeypatch):
    monkeypatch.delenv("PRIORS_ASL", raising=False)
    monkeypatch.delenv("PRIORS_PIANO", raising=False)
    s = _summary()
    out = facts.add_prior_facts(s, np.zeros(H.N_ANGLES))
    assert out is s and "priors" not in out


@pytest.mark.skipif(not asl.MODEL_FILE.exists(), reason="letter model not trained")
def test_asl_flag_reads_letter(monkeypatch):
    monkeypatch.setenv("PRIORS_ASL", "1")
    s_curl = asl.letter_curls()["s"]
    learner = asl.target_angles(s_curl)
    out = facts.add_prior_facts(_summary(), learner)
    a = out["priors"]["asl"]
    assert a["target"] == "a"
    assert a["read_as"] == "s"
    assert a["matches_target"] is False
    assert out["priors"]["facts"][0] == "reads as S, target A"
    line = RuleCoach().tip(out)
    assert line.text.startswith("Reads as S, target A. ")
    assert len(line.text) <= 120


def test_asl_flag_ignores_non_letter_steps(monkeypatch):
    monkeypatch.setenv("PRIORS_ASL", "1")
    s = _summary(lesson="Table tennis", step_name="Grip")
    assert "priors" not in facts.add_prior_facts(s, np.zeros(H.N_ANGLES))


@pytest.mark.skipif(not piano.RANGES_FILE.exists(), reason="piano ranges not built")
def test_piano_flag_flags_a_flat_hand(monkeypatch):
    monkeypatch.setenv("PRIORS_PIANO", "1")
    s = _summary(lesson="Piano scale", step_name="C", task="piano")
    out = facts.add_prior_facts(s, np.zeros(H.N_ANGLES))
    items = out["priors"]["piano"]["outside"]
    assert items and all(i["direction"] in ("flatter", "narrower") for i in items)
    assert "than the expert range" in out["priors"]["facts"][0]


def test_checker_directions():
    r = piano.PianoRanges(
        lo=np.full(H.N_ANGLES, 10.0), hi=np.full(H.N_ANGLES, 40.0),
        lo_press=None, hi_press=None, lo_free=None, hi_free=None, band=(5, 95),
    )
    a = np.full(H.N_ANGLES, 20.0)
    a[2] = 0.0  # index_mcp flat
    a[6] = 70.0  # middle_pip curled
    a[15] = 50.0  # spread index-middle wide
    out = r.check(a)
    by = {i["joint"]: i for i in out}
    assert by["index_mcp"]["direction"] == "flatter" and by["index_mcp"]["by_deg"] == 10.0
    assert by["middle_pip"]["direction"] == "more_curled" and by["middle_pip"]["by_deg"] == 30.0
    assert by["spread_index_middle"]["direction"] == "wider"
    assert out[0]["joint"] == "middle_pip"  # worst first
    w = np.ones(H.N_ANGLES)
    w[6] = 0
    assert "middle_pip" not in {i["joint"] for i in r.check(a, slot_weights=w)}


def test_furelise_mapping_matches_core_features():
    """A synthetic hand dropped to FurElise's 21 joints gives the same flexion angles back."""
    h = H.synth_hand("right", curl={"thumb": 0.3, "index": 0.5, "middle": 0.2, "ring": 0.7, "little": 0.4})
    J = h.joints_local
    j21 = np.zeros((21, 3))
    j21[0] = J[1]
    j21[1:5] = J[2:6]
    for f, b in piano.FE_FINGER.items():
        j21[b : b + 4] = J[H.FINGER_BASE[f] + 1 : H.FINGER_BASE[f] + 5]
    got = piano.angles_of(j21[None])[0]
    # PIP, DIP and both thumb joints do not depend on the metacarpal joint
    for f in ("index", "middle", "ring", "little"):
        s = H.FLEXION_SLOTS[f]
        assert np.allclose(got[s[1:]], h.angles[s[1:]], atol=1e-6)
    assert np.allclose(got[:2], h.angles[:2], atol=1e-6)


def test_to_calibrated_maps_aaos_fist_to_full():
    a = piano.AAOS_FIST.copy()
    cal = piano.to_calibrated(a)
    assert np.allclose(cal[:2], 60) and np.allclose(cal[2:14], 90)
