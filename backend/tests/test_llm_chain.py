"""The fallback chain: gemini, then ollama, then fake rule lines. Every provider here is a stub or unreachable."""

import asyncio
import json
from pathlib import Path

import pytest
from app.core.config import Settings
from app.core.errors import LLMTimeoutError, RateLimitedError, ServiceUnavailableError
from app.services.llm import chain as chain_mod
from app.services.llm.base import LLMRequest
from app.services.llm.chain import ChainLLM, answered_by
from app.services.llm.fake import FakeLLM
from app.services.llm.gemini import GeminiLLM
from app.services.llm.ollama import OllamaLLM
from app.services.llm.registry import LLMState
from fastapi.testclient import TestClient

HINT_BODY = {"deviations": {"index": 25}}


class Stub:
    """A named provider that raises, sleeps or answers, and records what it was asked."""

    def __init__(self, name: str, answer: str = "{}", error: Exception | None = None, delay: float = 0.0, video: bool = False) -> None:
        """Remember the behaviour."""
        self.name = name
        self.answer = answer
        self.error = error
        self.delay = delay
        self.supports_video = video
        self.requests: list[LLMRequest] = []

    async def generate_json(self, request: LLMRequest) -> str:
        """Record, wait, then fail or answer."""
        self.requests.append(request)
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error is not None:
            raise self.error
        return self.answer

    async def generate_text(self, request: LLMRequest) -> str:
        """Same as generate_json."""
        return await self.generate_json(request)


def _request(task: str = "hint", model: str | None = None, video: str | None = None) -> LLMRequest:
    """A minimal request."""
    return LLMRequest("system", "prompt", "{}", task=task, model=model, video_path=video)  # type: ignore[arg-type]


def _run(chain: ChainLLM, request: LLMRequest) -> tuple[str, str]:
    """Call the chain and read who answered, inside one event loop task."""

    async def go() -> tuple[str, str]:
        text = await chain.generate_json(request)
        return text, answered_by("none")

    return asyncio.run(go())


@pytest.mark.parametrize(
    "error",
    [RateLimitedError("budget spent"), LLMTimeoutError("slow"), ServiceUnavailableError("no key"), RuntimeError("boom")],
)
def test_any_failure_moves_to_the_next_link(error: Exception) -> None:
    """Rate limit, timeout, missing key or any other exception hands the call to the next provider."""
    chain = ChainLLM([Stub("gemini", error=error), Stub("ollama", answer="from ollama"), FakeLLM()])
    assert _run(chain, _request("plan")) == ("from ollama", "ollama")
    assert chain.last_answered == "ollama" and chain.last_errors[0].startswith("gemini:")


def test_first_link_answers_when_healthy() -> None:
    """A healthy first provider is the only one called."""
    backup = Stub("ollama", answer="unused")
    chain = ChainLLM([Stub("gemini", answer="from gemini"), backup])
    assert _run(chain, _request()) == ("from gemini", "gemini")
    assert not backup.requests


def test_slow_fallback_is_cut_off(monkeypatch: pytest.MonkeyPatch) -> None:
    """A fallback that hangs on a live hint is abandoned for the next link."""
    monkeypatch.setattr(chain_mod, "FALLBACK_HINT_TIMEOUT_S", 0.05)
    chain = ChainLLM([Stub("gemini", error=RateLimitedError("x")), Stub("ollama", delay=1.0), Stub("fake", answer="rules")])
    assert _run(chain, _request("hint")) == ("rules", "fake")
    assert chain.last_errors == ["gemini: RateLimitedError: x", "ollama: timeout"]


def test_all_links_failing_raises_the_last_error() -> None:
    """A chain without fake raises the last provider's error so callers keep their own fallback."""
    chain = ChainLLM([Stub("gemini", error=RateLimitedError("a")), Stub("ollama", error=ServiceUnavailableError("b"))])
    with pytest.raises(ServiceUnavailableError, match="b"):
        _run(chain, _request())


def test_fallback_drops_the_gemini_model_override() -> None:
    """The Gemini hint model name is never sent to Ollama."""
    ollama = Stub("ollama", answer="ok")
    chain = ChainLLM([Stub("gemini", error=RuntimeError("x")), ollama])
    _run(chain, _request(model="gemini-hint-model"))
    assert ollama.requests[0].model is None


