"""pick_action, check_outcome and finger_rubric on the recorded capture, with fake transports."""
from __future__ import annotations

import base64
import time
from pathlib import Path

import numpy as np
import pytest

from decisions import config as C
from decisions import judgements as J
from decisions import rules as R
from decisions.client import DecisionsClient
from decisions.judgements import check_outcome, finger_rubric, pick_action, summary_text

from conftest import FIXTURES, canned_transport, choice_body, noul_body, read_log, score_body, slow_transport


def action_body(action: str, conf: float = 0.8, focus: str = "none") -> dict:
    probs = {a: (conf if a == action else (1.0 - conf) / (len(C.ACTIONS) - 1)) for a in C.ACTIONS}
    fprobs = {f: 0.0 for f in (*C.FINGERS, "none")}
    fprobs[focus] = 1.0
    return choice_body(action=(action, probs, conf), focus=(focus, fprobs, 0.9))


# ---------------------------------------------------------------------- pick_action
def test_pick_action_from_the_model(make_client, summaries):
    seen: list = []
    cl = make_client(canned_transport(action_body("isolate_finger", 0.83, "ring"), seen=seen))
    s = summaries[17]  # ring finger alone, 47.7 degrees off, stuck 14 s
    d = pick_action(s, client=cl)
    assert d.source == "model" and d.reason == "model"
    assert d.action == "isolate_finger" and d.confidence == pytest.approx(0.83) and d.focus == "ring"
    assert set(d.probabilities) == set(C.ACTIONS) and sum(d.probabilities.values()) == pytest.approx(1.0)
    payload, _ = seen[0]
    assert set(payload["questions"]) == {"action", "focus"}
    assert set(payload["questions"]["action"]["criteria"]) == set(C.ACTIONS)
    assert set(payload["questions"]["focus"]["criteria"]) == {*C.FINGERS, "none"}
    text = payload["input"][0]["text"]
    assert "Step 3" in text and "ring score" in text and "Stuck for 14.0 s" in text
    rows = read_log(cl.log.path)
    assert len(rows) == 1
    r = rows[0]
    assert r["fn"] == "pick_action" and r["source"] == "model" and r["ok"] is True
    assert r["result"] == {"action": "isolate_finger", "confidence": 0.83, "focus": "ring"}
    assert r["step"] == 2 and r["hand"] == "left" and r["budget_ms"] == 600 and r["latency_ms"] >= 0


def test_pick_action_focus_defaults_to_the_worst_finger(make_client, summaries):
    cl = make_client(canned_transport(action_body("isolate_finger", 0.7, "none")))
    d = pick_action(summaries[12], client=cl)  # middle alone at 46.6 degrees
    assert d.action == "isolate_finger" and d.focus == "middle"


def test_pick_action_falls_back_on_timeout(make_client, summaries):
    cl = make_client(slow_transport(0.5, action_body("move_on")), budget_ms=120)
    s = summaries[8]  # every finger wrong, overall 0.126, stuck 8 s
    t0 = time.monotonic()
    d = pick_action(s, client=cl)
    assert time.monotonic() - t0 < 0.4
    assert d.source == "rule" and d.reason == "timeout:stuck_low" and d.action == "show_keyframe"
    rows = read_log(cl.log.path)
    assert rows[0]["reason"] == "timeout" and rows[0]["source"] == "rule" and rows[0]["why"] == "timeout:stuck_low"
    cl.close()


def test_pick_action_offline_uses_rules_and_still_logs(summaries, tmp_path, monkeypatch):
    log = tmp_path / "offline.jsonl"
    monkeypatch.setenv("DECISIONS_LOG", str(log))
    J.set_client(None)
    d = pick_action(summaries[1])  # passed
    assert d.source == "rule" and d.reason == "no_key:passed" and d.action == "move_on" and d.confidence == 0.95
    rows = read_log(log)
    assert len(rows) == 1 and rows[0]["reason"] == "no_key" and rows[0]["latency_ms"] == 0.0
    assert J.get_client().enabled is False


def test_pick_action_bad_answer_falls_back(make_client, summaries):
    body = choice_body(action=("essay", {}, 0.1), focus=("none", {"none": 1.0}, 1.0))
    cl = make_client(canned_transport(body))
    d = pick_action(summaries[3], client=cl)
    assert d.source == "rule" and d.reason.startswith("bad_answer:") and d.action in C.ACTIONS


