"""scripts/llm_health.py without any network: no key, closed ports, scrubbed errors, the table."""

import asyncio
import importlib.util
import sys
from pathlib import Path

from app.core.config import Settings

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


def test_ollama_down_says_how_to_start_it(tmp_path: Path) -> None:
    """A closed port reads as no server, with the start command."""
    row = asyncio.run(health.check_ollama(_settings(tmp_path, ollama_url="http://127.0.0.1:9"), []))
    assert row.reachable == "no" and "ollama serve" in row.words


def test_openai_unreachable_is_reported_not_deployed(tmp_path: Path) -> None:
    """An explicit endpoint on a closed port is unreachable; the script never deploys."""
    settings = _settings(tmp_path, openai_base_url="http://127.0.0.1:9")
    row = asyncio.run(health.check_openai(settings, {"OPENAI_BASE_URL": "http://127.0.0.1:9"}, []))
    assert row.reachable == "no" and row.words.startswith("unreachable")


def test_secrets_are_scrubbed_from_errors() -> None:
    """A key that leaks into an error message is replaced before printing."""
    secrets = health._secrets({"GEMINI_API_KEY": "abcdefghijkl", "OLLAMA_URL": "http://x"})
    assert secrets == ["abcdefghijkl"]
    assert "abcdefghijkl" not in health._scrub("bad key abcdefghijkl here", secrets)


def test_table_has_every_column() -> None:
    """The header names provider, reachable, answered, latency and first words."""
    table = health.render([health.Row("ollama", "gemma4:e4b", "yes", "yes", "0.40 s", "Ready to coach.")])
    header = table.splitlines()[0]
    for name in ("provider", "model", "reachable", "answered", "latency", "first words"):
        assert name in header
    assert "gemma4:e4b" in table
