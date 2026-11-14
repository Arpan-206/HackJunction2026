"""Typing task: chart, verdicts from synthetic presses, session wiring, --fake simulation, schema."""

import json
import re
from pathlib import Path

import numpy as np
import pytest

from core import fake
from core import hand as H
from core.clock import FakeClock
from core.coach import Coach
from core.session import CommandError, Session
from core.tasks.typing import CHART, TALLY_ROWS, TypingTask, normalize_key

ROOT = Path(__file__).resolve().parent.parent
DT = 10_000  # 100 Hz


def bump(t_us, t_press, peak=25.0, rise=60_000, hold=100_000):
    """Flexion offset of one press whose rise starts at t_press."""
    dt = t_us - t_press
    if dt <= 0:
        return 0.0
    if dt < rise:
        return peak * dt / rise
    if dt < rise + hold:
        return peak
    dt -= rise + hold
    return max(0.0, peak * (1 - dt / rise))


def run(task, presses, keys, t_end=1_500_000, rest=5.0, scale=None):
    """presses: [(side, finger, t_press_us)], keys: [(key, t_us)]. Feeds both hands at 100 Hz."""
    keys = sorted(keys, key=lambda k: k[1])
    out, t = [], 0
    scale = scale or {}
    while t <= t_end:
        while keys and keys[0][1] <= t:
            task.keystroke(*keys.pop(0))
        for side in ("left", "right"):
            a = np.full(18, rest)
            for s, f, tp in presses:
                if s == side:
                    a[H.FLEXION_SLOTS[f]] += bump(t, tp) * scale.get((s, f, tp), 1.0)
            task.feed(t, side, a)
        out += task.due(t)
        t += DT
    return out


def test_chart_covers_the_home_row_and_space():
    assert CHART["f"] == [("left", "index")]
    assert CHART["j"] == [("right", "index")]
    assert CHART["a"] == [("left", "little")]
    assert CHART[";"] == [("right", "little")]
    assert set(CHART[" "]) == {("left", "thumb"), ("right", "thumb")}
    assert normalize_key("F") == "f"
    assert normalize_key(":") == ";"
    assert normalize_key("Space") == " "
    assert normalize_key("Enter") is None
    assert normalize_key("é") is None
    # every letter has exactly one finger
    assert all(len(CHART[c]) == 1 for c in "abcdefghijklmnopqrstuvwxyz")


def test_right_finger_is_good(cfg):
    tt = TypingTask(cfg.piano)
    out = run(tt, [("right", "index", 500_000)], [("j", 560_000)])
    assert [v["verdict"] for v in out] == ["good"]
    assert out[0]["detected"] == {"hand": "right", "finger": "index"}
    assert out[0]["source"] == "press"
    assert tt.tally["right.index"]["good"] == 1


def test_wrong_finger(cfg):
    tt = TypingTask(cfg.piano)
    out = run(tt, [("right", "middle", 500_000)], [("j", 560_000)])
    assert out[0]["verdict"] == "wrong_finger"
    assert out[0]["detected"] == {"hand": "right", "finger": "middle"}
    assert tt.tally["right.index"]["wrong_finger"] == 1


def test_wrong_hand_is_wrong_finger(cfg):
    tt = TypingTask(cfg.piano)
    out = run(tt, [("left", "index", 500_000)], [("j", 560_000)])
    assert out[0]["verdict"] == "wrong_finger"
    assert out[0]["detected"]["hand"] == "left"


def test_no_motion_is_unclear(cfg):
    tt = TypingTask(cfg.piano)
    out = run(tt, [], [("f", 560_000)])
    assert out[0]["verdict"] == "unclear"
    assert out[0]["reason"] == "no_press"
    assert out[0]["detected"] is None


def test_two_fingers_alike_is_unclear(cfg):
    tt = TypingTask(cfg.piano)
    out = run(
        tt,
        [("left", "index", 500_000), ("left", "middle", 500_000)],
        [("f", 560_000)],
    )
    assert out[0]["verdict"] == "unclear"
    assert out[0]["reason"] == "ambiguous"