def test_video_skips_providers_that_cannot_watch() -> None:
    """A video request goes from Gemini straight to the fake template, never to a text-only model."""
    ollama = Stub("ollama", answer="never")
    chain = ChainLLM([Stub("gemini", error=RuntimeError("x"), video=True), ollama, Stub("fake", answer="template")])
    assert _run(chain, _request("lesson", video="/tmp/v.mp4")) == ("template", "fake")
    assert not ollama.requests and chain.supports_video


def test_real_providers_fall_through_without_network(tmp_path: Path) -> None:
    """Gemini with no key and Ollama on a closed port both fail fast, and fake rule lines answer."""
    chain = ChainLLM([GeminiLLM(None, "gemini-x"), OllamaLLM("http://127.0.0.1:9", "gemma4:e4b"), FakeLLM()])
    hint = {"deviations": {"index": 25, "thumb": 0, "middle": 0, "ring": 0, "little": 0}}
    request = LLMRequest("s", "p", json.dumps(hint), task="hint")
    text, who = _run(chain, request)
    assert who == "fake" and json.loads(text)["focus_finger"] == "index"


def _state(tmp_path: Path, provider: str, fallback: str) -> LLMState:
    """An LLMState with the given provider and fallback list."""
    return LLMState(Settings(data_dir=tmp_path, llm_provider=provider, llm_fallback=fallback, gemini_api_key=None))  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("provider", "fallback", "expected"),
    [
        ("gemini", "ollama", ["gemini", "ollama", "fake"]),
        ("gemini", "ollama,openai", ["gemini", "ollama", "openai", "fake"]),
        ("gemini", "none", ["gemini"]),
        ("gemini", "nonsense", ["gemini", "fake"]),
        ("ollama", "ollama", ["ollama", "fake"]),
        ("fake", "ollama", ["fake"]),
    ],
)
def test_registry_builds_the_chain_from_settings(tmp_path: Path, provider: str, fallback: str, expected: list[str]) -> None:
    """LLM_FALLBACK picks the links after LLM_PROVIDER; fake always closes the chain."""
    assert _state(tmp_path, provider, fallback).chain == expected


def test_default_fallback_is_ollama() -> None:
    """With no LLM_FALLBACK set the chain falls back to Ollama."""
    assert Settings.model_fields["llm_fallback"].default == "ollama"


def test_coach_reports_the_fallback_that_answered(client: TestClient) -> None:
    """When Gemini is rate limited the hint comes from Ollama and says so."""
    answer = '{"hint": "Lift your index finger a little.", "focus_finger": "index", "cue_type": "extend", "severity": "medium"}'
    gemini = Stub("gemini", error=RateLimitedError("spent"))
    ollama = Stub("ollama", answer=answer)
    llm = client.app.state.services.llm
    llm.use(ChainLLM([gemini, ollama, FakeLLM()]))
    body = client.post("/api/coach/hint", json=HINT_BODY).json()
    assert body["provider"] == "ollama" and body["hint"] == "Lift your index finger a little."
    assert llm.last_answered == "ollama"
    again = client.post("/api/coach/hint", json=HINT_BODY).json()
    assert again["provider"] == "ollama" and len(ollama.requests) == 1  # cached with its provider


def test_coach_ends_on_rule_lines_when_every_model_fails(client: TestClient) -> None:
    """Gemini and Ollama both down: the fake provider writes the rule-based cue."""
    chain = ChainLLM([Stub("gemini", error=LLMTimeoutError("slow")), Stub("ollama", error=ServiceUnavailableError("down")), FakeLLM()])
    client.app.state.services.llm.use(chain)
    body = client.post("/api/coach/hint", json=HINT_BODY).json()
    assert body["provider"] == "fake" and body["focus_finger"] == "index" and body["cue_type"] == "extend"


def test_plan_reports_the_fallback_that_answered(client: TestClient) -> None:
    """The practice plan names Ollama when Gemini failed and Ollama wrote it."""
    plan = json.dumps({"summary": "Slow down.", "drills": [{"step_id": "a", "focus_finger": None, "exercise": "Pinch slowly."}], "master_note": "Fine."})
    client.app.state.services.llm.use(ChainLLM([Stub("gemini", error=RuntimeError("x")), Stub("ollama", answer=plan), FakeLLM()]))
    body = client.post("/api/coach/plan", json={"lesson_title": "Pinch", "steps": [], "attempts": []})
    assert body.status_code == 200, body.text
    assert body.json()["provider"] == "ollama"
