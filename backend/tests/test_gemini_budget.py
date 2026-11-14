"""Gemini request budget, TTL cache, the rate-limited fallback and the dev-state fields. No real API calls."""

from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import constants as c
from app.services.llm.gemini import GeminiLLM
from app.services.llm.rate_limit import RateLimiter, TTLCache, free_limits, pacific_day

MODEL = "gemini-3.8-flash"
NOON_UTC = 1_800_000_000.0


class Clock:
    """A settable fake time source."""

    def __init__(self, now: float = NOON_UTC) -> None:
        """Start at now."""
        self.now = now

    def __call__(self) -> float:
        """Return the fake time."""
        return self.now


def test_budgets_are_eighty_percent_of_free_limits(tmp_path: Path) -> None:
    """The 3.8 Flash free tier (5 per minute, 20 per day) gives a budget of 4 and 16."""
    assert free_limits(MODEL) == (5, 20)
    limiter = RateLimiter(tmp_path / "u.json")
    assert limiter.budgets(MODEL) == (4, 16)
    assert limiter.budgets("gemini-3.5-flash-lite") == (8, 400)
    assert limiter.budgets("unknown-model") == (4, 16)


def test_minute_window_slides(tmp_path: Path) -> None:
    """The fifth request inside a minute is refused; it is allowed again once the oldest has aged out."""
    clock = Clock()
    limiter = RateLimiter(tmp_path / "u.json", clock=clock, rpd_override=100)
    assert [limiter.try_acquire(MODEL) for _ in range(5)] == [True, True, True, True, False]
    assert limiter.remaining(MODEL)["rpm_remaining"] == 0
    clock.now += c.GEMINI_MINUTE_WINDOW_S - 1
    assert limiter.try_acquire(MODEL) is False
    clock.now += 1.5
    assert limiter.try_acquire(MODEL) is True


def test_daily_budget_persists_across_restart_and_resets(tmp_path: Path) -> None:
    """The day count survives a new limiter on the same file, and resets when the Pacific date changes."""
    clock = Clock()
    path = tmp_path / "u.json"
    first = RateLimiter(path, clock=clock, rpm_override=100)
    for _ in range(16):
        assert first.try_acquire(MODEL)
    restarted = RateLimiter(path, clock=clock, rpm_override=100)
    assert restarted.remaining(MODEL)["rpd_remaining"] == 0
    assert restarted.try_acquire(MODEL) is False
    clock.now += 86_400
    assert pacific_day(clock.now) != pacific_day(NOON_UTC)
    assert RateLimiter(path, clock=clock, rpm_override=100).try_acquire(MODEL) is True


def test_models_have_separate_budgets_and_corrupt_file_is_ignored(tmp_path: Path) -> None:
    """Each model counts on its own; a corrupt usage file starts from zero."""
    path = tmp_path / "u.json"
    path.write_text("not json", encoding="utf-8")
    limiter = RateLimiter(path, clock=Clock(), rpm_override=1)
    assert limiter.try_acquire(MODEL) and not limiter.try_acquire(MODEL)
    assert limiter.try_acquire("gemini-3.5-flash-lite")


def test_penalise_blocks_the_minute(tmp_path: Path) -> None:
    """After Google answers 429 the minute budget is spent until the window passes."""
    clock = Clock()
    limiter = RateLimiter(tmp_path / "u.json", clock=clock)
    limiter.penalise(MODEL)
    assert limiter.try_acquire(MODEL) is False
    clock.now += c.GEMINI_MINUTE_WINDOW_S + 1
    assert limiter.try_acquire(MODEL) is True


def test_ttl_cache_expires_and_evicts() -> None:
    """Entries expire after the TTL and the oldest is dropped beyond capacity."""
    clock = Clock(0.0)
    cache: TTLCache[int] = TTLCache(10.0, 2, clock=clock)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.put("c", 3)
    assert cache.get("a") is None and cache.get("b") == 2
    clock.now = 10.0
    assert cache.get("b") is None and cache.get("c") is None


class StubClient:
    """Mimics client.aio.models.generate_content and counts calls."""

    def __init__(self, text: str) -> None:
        """Answer every call with text."""
        self.text = text
        self.calls: list[dict] = []
        self.aio = SimpleNamespace(models=SimpleNamespace(generate_content=self._generate))

    async def _generate(self, **kwargs: object) -> SimpleNamespace:
        """Record the call and return a response with .text."""
        self.calls.append(kwargs)
        return SimpleNamespace(text=self.text)


