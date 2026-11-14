"""Hand root: core/root_fuse.py rules, core/camera/hand_root.py maths, and the flag-on equals
flag-off proof on a replay of real glove wrist quaternions.

The replay: tests/fixtures/depth/glove_yaw_right_1320s.npz (20 s of the right glove from the
live slot on Sat 14 Nov, its wrist quaternions as they came) drives a learn-mode session on
the fake lesson. One session has no hand root; the other has the hand root on, reading an
empty table (a flat depth plane, a camera looking down) with the real MediaPipe detector when
the model file is present, else a detector that finds nothing. Every frame message, every
outgoing message and every compat /ws/gloves hand must be identical.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from core import compat, fake
from core import hand as H
from core.camera.depth import DepthFrame
from core.camera.hand_root import (Detection, HandRootLive, HandRootTracker, RootConfig, unrotate_points,
                                   upright_rotation, rotate_image)
from core.clock import FakeClock
from core.coach import Coach
from core.root_fuse import FuseConfig, RootFuser
from core.session import Session

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "tests" / "fixtures" / "depth" / "glove_yaw_right_1320s.npz"
MODEL = ROOT / "models" / "hand_landmarker.task"
REST = {"left": np.array([-0.15, 0.10, -0.20]), "right": np.array([0.15, 0.10, -0.20])}

# ARKit camera 0.4 m above the table at the world origin, looking straight down, its image
# top toward world -z. Columns: camera x, y, z axes in the world (ARKit: -z is forward).
DOWN = np.array([[1.0, 0, 0, 0], [0, 0, 1, 0.4], [0, -1, 0, 0], [0, 0, 0, 1]])


def table_frame(i: int, t_us: int, h: float = 0.4) -> DepthFrame:
    rng = np.random.default_rng(i)
    bgr = (90 + rng.integers(0, 30, (480, 640, 3))).astype(np.uint8)
    depth = np.full((192, 256), h, np.float32)
    K = np.array([[473.0, 0, 320], [0, 473.0, 240], [0, 0, 1]])
    return DepthFrame(t_us=t_us, bgr=bgr, depth=depth, K=K, confidence=np.full((192, 256), 2, np.uint8),
                      transform=DOWN.copy(), frame_id=i + 1, stream_t=t_us / 1e6, arrival_us=t_us)


class ListSource:
    """A DepthSource over frames made on demand: the newest frame at the clock's time."""

    def __init__(self, clock, fps=30.0):
        self.clock, self.fps, self.t0, self.frame = clock, fps, None, None

    def start(self):
        pass

    def stop(self):
        pass

    def read(self):
        now = self.clock.now_us()
        self.t0 = self.t0 or now
        i = int((now - self.t0) * self.fps / 1e6)
        if self.frame is None or self.frame.frame_id != i + 1:
            self.frame = table_frame(i, now)
        return self.frame

    def status(self):
        return {"connected": True}


class Stub:
    """Detector stand-in: returns what fn(t_us) gives, as one or more Detections."""

    def __init__(self, fn):
        self.fn = fn
        self.calls = 0

    def __call__(self, bgr, t_us, rot=0):
        self.calls += 1
        return self.fn(t_us)


def det_at(u, v, label="Right"):
    lm = np.zeros((21, 2))
    lm[:] = (u, v)
    lm[5] = (u + 0.03, v - 0.08)
    lm[17] = (u - 0.03, v - 0.08)
    return Detection(lm, label, 0.9)


def glove(side, t_us, q=None, curl=0.3):
    h = H.synth_hand(side=side, curl={f: float(curl) for f in H.FINGERS}, t_us=t_us, device_id=2 if side == "right" else 1)
    h.wrist_p = REST[side].copy()
    h.anchor = "rest"
    if q is not None:
        h.wrist_q = np.asarray(q, dtype=float)
    return h


# -- fusion rules -----------------------------------------------------------------

