"""Depth step on the FAKE bench scene (core/camera/fake_depth.py). Nothing here is real depth."""

import json
import math

import numpy as np
import pytest

from core import geom
from core import hand as H
from core.camera.depth_live import DepthTracking, FakeDepthSource, glove_yaw_deg
from core.camera.depth_track import DepthTracker, TrackerConfig, YawCorrector, YawCorrectorConfig, wrap_deg
from core.camera.fake_depth import LABEL_HAND, LABEL_TABLE, FakeDepthScene, write_recording
from core.camera.gdrec import frames, read_note
from core.camera.geppetto_depth import ARKIT_TO_OPENCV, parse_packet
from core.clock import FakeClock


# The fake scene shows about 30 cm of a perfect cylinder forearm, and its dark hand is the
# forearm alone, so it cannot pass the "shape" gate tuned on the real clip (no wrist taper).
# Tests of direction and correction dynamics on the fake pin the first gate, "cylinder".
def cyl(**kw):
    return TrackerConfig(gate="cylinder", entry_margin_px=2, **kw)


def frame_at(scene, i, fps=30.0):
    return parse_packet(scene.packet(i, fps), 1_700_000_000_000_000 + int(i * 1e6 / fps))


# -- the fake scene ------------------------------------------------------------
def test_fake_scene_geometry_and_noise():
    s = FakeDepthScene()
    r = s.render(0.0, 0)
    d, lab, conf = r["truth_depth"], r["labels"], r["confidence"]
    K = s.K_depth
    T = s.transform @ ARKIT_TO_OPENCV
    # a table pixel back-projects onto world y = 0
    v, u = np.argwhere((lab == LABEL_TABLE) & (conf == 2))[len(np.argwhere(lab == LABEL_TABLE)) // 2]
    z = d[v, u]
    p = T[:3, :3] @ np.array([(u + 0.5 - K[0, 2]) / K[0, 0] * z, (v + 0.5 - K[1, 2]) / K[1, 1] * z, z]) + T[:3, 3]
    assert abs(p[1]) < 1e-6
    # noise on high confidence table pixels is near the measured 1.8 mm
    m = (lab == LABEL_TABLE) & (conf == 2)
    noise = (r["depth"] - d)[m]
    assert 0.0012 < noise.std() < 0.0025
    assert (lab == LABEL_HAND).sum() > 500


def test_fake_dark_hand_has_no_usable_depth():
    s = FakeDepthScene(dark_hand=True)
    f = frame_at(s, 15)
    r = s.render(15 / 30, 15)
    hand = r["labels"] == LABEL_HAND
    assert (f.confidence[hand] == 0).all()
    # filled from the surroundings: no hand-shaped step, the depth runs smooth across it
    gy = np.abs(np.diff(f.depth, axis=0))[hand[1:] & hand[:-1]]
    assert np.percentile(gy, 95) < 0.02


def test_fake_recording_round_trip(tmp_path):
    p = tmp_path / "fake.gdrec.gz"
    n = write_recording(p, FakeDepthScene(dark_hand=True), seconds=0.5, fps=10)
    got = list(frames(p))
    assert n == 5 and len(got) == 5
    assert read_note(p)["dark_hand"] is True and "FAKE" in read_note(p)["source"]
    f = got[0]
    assert f.depth.shape == (192, 256) and f.bgr.shape == (480, 640, 3) and f.plane is not None


# -- the tracker ---------------------------------------------------------------
@pytest.mark.parametrize("dark,plane", [(False, True), (True, True), (False, False), (True, False)])
def test_tracker_finds_table_arm_and_yaw(dark, plane):
    s = FakeDepthScene(dark_hand=dark, with_plane=plane)
    tr = DepthTracker(cyl())
    errs, hand_depth = [], []
    for i in range(0, 180, 6):
        o = tr.process(frame_at(s, i))
        assert o.table is not None and o.table.source == ("app" if plane else "fit")
        assert abs(o.table.camera_height_m - 0.14) < 0.004
        assert o.arm_found and o.forearm_ok and o.entry == "top"
        errs.append(wrap_deg(o.forearm_yaw_deg - s.yaw_deg(i / 30)))
        hand_depth.append(o.hand_depth)
    e = np.array(errs)
    assert abs(e.mean()) < 1.0 and np.abs(e).max() < 4.0, (e.mean(), np.abs(e).max())
    assert (np.mean(hand_depth) > 0.8) if not dark else (np.mean(hand_depth) < 0.2)
    if plane:
        assert o.agree_deg is not None and o.agree_deg < 1.0 and abs(o.agree_mm) < 3.0


def test_tracker_empty_bench_and_camera_yaw():
    tr = DepthTracker(cyl())
    o = tr.process(frame_at(FakeDepthScene(no_arm=True), 0))
    assert o.table is not None and not o.arm_found and o.forearm_yaw_deg is None
    # the same scene seen as if the phone looked the person's way: yaw turns by 180
    s = FakeDepthScene()
    a = DepthTracker(cyl()).process(frame_at(s, 30)).forearm_yaw_deg
    b = DepthTracker(cyl(camera_yaw_deg=0.0)).process(frame_at(s, 30)).forearm_yaw_deg
    assert abs(wrap_deg(a - b - 180.0)) < 1e-6


def test_tracker_cloud_labels():
    s = FakeDepthScene(dark_hand=True)
    o = DepthTracker(cyl()).process(frame_at(s, 30), want_cloud=True)
    c = o.cloud
    assert 1500 <= len(c["labels"]) <= 2000
    counts = np.bincount(c["labels"], minlength=4)
    assert counts[1] > 300 and counts[2] > 200 and counts[3] > 20
    table_y = c["points"][c["labels"] == 1][:, 1]
    assert np.abs(table_y).max() < 0.011


# -- the corrector -------------------------------------------------------------
def test_corrector_locks_then_removes_drift():
    c = YawCorrector(YawCorrectorConfig(lock_s=1.0, tau_s=1.0))
    rng = np.random.default_rng(1)
    t = 0
    for k in range(600):                         # 20 s at 30 Hz
        t = k * 33_333
        true = 20 * math.sin(k / 40)
        drift = 0.0 if k < 60 else (k - 60) / 30 * 1.5      # 1.5 deg/s after the lock
        glove = true + drift + 40.0              # 40 deg: the unknown glove-to-bench offset
        depth = true + rng.normal(0, 3)
        c.update(t, glove, depth)
    assert c.locked
    assert abs(c.offset_deg + drift) < 2.5       # the offset cancels the drift


def test_corrector_skips_outliers_but_follows_a_real_jump():
    c = YawCorrector(YawCorrectorConfig(lock_s=0.5, tau_s=0.5, outlier_deg=20, outlier_run=30, max_rate_deg_s=100.0))
    for k in range(30):
        c.update(k * 33_333, 0.0, 0.0)
    assert c.locked
    c.update(31 * 33_333, 0.0, 90.0)             # one wild sample
    assert abs(c.offset_deg) < 1e-9 and c.outliers == 1
    for k in range(32, 200):                      # a real 40 deg jump, held
        c.update(k * 33_333, 0.0, 40.0)
    assert abs(c.offset_deg - 40.0) < 3.0


def test_corrector_rate_cap():
    c = YawCorrector(YawCorrectorConfig(lock_s=0.5, tau_s=0.1, outlier_deg=90, max_rate_deg_s=3.0))
    for k in range(30):
        c.update(k * 33_333, 0.0, 0.0)
    assert c.locked
    t0 = 30 * 33_333
    for k in range(30, 60):                       # 1 s of a 40 deg disagreement
        c.update(k * 33_333, 0.0, 40.0)
    dt_s = (59 * 33_333 - t0) / 1e6
    assert 0 < c.offset_deg <= 3.0 * dt_s + 0.2   # at most 3 deg/s, however big the disagreement


# -- the live step -------------------------------------------------------------
def glove_hand(yaw_deg, side="right"):
    q = geom.yaw_quat(math.radians(yaw_deg))
    return H.HandState(side=side, device_id=1, source="glove", t_us=0, joints_local=np.zeros((26, 3)),
                       wrist_p=np.zeros(3), wrist_q=q)


def test_apply_turns_each_hand_once():
    clock = FakeClock()
    dt = DepthTracking(FakeDepthSource(FakeDepthScene(), clock=clock), cyl(),
                       corrector_cfg=YawCorrectorConfig(lock_s=0.0, lock_min_samples=1))
    dt.corrector.ref_deg = 0.0
    dt.corrector.offset_deg = 10.0
    h = glove_hand(5.0)
    dt.apply({"right": h}, clock.now_us())
    assert abs(glove_yaw_deg(h.wrist_q) - 15.0) < 1e-6
    dt.apply({"right": h}, clock.now_us())           # the same object again: not turned twice
    assert abs(glove_yaw_deg(h.wrist_q) - 15.0) < 1e-6
    assert abs(dt.last_glove_yaw - 5.0) < 1e-6
    b = dt.block()
    assert b["correction_deg"] == 10.0 and b["side"] == "right"


def test_live_step_corrects_drift_on_fake_glove():
    """Glove yaw = true + drift; the fake depth scene shows the true yaw; the corrected glove follows the truth."""
    clock = FakeClock()
    scene = FakeDepthScene(dark_hand=True)
    dt = DepthTracking(FakeDepthSource(scene, clock=clock, fps=15), cyl(),
                       corrector_cfg=YawCorrectorConfig(lock_s=1.0, tau_s=1.0))
    t0 = clock.now_us()
    last = None
    for k in range(int(12 * 15)):                    # 12 s, one tick per depth frame
        clock.set_us(t0 + int(k * 1e6 / 15))
        t = k / 15
        drift = 0.0 if t < 1.5 else (t - 1.5) * 2.0   # 2 deg/s, 21 deg by the end
        h = glove_hand(scene.yaw_deg(t) + drift)
        dt.step()
        dt.apply({"right": h}, clock.now_us())
        last = (glove_yaw_deg(h.wrist_q), scene.yaw_deg(t), drift)
    corrected, true, drift = last
    assert drift > 20
    assert abs(wrap_deg(corrected - true)) < 4.0, (corrected, true, drift, dt.status())
    assert dt.block()["applied"] and dt.block()["locked"]


def test_core_frame_and_ws_depth(tmp_path, schemas):
    from fastapi.testclient import TestClient

    from core.config import load_config
    from core.server import Core, create_app
    from tests.conftest import ROOT

    cfg = load_config(ROOT / "config.toml")
    core = Core(cfg, fake=True, validate=True, lessons_dir=tmp_path / "lessons", logs_dir=tmp_path / "logs")
    plain = core.session.tick(core.clock.now_us())
    assert "depth" not in plain                      # flag off: the frame is unchanged
    core.session.depth = DepthTracking.from_config(cfg, core.clock, source=FakeDepthSource(clock=core.clock))
    core.session.depth.tracker.cfg.gate = "cylinder"
    app = create_app(core)
    with TestClient(app) as client:
        with client.websocket_connect("/ws/depth") as ws:
            msg = json.loads(ws.receive_text())
        assert msg["type"] == "depth" and msg["frame"] == "bench" and msg["n"] == len(msg["labels"])
        assert len(msg["points"]) == 3 * msg["n"] and len(msg["rgb"]) == 3 * msg["n"]
        schemas.validate("depth", msg)
        h = client.get("/health").json()
        assert h["depth"]["processed"] >= 1
        assert client.get("/depth").status_code == 200
    frame = core.session.tick(core.clock.now_us())
    schemas.validate("frame", frame)
    blk = frame["depth"]
    from jsonschema import Draft202012Validator
    Draft202012Validator({"$ref": "https://geppetto.local/schema/depth.json#/$defs/block"},
                         registry=schemas.registry).validate(blk)
    assert blk["table"] and blk["hand"]
    assert core.validation_errors == 0, core.last_validation_error


# -- the check tool --------------------------------------------------------------
def test_depth_check_on_fake_recordings(tmp_path):
    from tools.depth_check import check

    for dark in (False, True):
        rec = tmp_path / f"fake-{dark}.gdrec.gz"
        write_recording(rec, FakeDepthScene(dark_hand=dark), seconds=1.0, fps=10)
        s = check(rec, tmp_path / f"out-{dark}", n_images=2, tracker_cfg=cyl())
        assert s["frames"] == 10 and s["bad_packets"] == 0
        assert s["table"]["app_plane_fraction"] == 1.0 and abs(s["table"]["camera_height_fit_m"]["median"] - 0.14) < 0.003
        assert s["hand"]["found_fraction"] >= 0.8 and s["forearm_yaw"]["frames"] >= 8
        assert (s["hand"]["hand_depth_fraction_when_found"] < 0.2) if dark else (s["hand"]["hand_depth_fraction_when_found"] > 0.8)
        assert s["latency"]["fps"] == 10.0
        assert len(list((tmp_path / f"out-{dark}").glob("*_overlay.jpg"))) == 2
        assert (tmp_path / f"out-{dark}" / "frames.csv").exists()


def test_a_box_on_the_bench_is_not_an_arm():
    """A wide block standing on the table passes the height band but fails the arm gates."""
    s = FakeDepthScene(no_arm=True)
    box = [(np.array([x, 0.0, -0.25]), np.array([x, 0.12, -0.25]), 0.05, 2) for x in (-0.04, 0.0, 0.04)]
    s.capsules = lambda t: box
    for gate in ("cylinder", "shape"):
        o = DepthTracker(TrackerConfig(gate=gate)).process(frame_at(s, 0))
        assert o.blob_found and not o.arm_found and not o.forearm_ok
