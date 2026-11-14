"""Yaw drift correction on a REAL glove window paired with the FAKE depth stream.

The glove: 20 s of the right Smartglove II from the live slot on Sat 14 Nov
(logs/live/20261114-131952/solver_12277.rgmp, from 1320 s; cut with
python -m tools.glove_yaw_window, stored in tests/fixtures/depth/). Its wrist
quaternions are used as they came, pitch and roll included.

The depth: the fake bench scene, whose arm yaw is the recorded glove yaw (minus the
window's mean, so the arm stays in view). The glove fed to the core reads the recorded
yaw plus an injected drift. The correction must cancel the drift.
This checks the corrector's dynamics on real hand motion; it says nothing about real
depth, which nobody has recorded yet.
"""

from pathlib import Path

import numpy as np
import pytest

from core import geom
from core import hand as H
from core.camera.depth_live import DepthTracking, FakeDepthSource, glove_yaw_deg
from core.camera.depth_track import YawCorrectorConfig, wrap_deg
from core.camera.fake_depth import FakeDepthScene
from core.clock import FakeClock

FIXTURE = Path(__file__).parent / "fixtures" / "depth" / "glove_yaw_right_1320s.npz"
DRIFT_START_S = 3.0
DRIFT_DEG_S = 1.5


def drift(t):
    return 0.0 if t < DRIFT_START_S else (t - DRIFT_START_S) * DRIFT_DEG_S


@pytest.mark.parametrize("dark", [True, False])
def test_drift_correction_on_real_glove_window(dark):
    w = np.load(FIXTURE)
    ts = w["t_us"] / 1e6
    q = w["wrist_q"]
    yaw = np.degrees(np.unwrap(np.radians(w["yaw_deg"])))
    mean = float(yaw.mean())
    assert 15 < np.ptp(yaw) < 60          # the hand really turns in this window

    def glove_yaw(t):
        return float(np.interp(t, ts, yaw))

    # the recorded yaw is the truth: depth sees it (centred so the fake arm stays in the
    # picture), the glove below reads it plus the injected drift
    scene = FakeDepthScene(dark_hand=dark, yaw_fn=lambda t: glove_yaw(t) - mean)
    clock = FakeClock()
    fps = 10.0
    dt = DepthTracking(FakeDepthSource(scene, clock=clock, fps=fps),
                       corrector_cfg=YawCorrectorConfig(lock_s=2.0, lock_min_samples=10, tau_s=1.5))
    t0 = clock.now_us()
    errs, raw_errs = [], []
    for k in range(int(ts[-1] * fps)):
        t = k / fps
        clock.set_us(t0 + int(t * 1e6))
        i = int(np.searchsorted(ts, t))
        i = min(i, len(ts) - 1)
        # the real glove quaternion, turned by the injected drift about world up
        qk = geom.quat_mul(geom.yaw_quat(np.radians(drift(t) + glove_yaw(t) - float(yaw[i]))), q[i])
        h = H.HandState(side="right", device_id=1, source="glove", t_us=clock.now_us(),
                        joints_local=np.zeros((26, 3)), wrist_p=np.zeros(3), wrist_q=qk)
        dt.step()
        dt.apply({"right": h}, clock.now_us())
        if t > ts[-1] - 5.0:
            # the glove reads true + drift; the lock absorbed the constant glove-to-bench offset
            # while the drift was 0, so corrected minus true is the error left
            errs.append(wrap_deg(glove_yaw_deg(h.wrist_q) - glove_yaw(t)))
            raw_errs.append(drift(t))
    st = dt.status()
    assert st["locked"] and st["updates"] > 100, st
    assert np.mean(raw_errs) > 20                     # uncorrected: 20 to 25 degrees off by the end
    # measured 2.3 to 2.6 deg: the lag of a 1.5 s filter behind a 1.5 deg/s ramp
    assert abs(np.mean(errs)) < 3.5, (np.mean(errs), st)
    assert np.abs(errs).max() < 4.5, (np.abs(errs).max(), st)
