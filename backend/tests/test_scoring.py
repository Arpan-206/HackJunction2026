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


def _two_handed_recording(client: TestClient) -> str:
    """Store a recording whose frames carry both hands, the left one listed first, and return its id."""
    spec = FingerSequence.model_validate(MOTION)
    recorder = client.app.state.services.recorder
    recording_id = recorder.start(None, None)
    for i in range(int(DURATION_S * FPS)):
        t = i / FPS
        left = synthesiser.frame_at(spec, t, ("left",)).hands[0]
        both = synthesiser.frame_at(spec, t, ("right",))
        recorder.push(both.model_copy(update={"hands": [left, both.hands[0]]}))
    return recorder.stop(recording_id).id


def _right_attempt() -> list[dict]:
    """Right-handed attempt frames that follow the reference exactly."""
    spec = FingerSequence.model_validate(MOTION)
    return [synthesiser.frame_at(spec, i / FPS, ("right",)).model_dump(mode="json") for i in range(int(DURATION_S * FPS))]


def test_right_attempt_scores_against_two_handed_reference_with_left_first(client: TestClient) -> None:
    """A one-handed right attempt must score against a two-handed reference whose left hand is listed first."""
    reference_id = _two_handed_recording(client)
    stored = client.get(f"/api/recordings/{reference_id}").json()
    assert [h["side"] for h in stored["frames"][0]["hands"]] == ["left", "right"]
    response = client.post("/api/score", json={"reference_recording_id": reference_id, "attempt_frames": _right_attempt()})
    assert response.status_code == 200, response.text
    assert response.json()["overall"] > 90


def test_explicit_side_picks_the_hand_to_score(client: TestClient) -> None:
    """An explicit side wins, and asking for a side the attempt lacks is a clear 400."""
    reference_id = _two_handed_recording(client)
    body = {"reference_recording_id": reference_id, "attempt_frames": _right_attempt()}
    assert client.post("/api/score", json={**body, "side": "right"}).status_code == 200
    missing = client.post("/api/score", json={**body, "side": "left"})
    assert missing.status_code == 400
    assert "left hand" in missing.json()["detail"]


GRIP = {"preset": "hold_pose", "pose": {"thumb": 0.62, "index": 0.8, "middle": 0.84, "ring": 0.86, "little": 0.88}}


def _hold_frames(duration_s: float, phase_s: float = 0.0, index_extra_rad: float = 0.0) -> list[dict]:
    """Frames of a held grip; phase_s offsets the breathing ripple, index_extra_rad over-curls each index joint."""
    spec = HoldPose.model_validate(GRIP)
    out = []
    for i in range(int(duration_s * FPS)):
        frame = synthesiser.frame_at(spec, i / FPS + phase_s, ("right",)).model_copy(update={"t": i / FPS})
        hand = frame.hands[0]
        index = tuple(v + index_extra_rad for v in hand.flexion["index"])
        out.append(frame.model_copy(update={"hands": [hand.model_copy(update={"flexion": {**hand.flexion, "index": index}})]}).model_dump(mode="json"))
    return out


def test_held_pose_has_no_timing_penalty(client: TestClient) -> None:
    """A held grip has no beat: a different breathing phase must not score as early or late (was timing 51, 435 ms early)."""
    result = client.post("/api/score", json={"reference_motion": GRIP, "attempt_frames": _hold_frames(3.0, phase_s=2.0)}).json()
    assert result["timing"] == 100.0 and result["within_tolerance"] is True
    assert result["overall"] > 99 and "early" not in result["hint"] and "late" not in result["hint"]


def test_held_pose_recording_is_detected_without_a_preset(client: TestClient) -> None:
    """A recorded take that barely moves is treated as a held pose, whatever its length differs from the attempt."""
    recorder = client.app.state.services.recorder
    recording_id = recorder.start(None, None)
    spec = HoldPose.model_validate(GRIP)
    for i in range(int(4.0 * FPS)):
        recorder.push(synthesiser.frame_at(spec, i / FPS + 1.0, ("right",)).model_copy(update={"t": i / FPS}))
    reference_id = recorder.stop(recording_id).id
    result = client.post("/api/score", json={"reference_recording_id": reference_id, "attempt_frames": _hold_frames(3.0)}).json()
    assert result["timing"] == 100.0 and result["overall"] > 99 and "ms" not in result["hint"]


def test_held_pose_still_scores_finger_errors(client: TestClient) -> None:
    """Dropping the timing score for a held pose must not hide a wrong finger: the hint names it, not timing."""
    result = client.post("/api/score", json={"reference_motion": GRIP, "attempt_frames": _hold_frames(3.0, phase_s=2.0, index_extra_rad=0.2)}).json()
    assert result["worst_finger"] == "index" and result["per_finger"]["index"] < 90 and result["within_tolerance"] is False
    assert "index" in result["hint"] and "ms" not in result["hint"]
