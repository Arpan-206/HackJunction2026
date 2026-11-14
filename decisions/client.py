"""HTTP client for the Gemini Decisions API with a hard wall-clock budget.

Documented shapes (Google AI Studio docs, "Decisions API", read 14 Nov 2026):

* ``POST https://generativelanguage.googleapis.com/v1beta/decisions``
  with header ``x-goog-api-key``.
* Body: ``{"model": "gemini-decision-1", "input": <text | part | [parts]>,
  "questions": {key: {"type": "noul" | "choice" | "score", "instructions": str, "criteria": ...}}}``.
  Parts: ``{"type": "text", "text": ...}`` and
  ``{"type": "image", "mime_type": ..., "data": <base64>, "resolution": "low|medium|high|ultra_high"}``.
  Criteria: noul ``{"true_description", "false_description"}`` (optional), choice ``{option_id: description}``
  (2 to 255), score ``[level 0 text, level 1 text, ...]`` (2 to 255).
* Answers: ``{"answers": {key: {"type": ..., "noul": p, "choice": id, "probabilities": {...},
  "score": x, "legend": {...}, "confidence": c}}, "usage": {"total_input_tokens": n, ...}}``.

The budget is enforced twice: httpx timeouts on the socket, and a thread pool
``future.result(timeout=...)`` around the whole call, so DNS stalls and TLS
handshakes count too. A call that misses the budget returns no answers and the
caller uses its rule fallback. Three failures in a row open a cool-down during
which no network call is made at all (offline demo, captive portal).
"""
from __future__ import annotations

import concurrent.futures as cf
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from . import config as C
from .log import JsonlLog

Transport = Callable[[dict, float], tuple[int, dict]]
"""(payload, timeout_s) -> (http_status, body_json). Tests pass their own."""

QUESTION_TYPES = ("noul", "choice", "score")


@dataclass
class CallResult:
    """What one ``decide`` call produced. ``answers`` is None whenever the caller should fall back."""

    fn: str
    answers: dict[str, dict] | None
    reason: str  # ok | no_key | disabled | auth | cooldown | timeout | http_<status> | error:<Type> | bad_response
    latency_ms: float
    http_status: int | None = None
    usage: dict = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.answers is not None

    def record(self) -> dict:
        return {
            "fn": self.fn,
            "ok": self.ok,
            "reason": self.reason,
            "latency_ms": round(self.latency_ms, 1),
            "http_status": self.http_status,
            "input_tokens": self.usage.get("total_input_tokens"),
        }


