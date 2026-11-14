import json

import numpy as np
import pytest

from core import fake
from core import hand as H
from core.clock import FakeClock
from core.coach import Coach
from core.session import CommandError, Session


@pytest.fixture
def sess(cfg, tmp_path):
    clock = FakeClock()
    coach = Coach(None, cfg.coach, cfg.score.timing_hint_ms)
    s = Session(cfg, clock, tmp_path, coach, fake=True)
    s.attempts_log = tmp_path / "attempts.jsonl"
    fake.build_fake_lesson(cfg, tmp_path)
    return s, clock


def feed(s, clock, side, curl, n=1, dt_us=33_333, pinch=None):
    for _ in range(n):
        clock.advance_us(dt_us)
        h = H.synth_hand(side=side, curl=curl, t_us=clock.now_us(), device_id=2)
        H.finish_hand(h, s.cfg.hand)
        if pinch:
            h.pinch[pinch] = True
        s.update_hand(side, h)
        s.tick(clock.now_us())
    return s.drain()


def types(msgs, kind=None, name=None):
    out = [m for m in msgs if kind is None or m["type"] == kind]
    if name:
        out = [m for m in out if m.get("name") == name]
    return out


def test_mode_guards(sess):
    s, _ = sess
    with pytest.raises(CommandError) as e:
        s.handle_command("set_mode", {"mode": "learn"})
    assert e.value.code == "bad_state"
    with pytest.raises(CommandError) as e:
        s.handle_command("step_next", {})
    assert e.value.code == "bad_state"
    with pytest.raises(CommandError) as e:
        s.handle_command("set_tempo", {"factor": 3})
    assert e.value.code == "bad_args"
    with pytest.raises(CommandError) as e:
        s.handle_command("lesson_load", {"lesson_id": "../etc"})
    assert e.value.code == "bad_args"
    with pytest.raises(CommandError) as e:
        s.handle_command("lesson_load", {"lesson_id": "missing"})
    assert e.value.code == "not_found"
    with pytest.raises(CommandError) as e:
        s.handle_command("nope", {})
    assert e.value.code == "bad_args"


def test_learn_flow_passes_and_advances(sess, schemas):
    s, clock = sess
    s.handle_command("lesson_load", {"lesson_id": fake.FAKE_LESSON_ID})
    s.handle_command("set_mode", {"mode": "learn"})
    msgs = s.drain()
    assert types(msgs, "lesson") and types(msgs, "session")
    assert types(msgs, "event", "step_started")
    assert s.step_index == 0
    # wrong pose: no pass, eventually a stuck event and a coach tip
    msgs = feed(s, clock, "right", fake.POSES[1][1], n=int(6 / 0.0333))
    assert not types(msgs, "event", "step_passed")
    assert types(msgs, "event", "stuck")
    tips = types(msgs, "coach")
    assert tips and tips[0]["kind"] == "tip" and "finger" in tips[0]["text"]
    for m in msgs:
        schemas.validate_message(m)
    # right pose: passes within about a second
    msgs = feed(s, clock, "right", fake.POSES[0][1], n=60)
    passed = types(msgs, "event", "step_passed")
    assert passed and passed[0]["data"]["step"] == 0 and passed[0]["hand"] == "right"
    assert types(msgs, "coach")[0]["kind"] == "praise"
    assert s.step_index == 1
    frame = s.tick(clock.now_us())
    assert frame["ghost"]["right"]["lesson_t"] == s.lesson.steps[1].key_t_us
    schemas.validate_message(frame)
    lines = [json.loads(l) for l in s.attempts_log.read_text().splitlines()]
    assert (
        lines
        and lines[-1]["passed"] is True
        and lines[-1]["lesson_id"] == fake.FAKE_LESSON_ID
    )
    for l in lines:
        schemas.validate(
            "step_summary",
            {k: v for k, v in l.items() if k not in ("t", "lesson_id", "mode")},
        )