def test_pick_action_on_every_recorded_summary(make_client, summaries):
    cl = make_client(canned_transport(action_body("repeat", 0.6)))
    for s in summaries:
        d = pick_action(s, client=cl)
        assert d.action in C.ACTIONS and 0.0 <= d.confidence <= 1.0
    assert len(read_log(cl.log.path)) == len(summaries)


def test_summary_text_is_compact_and_complete(summaries):
    t = summary_text(summaries[0])
    assert len(t) < 900
    for word in ("Task: general", "Hand: left", "Attempt 1", "Passed: no", "thumb score", "too_spread", "Stuck for 8.0 s"):
        assert word in t
    t2 = summary_text(summaries[9])
    assert "Every finger is at or above the pass mark" in t2 and "Passed: yes" in t2
    t3 = summary_text({**summaries[0], "timing_ms": -220, "history": [0.5, 0.6]})
    assert "220 ms early" in t3 and "Earlier attempts: 0.50, 0.60" in t3


# ---------------------------------------------------------------------- check_outcome
def test_check_outcome_from_the_model_with_bytes(make_client, keyframe_jpg):
    seen: list = []
    cl = make_client(canned_transport(noul_body("outcome", 0.92, 0.88), seen=seen))
    d = check_outcome(keyframe_jpg, "Is the hand closed around the object?", client=cl)
    assert d.source == "model" and d.answer is True and d.probability == 0.92 and d.confidence == 0.88
    payload, _ = seen[0]
    part = payload["input"][0]
    assert part["type"] == "image" and part["mime_type"] == "image/jpeg" and part["resolution"] == "low"
    assert base64.b64decode(part["data"]) == keyframe_jpg
    assert payload["questions"] == {"outcome": {"type": "noul", "instructions": "Is the hand closed around the object?"}}
    rows = read_log(cl.log.path)
    assert rows[0]["fn"] == "check_outcome" and rows[0]["result"]["answer"] is True
    assert rows[0]["image_bytes"] == len(keyframe_jpg) and "data" not in str(rows[0])


def test_check_outcome_criteria_and_context(make_client, keyframe_jpg):
    seen: list = []
    cl = make_client(canned_transport(noul_body("outcome", 0.2), seen=seen))
    ctx = {"curl": {f: 0.1 for f in C.FINGERS}, "pinch": {"index": True}, "note": "Paper cup on the bench."}
    d = check_outcome(keyframe_jpg, "Is the cup held?", context=ctx, yes_means="Fingers wrap the cup.",
                      no_means="The cup is free.", client=cl)
    assert d.answer is False and d.probability == 0.2 and d.confidence == pytest.approx(0.6)
    payload, _ = seen[0]
    assert payload["questions"]["outcome"]["criteria"] == {"true_description": "Fingers wrap the cup.",
                                                           "false_description": "The cup is free."}
    assert payload["input"][1]["type"] == "text"
    assert "thumb straight" in payload["input"][1]["text"] and "Thumb touches: index" in payload["input"][1]["text"]
    assert "Paper cup" in payload["input"][1]["text"]


def test_check_outcome_accepts_a_path_and_an_array(make_client):
    seen: list = []
    cl = make_client(canned_transport(noul_body("outcome", 0.7), seen=seen))
    check_outcome(FIXTURES / "keyframe_01.jpg", "Hand?", client=cl)
    assert seen[0][0]["input"][0]["mime_type"] == "image/jpeg"
    import cv2

    big = np.zeros((900, 1600, 3), dtype=np.uint8)
    check_outcome(big, "Hand?", client=cl)
    data = base64.b64decode(seen[1][0]["input"][0]["data"])
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    assert img.shape[1] <= J.MAX_SIDE_PX and img.shape[0] <= J.MAX_SIDE_PX
    with pytest.raises(TypeError):
        check_outcome(12345, "Hand?", client=cl)


def test_check_outcome_falls_back_to_the_glove_context(make_client, keyframe_jpg):
    cl = make_client(slow_transport(0.5, noul_body("outcome", 0.9)), budget_ms=100)
    closed = {"curl": {f: 0.9 for f in C.FINGERS}}
    d = check_outcome(keyframe_jpg, "Is the hand closed?", context=closed, client=cl)
    assert d.source == "rule" and d.reason == "timeout:closed" and d.answer is True and d.confidence > 0.8
    d = check_outcome(keyframe_jpg, "Is the hand closed?", client=cl)
    assert d.source == "rule" and d.confidence == 0.0 and d.answer is False
    cl.close()


