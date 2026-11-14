import numpy as np
import pytest

from core import geom
from core import hand as H
from core.camera import DEVICE_IDS, camera_to_world, landmarks_to_hand


def synth_landmarks(curl, side, mirror, q=None, centre=(0.0, 0.0, 0.0)):
    """Build 21 MediaPipe-style landmarks (camera frame) from a synthetic 26-joint hand."""
    local = H.synth_joints(curl, side=side)
    q = geom.IDENTITY_Q if q is None else q
    world = H.local_to_world(local, np.zeros(3), q) + np.asarray(centre)
    L_world = H.mediapipe_from_joints(world)
    # inverse of camera_to_world
    L_cam = L_world.copy()
    L_cam[:, 0] = L_world[:, 0] if mirror else -L_world[:, 0]
    L_cam[:, 1] = -L_world[:, 1]
    norm = np.zeros((21, 3))
    norm[:, 0] = 0.3 + 0.1 * L_cam[:, 0]
    norm[:, 1] = 0.6 + 0.1 * L_cam[:, 1]
    return L_cam, norm


def test_camera_to_world_is_rotation_or_reflection():
    v = np.array([[1.0, 2.0, 3.0]])
    assert np.allclose(camera_to_world(v, mirror=False), [[-1.0, -2.0, 3.0]])
    assert np.allclose(camera_to_world(v, mirror=True), [[1.0, -2.0, 3.0]])


@pytest.mark.parametrize("mirror", [True, False])
@pytest.mark.parametrize("side", ["left", "right"])
def test_landmarks_round_trip_angles_and_side(cfg, mirror, side):
    cam = dict(cfg.camera)
    cam["mirror"] = mirror
    from core.config import config_from_dict
    cam = config_from_dict(cam)
    curl = {"thumb": 0.4, "index": 0.8, "middle": 0.3, "ring": 0.1, "little": 0.6}
    q = geom.quat_from_axis_angle([0.2, 1.0, 0.1], 0.6)
    L_cam, norm = synth_landmarks(curl, side, mirror, q=q, centre=(0.05, -0.02, 0.4))
    # MediaPipe labels assume a mirrored image: with mirror=False the label is the other hand
    label = side.capitalize() if mirror else ("Left" if side == "right" else "Right")
    h = landmarks_to_hand(L_cam, norm, label, cam, t_us=123)
    assert h.side == side and h.source == "camera" and h.anchor == "camera" and h.device_id == DEVICE_IDS[side]
    expect = H.angle_features(H.synth_joints(curl, side=side))
    got = H.angle_features(h.joints_local)
    for f in ["index", "middle", "ring", "little"]:
        _, pip, dip = H.FLEXION_SLOTS[f]
        assert abs(got[pip] - expect[pip]) < 1e-6 and abs(got[dip] - expect[dip]) < 1e-6
    assert np.allclose(got[:2], expect[:2], atol=1e-6)
    assert np.allclose(got[14:], expect[14:], atol=1e-6)
    assert np.all(np.abs(got[2:14] - expect[2:14]) < 20)
    # thumb side in the wrist frame matches the side
    tx = h.joints_local[H.TIP["thumb"]][0]
    assert (tx < 0) if side == "right" else (tx > 0)
    # wrist is on the configured plane
    assert h.wrist_p[2] == pytest.approx(cam.plane_z_m)
    assert abs(h.wrist_p[0]) < cam.plane_width_m and abs(h.wrist_p[1] - cam.plane_y_m) < cam.plane_height_m


def test_camera_hand_message_validates(cfg, schemas):
    L_cam, norm = synth_landmarks({"index": 0.5}, "right", True)
    h = landmarks_to_hand(L_cam, norm, "Right", cfg.camera, t_us=5)
    H.finish_hand(h, cfg.hand)
    frame = {"v": 1, "type": "frame", "t": 5, "seq": 1, "hands": {"left": None, "right": h.to_message(4, True)},
             "ghost": {}, "score": None, "task": {}}
    schemas.validate("frame", frame)
    assert frame["hands"]["right"]["source"] == "camera"


def test_camera_source_needs_model(cfg, tmp_path):
    from core.camera import CameraSource
    from core.clock import FakeClock
    with pytest.raises(FileNotFoundError):
        CameraSource(cfg, FakeClock(), model_path=tmp_path / "missing.task")


def test_camera_source_ingest_and_poll(cfg, tmp_path):
    """Feed a fake HandLandmarkerResult through ingest/poll without MediaPipe running."""
    from types import SimpleNamespace as NS
    from core.camera import CameraSource
    from core.clock import FakeClock
    model = tmp_path / "m.task"
    model.write_bytes(b"not a real model")
    clock = FakeClock()
    src = CameraSource(cfg, clock, model_path=model)
    L_cam, norm = synth_landmarks({"index": 0.9}, "left", True)
    lm = lambda a: [NS(x=float(p[0]), y=float(p[1]), z=float(p[2])) for p in a]
    result = NS(hand_landmarks=[lm(norm)], hand_world_landmarks=[lm(L_cam)], handedness=[[NS(category_name="Left", score=0.9)]])
    t = clock.now_us()
    src.ingest(result, t)
    out = src.poll(t)
    assert out["right"][0] is None
    h, events = out["left"]
    assert h is not None and h.tracked and h.side == "left" and h.curl["index"] > 0.8
    assert src.poll(t + 1_000_000)["left"][0].tracked is False
