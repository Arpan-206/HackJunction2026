import numpy as np
import pytest

from core import fake
from core import hand as H
from core.coach import Coach, RuleCoach
from core.recorder import Lesson, Recorder, list_lessons
from core.scorer import (
    MirrorScorer,
    StepScorer,
    Tolerances,
    dtw_path_costs,
    score_frame,
)


def tol(cfg):
    return Tolerances(cfg.score.perfect_deg, cfg.score.wrong_deg)


# SPEC.md's own numbers, for the tests that pin the scoring formula; config.toml carries the tuned 15 / 60.
SPEC_TOL = Tolerances(8, 45)


def test_identical_hands_score_one(cfg):
    a = H.angle_features(H.synth_joints({"index": 0.5, "thumb": 0.3}))
    fs, _, _ = score_frame("right", a, a, {f: 1.0 for f in H.FINGERS}, tol(cfg))
    assert fs.overall == 1.0 and all(v == 1.0 for v in fs.fingers.values())
    assert fs.hint is None


def test_45_degree_offset_scores_zero_on_that_finger(cfg):
    a = H.angle_features(H.synth_joints({}))
    b = a.copy()
    for s in H.FLEXION_SLOTS["index"] + H.FINGER_SPREAD_SLOTS["index"]:
        b[s] += 45.0
    fs, _, _ = score_frame("right", b, a, {f: 1.0 for f in H.FINGERS}, SPEC_TOL)
    assert fs.fingers["index"] == 0.0
    assert fs.worst == "index" and fs.hint == "too_curled"
    assert fs.fingers["ring"] == 1.0 and fs.fingers["little"] == 1.0
    assert 0 < fs.overall < 1


def test_hint_directions(cfg):
    a = H.angle_features(H.synth_joints({"index": 0.5}))
    flat = a.copy()
    flat[H.FLEXION_SLOTS["index"]] -= 30
    fs, _, _ = score_frame("right", flat, a, {}, SPEC_TOL)
    assert fs.worst == "index" and fs.hint == "too_flat"
    # spread slots are shared half and half, so push both of the middle finger's
    spread = a.copy()
    spread[[15, 16]] += 60
    fs, _, _ = score_frame("right", spread, a, {}, SPEC_TOL)
    assert fs.worst == "middle" and fs.hint == "too_spread"
    closed = a.copy()
    closed[[15, 16]] -= 60
    fs, _, _ = score_frame("right", closed, a, {}, SPEC_TOL)
    assert fs.hint == "too_closed"


def test_under_8_degrees_is_perfect(cfg):
    a = np.zeros(18)
    b = a + 7.9
    fs, _, _ = score_frame("right", b, a, {}, SPEC_TOL)
    assert fs.overall == 1.0


@pytest.fixture
def fake_lesson(cfg, tmp_path):
    return fake.build_fake_lesson(cfg, tmp_path)


def test_fake_lesson_has_four_hold_steps_and_validates(
    cfg, schemas, fake_lesson, tmp_path
):
    lesson = fake_lesson
    assert len(lesson.steps) == 4
    assert all(s.kind == "hold" for s in lesson.steps), [s.kind for s in lesson.steps]
    schemas.validate("lesson", lesson.to_json())
    reloaded = Lesson.load(tmp_path / fake.FAKE_LESSON_ID)
    assert all(s.frame == f"frames/step_{s.index:02d}.jpg" for s in reloaded.steps)
    assert (
        tmp_path / fake.FAKE_LESSON_ID / "frames" / "step_03.jpg"
    ).stat().st_size > 1000
    assert reloaded.trace is not None and reloaded.trace.angles.shape[1] == 18
    assert reloaded.trace.joints.shape[1:] == (26, 3)
    assert len(list_lessons(tmp_path)) == 1
    # key poses match the pose table
    for s, (_, curl) in zip(reloaded.steps, fake.POSES):
        expect = H.angle_features(H.synth_joints(curl))
        assert np.allclose(s.key_angles, expect, atol=2.0), (
            s.name,
            s.key_angles - expect,
        )


def test_auto_boundaries_find_still_poses(cfg):
    rec = Recorder(cfg.record, 500)
    rec.start(0, "auto", "general", {}, "right")
    rate = 83.33
    n = int(11.0 * rate)
    for i in range(n):
        t_s = i / rate
        curl, _ = fake.fake_master_curl(t_s, hold_s=2.0, move_s=1.0)
        h = H.synth_hand(curl=curl, t_us=int(t_s * 1e6))
        rec.add(h)
    lesson = rec.stop(int(11.0 * 1e6), save=True, lesson_id="auto-test")
    assert lesson is not None
    assert len(lesson.steps) == 4, [(s.t0_us, s.t1_us) for s in lesson.steps]
    assert all(s.kind == "hold" for s in lesson.steps)