class Fix:
    def __init__(self, side, p, t_us, fid, conf=1.0):
        self.side, self.p, self.t_us, self.frame_id, self.confidence = side, np.asarray(p, float), t_us, fid, conf


def test_no_fix_leaves_hand_untouched():
    f = RootFuser()
    h = glove("right", 0)
    before = (h.wrist_p.copy(), h.anchor)
    for k in range(30):
        f.apply({"right": h, "left": None}, [], k * 33_333)
    assert np.array_equal(h.wrist_p, before[0]) and h.anchor == before[1]


def test_rate_cap_jump_gate_hold_and_decay():
    cfg = FuseConfig(max_speed_m_s=1.5, jump_m=0.15, jump_frames=3, hold_s=1.0, decay_s=1.0, box=False, one_euro=False)
    f = RootFuser(cfg)
    h = glove("right", 0)
    dt = 33_333
    target = REST["right"] + [0.10, 0, 0]
    t = 0
    for k in range(30):
        t = k * dt
        f.apply({"right": h}, [Fix("right", target, t, k)], t)
        if k == 0:
            # the first fix pulls from the glove's rest position at the rate cap: 1.5 m/s * 1/30 s = 5 cm
            assert np.linalg.norm(h.wrist_p - REST["right"]) == pytest.approx(0.05, abs=1e-6)
    assert np.allclose(h.wrist_p, target) and h.anchor == "camera"
    # one wild fix 40 cm away is ignored; the wrist does not move
    t += dt
    f.apply({"right": h}, [Fix("right", target + [0.4, 0, 0], t, 100)], t)
    assert np.allclose(h.wrist_p, target)
    # tracking drops: held, then back to the glove's own position, then untouched
    t_drop = t
    for k in range(1, 100):
        t = t_drop + k * dt
        f.apply({"right": h}, [], t)
        age = (t - t_drop) / 1e6
        if 0.2 < age < 0.9:
            assert np.allclose(h.wrist_p, target) and h.anchor == "held"
    assert np.allclose(h.wrist_p, REST["right"]) and h.anchor == "rest"


def test_jump_accepted_after_three_frames():
    f = RootFuser(FuseConfig(jump_m=0.15, jump_frames=3, max_speed_m_s=0.0, box=False, one_euro=False))
    h = glove("right", 0)
    f.apply({"right": h}, [Fix("right", REST["right"], 0, 0)], 0)
    far = REST["right"] + [0.3, 0, 0]
    for k in range(1, 4):
        f.apply({"right": h}, [Fix("right", far, k * 33_333, k)], k * 33_333)
    assert np.allclose(h.wrist_p, far)


def test_two_fixes_go_by_x_order_whatever_the_label():
    f = RootFuser(FuseConfig(max_speed_m_s=0.0, box=False, one_euro=False))
    hl, hr = glove("left", 0), glove("right", 0)
    fixes = [Fix("left", REST["right"], 0, 1), Fix("left", REST["left"], 0, 1)]
    f.apply({"left": hl, "right": hr}, fixes, 0)
    assert np.allclose(hl.wrist_p, REST["left"]) and np.allclose(hr.wrist_p, REST["right"])
    assert f.swaps == 1


def test_one_fix_one_glove_goes_to_that_glove():
    f = RootFuser(FuseConfig(max_speed_m_s=0.0, box=False, one_euro=False))
    hl = glove("left", 0)
    p = REST["left"] + [0, 0.05, 0]
    f.apply({"left": hl, "right": None}, [Fix("right", p, 0, 1)], 0)
    assert np.allclose(hl.wrist_p, p)


def test_twice_on_one_hand_object_applies_once():
    f = RootFuser(FuseConfig(max_speed_m_s=0.0, box=False, one_euro=False))
    h = glove("right", 0)
    p = REST["right"] + [0.05, 0, 0]
    f.apply({"right": h}, [Fix("right", p, 0, 1)], 0)
    f.apply({"right": h}, [Fix("right", p, 0, 1)], 1000)
    assert np.allclose(h.wrist_p, p)
    assert np.allclose(getattr(h, "_root_glove_p"), REST["right"])


