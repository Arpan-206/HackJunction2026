"""Rule fallbacks: deterministic answers on synthetic summaries and on the recorded steps."""

from __future__ import annotations

import pytest

from decisions import rules as R
from decisions.config import ACTIONS, FINGERS


def summary(**over) -> dict:
    base = {
        "task": "general",
        "lesson": "t",
        "hand": "right",
        "step": {"index": 1, "name": "Fist", "kind": "hold"},
        "attempt": 1,
        "passed": False,
        "overall": 0.7,
        "best": 0.7,
        "history": [],
        "fingers": {},
        "timing_ms": None,
        "stuck_s": None,
        "worst_at_ms": None,
    }
    base.update(over)
    return base


def finger(err: float, score: float = 0.5, hint: str = "too_flat") -> dict:
    return {"score": score, "err_deg": err, "hint": hint}


# ---------------------------------------------------------------------- pick_action
def test_passed_moves_on():
    assert R.rule_pick_action(summary(passed=True))[0::3] == ("move_on", "passed")


def test_early_timing_slows_down():
    assert R.rule_pick_action(summary(timing_ms=-200))[0::3] == ("slow_down", "early")
    assert (
        R.rule_pick_action(summary(timing_ms=200))[0] == "repeat"
    )  # late is not "ahead of the hand"


def test_one_bad_finger_is_isolated():
    a, conf, focus, rule = R.rule_pick_action(summary(fingers={"ring": finger(31.0)}))
    assert (a, focus, rule) == ("isolate_finger", "ring", "one_finger") and conf >= 0.7
    # two fingers with similar errors: not one finger's fault
    a, _, _, rule = R.rule_pick_action(
        summary(fingers={"ring": finger(31.0), "index": finger(25.0)})
    )
    assert a == "repeat" and rule == "default"
    # one finger but a small error: repeat with that finger as focus
    a, _, focus, rule = R.rule_pick_action(summary(fingers={"ring": finger(12.0, 0.8)}))
    assert (a, focus) == ("repeat", "ring")


def test_stuck_with_a_low_score_shows_the_keyframe():
    s = summary(
        stuck_s=6.0,
        overall=0.4,
        best=0.5,
        fingers={"ring": finger(30.0), "index": finger(28.0)},
    )
    assert R.rule_pick_action(s)[0::3] == ("show_keyframe", "stuck_low")
    s = summary(
        stuck_s=6.0,
        overall=0.75,
        best=0.8,
        fingers={"ring": finger(20.0), "index": finger(18.0)},
    )
    assert R.rule_pick_action(s)[0::3] == ("show_keyframe", "stuck")


def test_nearly_passed_many_times_moves_on():
    s = summary(
        attempt=5,
        overall=0.8,
        best=0.82,
        fingers={"ring": finger(15.0), "index": finger(14.0)},
    )
    assert R.rule_pick_action(s)[0::3] == ("move_on", "nearly_passed")


def test_getting_worse_slows_down():
    s = summary(
        history=[0.85],
        overall=0.6,
        best=0.85,
        fingers={"ring": finger(15.0), "index": finger(14.0)},
    )
    assert R.rule_pick_action(s)[0::3] == ("slow_down", "getting_worse")


def test_every_rule_answer_is_in_the_fixed_list(summaries):
    for s in summaries:
        action, conf, focus, rule = R.rule_pick_action(s)
        assert action in ACTIONS
        assert 0.0 <= conf <= 1.0
        assert focus is None or focus in FINGERS


def test_recorded_summaries_cover_several_actions(summaries):
    actions = {R.rule_pick_action(s)[0] for s in summaries}
    assert "move_on" in actions, (
        "the left hand passed a step at least once in the capture"
    )
    assert len(actions) >= 3


# ---------------------------------------------------------------------- check_outcome
def test_outcome_without_context_cannot_judge():
    answer, p, conf, rule = R.rule_check_outcome("Is the hand closed?", None)
    assert (answer, p, conf, rule) == (False, 0.5, 0.0, "no_context")


def test_outcome_closed_and_open_from_curl():
    closed = {"curl": {f: 0.85 for f in FINGERS}}
    opened = {"curl": {f: 0.1 for f in FINGERS}}
    assert R.rule_check_outcome("Is the hand closed around the cup?", closed)[0] is True
    assert (
        R.rule_check_outcome("Is the hand closed around the cup?", opened)[0] is False
    )
    assert R.rule_check_outcome("Is the hand open and flat?", opened)[0] is True
    assert R.rule_check_outcome("Is the hand open and flat?", closed)[0] is False
    a, p, conf, rule = R.rule_check_outcome("Is the hand closed?", closed)
    assert conf > 0.8 and rule == "closed"


