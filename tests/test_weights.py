"""Per-finger step weights: takes, task chart, calibration, and the scorer honouring them (STATUS-weights.md)."""

import json

import numpy as np
import pytest

from core import hand as H
from core.calibration import angles_to_triples, load_hand
from core.clock import FakeClock
from core.coach import Coach
from core.config import load_config
from core.recorder import (
    Lesson,
    Recorder,
    chart_fingers,
    consistency_weights,
    reweight_lesson,
    step_weights,
    take_groups,
)
from core.scorer import StepScorer, Tolerances, focus_fingers, score_frame
from core.session import Session
from tests.conftest import ROOT
from tests.test_calibration import FIST, FLAT, raw_angles, write_range

ONES = {f: 1.0 for f in H.FINGERS}

# Arpan's real range calibrations from the glove slot (backend/data/calibrations,
# Sat 14 Nov): the right thumb reads less bent in the fist than flat, and the
# left ring and little MCP do too. Radians, backend triples.
REAL_RIGHT = {
    "flat": {"thumb": [0.9129, 0.8876, 0.2603], "index": [0.8082, 0.293, 0.1962], "middle": [0.5602, 0.8699, 0.5828], "ring": [0.3921, 1.0903, 0.7319], "little": [0.3146, 0.8156, 0.5462]},
    "fist": {"thumb": [1.1208, 0.4842, 0.1908], "index": [1.4608, 1.423, 0.9574], "middle": [1.7345, 1.345, 0.9032], "ring": [1.8115, 1.37, 0.9207], "little": [1.7811, 1.2779, 0.8594]},
}  # fmt: skip
REAL_LEFT = {
    "flat": {"thumb": [0.6999, 0.853, 0.1325], "index": [0.9739, 0.5003, 0.3335], "middle": [0.9098, 0.5769, 0.3855], "ring": [0.8473, 0.5343, 0.3574], "little": [0.7829, 0.5529, 0.3687]},
    "fist": {"thumb": [0.7904, 1.0453, 0.5414], "index": [1.2445, 0.5945, 0.3963], "middle": [0.9606, 0.7114, 0.4757], "ring": [0.704, 0.6886, 0.46], "little": [0.6133, 0.6769, 0.4527]},
}  # fmt: skip


def pose(curl: dict) -> np.ndarray:
    return H.angle_features(H.synth_joints(curl))


def tol(cfg):
    return Tolerances(cfg.score.perfect_deg, cfg.score.wrong_deg)


@pytest.fixture
def ccfg(tmp_path):
    c = load_config(ROOT / "config.toml")
    c.calibration.data_dir = str(tmp_path / "data")
    c.calibration.enabled = True
    return c


# -- (a) consistency across takes ---------------------------------------------


def test_a_finger_the_master_varies_across_takes_loses_weight(cfg):
    base = {"thumb": 0.3, "index": 0.8, "middle": 0.8, "ring": 0.5, "little": 0.5}
    takes = []
    for ring in (0.1, 0.5, 0.9):  # the ring wanders; every other finger is the same
        takes.append(pose({**base, "ring": ring}))
    w, sd = consistency_weights(takes, 6.0, 20.0, 0.2)
    assert w["ring"] == pytest.approx(0.2)
    assert sd["ring"] > 20
    for f in ("thumb", "index", "middle", "little"):
        assert w[f] == pytest.approx(1.0)
    one, _ = consistency_weights(takes[:1], 6.0, 20.0, 0.2)
    assert one == ONES


def test_take_groups_by_pose_and_by_declared_repeats():
    fist, flat = pose({f: 0.9 for f in H.FINGERS}), pose({f: 0.05 for f in H.FINGERS})
    fist2 = pose({**{f: 0.9 for f in H.FINGERS}, "index": 0.85})
    assert take_groups([fist, flat, fist2], 12.0) == [[0, 2], [1]]
    # declared: 4 steps = 2 takes of a 2-step sequence
    assert take_groups([fist, flat, fist, flat], 12.0, takes=2) == [[0, 2], [1, 3]]
    # not divisible: fall back to pose grouping
    assert take_groups([fist, flat, fist], 0.5, takes=2) == [[0, 2], [1]]


# -- (b) the task's chart -------------------------------------------------------


