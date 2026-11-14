"""Several expert takes into one model (POST /recordings/model), per-finger tolerance in scoring and hints, and the
take list and delete routes."""

import math
import time

import numpy as np
import pytest
from app import constants as c
from app.schemas.api import CoachHintRequest
from app.schemas.common import Tolerance
from app.schemas.motion import HoldPose
from app.services import hints, scoring, takes
from app.services.motion import synthesiser
from fastapi.testclient import TestClient

FINGERS = c.FINGERS
FRAMES = 40


def _held(**offsets_deg: float) -> np.ndarray:
    """A still hand (T, 5, 3) with each named finger's TOTAL flexion moved by the given degrees, spread over its joints."""
    base = np.full((FRAMES, len(FINGERS), c.JOINTS_PER_FINGER), 0.5)
    for finger, deg in offsets_deg.items():
        base[:, FINGERS.index(finger), :] += math.radians(deg) / c.JOINTS_PER_FINGER
    return base


def test_spread_maps_to_a_clamped_tolerance() -> None:
    """Spread is scaled by TAKES_TOLERANCE_SCALE and clamped between the strict floor and the loose ceiling."""
    assert takes.tolerance_from_spread(0.0) == c.TAKES_TOLERANCE_FLOOR_DEG
    assert takes.tolerance_from_spread(6.0) == pytest.approx(
        6.0 * c.TAKES_TOLERANCE_SCALE
    )
    assert takes.tolerance_from_spread(100.0) == c.TAKES_TOLERANCE_CEIL_DEG


def test_medoid_is_the_central_take() -> None:
    """The take each other take differs from by one finger is the reference, wherever it sits in the request."""
    model = takes.build_model(
        [_held(index=8), _held(), _held(ring=8)], ["b", "a", "c"], "right"
    )
    assert model.reference_recording_id == "a"
    assert [t.is_reference for t in model.takes] == [False, True, False]
    reference = model.takes[1]
    assert reference.score == 100 and reference.distance_deg == 0
    assert reference.worst_finger is None
    assert (
        model.takes[0].worst_finger == "index" and model.takes[2].worst_finger == "ring"
    )
    assert model.take_ids == ["b", "a", "c"] and model.enough_takes is True


def test_steady_fingers_get_strict_and_variable_fingers_loose_tolerance() -> None:
    """Thumb never moves (floor), the index wobbles 6 degrees (15), the little finger 20 degrees (clamped at the ceiling)."""
    model = takes.build_model(
        [_held(), _held(index=6, little=20), _held(index=-6, little=-20)],
        ["a", "b", "c"],
        "right",
    )
    assert model.reference_recording_id == "a"
    tol = model.tolerance.finger_angle_deg
    assert tol is not None
    assert tol["thumb"] == c.TAKES_TOLERANCE_FLOOR_DEG
    assert tol["index"] == pytest.approx(6 * c.TAKES_TOLERANCE_SCALE, abs=0.1)
    assert tol["little"] == c.TAKES_TOLERANCE_CEIL_DEG
    assert (
        model.tolerance.angle_deg == c.TAKES_TOLERANCE_FLOOR_DEG
    )  # median of 10, 15, 10, 10, 36
    assert model.spread_deg.index == pytest.approx(6, abs=0.1)
    assert model.steadiest_finger == "thumb" and model.loosest_finger == "little"
    assert not any(t.outlier for t in model.takes) and model.warnings == []
    assert model.takes[1].worst_finger == "little" and model.takes[1].score > 90
    assert model.consistency == pytest.approx(model.takes[1].score, abs=0.1)


def test_far_take_is_flagged_and_does_not_loosen_the_model() -> None:
    """A take 25 degrees off on every finger is an outlier among three close takes; the spread ignores it."""
    model = takes.build_model(
        [
            _held(),
            _held(index=3),
            _held(ring=3),
            _held(**dict.fromkeys(FINGERS, -25.0)),
        ],
        ["a", "b", "c", "d"],
        "right",
    )
    assert model.reference_recording_id == "a"
    assert [t.outlier for t in model.takes] == [False, False, False, True]
    assert model.tolerance.finger_angle_deg == dict.fromkeys(
        FINGERS, c.TAKES_TOLERANCE_FLOOR_DEG
    )
    assert any("Take 4" in w for w in model.warnings)
    assert model.takes[3].score < model.takes[1].score


def test_consistent_takes_are_never_outliers() -> None:
    """Takes a few degrees apart stay unflagged however their distances compare (TAKES_OUTLIER_MIN_DEG)."""
    model = takes.build_model(
        [_held(), _held(index=1), _held(ring=1), _held(middle=6)],
        ["a", "b", "c", "d"],
        "right",
    )
    assert not any(t.outlier for t in model.takes)