def test_no_marks_no_stillness_gives_one_move_step(cfg):
    rec = Recorder(cfg.record, 500)
    rec.start(0, "wave", "general", {}, "right")
    rate = 60.0
    for i in range(int(4 * rate)):
        t_s = i / rate
        curl = {
            f: 0.5 + 0.5 * np.sin(2 * np.pi * t_s / 1.5 + k)
            for k, f in enumerate(H.FINGERS)
        }
        rec.add(H.synth_hand(curl=curl, t_us=int(t_s * 1e6)))
    lesson = rec.stop(int(4e6), save=True, lesson_id="wave")
    assert len(lesson.steps) == 1 and lesson.steps[0].kind == "move"


def test_hold_step_passes_after_hold_ms(cfg, fake_lesson):
    step = fake_lesson.steps[1]  # fist
    sc = StepScorer("right", fake_lesson, step, cfg.score, tol(cfg))
    sc.reset_attempt(0)
    fist = H.angle_features(H.synth_joints(fake.POSES[1][1]))
    flat = H.angle_features(H.synth_joints(fake.POSES[0][1]))
    t = 0
    fs = None
    for _ in range(20):  # 20 frames of the wrong pose: no progress
        t += 33_333
        fs = sc.update(t, flat, None)
    assert not fs.passed and fs.step_progress == 0.0 and fs.overall < 0.5
    passed_at = None
    for i in range(60):
        t += 33_333
        fs = sc.update(t, fist, None)
        if fs.passed:
            passed_at = i
            break
    assert fs.passed and fs.timing_ms is None
    # EMA (150 ms) must first climb above 0.85, then hold 500 ms: well under 2 s
    assert passed_at is not None and 15 <= passed_at <= 45, passed_at
    assert fs.step_progress == 1.0


def test_move_step_timing_and_pass(cfg):
    # Build a one-step move lesson from a wave, then play the learner through it.
    rec = Recorder(cfg.record, 500)
    rec.start(0, "wave", "general", {}, "right")
    rate = 83.33

    def curl_at(t_s):
        return {
            f: 0.5 + 0.45 * np.sin(2 * np.pi * t_s / 2.0 + 0.7 * k)
            for k, f in enumerate(H.FINGERS)
        }

    for i in range(int(4 * rate)):
        t_s = i / rate
        rec.add(H.synth_hand(curl=curl_at(t_s), t_us=int(t_s * 1e6)))
    lesson = rec.stop(int(4e6), save=True, lesson_id="wave")
    step = lesson.steps[0]
    assert step.kind == "move"
    sc = StepScorer("right", lesson, step, cfg.score, tol(cfg))
    sc.reset_attempt(0)
    t = 0
    timings = []
    while t < step.t1_us:
        t += 33_333
        ghost_t = t
        learner = H.angle_features(
            H.synth_joints(curl_at((t + 100_000) / 1e6))
        )  # 100 ms ahead
        fs = sc.update(t, learner, ghost_t)
        if fs.timing_ms is not None:
            timings.append(fs.timing_ms)
    assert fs.passed, (sc.mean_overall, fs.step_progress)
    med = float(np.median(timings[5:]))
    assert -160 < med < -40, med  # negative = early


def test_move_step_fails_when_learner_is_wrong(cfg):
    rec = Recorder(cfg.record, 500)
    rec.start(0, "wave", "general", {}, "right")
    for i in range(240):
        t_s = i / 60
        curl = {
            f: 0.5 + 0.45 * np.sin(2 * np.pi * t_s / 2.0 + k)
            for k, f in enumerate(H.FINGERS)
        }
        rec.add(H.synth_hand(curl=curl, t_us=int(t_s * 1e6)))
    lesson = rec.stop(int(4e6), save=True, lesson_id="wave")
    step = lesson.steps[0]
    sc = StepScorer("right", lesson, step, cfg.score, tol(cfg))
    sc.reset_attempt(0)
    wrong = H.angle_features(H.synth_joints({f: 1.0 for f in H.FINGERS}))
    t = 0
    while t < step.t1_us + 40_000:
        t += 33_333
        fs = sc.update(t, wrong, min(t, step.t1_us))
    assert not fs.passed and sc.move_step_finished(step.t1_us)
    s = sc.summary(t, "general", "wave", stuck=False)
    assert s["passed"] is False and s["attempt"] == 1 and s["worst_at_ms"] is not None
    assert len(s["fingers"]) >= 1


def test_summary_validates_against_schema(cfg, schemas, fake_lesson):
    step = fake_lesson.steps[2]
    sc = StepScorer("right", fake_lesson, step, cfg.score, tol(cfg))
    sc.reset_attempt(0)
    flat = H.angle_features(H.synth_joints({}))
    t = 0
    for _ in range(200):
        t += 33_333
        sc.update(t, flat, None)
    assert sc.stuck_due(t)
    s = sc.summary(t, "general", fake_lesson.title, stuck=True)
    schemas.validate("step_summary", s)
    assert s["stuck_s"] >= cfg.score.stuck_s
    assert "index" not in s["fingers"]  # pointing step: index is straight in both poses
    assert s["fingers"]["middle"]["hint"] == "too_flat"