def test_typing_chart_names_the_finger_per_key():
    cfgk = {"keys": ["j", "f", "Space", "p"]}
    assert chart_fingers("typing", cfgk, 0, "right") == ["index"]
    assert chart_fingers("typing", cfgk, 1, "right") is None  # f is a left-hand key
    assert chart_fingers("typing", cfgk, 1, "left") == ["index"]
    assert chart_fingers("typing", cfgk, 2, "right") == ["thumb"]
    assert chart_fingers("typing", cfgk, 3, "right") == ["little"]
    assert chart_fingers("typing", {"text": "ok"}, 1, "right") == ["middle"]
    assert chart_fingers("piano", {"notes": [{"beat": 0, "finger": "ring"}]}, 0, "right") == ["ring"]
    assert chart_fingers("general", {"fingers": [["thumb", "index"]]}, 0, "left") == ["thumb", "index"]
    assert chart_fingers("general", {}, 0, "left") is None


def test_step_weights_multiply_static_consistency_chart_and_calibration(cfg):
    rec = Recorder(cfg.record, 500)
    a = pose({"thumb": 0.2, "index": 0.9, "middle": 0.2, "ring": 0.2, "little": 0.2})
    b = pose({"thumb": 0.2, "index": 0.2, "middle": 0.9, "ring": 0.2, "little": 0.2})

    class S:  # the two fields step_weights reads
        def __init__(self, i, k):
            self.index, self.key_angles = i, k

    steps = [S(0, a), S(1, b)]
    static = {f: 1.0 for f in H.FINGERS} | {"little": 0.5}
    usable = {f: 1.0 for f in H.FINGERS} | {"thumb": 0.0}
    out = step_weights(steps, "typing", {"keys": ["j", "k"]}, "right", static, rec.cfg, usable)
    w0, src0 = out[0]
    assert w0 == {"thumb": 0.0, "index": 1.0, "middle": 0.2, "ring": 0.2, "little": 0.1}
    assert src0["chart"] == ["index"] and src0["takes"] == 1
    assert out[1][0]["middle"] == 1.0 and out[1][0]["index"] == 0.2


# -- (c) calibration ------------------------------------------------------------


def test_real_calibration_zeroes_unusable_joints_and_fingers(ccfg, tmp_path):
    d = tmp_path / "data"
    write_range(d, "c8713cacaff6", "right", REAL_RIGHT["flat"], REAL_RIGHT["fist"], "2026-11-14T11:34:24Z")
    write_range(d, "50462cbe80bd", "left", REAL_LEFT["flat"], REAL_LEFT["fist"], "2026-11-14T11:34:24Z")
    right = load_hand(d, "right", "", ccfg.calibration, ccfg.hand)
    left = load_hand(d, "left", "", ccfg.calibration, ccfg.hand)
    assert right.finger_weights() == {"thumb": 0.0, "index": 1.0, "middle": 1.0, "ring": 1.0, "little": 1.0}
    assert left.finger_weights() == ONES
    sw = left.slot_weights()
    assert sw[H.ANGLE_NAMES.index("ring_mcp")] == 0 and sw[H.ANGLE_NAMES.index("little_mcp")] == 0
    assert sw[H.ANGLE_NAMES.index("ring_pip")] == 1 and sw[14:].tolist() == [1, 1, 1, 1]
    assert "thumb_mcp" in right.summary()["unusable"]


def test_unusable_joint_error_is_ignored(cfg):
    a = pose({"index": 0.5, "ring": 0.5})
    b = a.copy()
    b[H.ANGLE_NAMES.index("ring_mcp")] += 60  # only the unusable joint differs
    sw = np.ones(H.N_ANGLES)
    sw[H.ANGLE_NAMES.index("ring_mcp")] = 0
    fs, _, _ = score_frame("right", b, a, ONES, tol(cfg), slot_weights=sw)
    assert fs.fingers["ring"] == 1.0 and fs.overall == 1.0
    fs, _, _ = score_frame("right", b, a, ONES, tol(cfg))
    assert fs.fingers["ring"] < 1.0


# -- the scorer honours the weights ---------------------------------------------


def test_the_one_to_fix_is_only_ever_a_weighted_finger(cfg):
    master = pose({"thumb": 0.3, "index": 0.8, "middle": 0.8, "ring": 0.5, "little": 0.5})
    learner = pose({"thumb": 0.3, "index": 0.8, "middle": 0.7, "ring": 0.0, "little": 0.5})
    light_ring = ONES | {"ring": 0.2}
    fs, _, _ = score_frame("right", learner, master, light_ring, tol(cfg), focus_min_weight=0.3)
    assert fs.worst != "ring"
    fs_all, _, _ = score_frame("right", learner, master, ONES, tol(cfg), focus_min_weight=0.3)
    assert fs_all.worst == "ring"
    assert fs.overall > fs_all.overall  # a light finger costs less
    # zero weight: the finger does not count at all
    fs0, _, _ = score_frame("right", learner, master, ONES | {"ring": 0.0, "middle": 0.0}, tol(cfg))
    assert fs0.overall == pytest.approx(1.0) and fs0.worst not in ("ring", "middle")


