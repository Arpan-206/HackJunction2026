"""Shared fixtures: an app wired to a temporary data directory with the simulator and fake LLM.

The real Gemini API must never be reachable from tests, even with a key in backend/.env: the key and provider are
blanked in the environment before the app module is imported, and an autouse fixture makes the SDK client unbuildable.
"""

import os
from collections.abc import Iterator
from pathlib import Path

os.environ["GEMINI_API_KEY"] = ""
os.environ["LLM_PROVIDER"] = "fake"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest.fixture(autouse=True)
def _no_real_gemini(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make any attempt to build a real google-genai client fail loudly."""
    from google import genai  # noqa: PLC0415

    def _forbidden(*_: object, **__: object) -> None:
        raise AssertionError("tests must never create a real Gemini client")

    monkeypatch.setattr(genai, "Client", _forbidden)


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    """Yield a TestClient whose lifespan has started the simulator."""
    settings = Settings(
        data_dir=tmp_path, llm_provider="fake", gemini_api_key=None, glove_source="simulator", rokoko_udp_port=0,
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client