def _install_gemini(client: TestClient, answer: str, rpd: int = 100, rpm: int = 100) -> StubClient:
    """Replace the active provider with a GeminiLLM backed by a stub SDK client."""
    llm = client.app.state.services.llm
    data_dir = Path(client.app.state.services.settings.data_dir)
    llm.limiter = RateLimiter(data_dir / "stub_usage.json", rpm_override=rpm, rpd_override=rpd)
    stub = StubClient(answer)
    gemini = GeminiLLM("test-key", MODEL, llm.limiter)
    gemini._client = stub
    llm.use(gemini)
    return stub


HINT_BODY = {"instruction": "Pinch", "move_name": "Pinch", "deviations": {"index": 25}, "timing_ms": 0}
GOOD_HINT = '{"hint": "Lift your index finger a little.", "focus_finger": "index", "cue_type": "extend", "severity": "medium"}'


def test_gemini_call_uses_hint_model_and_low_thinking(client: TestClient) -> None:
    """Hints go to the hint model with thinking turned down and no temperature."""
    stub = _install_gemini(client, GOOD_HINT)
    body = client.post("/api/coach/hint", json=HINT_BODY).json()
    assert body["provider"] == "gemini" and body["hint"] == "Lift your index finger a little."
    call = stub.calls[0]
    assert call["model"] == c.GEMINI_HINT_MODEL
    assert call["config"].temperature is None
    assert str(call["config"].thinking_config.thinking_level).lower().endswith("low")


def test_identical_hints_are_cached(client: TestClient) -> None:
    """A repeated identical request is answered from the cache without a second API call."""
    stub = _install_gemini(client, GOOD_HINT)
    first = client.post("/api/coach/hint", json=HINT_BODY).json()
    second = client.post("/api/coach/hint", json=HINT_BODY).json()
    assert first == second and len(stub.calls) == 1


def test_exhausted_budget_falls_back_without_calling(client: TestClient) -> None:
    """With no budget left the hint is algorithmic, labelled rate limited, and Gemini is never called."""
    stub = _install_gemini(client, GOOD_HINT, rpd=1)
    client.post("/api/coach/hint", json={**HINT_BODY, "deviations": {"ring": 25}})
    body = client.post("/api/coach/hint", json=HINT_BODY).json()
    assert len(stub.calls) == 1
    assert body["provider"] == c.PROVIDER_RATE_LIMITED and "index" in body["hint"] and body["cue_type"] == "extend"


def test_rate_limited_lesson_and_motion_fall_back(client: TestClient) -> None:
    """Lesson and motion report the rate-limited provider after one skipped attempt and no API call."""
    stub = _install_gemini(client, "{}", rpd=1, rpm=1)
    assert client.app.state.services.llm.limiter.try_acquire(MODEL)
    lesson = client.post("/api/lessons/generate", json={"prompt": "piano scale"}).json()
    motion = client.post("/api/motion/from_text", json={"text": "pinch"}).json()
    assert lesson["provider"] == c.PROVIDER_RATE_LIMITED and lesson["attempts"] == 1
    assert motion["provider"] == c.PROVIDER_RATE_LIMITED
    assert not stub.calls


def test_429_marks_rate_limited(client: TestClient) -> None:
    """A 429 from Google becomes the rate-limited fallback and blocks further calls this minute."""
    stub = _install_gemini(client, GOOD_HINT)

    class TooMany(Exception):
        code = 429

    async def boom(**_: object) -> None:
        raise TooMany

    stub.aio.models.generate_content = boom
    body = client.post("/api/coach/hint", json=HINT_BODY).json()
    assert body["provider"] == c.PROVIDER_RATE_LIMITED
    assert client.app.state.services.llm.limiter.remaining(c.GEMINI_HINT_MODEL)["rpm_remaining"] == 0


def test_dev_state_exposes_budget(client: TestClient) -> None:
    """GET /dev/state lists the remaining budget for the configured models, once each.

    Both default to Flash-Lite (500 requests per day free), so they share one 400 per day budget.
    """
    rows = client.get("/api/dev/state").json()["gemini_budget"]
    budgets = {b["model"]: b for b in rows}
    assert c.DEFAULT_GEMINI_MODEL == c.GEMINI_HINT_MODEL == "gemini-3.5-flash-lite"
    assert len(rows) == len(budgets)
    assert budgets[c.GEMINI_HINT_MODEL]["rpd_budget"] == 400 and budgets[c.GEMINI_HINT_MODEL]["rpm_remaining"] == 8


def test_no_real_client_in_tests() -> None:
    """The conftest guard makes building a real Gemini client impossible."""
    from google import genai  # noqa: PLC0415

    with pytest.raises(AssertionError):
        genai.Client(api_key="x")
