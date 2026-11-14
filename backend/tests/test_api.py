"""HTTP API tests: health, moves, lessons, generation, recordings, calibration, scoring, dev state."""

import time

from fastapi.testclient import TestClient

from app.schemas.records import Recording
from app.services.llm.base import LLMRequest
from app.services.llm.fake import FakeLLM

MOTION = {"preset": "finger_sequence", "sequence": [1, 2, 3, 4, 5], "beat_ms": 400}


def test_health(client: TestClient) -> None:
    """Health reports the active source and provider."""
    body = client.get("/api/health").json()
    assert body == {"status": "ok", "glove_source": "simulator", "llm_provider": "fake"}


def test_moves_catalogue_and_filter(client: TestClient) -> None:
    """The catalogue serves all skills and filters by skill."""
    everything = client.get("/api/moves").json()
    assert {m["skill"] for m in everything} == {"table_tennis", "piano", "general"}
    piano = client.get("/api/moves", params={"skill": "piano"}).json()
    assert len(piano) == 3 and all(m["skill"] == "piano" for m in piano)


def test_seed_lessons_present(client: TestClient) -> None:
    """Seed lessons are installed with the required steps."""
    lessons = {lesson["id"]: lesson for lesson in client.get("/api/lessons").json()}
    tt = lessons["seed-table-tennis"]
    assert [s["title"] for s in tt["steps"]] == [
        "Lesson 1: The shakehand grip", "Lesson 2: Forehand swing", "Lesson 3: Wrist snap at contact",
    ]
    assert tt["test"] == {"kind": "table_tennis_rally", "opponent": "bot", "rounds": 3}
    assert lessons["seed-piano"]["steps"][1]["motion"]["sequence"] == [1, 2, 3, 4, 5, 4, 3, 2, 1]


def test_lesson_crud(client: TestClient) -> None:
    """Create, read, update and 404 a lesson."""
    body = {"title": "Mine", "skill": "general", "steps": [{"title": "Lesson 1", "instruction": "Do it"}]}
    created = client.post("/api/lessons", json=body)
    assert created.status_code == 201
    lesson = created.json()
    assert lesson["id"] and lesson["created_at"] and lesson["steps"][0]["id"]
    assert client.get(f"/api/lessons/{lesson['id']}").json()["title"] == "Mine"
    lesson["title"] = "Renamed"
    updated = client.put(f"/api/lessons/{lesson['id']}", json=lesson).json()
    assert updated["title"] == "Renamed" and updated["created_at"] == lesson["created_at"]
    assert client.get("/api/lessons/nope").status_code == 404
    assert client.get("/api/lessons/..%2Fx").status_code in (400, 404)


def test_generate_with_fake(client: TestClient) -> None:
    """The fake provider returns a validated template and reports provenance."""
    body = client.post("/api/lessons/generate", json={"prompt": "teach me piano scales"}).json()
    assert body["provider"] == "fake" and body["attempts"] == 1
    assert body["lesson"]["skill"] == "piano" and body["lesson"]["source"] == "generated"
    general = client.post("/api/lessons/generate", json={"prompt": "juggling"}).json()
    assert general["lesson"]["skill"] == "general"


class FlakyLLM:
    """Returns invalid JSON first, then delegates to the fake provider."""

    name = "gemini"

    def __init__(self, failures: int) -> None:
        """Fail this many times before succeeding."""
        self.failures = failures
        self.calls: list[str] = []

    async def generate_json(self, request: LLMRequest) -> str:
        """Return garbage until the failure budget is spent."""
        self.calls.append(request.prompt)
        if len(self.calls) <= self.failures:
            return "{not json"
        return await FakeLLM().generate_json(request)

    async def generate_text(self, request: LLMRequest) -> str:
        """Unused here."""
        return request.user_text


def test_generate_retries_with_errors_fed_back(client: TestClient) -> None:
    """Invalid JSON on the first call is retried and the errors appear in the next prompt."""
    flaky = FlakyLLM(failures=1)
    client.app.state.services.llm.use(flaky)
    body = client.post("/api/lessons/generate", json={"prompt": "table tennis grip"}).json()
    assert body["provider"] == "gemini" and body["attempts"] == 2
    assert "FAILED VALIDATION" in flaky.calls[1] and "FAILED VALIDATION" not in flaky.calls[0]


def test_generate_falls_back_to_fake_after_retries(client: TestClient) -> None:
    """Three invalid answers in a row fall back to the fake template."""
    client.app.state.services.llm.use(FlakyLLM(failures=99))
    body = client.post("/api/lessons/generate", json={"prompt": "table tennis"}).json()
    assert body["provider"] == "fake" and body["attempts"] == 3
    assert body["lesson"]["skill"] == "table_tennis"


def test_motion_preview(client: TestClient) -> None:
    """Preview returns synthesised single-hand frames."""
    body = client.post("/api/motion/preview", json={"motion": MOTION, "side": "left", "duration_s": 1}).json()
    assert len(body["frames"]) == 60
    assert body["frames"][0]["hands"][0]["side"] == "left"
    assert client.post("/api/motion/preview", json={"motion": {"preset": "nope"}, "duration_s": 1}).status_code == 422


def _record(client: TestClient, seconds: float = 0.5) -> dict:
    """Record the live simulator for a short time and return the stored recording."""
    started = client.post("/api/recordings/start", json={"lesson_id": "l", "step_id": "s"}).json()
    time.sleep(seconds)
    return client.post(f"/api/recordings/{started['recording_id']}/stop").json()