def test_camera_hands_are_left_alone():
    f = RootFuser(FuseConfig(max_speed_m_s=0.0, box=False, one_euro=False))
    h = glove("right", 0)
    h.source, h.anchor = "camera", "camera"
    p0 = h.wrist_p.copy()
    f.apply({"right": h}, [Fix("right", p0 + 0.1, 0, 1)], 0)
    assert np.array_equal(h.wrist_p, p0)


# -- tracker maths -------------------------------------------------------------------

@pytest.mark.parametrize("rot", [0, 1, 2, 3])
def test_rotation_round_trip(rot):
    img = np.zeros((48, 64, 3), np.uint8)
    img[5, 40] = 255
    r = rotate_image(img, rot)
    ys, xs = np.nonzero(r[..., 0])
    pr = np.array([[(xs[0] + 0.5) / r.shape[1], (ys[0] + 0.5) / r.shape[0]]])
    back = unrotate_points(pr, rot)[0]
    assert back == pytest.approx([(40 + 0.5) / 64, (5 + 0.5) / 48], abs=1e-9)


def test_upright_rotation_of_known_poses():
    assert upright_rotation(None) == 0
    # ARKit camera level, looking along world -z: no turn
    level = np.eye(4)
    level[0, 3] = 0.01
    assert upright_rotation(level) == 0
    assert upright_rotation(DOWN) == 0           # looking down, image top toward world -z
    # rolled 90 degrees about the viewing axis: world up now along the image x axis
    roll = np.array([[0.0, -1, 0, 0], [1, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]])
    assert upright_rotation(roll) in (1, 3)
    roll_back = roll.copy()
    roll_back[:3, :3] = roll[:3, :3].T
    assert {upright_rotation(roll), upright_rotation(roll_back)} == {1, 3}


def test_tracker_backprojects_onto_the_bench_and_locks_to_rest():
    seq = iter([det_at(0.5, 0.5), det_at(0.5 + 0.0846, 0.5)])   # 0.0846 * 640 / 473 * 0.4 m = 4.6 cm
    tr = HandRootTracker(RootConfig(clahe=False), rest_p=REST, detector=Stub(lambda t: [next(seq)]))
    a = tr.process(table_frame(0, 1_000_000))
    b = tr.process(table_frame(1, 1_033_333))
    assert tr.bench is not None and tr.bench.table.camera_height_m == pytest.approx(0.4, abs=0.01)
    # x and z lock to the rest pose; y is the table height: floor_y_m + motion_scale * 0 m
    assert len(a) == 1 and np.allclose(a[0].p, [REST["right"][0], 0.05, REST["right"][2]], atol=0.005)
    assert a[0].p_bench[1] == pytest.approx(0.0, abs=0.01)
    assert np.linalg.norm(b[0].p_bench - a[0].p_bench) == pytest.approx(0.0458, abs=0.004)
    assert a[0].confidence == 1.0


# -- the replay: flag on with no hand in view equals flag off ---------------------------

def _session(cfg, tmp_path, name):
    clock = FakeClock()
    d = tmp_path / name
    d.mkdir()
    s = Session(cfg, clock, d, Coach(None, cfg.coach, cfg.score.timing_hint_ms), fake=True)
    s.attempts_log = None
    fake.build_fake_lesson(cfg, d)
    s.handle_command("lesson_load", {"lesson_id": fake.FAKE_LESSON_ID})
    s.handle_command("set_mode", {"mode": "learn"})
    s.drain()
    return s, clock


STRIDE = 8     # the fixture is 250 Hz; every 8th sample is 31 Hz, the glove rate the core sees


