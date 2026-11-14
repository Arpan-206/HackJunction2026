import numpy as np

from core import hand as H
from core.clock import FakeClock
from core.coach import Coach
from core.session import Session
from core.tasks.piano import PianoTask, PressDetector


def angles_with_mcp(finger, deg):
    a = np.zeros(18)
    a[H.FLEXION_SLOTS[finger][0]] = deg
    return a


def press_curve(
    detector, finger, t0, rise_ms=60, hold_ms=150, peak=30.0, rest=5.0, dt_ms=10
):
    events, t = [], t0
    # rest
    for _ in range(20):
        events += detector.update(t, angles_with_mcp(finger, rest))
        t += dt_ms * 1000
    # fast rise
    n = rise_ms // dt_ms
    for i in range(1, n + 1):
        events += detector.update(
            t, angles_with_mcp(finger, rest + (peak - rest) * i / n)
        )
        t += dt_ms * 1000
    for _ in range(hold_ms // dt_ms):
        events += detector.update(t, angles_with_mcp(finger, peak))
        t += dt_ms * 1000
    for i in range(n, -1, -1):
        events += detector.update(
            t, angles_with_mcp(finger, rest + (peak - rest) * i / n)
        )
        t += dt_ms * 1000
    return events, t


def test_press_detector_fast_rise_is_a_press(cfg):
    d = PressDetector(cfg.piano)
    events, _ = press_curve(d, "index", 0)
    assert events == [("index", "down"), ("index", "up")]


def test_press_detector_slow_rise_is_not_a_press(cfg):
    d = PressDetector(cfg.piano)
    events, _ = press_curve(d, "index", 0, rise_ms=2000, dt_ms=20)
    assert events == []


def test_press_detector_small_twitch_is_not_a_press(cfg):
    d = PressDetector(cfg.piano)
    events, _ = press_curve(d, "ring", 0, peak=12.0)  # only 7 degrees past rest
    assert events == []


def test_note_verdicts(cfg):
    piece = {
        "tempo_bpm": 60,
        "notes": [
            {"beat": 0.5, "finger": "thumb", "midi": 60},
            {"beat": 1.5, "finger": "index", "midi": 62},
            {"beat": 2.5, "finger": "middle", "midi": 64},
            {"beat": 3.5, "finger": "ring", "midi": 65},
        ],
    }
    pt = PianoTask(cfg.piano, piece, 0, loop=False)
    out = []
    t = 0

    def feed_until(t_end, angles=None):
        nonlocal t
        while t < t_end:
            out.extend(pt.update(t, angles if angles is not None else np.zeros(18)))
            t += 10_000

    def press(finger, at_us):
        feed_until(at_us - 100_000)
        ev, t2 = press_curve(pt.detector, finger, t, rise_ms=50, hold_ms=50)
        # route the detector events through the task by replaying the same curve on a fresh detector is awkward;
        # instead feed the curve through pt.update directly

    # thumb exactly on time (beat 0.5 at 60 bpm = 500 ms)
    feed_until(380_000)
    ev, t = _press_through(pt, "thumb", t)
    verdicts = [d for n, d in ev if n == "note"]
    assert (
        verdicts
        and verdicts[0]["verdict"] == "good"
        and verdicts[0]["finger"] == "thumb"
    )
    # index 200 ms late (beat 1.5 = 1500 ms; press lands around 1700)
    feed_until(1_580_000)
    ev, t = _press_through(pt, "index", t)
    assert [d["verdict"] for n, d in ev if n == "note"] == ["late"]
    # middle expected at 2500 ms, ring pressed instead
    feed_until(2_380_000)
    ev, t = _press_through(pt, "ring", t)
    assert [d["verdict"] for n, d in ev if n == "note"] == ["wrong_finger"]
    # ring at 3500 ms never pressed -> miss after near_ms
    feed_until(4_000_000)
    assert [d["verdict"] for n, d in out if n == "note"][-1] == "miss"
    st = pt.state(t)
    assert st["next"] == [] and st["last"]["verdict"] == "miss"


def _press_through(
    pt, finger, t, rise_ms=60, hold_ms=100, peak=30.0, rest=0.0, dt_ms=10
):
    """Feed a press curve through the task; the detector was at rest 0 from the zeros fed before."""
    events = []
    n = rise_ms // dt_ms
    for i in range(1, n + 1):
        events += pt.update(t, angles_with_mcp(finger, rest + (peak - rest) * i / n))
        t += dt_ms * 1000
    for _ in range(hold_ms // dt_ms):
        events += pt.update(t, angles_with_mcp(finger, peak))
        t += dt_ms * 1000
    for i in range(n, -1, -1):
        events += pt.update(t, angles_with_mcp(finger, rest + (peak - rest) * i / n))
        t += dt_ms * 1000
    return events, t


def test_session_piano_task_state_and_events(cfg, tmp_path, schemas):
    clock = FakeClock()
    s = Session(
        cfg,
        clock,
        tmp_path,
        Coach(None, cfg.coach, cfg.score.timing_hint_ms),
        fake=True,
    )
    s.attempts_log = tmp_path / "a.jsonl"
    s.handle_command(
        "set_task",
        {
            "task": "piano",
            "config": {
                "tempo_bpm": 120,
                "notes": [{"beat": 1, "finger": "index", "midi": 62}],
            },
        },
    )
    assert s.piano is not None
    s.drain()
    # feed a hand that presses the index at about beat 1 (500 ms at 120 bpm)
    t = clock.now_us()

    def hand(curl_index):
        h = H.synth_hand(side="right", curl={"index": curl_index}, t_us=clock.now_us())
        H.finish_hand(h, cfg.hand)
        return h

    frames = []
    for i in range(80):
        clock.advance_us(10_000)
        el = clock.now_us() - t
        c = (
            0.0
            if el < 450_000
            else (
                min(1.0, (el - 450_000) / 60_000) * 0.5
                if el < 650_000
                else max(0.0, 0.5 - (el - 650_000) / 60_000 * 0.5)
            )
        )
        s.update_hand("right", hand(c))
        frames.append(s.tick(clock.now_us()))
    msgs = s.drain()
    names = [m["name"] for m in msgs if m["type"] == "event"]
    assert "finger_down" in names and "note" in names
    note = next(m for m in msgs if m["type"] == "event" and m["name"] == "note")
    assert note["data"]["finger"] == "index" and note["data"]["verdict"] in (
        "good",
        "early",
        "late",
    )
    for m in msgs:
        schemas.validate_message(m)
    f = frames[-1]
    assert set(f["task"]) >= {"beat", "next", "down", "last"}
    schemas.validate_message(f)