def test_sympathetic_neighbour_does_not_spoil_a_clear_press(cfg):
    tt = TypingTask(cfg.piano)
    presses = [("left", "index", 500_000), ("left", "middle", 500_000)]
    out = run(
        tt, presses, [("f", 560_000)], scale={("left", "middle", 500_000): 0.4}
    )
    assert out[0]["verdict"] == "good"


def test_press_outside_the_window_does_not_count(cfg):
    tt = TypingTask(cfg.piano)
    out = run(tt, [("left", "index", 100_000)], [("f", 900_000)])
    assert out[0]["verdict"] == "unclear"


def test_space_takes_either_thumb(cfg):
    tt = TypingTask(cfg.piano)
    out = run(
        tt,
        [("left", "thumb", 300_000), ("right", "thumb", 900_000)],
        [(" ", 360_000), (" ", 960_000)],
    )
    assert [v["verdict"] for v in out] == ["good", "good"]
    assert tt.tally["both.thumb"]["good"] == 2


def test_a_sequence_of_words(cfg):
    tt = TypingTask(cfg.piano)
    text = "sad lads"
    presses, keys = [], []
    for i, ch in enumerate(text):
        tp = 300_000 + i * 400_000
        side, finger = CHART[ch][0]
        presses.append((side, finger, tp))
        keys.append((ch, tp + 60_000))
    out = run(tt, presses, keys, t_end=300_000 + len(text) * 400_000 + 500_000)
    assert [v["key"] for v in out] == list(text)
    assert all(v["verdict"] == "good" for v in out), out
    assert tt.state()["totals"] == {"good": len(text), "wrong_finger": 0, "unclear": 0}


@pytest.fixture
def sess(cfg, tmp_path):
    clock = FakeClock()
    coach = Coach(None, cfg.coach, cfg.score.timing_hint_ms)
    s = Session(cfg, clock, tmp_path, coach, fake=True)
    s.attempts_log = tmp_path / "attempts.jsonl"
    return s, clock


def tick_hands(s, clock, curls, n=1, dt_us=33_333):
    for _ in range(n):
        clock.advance_us(dt_us)
        for side in ("left", "right"):
            h = H.synth_hand(side=side, curl=curls(side, clock.now_us()), t_us=clock.now_us(), device_id=2)
            H.finish_hand(h, s.cfg.hand)
            s.update_hand(side, h)
        s.tick(clock.now_us())
    return s.drain()


def test_session_keystroke_end_to_end(sess, schemas):
    s, clock = sess
    with pytest.raises(CommandError):
        s.handle_command("keystroke", {"key": "f"})
    s.handle_command("set_task", {"task": "typing"})
    s.drain()
    tick_hands(s, clock, lambda side, t: {}, n=10)
    t_press = clock.now_us() + 100_000

    def curls(side, t):
        if side != "left":
            return {}
        return {"index": bump(t, t_press, peak=40.0) / 90.0}

    tick_hands(s, clock, curls, n=3)
    ack = s.handle_command("keystroke", {"key": "F"})
    assert ack["key"] == "f"
    msgs = tick_hands(s, clock, curls, n=15)
    evs = [m for m in msgs if m["type"] == "event" and m["name"] == "keystroke"]
    assert len(evs) == 1, evs
    schemas.validate_message(evs[0])
    assert evs[0]["data"]["verdict"] == "good"
    assert evs[0]["hand"] == "left"
    frame = s.tick(clock.now_us())
    schemas.validate_message(frame)
    assert frame["task"]["tally"]["left.index"]["good"] == 1
    s.handle_command("typing_reset", {})
    assert s.tick(clock.now_us())["task"]["totals"]["good"] == 0
    with pytest.raises(CommandError):
        s.handle_command("keystroke", {"key": "Enter"})


def test_fake_simulation_drives_the_screen(sess, schemas):
    s, clock = sess
    s.handle_command("set_task", {"task": "typing", "config": {"simulate": True, "sim_seed": 3}})
    tick_hands(s, clock, lambda side, t: {}, n=10)
    text = "asdf jkl; " * 4
    verdicts = []
    for ch in text:
        s.handle_command("keystroke", {"key": ch})
        msgs = tick_hands(s, clock, lambda side, t: {}, n=12)
        verdicts += [m["data"]["verdict"] for m in msgs if m["type"] == "event" and m["name"] == "keystroke"]
    assert len(verdicts) == len(text)
    assert verdicts.count("good") >= len(text) * 0.6
    assert "wrong_finger" in verdicts
    assert s.tick(clock.now_us())["task"]["simulated"] is True


