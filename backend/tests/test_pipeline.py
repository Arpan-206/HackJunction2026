"""Unit tests for smoothing, the websocket stream, the synthesiser and the Rokoko mapper."""

import math

import numpy as np
from app.schemas.motion import FingerSequence, GripAndSwing
from app.services.gloves.rokoko_mapper import angle_to_quat, map_payload
from app.services.motion import synthesiser
from app.services.smoothing.one_euro import GloveSmoother, OneEuroFilter
from fastapi.testclient import TestClient


def test_one_euro_reduces_jitter_variance() -> None:
    """A noisy constant signal has far lower variance after filtering."""
    rng = np.random.default_rng(1)
    noisy = 0.8 + rng.normal(0, 0.02, 600)
    filt = OneEuroFilter(min_cutoff=1.0, beta=0.0, deadband=0.0)
    out = np.array([filt(float(x), 1 / 60) for x in noisy])
    assert out[60:].var() < noisy[60:].var() * 0.2


def test_one_euro_follows_fast_motion() -> None:
    """With beta above zero a step is tracked quickly rather than lagging."""
    slow = OneEuroFilter(1.0, 0.0, deadband=0.0)
    fast = OneEuroFilter(1.0, 5.0, deadband=0.0)
    for f in (slow, fast):
        f(0.0, 1 / 60)
    a = [slow(1.0, 1 / 60) for _ in range(5)][-1]
    b = [fast(1.0, 1 / 60) for _ in range(5)][-1]
    assert b > a


def test_smoother_disabled_is_passthrough_and_deadband_holds() -> None:
    """Disabled smoothing returns the frame untouched; a tiny wobble is held by the deadband."""
    spec = FingerSequence(sequence=[1], beat_ms=500)
    frame = synthesiser.frame_at(spec, 0.0)
    smoother = GloveSmoother()
    smoother.configure(enabled=False)
    assert smoother.apply(frame) is frame
    smoother.configure(enabled=True)
    first = smoother.apply(frame)
    wobble = frame.model_copy(
        update={
            "t": 1 / 60,
            "hands": [
                h.model_copy(
                    update={
                        "flexion": {
                            k: tuple(v + 0.001 for v in vals)
                            for k, vals in h.flexion.items()
                        }
                    }
                )
                for h in frame.hands
            ],
        }
    )
    assert smoother.apply(wobble).hands[0].flexion == first.hands[0].flexion


def test_synthesiser_ranges_and_swing() -> None:
    """Flexion stays in a sane range and the swing moves the wrist quaternion."""
    spec = GripAndSwing(grip="shakehand", swing="forehand", beat_ms=1000)
    frames = synthesiser.synthesise(spec, "right", 2.0)
    assert len(frames) == 120
    values = [v for f in frames for vals in f.hands[0].flexion.values() for v in vals]
    assert 0.0 <= min(values) and max(values) < 2.5
    quats = {f.hands[0].wrist_quat for f in frames}
    assert len(quats) > 20
    assert all(math.isclose(sum(v * v for v in q), 1.0, abs_tol=1e-3) for q in quats)


def test_websocket_streams_frames_and_accepts_motion(client: TestClient) -> None:
    """The socket emits GloveFrames and applies set_motion to the simulator."""
    with client.websocket_connect("/ws/gloves") as ws:
        first = ws.receive_json()
        assert first["source"] == "simulator" and len(first["hands"]) == 2
        ws.send_json(
            {
                "type": "set_motion",
                "motion": {"preset": "pinch", "fingers": [2], "beat_ms": 500},
            }
        )
        for _ in range(30):
            ws.receive_json()
    assert client.get("/api/dev/state").json()["simulator_motion"]["preset"] == "pinch"


def test_rokoko_mapper_v3_and_unknown_shape() -> None:
    """A v3-style payload maps to flexion; an unknown shape yields no hands."""
    ident = {"x": 0, "y": 0, "z": 0, "w": 1}
    q = angle_to_quat(0.5)
    bend = {"x": q[0], "y": q[1], "z": q[2], "w": q[3]}
    body = {
        "rightHand": {"rotation": ident},
        "rightIndexProximal": {"rotation": bend},
        "rightIndexMedial": {"rotation": bend},
        "rightIndexDistal": {"rotation": bend},
    }
    hands = map_payload(
        {"version": 3, "scene": {"actors": [{"name": "a", "body": body}]}}
    )
    assert [h.side for h in hands] == ["right"]
    index = hands[0].flexion["index"]
    assert math.isclose(index[0], 0.5, abs_tol=1e-3) and math.isclose(
        index[1], 0.0, abs_tol=1e-3
    )
    assert hands[0].flexion["thumb"] == (0.0, 0.0, 0.0)
    assert map_payload({"something": "else"}) == []