def test_ghost_is_mirrored_for_opposite_hand(sess):
    s, clock = sess
    s.handle_command(
        "lesson_load", {"lesson_id": fake.FAKE_LESSON_ID}
    )  # master is the right hand
    s.handle_command("set_roles", {"left": "learner", "right": "free"})
    s.handle_command("set_mode", {"mode": "learn"})
    feed(s, clock, "left", fake.POSES[0][1], n=2)
    frame = s.tick(clock.now_us())
    g = np.asarray(frame["ghost"]["left"]["joints"])
    wrist = np.asarray(frame["ghost"]["left"]["wrist"]["p"])
    # the ghost's thumb must be on the left hand's thumb side (+X in the wrist frame; wrist q is identity here)
    assert (g[H.TIP["thumb"]] - wrist)[0] > 0
    assert frame["score"]["hand"] == "left"


def test_record_flow_makes_a_loadable_lesson(sess, schemas):
    s, clock = sess
    s.handle_command("set_roles", {"left": "free", "right": "master"})
    s.handle_command("set_mode", {"mode": "record"})
    with pytest.raises(CommandError) as e:
        s.handle_command("record_mark", {})
    assert e.value.code == "bad_state"
    feed(s, clock, "right", fake.POSES[0][1], n=2)
    s.handle_command("record_start", {"title": "Two shapes"})
    assert s.recorder.active and s.session_state()["recording"]
    assert types(s.drain(), "event", "recording_started")
    feed(s, clock, "right", fake.POSES[0][1], n=60)
    s.handle_command("record_mark", {})
    assert types(s.drain(), "event", "step_marked")
    feed(s, clock, "right", fake.POSES[1][1], n=60)
    res = s.handle_command("record_stop", {"save": True})
    msgs = s.drain()
    assert res["steps_total"] == 2 and res["lesson_id"].endswith("-two-shapes")
    stopped = types(msgs, "event", "recording_stopped")[0]
    assert stopped["data"]["lesson_id"] == res["lesson_id"]
    assert types(msgs, "lesson")
    for m in msgs:
        schemas.validate_message(m)
    # loaded as current lesson, learn mode works on it
    assert s.lesson.id == res["lesson_id"] and s.lesson.master_hand == "right"
    s.handle_command("set_roles", {"left": "free", "right": "learner"})
    s.handle_command("set_mode", {"mode": "learn"})
    s.drain()
    msgs = feed(s, clock, "right", fake.POSES[0][1], n=60)
    assert types(msgs, "event", "step_passed")
    # the hello lists it
    assert any(l["id"] == res["lesson_id"] for l in s.hello()["lessons"])
    # delete it
    s.handle_command("lesson_delete", {"lesson_id": res["lesson_id"]})
    assert s.lesson is None and s.mode == "idle"


def test_discard_recording(sess):
    s, clock = sess
    s.handle_command("set_mode", {"mode": "record"})
    feed(s, clock, "right", fake.POSES[0][1], n=2)
    s.handle_command("record_start", {})
    feed(s, clock, "right", fake.POSES[0][1], n=10)
    assert s.handle_command("record_stop", {"save": False}) == {"lesson_id": None}
    assert s.lesson is None


def test_button_and_pinch_controls(sess):
    s, clock = sess
    # idle + single press -> record mode and recording
    feed(s, clock, "right", fake.POSES[0][1], n=2)
    s.handle_button("right", "SinglePress")
    assert s.mode == "record" and s.recorder.active
    feed(s, clock, "right", fake.POSES[0][1], n=30)
    # control pinch held 500 ms marks a step
    msgs = feed(
        s, clock, "right", fake.POSES[0][1], n=20, pinch=s.cfg.session.control_pinch
    )
    assert types(msgs, "event", "step_marked")
    feed(s, clock, "right", fake.POSES[1][1], n=30)
    s.handle_button("right", "SinglePress")
    assert not s.recorder.active and s.lesson is not None and len(s.lesson.steps) == 2
    msgs = s.drain()
    assert types(msgs, "event", "button")
    # learn: single press = next step, double = prev, long = calibrate
    s.handle_command("set_mode", {"mode": "learn"})
    s.handle_button("right", "SinglePress")
    assert s.step_index == 1
    s.handle_button("right", "DoublePress")
    assert s.step_index == 0
    s.handle_button("right", "LongPress")
    assert s.calibrated
    assert types(s.drain(), "event", "calibrated")