def _record(client: TestClient, step_id: str = "s", seconds: float = 0.4) -> str:
    """Record the live simulator for a short time and return the recording id."""
    rid = client.post(
        "/api/recordings/start", json={"lesson_id": "l", "step_id": step_id}
    ).json()["recording_id"]
    time.sleep(seconds)
    client.post(f"/api/recordings/{rid}/stop")
    return rid


def test_model_endpoint_accepts_two_takes_with_a_warning(client: TestClient) -> None:
    """Two takes build a model but say that three to five are recommended; the tolerance drops into a Step."""
    ids = [_record(client), _record(client)]
    res = client.post("/api/recordings/model", json={"recording_ids": ids})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["reference_recording_id"] in ids and body["take_ids"] == ids
    assert body["enough_takes"] is False and len(body["warnings"]) == 1
    assert len(body["takes"]) == 2 and not any(t["outlier"] for t in body["takes"])
    assert set(body["tolerance"]["finger_angle_deg"]) == set(FINGERS)
    assert body["side"] in ("left", "right")
    Tolerance.model_validate(body["tolerance"])


@pytest.mark.parametrize("count", [1, 6])
def test_model_endpoint_rejects_one_or_more_than_five_takes(
    client: TestClient, count: int
) -> None:
    """One take is not a model and more than five is too many: 422."""
    res = client.post(
        "/api/recordings/model", json={"recording_ids": [f"r{i}" for i in range(count)]}
    )
    assert res.status_code == 422


def test_model_endpoint_rejects_duplicates_and_unknown_takes(
    client: TestClient,
) -> None:
    """A take named twice is a 422; an unknown take is a 404."""
    rid = _record(client)
    assert (
        client.post(
            "/api/recordings/model", json={"recording_ids": [rid, rid]}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/recordings/model", json={"recording_ids": [rid, "missing"]}
        ).status_code
        == 404
    )


def test_list_and_delete_takes(client: TestClient) -> None:
    """Takes are listed per step without frames, and a deleted take is really gone."""
    first, second, other = (
        _record(client, "s1"),
        _record(client, "s1"),
        _record(client, "s2"),
    )
    listed = client.get("/api/recordings", params={"step_id": "s1"}).json()
    assert [r["id"] for r in listed] == [first, second]
    assert "frames" not in listed[0] and listed[0]["frame_count"] > 0
    assert len(client.get("/api/recordings").json()) == 3
    assert client.delete(f"/api/recordings/{first}").status_code == 204
    assert client.get(f"/api/recordings/{first}").status_code == 404
    assert [r["id"] for r in client.get("/api/recordings?step_id=s1").json()] == [
        second
    ]
    assert client.delete(f"/api/recordings/{first}").status_code == 404
    assert client.get(f"/api/recordings/{other}").status_code == 200


def test_deleting_a_take_in_progress_discards_it(client: TestClient) -> None:
    """DELETE on a take still recording drops it, so stopping it afterwards finds nothing."""
    rid = client.post("/api/recordings/start", json={}).json()["recording_id"]
    assert client.delete(f"/api/recordings/{rid}").status_code == 204
    assert client.post(f"/api/recordings/{rid}/stop").status_code == 404


def test_step_keeps_take_ids_and_per_finger_tolerance(client: TestClient) -> None:
    """A published step round-trips its takes and per-finger tolerance; a step without them keeps the old defaults."""
    tolerance = {
        "angle_deg": 12.0,
        "timing_ms": 250.0,
        "finger_angle_deg": {
            "thumb": 10.0,
            "index": 22.5,
            "middle": 10.0,
            "ring": 12.0,
            "little": 36.0,
        },
    }
    lesson = {
        "title": "Takes",
        "skill": "general",
        "steps": [
            {
                "title": "Grip",
                "instruction": "Hold it",
                "reference_recording_id": "a",
                "take_ids": ["a", "b", "c"],
                "tolerance": tolerance,
            },
            {"title": "Plain", "instruction": "As before"},
        ],
    }
    created = client.post("/api/lessons", json=lesson).json()
    fetched = client.get(f"/api/lessons/{created['id']}").json()
    rich, plain = fetched["steps"]
    assert rich["take_ids"] == ["a", "b", "c"] and rich["tolerance"] == tolerance
    assert plain["take_ids"] == [] and plain["tolerance"]["finger_angle_deg"] is None
    too_many = {**lesson, "steps": [{**lesson["steps"][0], "take_ids": list("abcdef")}]}
    assert client.post("/api/lessons", json=too_many).status_code == 422
    bad = {**tolerance, "finger_angle_deg": {"index": 0}}
    assert (
        client.post(
            "/api/lessons",
            json={**lesson, "steps": [{**lesson["steps"][0], "tolerance": bad}]},
        ).status_code
        == 422
    )