def test_recording_start_stop(client: TestClient) -> None:
    """A recording captures smoothed simulator frames starting at t=0 and is retrievable."""
    client.post("/api/dev/state", json={"simulator_motion": MOTION})
    recording = _record(client)
    assert recording["frames"][0]["t"] == 0 and len(recording["frames"]) > 10
    assert recording["frames"][0]["source"] == "simulator"
    assert 30 < recording["fps"] < 90
    assert client.get(f"/api/recordings/{recording['id']}").json()["id"] == recording["id"]
    assert client.post("/api/recordings/missing/stop").status_code == 404
    assert recording["hands"] == "both"
    assert {h["side"] for h in recording["frames"][0]["hands"]} == {"left", "right"}


def test_recording_keeps_only_the_chosen_hand(client: TestClient) -> None:
    """A one-handed take stores only that hand, and says so on the recording."""
    client.post("/api/dev/state", json={"simulator_motion": MOTION})
    started = client.post("/api/recordings/start", json={"step_id": "s", "hands": "left"}).json()
    time.sleep(0.4)
    recording = client.post(f"/api/recordings/{started['recording_id']}/stop").json()
    assert recording["hands"] == "left"
    assert recording["frames"] and all([h["side"] for h in f["hands"]] == ["left"] for f in recording["frames"])
    assert client.post("/api/recordings/start", json={"hands": "middle"}).status_code == 422


def test_calibration_phases(client: TestClient) -> None:
    """Both phases merge into the latest calibration for the side."""
    assert client.get("/api/calibrations/latest", params={"side": "right"}).status_code == 404
    flat = client.post("/api/calibrations", json={"side": "right", "phase": "flat", "duration_s": 0.3})
    assert flat.status_code == 200
    client.post("/api/dev/state", json={"simulator_motion": {"preset": "hold_pose", "pose": dict.fromkeys(
        ["thumb", "index", "middle", "ring", "little"], 1.0)}})
    time.sleep(0.2)
    fist = client.post("/api/calibrations", json={"side": "right", "phase": "fist", "duration_s": 0.4}).json()
    latest = client.get("/api/calibrations/latest", params={"side": "right"}).json()
    assert latest["id"] == fist["id"]
    assert latest["fist"]["index"][0] > latest["flat"]["index"][0]


def _perturbed(client: TestClient, recording: dict, delta: float) -> str:
    """Store a copy of a recording with the index finger bent further by delta radians."""
    for frame in recording["frames"]:
        for hand in frame["hands"]:
            hand["flexion"]["index"] = [v + delta for v in hand["flexion"]["index"]]
    recording["id"] = "perturbed"
    client.app.state.services.recorder._store.save(Recording.model_validate(recording))
    return "perturbed"


def test_score_identical_and_perturbed(client: TestClient) -> None:
    """An identical attempt scores about 100; a bent index finger scores lower and is named the worst finger."""
    client.post("/api/dev/state", json={"simulator_motion": MOTION})
    recording = _record(client, 0.8)
    same = client.post("/api/score", json={
        "reference_recording_id": recording["id"], "attempt_recording_id": recording["id"],
    }).json()
    assert same["overall"] >= 99 and same["within_tolerance"] is True
    attempt_id = _perturbed(client, dict(recording), 0.6)
    worse = client.post("/api/score", json={
        "reference_recording_id": recording["id"], "attempt_recording_id": attempt_id,
    }).json()
    assert worse["overall"] < same["overall"] - 5 and worse["per_finger"]["index"] < 60
    assert worse["worst_finger"] == "index" and worse["within_tolerance"] is False
    assert "index" in worse["hint"]
    assert worse["per_finger"]["index"] < worse["per_finger"]["middle"]


def test_score_against_motion_and_validation(client: TestClient) -> None:
    """A reference motion works, and giving both or neither reference is rejected."""
    client.post("/api/dev/state", json={"simulator_motion": MOTION})
    recording = _record(client, 0.6)
    ok = client.post("/api/score", json={"reference_motion": MOTION, "attempt_recording_id": recording["id"]})
    assert ok.status_code == 200
    bad = client.post("/api/score", json={"attempt_recording_id": recording["id"]})
    assert bad.status_code == 422


def test_coach_hint_algorithmic(client: TestClient) -> None:
    """The coach names the worst finger from the deviations."""
    body = client.post("/api/coach/hint", json={
        "instruction": "Grip", "deviations": {"ring": 25}, "timing_ms": 0,
    }).json()
    assert "ring" in body["hint"] and body["provider"] == "fake"


def test_dev_state_switching(client: TestClient) -> None:
    """Dev state switches smoothing, provider, motion and glove source live."""
    state = client.post("/api/dev/state", json={
        "smoothing": {"min_cutoff": 0.5, "beta": 0.1, "enabled": False}, "llm_provider": "ollama",
        "simulator_motion": MOTION,
    }).json()
    assert state["smoothing"] == {"enabled": False, "min_cutoff": 0.5, "beta": 0.1}
    assert state["llm_provider"] == "ollama" and state["simulator_motion"]["preset"] == "finger_sequence"
    sdk = client.post("/api/dev/state", json={"glove_source": "rokoko_sdk"})
    assert sdk.status_code == 501 and "licence" in sdk.json()["detail"]
    assert client.get("/api/dev/state").json()["glove_source"] == "simulator"
    udp = client.post("/api/dev/state", json={"glove_source": "rokoko_udp"}).json()
    assert udp["glove_source"] == "rokoko_udp"
    back = client.post("/api/dev/state", json={"glove_source": "simulator"}).json()
    assert back["glove_source"] == "simulator"


def test_vision_reports_missing_extra_or_bad_image(client: TestClient) -> None:
    """Without the vision extra the route returns 503; with it, a bad image is a 400."""
    response = client.post("/api/vision/hands", files={"image": ("x.jpg", b"not an image", "image/jpeg")})
    assert response.status_code in (400, 503)