def test_check_outcome_without_an_image_makes_no_call(make_client):
    seen: list = []
    cl = make_client(canned_transport(noul_body("outcome", 0.9), seen=seen))
    d = check_outcome(None, "Is the hand closed?", context={"curl": {f: 0.9 for f in C.FINGERS}}, client=cl)
    assert seen == [] and d.source == "rule" and d.reason == "no_image:closed" and d.answer is True
    assert read_log(cl.log.path)[0]["reason"] == "no_image"


# ---------------------------------------------------------------------- finger_rubric
def test_finger_rubric_from_the_model(make_client, steps, lesson_meta):
    seen: list = []
    levels = {"thumb": 1.0, "index": 1.0, "middle": 1.0, "ring": 3.0, "little": 1.5}
    cl = make_client(canned_transport(score_body(levels, confidence=0.7), seen=seen))
    r = finger_rubric(steps[2], steps[2], lesson=lesson_meta, client=cl)
    assert r.source == "model"
    assert r.weights == {"thumb": pytest.approx(1 / 3, abs=1e-3), "index": pytest.approx(1 / 3, abs=1e-3),
                         "middle": pytest.approx(1 / 3, abs=1e-3), "ring": 1.0, "little": 0.5}
    assert r.levels == levels and r.confidence == pytest.approx(0.7)
    payload, _ = seen[0]
    assert set(payload["questions"]) == set(C.FINGERS)
    for f in C.FINGERS:
        q = payload["questions"][f]
        assert q["type"] == "score" and q["criteria"] == J.RUBRIC_LEVELS and f in q["instructions"]
    text = payload["input"][0]["text"]
    assert "Real capture: three shapes" in text and "Step 3" in text and "ring curled" in text
    assert read_log(cl.log.path)[0]["result"]["weights"]["ring"] == 1.0


def test_finger_rubric_with_a_picture_keyframe(make_client, steps, keyframe_jpg):
    seen: list = []
    cl = make_client(canned_transport(score_body({f: 2.0 for f in C.FINGERS}), seen=seen))
    r = finger_rubric(keyframe_jpg, steps[0], client=cl)
    assert r.weights == {f: 1.0 for f in C.FINGERS}
    parts = seen[0][0]["input"]
    assert parts[0]["type"] == "image" and parts[1]["type"] == "text"


def test_finger_rubric_all_zero_levels_means_every_finger_counts(make_client, steps):
    cl = make_client(canned_transport(score_body({f: 0.0 for f in C.FINGERS})))
    assert finger_rubric(steps[1], steps[1], client=cl).weights == {f: 1.0 for f in C.FINGERS}


def test_finger_rubric_falls_back_to_rules(make_client, steps):
    cl = make_client(slow_transport(0.5, score_body({f: 2.0 for f in C.FINGERS})), budget_ms=100)
    r = finger_rubric(steps[2], steps[2], client=cl)
    assert r.source == "rule" and r.reason == "timeout:shape_from_curl" and r.weights["ring"] == 1.0
    assert r.weights == R.rule_finger_rubric(steps[2], steps[2])[0]
    cl.close()


def test_finger_rubric_partial_answer_is_bad(make_client, steps):
    body = score_body({f: 2.0 for f in C.FINGERS})
    body["answers"]["ring"] = {"type": "noul", "noul": 0.5}
    cl = make_client(canned_transport(body))
    r = finger_rubric(steps[0], steps[0], client=cl)
    assert r.source == "rule" and r.reason.startswith("bad_answer:")


def test_one_log_line_per_call(make_client, summaries, steps, keyframe_jpg):
    cl = make_client(canned_transport(action_body("repeat")))
    pick_action(summaries[0], client=cl)
    cl2 = make_client(canned_transport({"answers": {}}))
    check_outcome(keyframe_jpg, "Hand?", client=cl2)
    finger_rubric(steps[0], steps[0], client=cl2)
    rows = read_log(cl.log.path)
    assert [r["fn"] for r in rows] == ["pick_action", "check_outcome", "finger_rubric"]
    assert all({"latency_ms", "budget_ms", "source", "why", "model", "result"} <= set(r) for r in rows)
    assert rows[1]["reason"] == "bad_response" and rows[1]["source"] == "rule"


def test_default_client_is_shared(monkeypatch):
    J.set_client(None)
    a = J.get_client()
    assert a is J.get_client()
    b = DecisionsClient(api_key="x", enabled=False)
    J.set_client(b)
    assert J.get_client() is b
