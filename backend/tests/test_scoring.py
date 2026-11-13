"""Scoring regression: a perturbed attempt must reach the scorer and the perturbed finger must score worst."""

import math

from fastapi.testclient import TestClient

from app.schemas.motion import FingerSequence, HoldPose
from app.services.motion import synthesiser

MOTION = {"preset": "finger_sequence", "sequence": [1, 2, 3, 4, 5], "beat_ms": 620}
FPS = 30.0
DURATION_S = 3.0


def _clumsy_frames(lag_s: float = 0.3, under_deg: float = 25.0) -> list[dict]:
    """Frames of the reference motion with the ring finger lagging and under-curled, as the frontend simulates."""
    spec = FingerSequence.model_validate(MOTION)
    out = []
    for i in range(int(DURATION_S * FPS)):
        t = i / FPS
        lagged = synthesiser.frame_at(spec, max(0.0, t - lag_s), ("right",)).hands[0]
        ring = tuple(v - math.radians(under_deg) / 3 for v in lagged.flexion["ring"])  # under_deg is the TOTAL over 3 joints
        hand = lagged.model_copy(update={"flexion": {**lagged.flexion, "ring": ring}})
        out.append(synthesiser.frame_at(spec, t, ("right",)).model_copy(update={"hands": [hand]}).model_dump(mode="json"))
    return out


def test_inline_clumsy_attempt_names_ring_finger(client: TestClient) -> None:
    """A ring finger 25 degrees (total flexion) under-curled and 300 ms late scores clearly lower and is the worst finger."""
    result = client.post("/api/score", json={"reference_motion": MOTION, "attempt_frames": _clumsy_frames()}).json()
    scores = result["per_finger"]
    assert result["worst_finger"] == "ring"
    assert scores["ring"] < 80 and all(scores[f] > 95 for f in ("thumb", "index", "middle"))
    assert result["timing"] < 95 and result["within_tolerance"] is False
    assert "ring" in result["hint"]


def test_score_needs_an_attempt(client: TestClient) -> None:
    """A request with neither attempt_recording_id nor attempt_frames is rejected."""
    assert client.post("/api/score", json={"reference_motion": MOTION}).status_code == 422


FIST = {"preset": "hold_pose", "pose": {f: 1.0 for f in ("thumb", "index", "middle", "ring", "little")}}


def _stiff_frames(factor: float) -> list[dict]:
    """The reference motion with every joint scaled, like a hand whose fist only reaches factor of nominal."""
    spec = HoldPose.model_validate(FIST)
    out = []
    for i in range(int(DURATION_S * FPS)):
        frame = synthesiser.frame_at(spec, i / FPS, ("right",))
        hand = frame.hands[0]
        scaled = {f: tuple(v * factor for v in vals) for f, vals in hand.flexion.items()}
        out.append(frame.model_copy(update={"hands": [hand.model_copy(update={"flexion": scaled})]}).model_dump(mode="json"))
    return out


def _save_calibration(client: TestClient, factor: float, complete: bool = True) -> str:
    """Store a right-hand calibration whose fist reaches factor of the nominal fist."""
    from app import constants as c
    from app.schemas.records import Calibration

    scale = [c.THUMB_FLEXION_SCALE] + [1.0] * 4
    flat = {f: tuple(factor * v * k for v in row) for f, row, k in zip(c.FINGERS, c.RELAXED_FLEXION, scale, strict=True)}
    extra = {}
    if complete:
        extra["fist"] = {
            f: tuple(factor * (r + u) * k for r, u in zip(rel, full, strict=True))
            for f, rel, full, k in zip(c.FINGERS, c.RELAXED_FLEXION, c.FULL_FLEXION, scale, strict=True)
        }
    cal = Calibration(id=f"cal-{int(factor * 100)}-{int(complete)}", side="right", flat=flat, created_at="2026-01-01T00:00:00Z", **extra)
    client.app.state.services.calibrations._store.save(cal)
    return cal.id


def test_calibration_rescues_stiff_hand(client: TestClient) -> None:
    """A stiff hand making the same relative movement scores far better once calibrated."""
    attempt = _stiff_frames(0.7)
    plain = client.post("/api/score", json={"reference_motion": FIST, "attempt_frames": attempt}).json()
    cal_id = _save_calibration(client, 0.7)
    calibrated = client.post("/api/score", json={
        "reference_motion": FIST, "attempt_frames": attempt, "attempt_calibration_id": cal_id,
    }).json()
    assert calibrated["overall"] > plain["overall"] + 15 and calibrated["overall"] > 85
    assert calibrated["warnings"] == [] and plain["warnings"] == []


def test_incomplete_calibration_is_ignored_with_warning(client: TestClient) -> None:
    """A calibration without a fist phase changes nothing and reports a warning."""
    attempt = _stiff_frames(0.7)
    plain = client.post("/api/score", json={"reference_motion": FIST, "attempt_frames": attempt}).json()
    cal_id = _save_calibration(client, 0.7, complete=False)
    result = client.post("/api/score", json={
        "reference_motion": FIST, "attempt_frames": attempt, "attempt_calibration_id": cal_id,
    }).json()
    assert result["overall"] == plain["overall"] and result["warnings"]


def test_use_latest_and_unknown_calibration(client: TestClient) -> None:
    """use_latest_calibration picks the stored one; a missing id is a 404."""
    attempt = _stiff_frames(0.7)
    _save_calibration(client, 0.7)
    body = {"reference_motion": FIST, "attempt_frames": attempt}
    assert client.post("/api/score", json={**body, "use_latest_calibration": True}).json()["overall"] > 85
    assert client.post("/api/score", json={**body, "attempt_calibration_id": "nope"}).status_code == 404
