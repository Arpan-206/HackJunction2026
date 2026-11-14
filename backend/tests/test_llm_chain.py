"""The fallback chain: Gemini and Gemma on Verda back each other up, then the coach goes offline. Stubs only."""

import asyncio
import json
import logging
import time
from pathlib import Path

import pytest
from app.core.config import Settings
from app.core.errors import LLMTimeoutError, RateLimitedError, ServiceUnavailableError
from app.services.llm import chain as chain_mod
from app.services.llm.base import LLMRequest
from app.services.llm.chain import OFFLINE, ChainLLM, LLMOfflineError, answered_by
from app.services.llm.coach import OFFLINE_NOTE
from app.services.llm.gemini import GeminiLLM
from app.services.llm.openai_compat import OpenAICompatLLM
from app.services.llm.registry import LLMState
from fastapi.testclient import TestClient

HINT_BODY = {"deviations": {"index": 25}}
GOOD_HINT = '{"hint": "Lift your index finger a little.", "focus_finger": "index", "cue_type": "extend", "severity": "medium"}'
PLAN_BODY = {"lesson_title": "Pinch", "steps": [], "attempts": []}
GOOD_PLAN = json.dumps({"summary": "Slow down.", "drills": [{"step_id": "a", "exercise": "Pinch slowly."}], "master_note": "Fine."})


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
    chain = ChainLLM([Stub("gemini", error=error), Stub("openai", answer="from verda")])
    assert _run(chain, _request("plan")) == ("from verda", "openai")
    assert chain.last_answered == "openai" and chain.last_errors[0].startswith("gemini:")


def test_first_link_answers_when_healthy() -> None:
    """A healthy first provider is the only one called."""
    backup = Stub("openai", answer="unused")
    chain = ChainLLM([Stub("gemini", answer="from gemini"), backup])
    assert _run(chain, _request()) == ("from gemini", "gemini")
    assert not backup.requests