def _run(s, clock, w, n):
    out = []
    t0 = clock.now_us()
    for k in range(n):
        i = k * STRIDE
        clock.set_us(t0 + int(w["t_us"][i] - w["t_us"][0]))
        t = clock.now_us()
        curl = 0.5 + 0.5 * np.sin(k / 15.0)
        h = H.synth_hand(side="right", curl={f: float(curl) for f in H.FINGERS}, t_us=t, device_id=2)
        H.finish_hand(h, s.cfg.hand)
        h.wrist_q = np.asarray(w["wrist_q"][i], dtype=float)
        h.wrist_p = REST["right"].copy()
        h.anchor = "rest"
        s.update_hand("right", h)
        frame = s.tick(t)
        out.append(json.dumps({"frame": frame, "msgs": s.drain(),
                               "compat": compat.hand_to_glove_hand(s.hands["right"])}, sort_keys=True, default=str))
    return out


@pytest.mark.parametrize("detector", ["mediapipe", "none"])
def test_flag_on_with_no_hand_in_view_equals_flag_off(cfg, tmp_path, detector):
    if detector == "mediapipe" and not MODEL.exists():
        pytest.skip("models/hand_landmarker.task missing (python -m tools.fetch_models)")
    w = np.load(FIXTURE)
    n = 240 if detector == "mediapipe" else len(w["t_us"]) // STRIDE   # 8 s at 31 Hz, or the whole 20 s
    off, clock_off = _session(cfg, tmp_path, "off")
    on, clock_on = _session(cfg, tmp_path, "on")
    rc = RootConfig.from_config(cfg)
    det = None if detector == "mediapipe" else Stub(lambda t: [])
    tr = HandRootTracker(rc, rest_p=REST, detector=det, model_path=MODEL)
    on.root = HandRootLive(ListSource(clock_on), tr, RootFuser(FuseConfig.from_config(cfg)), threaded=False)
    a = _run(off, clock_off, w, n)
    b = _run(on, clock_on, w, n)
    assert tr.frames > 0 and tr.bench is not None      # the hand root really ran on every frame
    assert tr.fixes == 0
    assert a == b
    # the scorer ran: the comparison covers the score, not only the hands
    assert any(json.loads(x)["frame"]["score"] is not None for x in a)


def test_flag_on_with_a_hand_moves_the_wrist_and_sends_wrist_pos(cfg, tmp_path):
    w = np.load(FIXTURE)
    s, clock = _session(cfg, tmp_path, "hand")
    t_start = clock.now_us()

    def moving(t):      # a hand in view for 2 s, sliding right in the image (5 cm), then gone
        age = (t - t_start) / 1e6
        return [det_at(0.4 + 0.05 * age, 0.5)] if age < 2.0 else []
    tr = HandRootTracker(RootConfig(clahe=False), rest_p=REST, detector=Stub(moving))
    s.root = HandRootLive(ListSource(clock), tr, RootFuser(FuseConfig(hold_s=1.0, decay_s=1.0)), threaded=False)
    out = [json.loads(x) for x in _run(s, clock, w, 180)]
    wp = [o["compat"]["wrist_pos"] for o in out]
    assert wp[0] is not None and np.allclose(np.array(wp[0])[[0, 2]], REST["right"][[0, 2]], atol=1e-3)
    moved = [p for p in wp[:60] if p is not None]
    # image right is the person's left when the phone faces them (camera_yaw_deg 180): core -x
    # 5 cm of real motion times motion_scale 0.6
    assert REST["right"][0] - min(p[0] for p in moved) > 0.02       # the wrist followed the hand
    assert out[59]["frame"]["hands"]["right"]["anchor"] == "camera"
    assert out[75]["frame"]["hands"]["right"]["anchor"] == "held"
    assert wp[-1] is None and out[-1]["frame"]["hands"]["right"]["wrist"]["p"] == pytest.approx(list(REST["right"]))