def test_simulate_is_ignored_without_fake(cfg):
    tt = TypingTask(cfg.piano, {"simulate": True}, fake=False)
    assert tt.simulate is False


def test_schema_lists_the_commands_and_event(schemas):
    assert "keystroke" in schemas.get("cmd")["properties"]["name"]["enum"]
    assert "typing_reset" in schemas.get("cmd")["properties"]["name"]["enum"]
    assert "keystroke" in schemas.get("event")["properties"]["name"]["enum"]


def test_frontend_chart_matches_the_core():
    """The screen's chart (frontend/src/features/typing/chart.ts) must say what the core judges."""
    ts = (ROOT / "frontend/src/features/typing/chart.ts").read_text()
    ts = ts.split("FINGER_KEYS", 1)[1].split("};", 1)[0]
    rows = dict(re.findall(r"'(left\.\w+|right\.\w+)':\s*'((?:[^'\\]|\\.)*)'", ts))
    rows = {k: v.replace("\\\\", "\\").replace("\\'", "'") for k, v in rows.items()}
    from core.tasks.typing import CHART_ROWS

    assert rows == {f"{s}.{f}": keys for (s, f), keys in CHART_ROWS.items()}
    assert set(TALLY_ROWS) == set(rows) | {"both.thumb"}


def test_accuracy_tool_on_the_real_capture(tmp_path):
    """Pipeline check on the worn capture: it holds whole-hand moves, not typing, so presses come out unclear."""
    from tools import typing_accuracy

    cap = ROOT / "backend/tests/fixtures/rgmp/worn_solver.rgmp.gz"
    if not cap.exists():
        pytest.skip("capture fixture absent")
    out = tmp_path / "rep.json"
    assert typing_accuracy.main([str(cap), "--synth", "--json", str(out)]) == 0
    rep = json.loads(out.read_text())
    assert rep["synthetic"] is True
    assert rep["total"]["keys"] == len(rep["verdicts"]) > 0


def test_accuracy_report_counts():
    from tools.typing_accuracy import report

    vs = [
        {"key": "f", "verdict": "good", "detected": {"hand": "left", "finger": "index"}},
        {"key": "f", "verdict": "wrong_finger", "detected": {"hand": "left", "finger": "middle"}},
        {"key": "j", "verdict": "unclear", "detected": None},
    ]
    rep = report(vs)
    assert rep["rows"]["left.index"]["match_rate"] == 0.5
    assert rep["total"]["clear_rate"] == round(2 / 3, 3)
    assert rep["confusion"] == {"left.index": {"left.middle": 1}}


def test_accuracy_tool_with_a_key_log(tmp_path, monkeypatch):
    """A keystroke log against a synthetic capture: the tool's replay must find the right fingers."""
    from tools import typing_accuracy as ta

    class FakeHand:
        def __init__(self, t, angles):
            self.t_us, self.angles, self.tracked = t, angles, True

    t0 = 1_700_000_000_000_000
    presses = [("left", "index", 300_000), ("right", "index", 800_000), ("right", "middle", 1_300_000)]
    hands = {"left": [], "right": []}
    for i in range(0, 2_000_000, 10_000):
        for side in ("left", "right"):
            a = np.full(18, 5.0)
            for s, f, tp in presses:
                if s == side:
                    a[H.FLEXION_SLOTS[f]] += bump(i, tp)
            hands[side].append(FakeHand(t0 + i, a))
    monkeypatch.setattr(ta, "load_hands", lambda cfg, path: hands)
    log = tmp_path / "keys.jsonl"
    log.write_text('{"t_ms": 360, "key": "f"}\n{"t_ms": 860, "key": "j"}\n{"t_ms": 1360, "key": "j"}\n')
    out = tmp_path / "rep.json"
    assert ta.main(["x.rgmp", "--keys", str(log), "--json", str(out)]) == 0
    rep = json.loads(out.read_text())
    assert [v["verdict"] for v in rep["verdicts"]] == ["good", "good", "wrong_finger"]
    assert rep["total"]["match_rate"] == round(2 / 3, 3)
