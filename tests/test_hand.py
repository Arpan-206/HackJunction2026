import numpy as np
import pytest

from core import hand as H
from core import geom


def test_joint_order_matches_spec():
    assert len(H.JOINT_NAMES) == 26
    assert H.JOINT_NAMES[0] == "palm" and H.JOINT_NAMES[1] == "wrist"
    assert H.JOINT_NAMES[2] == "thumb_metacarpal" and H.JOINT_NAMES[5] == "thumb_tip"
    assert H.JOINT_NAMES[6] == "index_metacarpal" and H.JOINT_NAMES[10] == "index_tip"
    assert H.JOINT_NAMES[25] == "little_tip"


def test_flat_hand_has_near_zero_flexion():
    a = H.angle_features(H.synth_joints({}))
    assert a.shape == (18,)
    assert np.all(a[:14] < 1.0), a[:14]


def test_fist_has_near_90_flexion():
    a = H.angle_features(H.synth_joints({f: 1.0 for f in H.FINGERS}))
    assert np.allclose(a[2:14], 90.0, atol=1.0), a[2:14]
    assert np.allclose(a[0:2], 60.0, atol=1.0), a[0:2]


def test_mirror_gives_identical_angles():
    J = H.synth_joints({"index": 0.7, "ring": 0.3, "thumb": 0.4}, side="right", spread_deg=5)
    a = H.angle_features(J)
    b = H.angle_features(H.mirror_local(J))
    assert np.allclose(a, b, atol=1e-6)
    # a built-in left hand is the mirror of the right
    left = H.synth_joints({"index": 0.7, "ring": 0.3, "thumb": 0.4}, side="left", spread_deg=5)
    assert np.allclose(H.angle_features(left), a, atol=1e-6)
    assert np.allclose(left[:, 0], -J[:, 0])


def test_angles_invariant_to_rigid_motion_and_scale():
    J = H.synth_joints({"middle": 0.5, "little": 0.9})
    a = H.angle_features(J)
    q = geom.quat_from_axis_angle([0.3, 1.0, 0.2], 1.1)
    J2 = geom.rotate(q, J) * 1.7 + np.array([0.5, -0.2, 0.1])
    assert np.allclose(H.angle_features(J2), a, atol=1e-6)


def test_curl_runs_zero_to_one(cfg):
    flat = H.synth_hand(curl={}, hand_cfg=cfg.hand)
    fist = H.synth_hand(curl={f: 1.0 for f in H.FINGERS}, hand_cfg=cfg.hand)
    for f in H.FINGERS:
        assert flat.curl[f] < 0.02
        assert fist.curl[f] > 0.98
    half = H.synth_hand(curl={"index": 0.5}, hand_cfg=cfg.hand)
    assert 0.45 < half.curl["index"] < 0.55


def test_pinch_hysteresis(cfg):
    tr = H.PinchTracker(cfg.hand.pinch_on_m, cfg.hand.pinch_off_m)
    J = H.synth_joints({})
    state, ev = tr.update(J)
    assert not any(state.values()) and ev == []
    # Fake a pinch by moving the index tip onto the thumb tip.
    J2 = J.copy()
    J2[H.TIP["index"]] = J2[H.TIP["thumb"]] + np.array([0.0, 0.0, 0.010])
    state, ev = tr.update(J2)
    assert state["index"] and ev == [("index", "pinch_down")]
    # 20 mm is inside the hysteresis band: still pinched.
    J3 = J.copy()
    J3[H.TIP["index"]] = J3[H.TIP["thumb"]] + np.array([0.0, 0.0, 0.020])
    state, ev = tr.update(J3)
    assert state["index"] and ev == []
    state, ev = tr.update(J)
    assert not state["index"] and ev == [("index", "pinch_up")]


def test_hand_message_validates(cfg, schemas):
    h = H.synth_hand(side="right", curl={"index": 0.3}, wrist_p=(0.1, 0.2, -0.3), hand_cfg=cfg.hand, device_id=3)
    h.role = "learner"
    h.rots_local = np.tile(geom.IDENTITY_Q, (26, 1))
    msg = h.to_message(decimals=4, include_rots=True)
    frame = {"v": 1, "type": "frame", "t": 1, "seq": 0, "hands": {"left": None, "right": msg}, "ghost": {}, "score": None, "task": {}}
    schemas.validate("frame", frame)
    assert len(msg["rots"]) == 26
    assert msg["joints"][1] == pytest.approx([0.1, 0.2, -0.3])


def test_world_local_round_trip():
    q = geom.quat_from_axis_angle([0, 1, 0], 0.7)
    p = np.array([0.3, 0.1, -0.2])
    h = H.synth_hand(curl={"ring": 0.6}, wrist_p=p, wrist_q=q)
    world = h.joints_world()
    back = H.xr_base_to_local(world - p, q)
    assert np.allclose(back, h.joints_local, atol=1e-9)


def test_mediapipe_round_trip_preserves_angles():
    J = H.synth_joints({"index": 0.8, "middle": 0.2, "thumb": 0.5}, spread_deg=4)
    L = H.mediapipe_from_joints(J)
    J2 = H.joints_from_mediapipe(L, metacarpal_fraction=0.25)
    a, b = H.angle_features(J), H.angle_features(J2)
    # Metacarpal joints are approximated, so MCP flexion may differ a little.
    for f in ["index", "middle", "ring", "little"]:
        pip, dip = H.FLEXION_SLOTS[f][1], H.FLEXION_SLOTS[f][2]
        assert abs(a[pip] - b[pip]) < 1e-6 and abs(a[dip] - b[dip]) < 1e-6
    assert np.allclose(a[:2], b[:2])           # thumb exact
    assert np.allclose(a[14:], b[14:])         # spreads exact
    assert np.all(np.abs(a[2:14] - b[2:14]) < 20.0)  # synthetic metacarpal bases sit off the wrist


def test_wrist_frame_recovers_canonical_pose():
    q = geom.quat_from_axis_angle([0.2, 1.0, 0.1], 0.9)
    p = np.array([0.1, 0.4, -0.3])
    for side in ["right", "left"]:
        local = H.synth_joints({"index": 0.4}, side=side)
        world = H.local_to_world(local, p, q)
        p2, q2 = H.wrist_frame_from_joints(world, side)
        assert np.allclose(p2, p)
        local2 = geom.rotate_inv(q2, world - p2)
        # same frame up to the small tilt of the synthetic middle metacarpal
        assert np.allclose(H.angle_features(local2), H.angle_features(local), atol=1e-4)
        fwd = local2[H.FINGER_BASE["middle"] + 1] - local2[1]
        assert fwd[2] < 0 and abs(fwd[0]) < 0.01     # fingers along -Z
        thumb_x = local2[H.TIP["thumb"]][0]
        assert (thumb_x < 0) if side == "right" else (thumb_x > 0)