class DecisionsClient:
    def __init__(
        self,
        api_key: str | None = None,
        *,
        model: str = C.MODEL,
        endpoint: str = C.ENDPOINT,
        budget_ms: int | None = None,
        transport: Transport | None = None,
        log: JsonlLog | None = None,
        enabled: bool | None = None,
        cooldown_s: float = 10.0,
        failures_to_trip: int = 3,
        warm_up: bool = False,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.api_key = api_key if api_key is not None else C.load_api_key()
        self.model = model
        self.endpoint = endpoint
        self.budget_ms = int(budget_ms if budget_ms is not None else C.budget_ms())
        self.transport: Transport = transport or self._http_transport
        self.log = log or JsonlLog()
        if enabled is not None:
            self.enabled = bool(enabled)
        else:
            self.enabled = bool(self.api_key) and not C.disabled()
        self.disabled_reason = "ok" if self.enabled else ("disabled" if C.disabled() else "no_key")
        self.cooldown_s = float(cooldown_s)
        self.failures_to_trip = int(failures_to_trip)
        self.clock = clock
        self.calls = 0
        self.model_answers = 0
        self.timeouts = 0
        self.late = 0
        self._failures = 0
        self._cooldown_until = 0.0
        self._lock = threading.Lock()
        self._pool = cf.ThreadPoolExecutor(max_workers=4, thread_name_prefix="decisions")
        self._http: Any = None
        if warm_up and self.enabled:
            self.warm_up()

    @classmethod
    def from_env(cls, **kw: Any) -> "DecisionsClient":
        return cls(**kw)

    def describe(self) -> dict:
        """Counters for a health endpoint. No secrets."""
        return {
            "model": self.model,
            "enabled": self.enabled,
            "reason": self.disabled_reason,
            "budget_ms": self.budget_ms,
            "calls": self.calls,
            "model_answers": self.model_answers,
            "timeouts": self.timeouts,
            "late": self.late,
            "in_cooldown": self.in_cooldown,
        }

    # ------------------------------------------------------------------ state
    @property
    def in_cooldown(self) -> bool:
        return self.clock() < self._cooldown_until

    def _note_failure(self) -> None:
        with self._lock:
            self._failures += 1
            if self._failures >= self.failures_to_trip:
                self._cooldown_until = self.clock() + self.cooldown_s
                self._failures = 0

    def _note_success(self) -> None:
        with self._lock:
            self._failures = 0

    # ------------------------------------------------------------------ request
    def payload(self, input_parts: list[dict] | str, questions: dict[str, dict]) -> dict:
        if not questions:
            raise ValueError("at least one question")
        for key, q in questions.items():
            if q.get("type") not in QUESTION_TYPES:
                raise ValueError(f"question {key!r}: bad type {q.get('type')!r}")
            if not q.get("instructions"):
                raise ValueError(f"question {key!r}: instructions required")
            if q["type"] == "choice" and len(q.get("criteria") or {}) < 2:
                raise ValueError(f"question {key!r}: a choice needs 2 to 255 options")
            if q["type"] == "score" and len(q.get("criteria") or []) < 2:
                raise ValueError(f"question {key!r}: a score needs 2 to 255 levels")
        return {"model": self.model, "input": input_parts, "questions": questions}

    def decide(
        self,
        fn: str,
        input_parts: list[dict] | str,
        questions: dict[str, dict],
        budget_ms: int | None = None,
    ) -> CallResult:
        """One request, bounded by the budget. Never raises; the reason says why ``answers`` is None."""
        budget = (budget_ms if budget_ms is not None else self.budget_ms) / 1000.0
        self.calls += 1
        if not self.enabled:
            return CallResult(fn, None, self.disabled_reason, 0.0)
        if self.in_cooldown:
            return CallResult(fn, None, "cooldown", 0.0)
        try:
            body = self.payload(input_parts, questions)
        except ValueError as e:
            return CallResult(fn, None, f"error:{type(e).__name__}", 0.0)
        t0 = self.clock()
        fut = self._pool.submit(self.transport, body, budget)
        try:
            status, data = fut.result(timeout=budget)
        except cf.TimeoutError:
            self.timeouts += 1
            self._note_failure()
            fut.add_done_callback(lambda f: self._late_done(fn, f, t0))
            return CallResult(fn, None, "timeout", (self.clock() - t0) * 1000.0)
        except Exception as e:  # transport raised: connection refused, DNS, bad JSON
            self._note_failure()
            return CallResult(fn, None, f"error:{type(e).__name__}", (self.clock() - t0) * 1000.0)
        latency = (self.clock() - t0) * 1000.0
        if status != 200:
            if status in (401, 403):
                self.enabled = False
                self.disabled_reason = "auth"
            elif status == 429 or status >= 500:
                self._note_failure()
            return CallResult(fn, None, f"http_{status}", latency, status)
        answers = data.get("answers") if isinstance(data, dict) else None
        if not isinstance(answers, dict) or any(k not in answers for k in questions):
            self._note_failure()
            return CallResult(fn, None, "bad_response", latency, status)
        self._note_success()
        self.model_answers += 1
        return CallResult(fn, answers, "ok", latency, status, data.get("usage") or {})

    def _late_done(self, fn: str, fut: cf.Future, t0: float) -> None:
        self.late += 1
        rec = {"fn": fn, "event": "late", "latency_ms": round((self.clock() - t0) * 1000.0, 1)}
        try:
            status, _ = fut.result()
            rec["http_status"] = status
        except Exception as e:
            rec["error"] = type(e).__name__
        self.log.write(rec)

    def warm_up(self) -> None:
        """Open the TLS connection early with the smallest possible request, in the background."""
        q = {"warm": {"type": "noul", "instructions": "Is this text in English?"}}

        def run() -> None:
            res = self.decide("warmup", "hello", q, budget_ms=3000)
            self.log.write({**res.record(), "source": "model" if res.ok else "none"})

        self._pool.submit(run)

    # ------------------------------------------------------------------ transport
    def _http_transport(self, payload: dict, timeout_s: float) -> tuple[int, dict]:
        import httpx

        if self._http is None:
            self._http = httpx.Client(
                timeout=httpx.Timeout(max(timeout_s, 0.1), connect=min(max(timeout_s, 0.1), 0.4)),
            )
        r = self._http.post(
            self.endpoint,
            json=payload,
            headers={"x-goog-api-key": self.api_key or "", "Content-Type": "application/json"},
        )
        try:
            body = r.json() if r.content else {}
        except ValueError:
            body = {}
        return r.status_code, body

    def close(self) -> None:
        if self._http is not None:
            try:
                self._http.close()
            except Exception:
                pass
        self._pool.shutdown(wait=False, cancel_futures=True)


# ---------------------------------------------------------------------- answer parsing
def choice_answer(ans: dict, options: tuple[str, ...] | list[str]) -> tuple[str, float, dict[str, float]] | None:
    """(choice, confidence, probabilities) from a choice answer, or None if the shape is wrong."""
    if not isinstance(ans, dict) or ans.get("type") != "choice":
        return None
    choice = ans.get("choice")
    probs_raw = ans.get("probabilities") or {}
    probs = {o: _unit(float(probs_raw.get(o, 0.0))) for o in options}
    if choice not in options:
        if not any(probs.values()):
            return None
        choice = max(probs, key=probs.get)
    conf = ans.get("confidence")
    conf = float(conf) if conf is not None else probs.get(choice, 0.0)
    return str(choice), _unit(conf), probs


def noul_answer(ans: dict) -> tuple[float, float] | None:
    """(probability_yes, confidence) from a noul answer."""
    if not isinstance(ans, dict) or ans.get("type") != "noul" or ans.get("noul") is None:
        return None
    p = _unit(float(ans["noul"]))
    conf = ans.get("confidence")
    return p, (_unit(float(conf)) if conf is not None else abs(p - 0.5) * 2.0)


def score_answer(ans: dict, levels: int) -> tuple[float, float] | None:
    """(expected_level, confidence) from a score answer; expected level is 0..levels-1."""
    if not isinstance(ans, dict) or ans.get("type") != "score":
        return None
    s = ans.get("score")
    probs = ans.get("probabilities") or {}
    if s is None and probs:
        try:
            s = sum(int(k) * float(v) for k, v in probs.items())
        except (TypeError, ValueError):
            return None
    if s is None:
        return None
    s = min(max(float(s), 0.0), float(levels - 1))
    conf = ans.get("confidence")
    return s, (_unit(float(conf)) if conf is not None else 0.5)


def _unit(x: float) -> float:
    return min(max(float(x), 0.0), 1.0)