def test_focus_fingers_falls_back_to_the_heaviest():
    assert focus_fingers(ONES | {"ring": 0.2}, 0.3) == ["thumb", "index", "middle", "little"]
    light = {f: 0.1 for f in H.FINGERS} | {"index": 0.2}
    assert focus_fingers(light, 0.3) == ["index"]
    assert focus_fingers({f: 0.0 for f in H.FINGERS}, 0.3) == []


def test_step_scorer_summary_lists_only_weighted_fingers(cfg):
    master = pose({"thumb": 0.3, "index": 0.8, "middle": 0.8, "ring": 0.5, "little": 0.5})
    learner = pose({"thumb": 0.9, "index": 0.8, "middle": 0.8, "ring": 0.0, "little": 0.5})
    rec = Recorder(cfg.record, 500)
    rec.start(0, "t", "general", {}, "right")
    for i in range(30):
        h = H.synth_hand(side="right", curl={"thumb": 0.3, "index": 0.8, "middle": 0.8, "ring": 0.5, "little": 0.5})
        h.t_us = i * 33_333
        rec.add(h)
    lesson = rec.stop(30 * 33_333, save=True)
    step = lesson.steps[0]
    sc = StepScorer("right", lesson, step, cfg.score, tol(cfg), weights=ONES | {"ring": 0.2})
    for i in range(10):
        fs = sc.update(i * 33_333, learner)
    assert fs.worst == "thumb"
    summ = sc.summary(10 * 33_333, "general", "t", stuck=True)
    assert "ring" not in summ["fingers"] and "thumb" in summ["fingers"]


# -- lessons ---------------------------------------------------------------------


def test_repeated_poses_in_a_lesson_are_takes_and_round_trip(cfg, tmp_path, schemas):
    rec = Recorder(cfg.record, 500)
    # a ring this different splits automatic pose grouping, so the take count is declared
    rec.start(0, "fist thrice", "general", {"takes": 3}, "right")
    t = 0
    marks = []
    for ring in (0.9, 0.3, 0.9):  # three fists; the ring differs in the middle take
        for _ in range(30):
            h = H.synth_hand(side="right", curl={"thumb": 0.6, "index": 0.9, "middle": 0.9, "ring": ring, "little": 0.9})
            h.t_us = t
            rec.add(h)
            t += 33_333
        marks.append(t - 1)
    for m in marks[:-1]:
        rec.mark(m)
    lesson = rec.stop(t, save=True)
    assert len(lesson.steps) == 3
    for s in lesson.steps:
        assert s.weights_from["takes"] == 3
        assert s.weights["ring"] < 0.5 <= s.weights["index"]
    lesson.save(tmp_path, keyframes=False)
    d = json.loads((lesson.dir / "lesson.json").read_text())
    schemas.validate("lesson", d)
    back = Lesson.load(lesson.dir)
    assert back.steps[0].weights == lesson.steps[0].weights
    assert back.steps[0].weights_from["takes"] == 3
    # reweighting from the saved lesson gives the same weights
    again = reweight_lesson(Lesson.load(lesson.dir), cfg.record)
    assert again.steps[1].weights == lesson.steps[1].weights


def test_session_drops_a_finger_the_learner_calibration_cannot_read(ccfg, tmp_path):
    d = tmp_path / "data"
    write_range(d, "c8713cacaff6", "right", REAL_RIGHT["flat"], REAL_RIGHT["fist"], "2026-11-14T11:34:24Z")
    write_range(d, "l1", "left", angles_to_triples(raw_angles(FLAT, "left")), angles_to_triples(raw_angles(FIST, "left")), "2026-11-14T11:34:24Z")
    s = Session(ccfg, FakeClock(), tmp_path / "lessons", Coach(None, ccfg.coach, ccfg.score.timing_hint_ms))
    w, slots = s._weights_for("right", ONES)
    assert w["thumb"] == 0.0 and w["index"] == 1.0
    assert slots is not None and slots[H.ANGLE_NAMES.index("thumb_mcp")] == 0
    w, slots = s._weights_for("left", ONES)
    assert w == ONES
    m = s._mirror_scorer("right")
    assert m.weights["thumb"] == 0.0 and "thumb" not in m.focus
