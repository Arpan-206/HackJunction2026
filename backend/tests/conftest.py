"""Shared fixtures: an app wired to a temporary data directory with the simulator and fake LLM."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    """Yield a TestClient whose lifespan has started the simulator."""
    settings = Settings(data_dir=tmp_path, llm_provider="fake", glove_source="simulator", rokoko_udp_port=0)
    with TestClient(create_app(settings)) as test_client:
        yield test_client