def test_outcome_pinch_and_point():
    pinch_on = {
        "curl": {f: 0.4 for f in FINGERS},
        "pinch": {"index": True, "middle": False, "ring": False, "little": False},
    }
    pinch_off = {
        "curl": {f: 0.4 for f in FINGERS},
        "pinch": {"index": False, "middle": False, "ring": False, "little": False},
    }
    assert (
        R.rule_check_outcome("Is the thumb pinching the index finger?", pinch_on)[0]
        is True
    )
    assert (
        R.rule_check_outcome("Is the thumb pinching the index finger?", pinch_off)[0]
        is False
    )
    point = {
        "curl": {"thumb": 0.5, "index": 0.1, "middle": 0.9, "ring": 0.9, "little": 0.9}
    }
    fist = {"curl": {f: 0.9 for f in FINGERS}}
    assert R.rule_check_outcome("Is the hand pointing?", point)[0] is True
    assert R.rule_check_outcome("Is the hand pointing?", fist)[0] is False


def test_outcome_unknown_question_has_zero_confidence():
    a, p, conf, rule = R.rule_check_outcome(
        "Is the cup on the table?", {"curl": {f: 0.5 for f in FINGERS}}
    )
    assert conf == 0.0 and rule == "no_rule"


# ---------------------------------------------------------------------- finger_rubric
def test_rubric_shape_words():
    w, conf, rule = R.rule_finger_rubric({}, {"name": "Pinch", "note": None})
    assert (
        rule == "shape_word"
        and w["thumb"] == 1.0
        and w["index"] == 1.0
        and w["little"] < 0.5
    )
    w, _, rule = R.rule_finger_rubric(
        {}, {"name": "Step 3", "note": "Point at the target."}
    )
    assert rule == "shape_word" and w["index"] == 1.0 and w["middle"] < 1.0
    w, _, rule = R.rule_finger_rubric(
        {}, {"name": "Look here"}
    )  # "ok" must not match inside "look"
    assert rule == "recorder_weights" and all(v == 1.0 for v in w.values())


def test_rubric_keeps_recorder_weights():
    w, conf, rule = R.rule_finger_rubric(
        {}, {"name": "Open hand", "weights": {f: 1.0 for f in FINGERS} | {"ring": 0.5}}
    )
    assert w["ring"] == 0.5 and w["index"] == 1.0


def test_rubric_from_curl_singles_out_the_odd_finger():
    curl = {"thumb": 0.2, "index": 0.2, "middle": 0.2, "ring": 0.8, "little": 0.2}
    w, conf, rule = R.rule_finger_rubric({"curl": curl}, {"name": "Shape"})
    assert (
        rule == "shape_from_curl"
        and w["ring"] == 1.0
        and all(w[f] < w["ring"] for f in FINGERS if f != "ring")
    )
    flat = {f: 0.2 for f in FINGERS}
    w, _, rule = R.rule_finger_rubric({"curl": flat}, {"name": "Shape"})
    assert rule == "recorder_weights" and all(v == 1.0 for v in w.values())


def test_rubric_on_recorded_steps(steps):
    for s in steps:
        w, conf, rule = R.rule_finger_rubric(s, s)
        assert set(w) == set(FINGERS)
        assert max(w.values()) == 1.0 and min(w.values()) >= 0.0
    # step 3 of the capture: the ring finger is curled while the others are nearly straight
    w, _, rule = R.rule_finger_rubric(steps[2], steps[2])
    assert rule == "shape_from_curl" and w["ring"] == 1.0


def test_curl_matches_the_core(steps):
    from core import hand as H

    for s in steps:
        ours = R.curl_from_key_angles(s["key_angles"])
        theirs = H.curl_from_angles(
            __import__("numpy").asarray(s["key_angles"]), 90.0, 60.0
        )
        for f in FINGERS:
            assert ours[f] == pytest.approx(theirs[f], abs=1e-6)
    assert R.curl_from_key_angles(None) is None
    assert R.curl_from_key_angles([1, 2, 3]) is None
