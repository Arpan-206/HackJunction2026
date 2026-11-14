"""The client: request shape, the hard budget, fallbacks, cool-down and the log. No network."""

from __future__ import annotations

import json
import time

import httpx
import pytest
from conftest import (
    canned_transport,
    choice_body,
    raising_transport,
    read_log,
    slow_transport,
)

from decisions import config as C
from decisions.client import DecisionsClient, choice_answer, noul_answer, score_answer
from decisions.config import (
    find_env_file as real_find_env_file,  # bound before the offline fixture patches it
)
from decisions.log import JsonlLog

Q_CHOICE = {
    "pick": {
        "type": "choice",
        "instructions": "Pick one.",
        "criteria": {"a": "A.", "b": "B."},
    }
}


class FakeClock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


# ---------------------------------------------------------------------- request shape
def test_payload_matches_the_documented_shape(make_client):
    seen: list = []
    cl = make_client(
        canned_transport(choice_body(pick=("a", {"a": 0.9, "b": 0.1}, 0.9)), seen=seen)
    )
    res = cl.decide("t", [{"type": "text", "text": "hello"}], Q_CHOICE)
    assert res.ok and res.reason == "ok" and res.http_status == 200
    payload, timeout_s = seen[0]
    assert payload == {
        "model": "gemini-decision-1",
        "input": [{"type": "text", "text": "hello"}],
        "questions": Q_CHOICE,
    }
    assert timeout_s == pytest.approx(0.6)
    assert res.usage["total_input_tokens"] == 100


def test_payload_rejects_bad_questions(make_client):
    cl = make_client(canned_transport({}))
    with pytest.raises(ValueError):
        cl.payload("x", {"q": {"type": "essay", "instructions": "no"}})
    with pytest.raises(ValueError):
        cl.payload("x", {"q": {"type": "noul"}})
    with pytest.raises(ValueError):
        cl.payload(
            "x",
            {
                "q": {
                    "type": "choice",
                    "instructions": "one option",
                    "criteria": {"a": "A"},
                }
            },
        )
    with pytest.raises(ValueError):
        cl.payload(
            "x",
            {"q": {"type": "score", "instructions": "one level", "criteria": ["only"]}},
        )
    with pytest.raises(ValueError):
        cl.payload("x", {})
    assert cl.decide("t", "x", {}).reason == "error:ValueError"


def test_http_transport_sends_key_header_and_json(log_file):
    """The real httpx path, against an in-process mock server: URL, header, body, parsing."""
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(
            200, json=choice_body(pick=("b", {"a": 0.2, "b": 0.8}, 0.8))
        )

    cl = DecisionsClient(
        api_key="k-test", log=JsonlLog(log_file), enabled=True, budget_ms=600
    )
    cl._http = httpx.Client(transport=httpx.MockTransport(handler))
    res = cl.decide("t", "hello", Q_CHOICE)
    assert res.ok
    req = calls[0]
    assert str(req.url) == C.ENDPOINT
    assert req.method == "POST"
    assert req.headers["x-goog-api-key"] == "k-test"
    assert req.headers["content-type"] == "application/json"
    assert json.loads(req.content)["model"] == C.MODEL
    assert choice_answer(res.answers["pick"], ("a", "b"))[0] == "b"
    cl.close()


# ---------------------------------------------------------------------- the budget
def test_slow_transport_falls_back_within_the_budget(make_client):
    cl = make_client(
        slow_transport(0.5, choice_body(pick=("a", {"a": 1.0, "b": 0.0}, 1.0))),
        budget_ms=150,
    )
    t0 = time.monotonic()
    res = cl.decide("t", "x", Q_CHOICE)
    elapsed = time.monotonic() - t0
    assert res.answers is None and res.reason == "timeout"
    assert elapsed < 0.4, f"waited {elapsed:.3f}s on a 150 ms budget"
    assert cl.timeouts == 1
    # the late result is logged when it lands, and never used
    time.sleep(0.6)
    late = [r for r in read_log(cl.log.path) if r.get("event") == "late"]
    assert len(late) == 1 and late[0]["fn"] == "t" and late[0]["http_status"] == 200
    assert cl.late == 1
    cl.close()


def test_per_call_budget_override(make_client):
    cl = make_client(
        slow_transport(0.25, choice_body(pick=("a", {"a": 1.0, "b": 0.0}, 1.0))),
        budget_ms=100,
    )
    assert cl.decide("t", "x", Q_CHOICE).reason == "timeout"
    assert cl.decide("t", "x", Q_CHOICE, budget_ms=1000).ok
    cl.close()


# ---------------------------------------------------------------------- failures
def test_transport_errors_become_a_reason(make_client):
    cl = make_client(raising_transport(ConnectionError("refused")))
    res = cl.decide("t", "x", Q_CHOICE)
    assert res.answers is None and res.reason == "error:ConnectionError"


def test_bad_status_codes(make_client):
    cl = make_client(canned_transport({"error": {"message": "nope"}}, status=500))
    assert cl.decide("t", "x", Q_CHOICE).reason == "http_500"
    cl = make_client(canned_transport({}, status=401))
    assert cl.decide("t", "x", Q_CHOICE).reason == "http_401"
    assert cl.enabled is False and cl.disabled_reason == "auth"
    assert cl.decide("t", "x", Q_CHOICE).reason == "auth"