def test_slow_verda_falls_back_to_gemini_and_logs_it(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    """Gemma on Verda past its cap: the same request goes to Gemini, and one log line names role, reason and latencies."""
    monkeypatch.setattr(chain_mod, "OPENAI_TIMEOUT_S", 0.05)
    verda = Stub("openai", delay=1.0)
    gemini = Stub("gemini", answer="lesson json")
    chain = ChainLLM([verda, gemini])
    with caplog.at_level(logging.WARNING, logger="app.services.llm.chain"):
        assert _run(chain, _request("lesson")) == ("lesson json", "gemini")
    assert gemini.requests[0].prompt == verda.requests[0].prompt
    line = next(r.getMessage() for r in caplog.records if r.getMessage().startswith("LLM fallback:"))
    for part in ("role=lesson", "from=openai", "to=gemini", "reason=timeout after 0.05 s", "failed_after=", "answered_in="):
        assert part in line


def test_verda_cap_is_twenty_seconds_and_hints_are_short() -> None:
    """The caps the brief asks for: 20 s on Verda, a few seconds on any live hint."""
    assert chain_mod.OPENAI_TIMEOUT_S == 20.0
    assert chain_mod.HINT_TIMEOUT_S <= 5.0


def test_every_link_down_raises_offline_at_once(monkeypatch: pytest.MonkeyPatch) -> None:
    """Two hanging providers on a hint: the chain gives up after the short caps, not the providers' own."""
    monkeypatch.setattr(chain_mod, "HINT_TIMEOUT_S", 0.05)
    chain = ChainLLM([Stub("gemini", delay=5.0), Stub("openai", delay=5.0)])
    start = time.perf_counter()
    with pytest.raises(LLMOfflineError):
        _run(chain, _request("hint"))
    assert time.perf_counter() - start < 1.0
    assert chain.last_answered == OFFLINE and len(chain.last_errors) == 2


def test_fallback_drops_the_first_model_override() -> None:
    """The Gemini hint model name is never sent to Verda."""
    verda = Stub("openai", answer="ok")
    chain = ChainLLM([Stub("gemini", error=RuntimeError("x")), verda])
    _run(chain, _request(model="gemini-hint-model"))
    assert verda.requests[0].model is None


def test_video_skips_providers_that_cannot_watch() -> None:
    """A video lesson routed to Verda first goes straight to Gemini, which can watch it."""
    verda = Stub("openai", answer="never")
    chain = ChainLLM([verda, Stub("gemini", answer="from video", video=True)])
    assert chain.supports_video
    assert _run(chain, _request("lesson", video="/tmp/v.mp4")) == ("from video", "gemini")
    assert not verda.requests


def test_real_providers_go_offline_without_network() -> None:
    """Gemini with no key and Verda on a closed port both fail fast."""
    chain = ChainLLM([GeminiLLM(None, "gemini-x"), OpenAICompatLLM("http://127.0.0.1:9", None, "gemma")])
    with pytest.raises(LLMOfflineError):
        _run(chain, _request("hint"))


def _state(tmp_path: Path, **kw: object) -> LLMState:
    """An LLMState that never reads a .env file."""
    return LLMState(Settings(_env_file=None, data_dir=tmp_path, gemini_api_key=None, **kw))  # type: ignore[call-arg]


VERDA = {"openai_base_url": "https://verda.example"}


@pytest.mark.parametrize(
    ("kw", "expected"),
    [
        ({"llm_provider": "gemini"}, ["gemini"]),
        ({"llm_provider": "gemini", **VERDA}, ["gemini", "openai"]),
        ({"llm_provider": "openai", **VERDA}, ["openai", "gemini"]),
        ({"llm_provider": "gemini", "llm_fallback": "none", **VERDA}, ["gemini"]),
        ({"llm_provider": "gemini", "llm_fallback": "ollama", **VERDA}, ["gemini"]),
        ({"llm_provider": "fake", **VERDA}, ["fake"]),
        ({"llm_provider": "gemini", "openai_base_url": "http://localhost:8000"}, ["gemini"]),
        ({"llm_provider": "gemini", "openai_base_url": ""}, ["gemini"]),
    ],
)
def test_registry_builds_the_chain_from_settings(tmp_path: Path, kw: dict, expected: list[str]) -> None:
    """Verda joins only when OPENAI_BASE_URL is set; Ollama is never in a chain; fake has no chain."""
    assert _state(tmp_path, **kw).chain == expected


def test_routes_send_a_role_to_verda_first(tmp_path: Path) -> None:
    """LLM_ROUTES moves lesson generation to Gemma on Verda with Gemini behind it; other roles keep the default."""
    state = _state(tmp_path, llm_provider="gemini", llm_routes="lesson=openai, plan=openai, bogus=gemini", **VERDA)
    assert state.chain_for("lesson") == ["openai", "gemini"]
    assert state.chain_for("plan") == ["openai", "gemini"]
    assert state.chain_for("hint") == ["gemini", "openai"]
    assert state.hint_model == state._settings.gemini_hint_model
    state.select("fake")
    assert state.chain_for("lesson") == ["fake"]


def test_coach_reports_the_fallback_that_answered(client: TestClient) -> None:
    """When Gemini is rate limited the hint comes from Verda and says so."""
    verda = Stub("openai", answer=GOOD_HINT)
    llm = client.app.state.services.llm
    llm.use(ChainLLM([Stub("gemini", error=RateLimitedError("spent")), verda], on_answer=llm.record))
    body = client.post("/api/coach/hint", json=HINT_BODY).json()
    assert body["provider"] == "openai" and body["hint"] == "Lift your index finger a little."
    assert llm.last_answered == "openai"
    again = client.post("/api/coach/hint", json=HINT_BODY).json()
    assert again["provider"] == "openai" and len(verda.requests) == 1  # cached with its provider


def test_coach_shows_the_offline_note(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Gemini and Verda both hang: the coach answers quickly with the offline note, provider offline."""
    monkeypatch.setattr(chain_mod, "HINT_TIMEOUT_S", 0.05)
    llm = client.app.state.services.llm
    llm.use(ChainLLM([Stub("gemini", delay=5.0), Stub("openai", error=ServiceUnavailableError("down"))], on_answer=llm.record))
    start = time.perf_counter()
    body = client.post("/api/coach/hint", json=HINT_BODY).json()
    assert time.perf_counter() - start < 1.0
    assert body["provider"] == "offline" and body["hint"] == OFFLINE_NOTE
    assert body["focus_finger"] == "index" and body["cue_type"] == "extend"
    assert llm.last_answered == "offline"
    assert client.get("/api/dev/state").json()["llm_answered_by"] == "offline"


def test_offline_note_is_user_copy() -> None:
    """One sentence that names the AI Assistant and no model or provider."""
    assert OFFLINE_NOTE.count(".") == 1 and "AI Assistant" in OFFLINE_NOTE
    for banned in ("Gemini", "Gemma", "coach", "Verda", "Ollama", "—"):
        assert banned not in OFFLINE_NOTE


def test_plan_offline_uses_the_template_without_retrying(client: TestClient) -> None:
    """Every model down: the plan template answers after one try per provider, not three."""
    gemini = Stub("gemini", error=ServiceUnavailableError("down"))
    verda = Stub("openai", error=ServiceUnavailableError("down"))
    client.app.state.services.llm.use(ChainLLM([gemini, verda]))
    body = client.post("/api/coach/plan", json=PLAN_BODY).json()
    assert body["provider"] == "fake" and len(gemini.requests) == 1 and len(verda.requests) == 1


def test_plan_reports_the_fallback_that_answered(client: TestClient) -> None:
    """The practice plan names Verda when Gemini failed and Verda wrote it."""
    client.app.state.services.llm.use(ChainLLM([Stub("gemini", error=RuntimeError("x")), Stub("openai", answer=GOOD_PLAN)]))
    body = client.post("/api/coach/plan", json=PLAN_BODY)
    assert body.status_code == 200, body.text
    assert body.json()["provider"] == "openai"
