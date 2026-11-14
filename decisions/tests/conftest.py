"""Test setup for the decisions lane.

Tests never reach the network or the real log: the key lookup is stubbed, the
log goes to a temporary file, and transports are fakes. The one exception is
``test_live.py``, which runs only with ``DECISIONS_LIVE=1`` and a real key.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

FIXTURES = Path(__file__).resolve().parent / "fixtures"

from decisions import config as C  # noqa: E402
from decisions import judgements  # noqa: E402
from decisions.client import DecisionsClient  # noqa: E402
from decisions.log import JsonlLog  # noqa: E402


def pytest_configure(config):
    config.addinivalue_line("markers", "live: calls the real Decisions API (opt in with DECISIONS_LIVE=1)")


def pytest_collection_modifyitems(config, items):
    if os.environ.get("DECISIONS_LIVE") == "1":
        return
    skip = pytest.mark.skip(reason="live API test; set DECISIONS_LIVE=1 to run it")
    for item in items:
        if "live" in item.keywords:
            item.add_marker(skip)


@pytest.fixture(autouse=True)
def offline(request, monkeypatch, tmp_path):
    """No key, no .env lookup, no warm-up, temporary log. Skipped for live tests."""
    if request.node.get_closest_marker("live"):
        monkeypatch.setenv("DECISIONS_LOG", str(tmp_path / "decisions-live.jsonl"))
        judgements.set_client(None)
        yield
        judgements.set_client(None)
        return
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("DECISIONS_DISABLED", raising=False)
    monkeypatch.setenv("DECISIONS_WARMUP", "0")
    monkeypatch.setenv("DECISIONS_LOG", str(tmp_path / "decisions.jsonl"))
    monkeypatch.setattr(C, "find_env_file", lambda *a, **k: None)
    judgements.set_client(None)
    yield
    judgements.set_client(None)


# ---------------------------------------------------------------------- recorded data
def _load(name: str):
    return json.loads((FIXTURES / name).read_text())


@pytest.fixture(scope="session")
def summaries() -> list[dict]:
    """Step summaries from the real Smartgloves capture (see make_fixtures.py)."""
    return _load("summaries.json")


@pytest.fixture(scope="session")
def steps() -> list[dict]:
    """The three lesson steps cut from the real capture, as Step.to_json()."""
    return _load("steps.json")


@pytest.fixture(scope="session")
def lesson_meta() -> dict:
    return _load("lesson.json")


@pytest.fixture(scope="session")
def keyframe_jpg() -> bytes:
    return (FIXTURES / "keyframe_00.jpg").read_bytes()


# ---------------------------------------------------------------------- fakes
@pytest.fixture
def log_file(tmp_path) -> Path:
    return tmp_path / "log.jsonl"


@pytest.fixture
def make_client(log_file):
    """A client with a fake transport and a temporary log. ``transport(payload, timeout_s) -> (status, body)``."""

    def _make(transport, **kw) -> DecisionsClient:
        kw.setdefault("budget_ms", 600)
        kw.setdefault("enabled", True)
        return DecisionsClient(api_key="test-key", transport=transport, log=JsonlLog(log_file), **kw)

    return _make


def read_log(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def choice_body(**answers: tuple[str, dict[str, float], float]) -> dict:
    """{"key": (choice, probabilities, confidence)} to a Decisions API response body."""
    return {
        "answers": {
            k: {"type": "choice", "choice": c, "probabilities": p, "confidence": conf} for k, (c, p, conf) in answers.items()
        },
        "usage": {"total_input_tokens": 100, "total_output_tokens": 0, "total_tokens": 100},
    }


def noul_body(key: str, p: float, confidence: float | None = None) -> dict:
    ans = {"type": "noul", "noul": p}
    if confidence is not None:
        ans["confidence"] = confidence
    return {"answers": {key: ans}, "usage": {"total_input_tokens": 300, "total_output_tokens": 0}}


def score_body(levels: dict[str, float], confidence: float = 0.8, n_levels: int = 4) -> dict:
    answers = {}
    for k, s in levels.items():
        lo = int(s)
        hi = min(n_levels - 1, lo + 1)
        frac = s - lo
        probs = {str(i): 0.0 for i in range(n_levels)}
        probs[str(lo)] += 1.0 - frac
        probs[str(hi)] += frac
        answers[k] = {"type": "score", "score": s, "probabilities": probs, "legend": {str(i): f"level {i}" for i in range(n_levels)},
                      "confidence": confidence}
    return {"answers": answers, "usage": {"total_input_tokens": 200, "total_output_tokens": 0}}


def slow_transport(seconds: float, body: dict):
    def _t(payload, timeout_s):
        time.sleep(seconds)
        return 200, body

    return _t


def canned_transport(body: dict, status: int = 200, seen: list | None = None):
    def _t(payload, timeout_s):
        if seen is not None:
            seen.append((payload, timeout_s))
        return status, body

    return _t


def raising_transport(exc: Exception):
    def _t(payload, timeout_s):
        raise exc

    return _t