def test_rule_coach_lines(cfg):
    rc = RuleCoach(cfg.score.timing_hint_ms)
    line = rc.tip(
        {
            "step": {"index": 1},
            "passed": False,
            "timing_ms": None,
            "fingers": {
                "ring": {"score": 0.3, "err_deg": 34, "hint": "too_flat"},
                "index": {"score": 0.8, "err_deg": 15, "hint": None},
            },
        }
    )
    assert (
        line.text == "Curl your ring finger more."
        and line.focus == "ring"
        and line.kind == "tip"
    )
    assert (
        rc.tip({"step": {"index": 0}, "passed": True, "fingers": {}}).text
        == "Good. Next step."
    )
    assert rc.tip(
        {"step": {"index": 0}, "passed": False, "timing_ms": -200, "fingers": {}}
    ).text.startswith("Slow down")
    assert (
        rc.tip(
            {"step": {"index": 0}, "passed": False, "timing_ms": 200, "fingers": {}}
        ).text
        == "A little faster."
    )
    assert (
        rc.tip(
            {"step": {"index": 0}, "passed": False, "timing_ms": None, "fingers": {}}
        )
        is None
    )
    assert rc.configure("teach me a guitar chord", ["general", "chords"]) == {
        "task": "chords",
        "config": {},
    }


def test_coach_rate_limit(cfg, schemas):
    coach = Coach(None, cfg.coach, cfg.score.timing_hint_ms)
    summary = {
        "hand": "right",
        "step": {"index": 0},
        "passed": False,
        "timing_ms": None,
        "fingers": {"ring": {"score": 0.3, "err_deg": 34, "hint": "too_flat"}},
    }
    l1 = coach.on_summary(0, summary)
    assert l1 is not None and l1.id == "k-1"
    assert coach.on_summary(1_000_000, summary) is None  # within 4 s: queued
    assert coach.pending["right"] is summary
    l3 = coach.on_summary(int(4.1e6), summary)
    assert l3 is not None and l3.id == "k-2" and not coach.pending
    msg = {"v": 1, "type": "coach", "t": 5, **l3.to_message()}
    schemas.validate("coach", msg)


def test_mirror_scorer(cfg):
    ms = MirrorScorer("left", cfg.score, tol(cfg), cfg.session.mirror_delay_ms)

    def curl_at(t_s):
        return {
            f: 0.5 + 0.4 * np.sin(2 * np.pi * t_s / 2.0 + k)
            for k, f in enumerate(H.FINGERS)
        }

    t = 0
    fs = None
    for i in range(120):
        t += 33_333
        ms.push_master(t, H.angle_features(H.synth_joints(curl_at(t / 1e6))))
        # learner copies the master with the expected 300 ms reaction delay
        fs = ms.update(
            t, H.angle_features(H.synth_joints(curl_at((t - 300_000) / 1e6)))
        )
    assert fs is not None and fs.overall > 0.95 and abs(fs.timing_ms) <= 40


def test_dtw_small():
    a = np.array([[0.0], [1.0], [2.0], [3.0]])
    b = np.array([[0.0], [1.0], [1.0], [2.0], [3.0]])
    c = dtw_path_costs(a, b)
    assert c is not None and c.shape == (4,) and np.all(c < 1e-9)


def test_coach_model_call_never_blocks_the_tick(cfg):
    """A slow model client runs off the tick; its line lands on a later poll; a failing one falls back to rules."""
    import time
    from core.coach import CoachClient, CoachLine

    class SlowClient:
        def __init__(self, delay, fail=False):
            self.delay, self.fail = delay, fail
        def tip(self, summary):
            time.sleep(self.delay)
            if self.fail:
                raise RuntimeError("model down")
            return CoachLine("tip", "Model says: curl it.", "ring", 0, True, "gemma", hand=summary.get("hand"))
        def name_steps(self, lesson_json, digests): return None
        def configure(self, text, task_names): return None
        def phrase_question(self, context): return None

    summary = {"hand": "right", "step": {"index": 0}, "passed": False, "timing_ms": None,
               "fingers": {"ring": {"score": 0.3, "err_deg": 34, "hint": "too_flat"}}}
    coach = Coach(SlowClient(0.3), cfg.coach, cfg.score.timing_hint_ms)
    t0 = time.perf_counter()
    assert coach.on_summary(0, summary) is None
    assert time.perf_counter() - t0 < 0.05            # returned at once
    assert coach.poll(10_000) == []                   # not ready yet
    time.sleep(0.45)
    lines = coach.poll(500_000)
    assert len(lines) == 1 and lines[0].source == "gemma" and lines[0].text.startswith("Model says")
    # a failing model call gives the rule line, still off the tick
    coach = Coach(SlowClient(0.05, fail=True), cfg.coach, cfg.score.timing_hint_ms)
    assert coach.on_summary(0, summary) is None
    time.sleep(0.2)
    lines = coach.poll(300_000)
    assert len(lines) == 1 and lines[0].source == "rule" and lines[0].text == "Curl your ring finger more."
