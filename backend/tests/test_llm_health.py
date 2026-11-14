"""scripts/llm_health.py without any network: no key, closed ports, scrubbed errors, the table."""

import asyncio
import importlib.util
import sys
from pathlib import Path

from app.core.config import Settings
from app.services.llm.registry import LLMState

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "llm_health.py"
spec = importlib.util.spec_from_file_location("llm_health", SCRIPT)
assert spec and spec.loader
health = importlib.util.module_from_spec(spec)
sys.modules["llm_health"] = health  # dataclasses look their module up while the class is built
spec.loader.exec_module(health)


def _settings(tmp_path: Path, **kw: object) -> Settings:
    """Settings that never read a .env file."""
    return Settings(_env_file=None, data_dir=tmp_path, **kw)  # type: ignore[call-arg]


def test_gemini_without_a_key_makes_no_call(tmp_path: Path) -> None:
    """No key: the row says so and nothing is sent."""
    row = asyncio.run(health.check_gemini(_settings(tmp_path, gemini_api_key=None), []))
    assert (row.reachable, row.answered, row.words) == ("no", "no", "GEMINI_API_KEY is not set")


def test_openai_unreachable_is_reported_not_deployed(tmp_path: Path) -> None:
    """An explicit endpoint on a closed port is unreachable; the script never deploys."""
    settings = _settings(tmp_path, openai_base_url="http://127.0.0.1:9")
    row = asyncio.run(health.check_openai(settings, {"OPENAI_BASE_URL": "http://127.0.0.1:9"}, []))
    assert row.reachable == "no" and row.words.startswith("unreachable")


def test_secrets_are_scrubbed_from_errors() -> None:
    """A key that leaks into an error message is replaced before printing."""
    secrets = health._secrets({"GEMINI_API_KEY": "abcdefghijkl", "OPENAI_BASE_URL": "http://x"})
    assert secrets == ["abcdefghijkl"]
    assert "abcdefghijkl" not in health._scrub("bad key abcdefghijkl here", secrets)


def test_table_has_every_column() -> None:
    """The header names provider, reachable, answered, latency and first words."""
    table = health.render([health.Row("openai", "google/gemma-4-31B-it", "yes", "yes", "0.40 s", "Ready to coach.")])
    header = table.splitlines()[0]
    for name in ("provider", "model", "reachable", "answered", "latency", "first words"):
        assert name in header
    assert "google/gemma-4-31B-it" in table


def _state(tmp_path: Path, **kw: object) -> LLMState:
    """An LLMState that never reads a .env file."""
    return LLMState(_settings(tmp_path, gemini_api_key=None, **kw))


def test_roles_follow_the_fallback_rules(tmp_path: Path) -> None:
    """Lesson routed to Verda, Verda down, Gemini up: lesson generation answers with Gemini."""
    state = _state(tmp_path, llm_provider="gemini", openai_base_url="https://verda.example", llm_routes="lesson=openai")
    rows = [health.Row("gemini", "g", "yes", "yes"), health.Row("openai", "o", "no", "no")]
    table = {role: (chain, now) for role, chain, now in health.role_table(state, rows)}
    assert table["lesson generation"] == ("openai then gemini then template", "gemini")
    assert table["coach hint"] == ("gemini then openai then offline note", "gemini")
    assert "Ollama" not in health.render_roles(health.role_table(state, rows))


def test_roles_go_offline_when_nothing_answers(tmp_path: Path) -> None:
    """No model answers: the coach shows the offline note and the others use templates."""
    rows = [health.Row("gemini", "g"), health.Row("openai", "o")]
    table = {role: now for role, _, now in health.role_table(_state(tmp_path, llm_provider="gemini"), rows)}
    assert table == {
        "coach hint": "offline (offline note)",
        "plan": "offline (template)",
        "lesson generation": "offline (template)",
        "motion from text": "offline (template)",
    }