GRIP = {
    "preset": "hold_pose",
    "pose": {"thumb": 0.62, "index": 0.8, "middle": 0.84, "ring": 0.86, "little": 0.88},
}


def _grip_frames(index_extra_rad: float) -> list[dict]:
    """Three seconds of a held grip with every index joint over-curled by index_extra_rad."""
    spec = HoldPose.model_validate(GRIP)
    out = []
    for i in range(90):
        frame = synthesiser.frame_at(spec, i / 30.0, ("right",))
        hand = frame.hands[0]
        index = tuple(v + index_extra_rad for v in hand.flexion["index"])
        out.append(
            frame.model_copy(
                update={
                    "hands": [
                        hand.model_copy(
                            update={"flexion": {**hand.flexion, "index": index}}
                        )
                    ]
                }
            ).model_dump(mode="json")
        )
    return out


def _score(client: TestClient, tolerance: dict, **extra: object) -> dict:
    """Score the over-curled index grip against the held grip."""
    return client.post(
        "/api/score",
        json={
            "reference_motion": GRIP,
            "attempt_frames": _grip_frames(0.12),
            "tolerance": tolerance,
            **extra,
        },
    ).json()


def test_score_honours_per_finger_tolerance(client: TestClient) -> None:
    """An index 21 degrees over is off at 18, inside a loose 30 for the index alone, and the margin still scales it."""
    plain = _score(client, {"angle_deg": 18})
    uniform = _score(
        client, {"angle_deg": 18, "finger_angle_deg": dict.fromkeys(FINGERS, 18.0)}
    )
    assert uniform == plain and plain["within_tolerance"] is False
    loose = _score(client, {"angle_deg": 18, "finger_angle_deg": {"index": 30}})
    assert (
        loose["within_tolerance"] is True
        and loose["per_finger"]["index"] > plain["per_finger"]["index"]
    )
    relaxed = _score(
        client, {"angle_deg": 18, "finger_angle_deg": {"index": 30}}, margin="relaxed"
    )
    assert relaxed["hint"] == "Great match. Keep the same shape and rhythm."
    strict_margin = _score(
        client, {"angle_deg": 18, "finger_angle_deg": {"index": 30}}, margin="strict"
    )
    assert (
        strict_margin["within_tolerance"] is False and "index" in strict_margin["hint"]
    )
    tight = _score(client, {"angle_deg": 18, "finger_angle_deg": {"index": 10}})
    assert tight["per_finger"]["index"] < plain["per_finger"]["index"]


def test_worst_finger_and_hint_follow_each_fingers_own_band() -> None:
    """With per-finger bands the finger furthest outside its own band is the worst and the one the hint names."""
    cmp = scoring.Comparison(
        {"thumb": 0.0, "index": 20.0, "middle": 0.0, "ring": 12.0, "little": 0.0},
        {"thumb": 0.0, "index": 20.0, "middle": 0.0, "ring": -12.0, "little": 0.0},
        0.0,
        0.0,
    )
    assert scoring.to_result(cmp, Tolerance()).worst_finger == "index"
    banded = scoring.to_result(
        cmp, Tolerance(finger_angle_deg={"index": 36, "ring": 10})
    )
    assert banded.worst_finger == "ring" and "ring" in banded.hint
    assert banded.per_finger.index == round(
        100 * math.exp(-0.5 * (20 / (1.5 * 36)) ** 2), 1
    )


def test_coach_hint_uses_per_finger_tolerance(client: TestClient) -> None:
    """The live hint picks the finger furthest outside its own band, measures severity against it, and the margin scales it."""
    request = CoachHintRequest.model_validate(
        {
            "deviations": {"index": 20, "ring": -12},
            "finger_tolerance_deg": {"index": 36, "ring": 10},
        }
    )
    draft = hints.build_hint_draft(request)
    assert draft.focus_finger == "ring" and draft.severity == "medium"
    assert (
        hints.build_hint_draft(
            request.model_copy(update={"finger_tolerance_deg": None})
        ).focus_finger
        == "index"
    )
    quiet = request.model_copy(update={"margin": "just_trying"})
    assert hints.build_hint_draft(quiet).cue_type == "praise"
    body = client.post(
        "/api/coach/hint",
        json={
            "deviations": {"index": 20, "ring": -12},
            "finger_tolerance_deg": {"index": 36, "ring": 10},
        },
    ).json()
    assert body["focus_finger"] == "ring"
    assert (
        client.post(
            "/api/coach/hint", json={"finger_tolerance_deg": {"ring": -1}}
        ).status_code
        == 422
    )
