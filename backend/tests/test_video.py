"""Video to lesson: upload validation, the fake fallback and the Gemini upload, poll and generate order."""

import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import constants as c
from app.services.llm.gemini import GeminiLLM

URL = "/api/lessons/generate_from_video"


def _post(client: TestClient, data: bytes = b"x" * 100, mime: str = "video/mp4", **form: str):
    """Upload a video with optional form fields."""
    return client.post(URL, files={"video": ("clip.mp4", data, mime)}, data=form)


def test_fake_provider_returns_template_with_note(client: TestClient) -> None:
    """Offline providers return the template lesson and say video analysis needs Gemini."""
    body = _post(client, prompt="penhold table tennis grip").json()
    assert body["provider"] == "fake" and "Gemini" in body["lesson"]["summary"]
    assert body["lesson"]["skill"] == "table_tennis"


def test_wrong_type_is_415(client: TestClient) -> None:
    """Non-video uploads are rejected."""
    assert _post(client, mime="text/plain").status_code == 415


def test_oversize_is_413(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Uploads above the size cap are rejected."""
    monkeypatch.setattr(c, "VIDEO_MAX_BYTES", 50)
    assert _post(client, data=b"x" * 200).status_code == 413


class _Files:
    """Stub of client.aio.files that records calls and goes ACTIVE on the second poll."""

    def __init__(self, calls: list[str]) -> None:
        self.calls, self.polls = calls, 0

    async def upload(self, *, file, config=None):
        self.calls.append("upload")
        return SimpleNamespace(name="files/1", uri="uri://1", state="PROCESSING", mime_type="video/mp4")

    async def get(self, *, name):
        self.calls.append("get")
        self.polls += 1
        state = "ACTIVE" if self.polls > 1 else "PROCESSING"
        return SimpleNamespace(name=name, uri="uri://1", mime_type="video/mp4", state=state)

    async def delete(self, *, name):
        self.calls.append("delete")


class _Models:
    """Stub of client.aio.models."""

    def __init__(self, calls: list[str], answer: str) -> None:
        self.calls, self.answer = calls, answer

    async def generate_content(self, *, model, contents, config):
        self.calls.append("generate")
        self.contents = contents
        return SimpleNamespace(text=self.answer)


def test_gemini_uploads_polls_then_generates(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """The Gemini path uploads, polls until ACTIVE, generates with the video part, then cleans up."""
    monkeypatch.setattr(c, "VIDEO_POLL_INTERVAL_S", 0.0)
    lesson = client.post("/api/lessons/generate", json={"prompt": "piano scale"}).json()["lesson"]
    draft = {k: lesson[k] for k in ("title", "skill", "summary", "source", "steps")}
    calls: list[str] = []
    files, models = _Files(calls), _Models(calls, json.dumps(draft))
    llm = GeminiLLM("key", "model")
    llm._client = SimpleNamespace(aio=SimpleNamespace(files=files, models=models))
    client.app.state.services.llm.use(llm)
    body = _post(client, prompt="teach this").json()
    assert calls == ["upload", "get", "get", "generate", "delete"]
    assert body["provider"] == "gemini" and body["attempts"] == 1
    assert len(models.contents) == 2