def test_mirror_and_duel_and_playback(sess, schemas):
    s, clock = sess
    s.handle_command("lesson_load", {"lesson_id": fake.FAKE_LESSON_ID})
    s.handle_command("set_roles", {"left": "master", "right": "learner"})
    s.handle_command("set_mode", {"mode": "mirror"})
    for _ in range(20):
        clock.advance_us(33_333)
        for side in ("left", "right"):
            h = H.synth_hand(side=side, curl=fake.POSES[2][1], t_us=clock.now_us())
            H.finish_hand(h, s.cfg.hand)
            s.update_hand(side, h)
        frame = s.tick(clock.now_us())
    schemas.validate_message(frame)
    assert (
        frame["ghost"]["right"]["source"] == "live" and frame["score"]["overall"] > 0.95
    )
    s.drain()
    s.handle_command("set_mode", {"mode": "duel"})
    msgs = feed(s, clock, "right", fake.POSES[0][1], n=60)
    frame = s.tick(clock.now_us())
    assert "duel" in frame["task"] and frame["task"]["duel"]["wins"]["right"] >= 1
    assert types(msgs, "event", "round_won")
    schemas.validate_message(frame)
    s.drain()
    s.handle_command("set_mode", {"mode": "playback"})
    s.handle_command("set_tempo", {"factor": 1.5})
    f = None
    for _ in range(100):
        clock.advance_us(33_333)
        f = s.tick(clock.now_us())
    schemas.validate_message(f)
    assert f["ghost"]["right"]["placement"] == "recorded" and f["score"] is None
    assert s.step_index >= 1


def test_set_sources_switches_tolerances(sess):
    s, clock = sess
    s.handle_command("lesson_load", {"lesson_id": fake.FAKE_LESSON_ID})
    s.handle_command("set_sources", {"right": "camera"})
    s.handle_command("set_mode", {"mode": "learn"})
    assert s.scorers["right"].tol.perfect_deg == s.cfg.score.camera.perfect_deg
    assert s.session_state()["sources"]["right"] == "camera"


def test_chords_task_state(sess):
    s, clock = sess
    s.handle_command("lesson_load", {"lesson_id": fake.FAKE_LESSON_ID})
    s.handle_command("set_task", {"task": "chords", "config": {"chords": ["G", "C"]}})
    s.handle_command("set_mode", {"mode": "learn"})
    frame = s.tick(clock.now_us())
    assert frame["task"] == {"chord": "Open hand", "next": "Fist"}
    assert (
        s.handle_command("describe_task", {"text": "teach me a piano scale"})["task"]
        == "piano"
    )


def test_control_pinch_ignores_fist_and_other_hand(sess):
    s, clock = sess
    s.handle_command("lesson_load", {"lesson_id": fake.FAKE_LESSON_ID})
    s.handle_command("set_mode", {"mode": "learn"})
    s.drain()
    # a fist with the little "pinch" flag set must not restart the step
    msgs = feed(
        s, clock, "right", fake.POSES[1][1], n=30, pinch=s.cfg.session.control_pinch
    )
    assert not types(msgs, "event", "step_restarted")
    # the free left hand must not control the learner's step either
    msgs = feed(
        s, clock, "left", fake.POSES[0][1], n=30, pinch=s.cfg.session.control_pinch
    )
    assert not types(msgs, "event", "step_restarted")
    # the learner's open hand with the gesture does
    msgs = feed(
        s, clock, "right", fake.POSES[0][1], n=30, pinch=s.cfg.session.control_pinch
    )
    assert types(msgs, "event", "step_restarted")


def test_button_press_makes_that_glove_the_master(sess):
    """With no master role set, the pressed glove is the one recorded (slot-kit finding)."""
    s, clock = sess
    for _ in range(3):
        feed(s, clock, "left", fake.POSES[0][1], n=1)
        feed(s, clock, "right", fake.POSES[0][1], n=1)
    assert not s.sides_with_role("master")
    s.handle_button("right", "SinglePress")
    assert s.recorder.active and not s.sides_with_role("master")
    feed(s, clock, "right", fake.POSES[0][1], n=30)
    feed(s, clock, "right", fake.POSES[1][1], n=30)
    s.handle_button("right", "SinglePress")
    assert s.lesson is not None and s.lesson.master_hand == "right"
