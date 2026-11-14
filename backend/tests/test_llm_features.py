"""Practice plan and text-to-motion endpoints, with the fake provider and a stub provider."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from app import constants as c
from app.services.llm.base import LLMRequest
from app.services.llm.gemini import GeminiLLM


def _score(worst: str, overall: float = 50.0) -> dict:
    """Build a ScoreResult body whose lowest per-finger score is the given finger."""
    per = {"thumb": 90, "index": 90, "middle": 90, "ring": 90, "little": 90}
    per[worst] = 20
    return {"overall": overall, "per_finger": per, "timing": 0.8, "within_tolerance": False, "worst_finger": worst, "hint": "x"}


PLAN = {
    "lesson_title": "Grip",
    "steps": [{"step_id": "a", "title": "Hold"}, {"step_id": "b", "title": "Swing"}],
    "attempts": [{"step_id": "a", "score": _score("ring", 40)}, {"step_id": "b", "score": _score("thumb", 70)}],
}


def test_plan_fake_is_deterministic(client: TestClient) -> None:
    """The fake plan targets the worst finger of the weakest step first."""
    first = client.post("/api/coach/plan", json=PLAN).json()
    assert first == client.post("/api/coach/plan", json=PLAN).json()
    assert first["provider"] == "fake" and len(first["summary"].split()) <= 60
    assert [(d["step_id"], d["focus_finger"]) for d in first["drills"]] == [("a", "ring"), ("b", "thumb")]
    assert "ring" in first["master_note"]


def test_plan_without_attempts(client: TestClient) -> None:
    """With no attempts the plan is a single baseline drill with no focus finger."""
    body = client.post("/api/coach/plan", json={**PLAN, "attempts": []}).json()
    assert len(body["drills"]) == 1 and body["drills"][0]["focus_finger"] is None


def test_plan_rejects_oversize_lists(client: TestClient) -> None:
    """Too many steps or attempts is a 422."""
    steps = [{"step_id": str(i), "title": "t"} for i in range(21)]
    assert client.post("/api/coach/plan", json={**PLAN, "steps": steps}).status_code == 422
    assert client.post("/api/coach/plan", json={**PLAN, "attempts": PLAN["attempts"] * 31}).status_code == 422


@pytest.mark.parametrize(("text", "preset"), [
    ("a pinch", "pinch"), ("penhold backhand", "grip_and_swing"), ("play a piano scale", "finger_sequence"),
    ("make a fist", "hold_pose"), ("wave", "idle"),
])
def test_motion_from_text_rules(client: TestClient, text: str, preset: str) -> None:
    """Keyword rules choose the preset."""
    body = client.post("/api/motion/from_text", json={"text": text, "side": "left"}).json()
    assert body["motion"]["preset"] == preset and body["provider"] == "fake" and body["explanation"]


def test_motion_slow_doubles_beat(client: TestClient) -> None:
    """'slowly' doubles the default beat and penhold sets the grip."""
    fast = client.post("/api/motion/from_text", json={"text": "penhold grip"}).json()["motion"]
    slow = client.post("/api/motion/from_text", json={"text": "penhold grip, slowly"}).json()["motion"]
    assert fast["grip"] == "penhold" and slow["beat_ms"] == fast["beat_ms"] * 2


def test_motion_rejects_bad_input(client: TestClient) -> None:
    """Empty, oversize or unknown-side input is a 422."""
    assert client.post("/api/motion/from_text", json={"text": "x" * 201}).status_code == 422
    assert client.post("/api/motion/from_text", json={"text": ""}).status_code == 422
    assert client.post("/api/motion/from_text", json={"text": "pinch", "side": "up"}).status_code == 422


class BadLLM:
    """Always answers with the same bad JSON and records every prompt."""

    name = "gemini"

    def __init__(self, answer: str) -> None:
        """Answer every call with this text."""
        self.answer = answer
        self.prompts: list[str] = []

    async def generate_json(self, request: LLMRequest) -> str:
        """Return the bad answer."""
        self.prompts.append(request.prompt)
        return self.answer

    async def generate_text(self, request: LLMRequest) -> str:
        """Unused here."""
        return request.user_text


def test_plan_malformed_retries_then_falls_back(client: TestClient) -> None:
    """Three malformed answers, with errors fed back, end in the fake plan."""
    stub = BadLLM('{"summary": "hi", "drills": [], "master_note": "n"}')
    client.app.state.services.llm.use(stub)
    body = client.post("/api/coach/plan", json=PLAN).json()
    assert len(stub.prompts) == 3 and "FAILED VALIDATION" in stub.prompts[1]
    assert body["provider"] == "fake" and body["drills"]


def test_motion_malformed_retries_then_falls_back(client: TestClient) -> None:
    """An out-of-bounds beat is rejected three times, then keyword rules answer."""
    stub = BadLLM('{"motion": {"preset": "pinch", "fingers": [2], "beat_ms": 5}, "explanation": "e"}')
    client.app.state.services.llm.use(stub)
    body = client.post("/api/motion/from_text", json={"text": "pinch"}).json()
    assert len(stub.prompts) == 3 and "FAILED VALIDATION" in stub.prompts[2]
    assert body["provider"] == "fake" and body["motion"]["preset"] == "pinch"


class SlowGemini(GeminiLLM):
    """A real GeminiLLM whose underlying call hangs, counting how often it is called."""

    def __init__(self) -> None:
        """Start with no credentials and no calls."""
        super().__init__("key", "model")
        self.calls = 0

    async def _generate(self, request: LLMRequest, as_json: bool) -> str:
        """Sleep far longer than the patched timeout."""
        self.calls += 1
        await asyncio.sleep(5)
        return "{}"


def test_gemini_timeout_falls_back_without_retry(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """A hung Gemini call times out once and goes straight to the fake fallback on every LLM endpoint."""
    monkeypatch.setattr(c, "LLM_GEMINI_TIMEOUT_S", 0.05)
    slow = SlowGemini()
    client.app.state.services.llm.use(slow)
    plan = client.post("/api/coach/plan", json=PLAN).json()
    assert plan["provider"] == "fake" and slow.calls == 1
    motion = client.post("/api/motion/from_text", json={"text": "pinch"}).json()
    assert motion["provider"] == "fake" and slow.calls == 2
    lesson = client.post("/api/lessons/generate", json={"prompt": "piano"}).json()
    assert lesson["provider"] == "fake" and slow.calls == 3 and lesson["attempts"] == 1
