"""Hand root, gloved hands: one-glove matching (never jump to a bare hand), the ring LED rules
in core/root_fuse.py, and the ring finder in core/camera/hand_root_led.py. Synthetic inputs;
the real-clip numbers are in STATUS-hand-root.md (tools/hand_root_check.py)."""
from __future__ import annotations

import numpy as np
import pytest

from core import hand as H
from core.root_fuse import FuseConfig, RootFuser

REST = {"left": np.array([-0.15, 0.10, -0.20]), "right": np.array([0.15, 0.10, -0.20])}


def glove(side):
    h = H.synth_hand(side=side, curl={f: 0.3 for f in H.FINGERS}, t_us=0, device_id=2 if side == "right" else 1)
    h.wrist_p = REST[side].copy()
    h.anchor = "rest"
    return h


class BlobFix:
    def __init__(self, p, t_us, fid, darkness, led_side=None):
        self.p, self.t_us, self.frame_id, self.confidence = np.asarray(p, float), t_us, fid, 1.0
        self.side = led_side or ""
        self.darkness, self.led, self.source, self.key = darkness, led_side is not None, "blob", ""


def test_one_glove_ignores_a_bare_hand_passing_through():
    f = RootFuser(FuseConfig(max_speed_m_s=100.0))
    h = glove("right")
    for k in range(60):
        t = k * 33_333
        fixes = [BlobFix(REST["right"], t, k, darkness=0.8)]
        if 20 <= k < 40:      # a bare hand sweeps across, passing right by the glove
            fixes.insert(0, BlobFix(REST["right"] + [0.3 - 0.015 * (k - 20), 0, 0], t, k, darkness=0.35))
        f.apply({"right": h, "left": None}, fixes, t)
        assert np.allclose(h.wrist_p, REST["right"]), k


def test_one_glove_without_a_dark_difference_keeps_the_nearest_blob():
    f = RootFuser(FuseConfig(max_speed_m_s=100.0))
    h = glove("right")
    for k in range(40):
        t = k * 33_333
        fixes = [BlobFix(REST["right"] + [0.15 - 0.01 * k, 0.02, 0], t, k, darkness=0.8),
                 BlobFix(REST["right"], t, k, darkness=0.8)]
        f.apply({"right": h, "left": None}, fixes, t)
        if k > 0:
            assert np.linalg.norm(h.wrist_p - REST["right"]) < 0.02, k


def test_one_glove_led_wins_and_ambiguity_holds():
    f = RootFuser(FuseConfig(max_speed_m_s=100.0))
    h = glove("right")
    a, b = REST["right"], REST["right"] + [0.2, 0, 0]
    f.apply({"right": h}, [BlobFix(a, 0, 0, 0.8)], 0)
    # the other side's ring is never taken; this side's ring is, even far away (after the jump gate)
    f.apply({"right": h}, [BlobFix(b, 33_333, 1, 0.9, led_side="left")], 33_333)
    assert np.allclose(h.wrist_p, a)
    for k in range(2, 5):
        f.apply({"right": h}, [BlobFix(b, k * 33_333, k, 0.8, led_side="right")], k * 33_333)
    assert np.allclose(h.wrist_p, b)
    # two equally dark blobs equally far from the wrist: hold, do not switch
    c, d = b + [0.1, 0, 0], b - [0.1, 0, 0]
    n0 = f.held_ambiguous
    f.apply({"right": h}, [BlobFix(c, 199_999, 6, 0.8), BlobFix(d, 199_999, 6, 0.8)], 199_999)
    assert np.allclose(h.wrist_p, b) and f.held_ambiguous == n0 + 1


def test_two_gloves_one_ring_names_its_hand():
    f = RootFuser(FuseConfig(max_speed_m_s=100.0))
    hl, hr = glove("left"), glove("right")
    # by x order these would be left then right; the ring says the lower-x blob is the right hand
    f.apply({"left": hl, "right": hr}, [BlobFix(REST["left"], 0, 1, 0.8, led_side="right"),
                                        BlobFix(REST["right"], 0, 1, 0.8)], 0)
    assert np.allclose(hr.wrist_p, REST["left"]) and np.allclose(hl.wrist_p, REST["right"])


def test_two_gloves_two_blobs_go_by_x_order():
    f = RootFuser(FuseConfig(max_speed_m_s=100.0))
    hl, hr = glove("left"), glove("right")
    f.apply({"left": hl, "right": hr}, [BlobFix(REST["right"], 0, 1, 0.8), BlobFix(REST["left"], 0, 1, 0.8)], 0)
    assert np.allclose(hl.wrist_p, REST["left"]) and np.allclose(hr.wrist_p, REST["right"])
    assert f.swaps == 0


def test_find_rings_sees_a_bright_ring_and_names_it_by_hue():
    import cv2
    from core.camera.hand_root_led import MARKER_RGB, LedConfig, find_rings, hue_cv
    img = np.full((480, 640, 3), (120, 30, 110), np.uint8)          # dark purple scene
    cv2.circle(img, (200, 240), 9, (0, 255, 0), 4)                  # green ring (BGR)
    cv2.circle(img, (450, 240), 9, (0, 140, 255), 4)                # amber ring (BGR)
    cv2.circle(img, (320, 100), 9, (255, 255, 255), -1)             # a white disc: no hole, not a ring
    cfg = LedConfig(marker_hues={s: hue_cv(c) for s, c in MARKER_RGB.items()})
    rings = sorted(find_rings(img, None, cfg), key=lambda r: r.uv[0])
    assert [r.side for r in rings] == ["left", "right"]
    assert rings[0].uv == pytest.approx((200 / 640, 240 / 480), abs=0.01)