def test_missing_answer_is_bad_response(make_client):
    cl = make_client(
        canned_transport({"answers": {"other": {"type": "noul", "noul": 0.5}}})
    )
    assert cl.decide("t", "x", Q_CHOICE).reason == "bad_response"
    cl = make_client(canned_transport({"not": "json shape"}))
    assert cl.decide("t", "x", Q_CHOICE).reason == "bad_response"


def test_three_failures_open_a_cooldown_then_recover(make_client):
    clock = FakeClock()
    seen: list = []
    cl = make_client(
        canned_transport({}, status=503, seen=seen),
        clock=clock,
        cooldown_s=10.0,
        failures_to_trip=3,
    )
    for _ in range(3):
        assert cl.decide("t", "x", Q_CHOICE).reason == "http_503"
    assert cl.in_cooldown
    assert cl.decide("t", "x", Q_CHOICE).reason == "cooldown"
    assert len(seen) == 3, "no network call during the cool-down"
    clock.t += 10.1
    assert not cl.in_cooldown
    cl.decide("t", "x", Q_CHOICE)
    assert len(seen) == 4


def test_offline_without_a_key(monkeypatch):
    cl = DecisionsClient.from_env(log=JsonlLog(enabled=False))
    assert cl.enabled is False and cl.disabled_reason == "no_key"
    res = cl.decide("t", "x", Q_CHOICE)
    assert res.answers is None and res.reason == "no_key" and res.latency_ms == 0.0
    monkeypatch.setenv("DECISIONS_DISABLED", "1")
    monkeypatch.setenv("GEMINI_API_KEY", "would-be-a-key")
    cl = DecisionsClient.from_env(log=JsonlLog(enabled=False))
    assert cl.enabled is False and cl.disabled_reason == "disabled"
    assert cl.describe()["enabled"] is False


def test_env_file_parsing(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text(
        "# comment\nexport GEMINI_API_KEY='abc 123'\nOTHER=\"x\"\nBROKEN LINE\n"
    )
    monkeypatch.setattr(C, "find_env_file", lambda *a, **k: env)
    assert C.parse_env_file(env) == {"GEMINI_API_KEY": "abc 123", "OTHER": "x"}
    assert C.load_api_key() == "abc 123"
    monkeypatch.setenv("GEMINI_API_KEY", "from-env")
    assert C.load_api_key() == "from-env"


def test_find_env_file_walks_up(tmp_path, monkeypatch):
    (tmp_path / ".env").write_text("GEMINI_API_KEY=k\n")
    deep = tmp_path / "a" / "b"
    deep.mkdir(parents=True)
    monkeypatch.delenv(C.ENV_FILE_VAR, raising=False)
    assert real_find_env_file(deep) == tmp_path / ".env"
    monkeypatch.setenv(C.ENV_FILE_VAR, str(tmp_path / "missing"))
    assert real_find_env_file(deep) is None


# ---------------------------------------------------------------------- answer parsing
def test_choice_answer_parsing():
    assert choice_answer(
        {
            "type": "choice",
            "choice": "a",
            "probabilities": {"a": 0.7, "b": 0.3},
            "confidence": 0.7,
        },
        ("a", "b"),
    ) == ("a", 0.7, {"a": 0.7, "b": 0.3})
    # unknown choice id: the best known probability wins
    assert (
        choice_answer(
            {"type": "choice", "choice": "zzz", "probabilities": {"a": 0.2, "b": 0.8}},
            ("a", "b"),
        )[0]
        == "b"
    )
    assert choice_answer({"type": "choice", "choice": "zzz"}, ("a", "b")) is None
    assert choice_answer({"type": "noul", "noul": 0.5}, ("a", "b")) is None


def test_noul_and_score_parsing():
    assert noul_answer({"type": "noul", "noul": 0.9, "confidence": 0.8}) == (0.9, 0.8)
    assert noul_answer({"type": "noul", "noul": 0.75}) == (0.75, pytest.approx(0.5))
    assert noul_answer({"type": "noul"}) is None
    assert score_answer({"type": "score", "score": 2.4, "confidence": 0.6}, 4) == (
        2.4,
        0.6,
    )
    assert score_answer(
        {"type": "score", "probabilities": {"0": 0.0, "1": 0.5, "2": 0.5}}, 4
    ) == (1.5, 0.5)
    assert score_answer({"type": "score", "score": 9.0}, 4) == (3.0, 0.5)
    assert score_answer({"type": "score"}, 4) is None


def test_log_lines_are_json(make_client):
    cl = make_client(
        canned_transport(choice_body(pick=("a", {"a": 1.0, "b": 0.0}, 1.0)))
    )
    cl.log.write({**cl.decide("t", "x", Q_CHOICE).record(), "source": "model"})
    rows = read_log(cl.log.path)
    assert (
        rows
        and rows[0]["fn"] == "t"
        and rows[0]["ok"] is True
        and "latency_ms" in rows[0]
        and "t" in rows[0]
    )
