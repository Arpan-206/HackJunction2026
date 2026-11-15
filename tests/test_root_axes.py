"""Axis check for the hand root: move the hand right, toward the camera, then up; the core
wrist (and so the 3D hand) must move the same three ways, for a phone held landscape and for
the upright phone on the riser (the stream is then turned 90 degrees).

Synthetic scene: an ARKit world with gravity +y. The phone is 0.43 m above the table and looks
down 40 degrees at a person across the bench, who faces it. The person's right is world +x,
toward the camera is world -z, up is +y. The core's convention (camera_yaw_deg = 180, the phone
faces the person): right is core +x, toward the camera (away from the person) is core -z, up +y.
The depth is ray-cast: the table plane plus a 4 cm disc for the hand at its height.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from core.camera.depth import DepthFrame
from core.camera.hand_root import Detection, HandRootTracker, RootConfig
from core.camera.hand_root_led import LedConfig

ARKIT_TO_OPENCV = np.diag([1.0, -1.0, -1.0, 1.0])
K = np.array([[473.0, 0, 320], [0, 473.0, 240], [0, 0, 1]])
CAM = np.array([0.0, 0.43, 0.0])


def pose(roll_deg: float) -> np.ndarray:
    """ARKit camera-to-world: looking toward world +z, pitched down 40 degrees, rolled about the view axis."""
    a = math.radians(40)
    fwd = np.array([0.0, -math.sin(a), math.cos(a)])
    zc = -fwd  # ARKit camera z points back
    yc = np.array([0.0, 1.0, 0.0]) - (np.array([0.0, 1.0, 0.0]) @ zc) * zc
    yc /= np.linalg.norm(yc)
    xc = np.cross(yc, zc)
    r = math.radians(roll_deg)
    xr, yr = math.cos(r) * xc + math.sin(r) * yc, -math.sin(r) * xc + math.cos(r) * yc
    T = np.eye(4)
    T[:3, 0], T[:3, 1], T[:3, 2], T[:3, 3] = xr, yr, zc, CAM
    return T


def render(
    T: np.ndarray, hand: np.ndarray, t_us: int, fid: int
) -> tuple[DepthFrame, tuple[float, float]]:
    W, H = 256, 192
    Kd = K.copy()
    Kd[0] *= W / 640
    Kd[1] *= H / 480
    Tcv = T @ ARKIT_TO_OPENCV
    R, c = Tcv[:3, :3], Tcv[:3, 3]
    v, u = np.mgrid[0:H, 0:W]
    rays = np.stack(
        [
            (u + 0.5 - Kd[0, 2]) / Kd[0, 0],
            (v + 0.5 - Kd[1, 2]) / Kd[1, 1],
            np.ones((H, W)),
        ],
        -1,
    )
    dw = rays @ R.T  # world direction for camera z = 1
    with np.errstate(divide="ignore", invalid="ignore"):
        t_tab = np.where(dw[..., 1] < 0, -c[1] / dw[..., 1], np.inf)
        t_hand = np.where(dw[..., 1] < 0, (hand[1] - c[1]) / dw[..., 1], np.inf)
    hit = c + dw * t_hand[..., None]
    on_hand = np.linalg.norm((hit - hand)[..., [0, 2]], axis=-1) < 0.04
    depth = np.where(on_hand, t_hand, t_tab).astype(np.float32)
    depth[~np.isfinite(depth)] = 0
    pc = R.T @ (hand - c)
    uv = (
        (K[0, 0] * pc[0] / pc[2] + K[0, 2]) / 640,
        (K[1, 1] * pc[1] / pc[2] + K[1, 2]) / 480,
    )
    f = DepthFrame(
        t_us=t_us,
        bgr=np.full((480, 640, 3), 100, np.uint8),
        depth=depth,
        K=K,
        confidence=np.full((H, W), 2, np.uint8),
        transform=T,
        frame_id=fid,
        stream_t=t_us / 1e6,
    )
    return f, uv


@pytest.mark.parametrize("roll", [0.0, 90.0, -90.0])
def test_right_toward_camera_up_move_the_core_wrist_the_same_ways(roll):
    T = pose(roll)
    seq: list = []

    def det(bgr, t_us, rot=0):
        u, v = seq[-1]
        lm = np.zeros((21, 2))
        lm[:] = (u, v)
        return [Detection(lm, "Right", 0.9)]

    tr = HandRootTracker(
        RootConfig(mode="mediapipe", clahe=False, use_led=False), detector=det
    )
    tr.led_cfg = LedConfig()
    start = np.array([0.0, 0.05, 0.40])
    moves = {
        "right": np.array([0.08, 0, 0]),
        "toward_camera": np.array([0, 0, -0.08]),
        "up": np.array([0, 0.08, 0]),
    }
    f, uv = render(T, start, 1_000_000, 1)
    seq.append(uv)
    p0 = tr.process(f)[0].p
    got = {}
    for i, (name, d) in enumerate(moves.items()):
        f, uv = render(T, start + d, 1_000_000 + (i + 1) * 33_333, i + 2)
        seq.append(uv)
        got[name] = tr.process(f)[0].p - p0
    k = tr.cfg.motion_scale
    assert got["right"][0] == pytest.approx(0.08 * k, abs=0.01), got
    assert got["toward_camera"][2] == pytest.approx(-0.08 * k, abs=0.01), got
    assert got["up"][1] == pytest.approx(0.08 * k, abs=0.01), got
    # and nothing much on the other axes
    assert abs(got["right"][1]) < 0.01 and abs(got["right"][2]) < 0.01
    assert abs(got["toward_camera"][0]) < 0.01 and abs(got["up"][0]) < 0.01
