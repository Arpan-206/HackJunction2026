"""The yaw correction is safe: no arm, no change; arm lost, correction held.

test_flag_on_no_arm_scores_identically runs the same fake-glove learn session twice on
the same clock: once with the depth step off, once on, reading the REAL no-arm frames of
captures/bench-stand-1 (0 to 165: the table and the tall object the first gate took for
an arm). Scores, hands and events must match frame by frame. It is skipped where the clip
is missing. test_correction_holds_when_the_arm_is_lost uses the fake scene.
"""

import json
from pathlib import Path

import numpy as np
import pytest

from core.camera.depth_live import DepthTracking, FakeDepthSource, RecordingDepthSource
from core.camera.depth_track import TrackerConfig, YawCorrectorConfig
from core.camera.fake_depth import FakeDepthScene
from core.clock import FakeClock
from core.config import load_config
from core.server import Core
from tests.conftest import ROOT
from tests.test_depth_bench_stand import CLIP


def run_session(tmp_path: Path, name: str, depth_src_factory=None, ticks: int = 160) -> list[dict]:
    cfg = load_config(ROOT / "config.toml")
    clock = FakeClock()
    core = Core(cfg, fake=True, validate=True, clock=clock, lessons_dir=tmp_path / name / "lessons",
                logs_dir=tmp_path / name / "logs")
    if depth_src_factory is not None:
        core.session.depth = DepthTracking.from_config(cfg, clock, source=depth_src_factory(clock))
    out = []
    t0 = clock.now_us()
    for k in range(ticks):
        t = t0 + int(k * 1e6 / 30)
        clock.set_us(t)
        core.poll_sources(t)
        if core.session.depth is not None:
            core.session.depth.step()
        frame = core.session.tick(t)
        msgs = core.session.drain()
        out.append({"score": frame["score"], "hands": frame["hands"], "ghost": frame["ghost"],
                    "events": [m for m in msgs if m["type"] in ("event", "session")],
                    "depth": frame.get("depth")})
    return out


@pytest.mark.skipif(CLIP is None, reason="captures/bench-stand-1.gdrec.gz not on this machine")
def test_flag_on_no_arm_scores_identically(tmp_path):
    off = run_session(tmp_path, "off")
    on = run_session(tmp_path, "on", lambda clock: RecordingDepthSource(CLIP, clock, 0, 166))
    assert any(f["score"] is not None for f in off)
    blocks = [f["depth"] for f in on]
    assert all(b is not None and b["table"] for b in blocks[5:])     # the depth step really ran
    assert not any(b["hand"] for b in blocks)                       # and saw no arm
    for k, (a, b) in enumerate(zip(off, on)):
        assert json.dumps(a["score"], sort_keys=True) == json.dumps(b["score"], sort_keys=True), k
        assert json.dumps(a["hands"], sort_keys=True) == json.dumps(b["hands"], sort_keys=True), k
        assert json.dumps(a["ghost"], sort_keys=True) == json.dumps(b["ghost"], sort_keys=True), k
        assert len(a["events"]) == len(b["events"]), k


def test_correction_holds_when_the_arm_is_lost():
    from core import geom
    from core import hand as H

    clock = FakeClock()
    scene = FakeDepthScene()
    src = FakeDepthSource(scene, clock=clock, fps=15)
    dt = DepthTracking(src, TrackerConfig(gate="cylinder", entry_margin_px=2),
                       YawCorrectorConfig(lock_s=0.5, lock_min_samples=5, tau_s=0.5, max_rate_deg_s=20.0))
    t0 = clock.now_us()

    def hand(yaw_deg):
        return H.HandState(side="right", device_id=1, source="glove", t_us=0, joints_local=np.zeros((26, 3)),
                           wrist_p=np.zeros(3), wrist_q=geom.yaw_quat(np.radians(yaw_deg)))

    k = 0
    for k in range(60):                              # 4 s: lock, then a 10 deg glove offset appears
        clock.set_us(t0 + int(k * 1e6 / 15))
        t = k / 15
        dt.step()
        dt.apply({"right": hand(scene.yaw_deg(t) + (10.0 if t > 1.0 else 0.0))}, clock.now_us())
    held = dt.corrector.offset_deg
    assert -10.5 < held < -6.0, held                  # most of the way to -10 after 3 s
    scene.no_arm = True                              # the arm leaves the view
    for k in range(60, 120):
        clock.set_us(t0 + int(k * 1e6 / 15))
        dt.step()
        h = hand(0.0)
        dt.apply({"right": h}, clock.now_us())
    assert not dt.block()["hand"]
    assert dt.corrector.offset_deg == held           # held, not snapped back
    assert dt.block()["correction_deg"] == round(held, 2)
