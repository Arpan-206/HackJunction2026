"""Check every language-model path the backend can use and print one table.

Run from backend/:  uv run python scripts/llm_health.py
                    uv run python scripts/llm_health.py --only openai   (no Gemini request)

Rows:
- gemini: the Gemini API with GEMINI_API_KEY and GEMINI_MODEL. One short request, counted in the Gemini budget.
- openai: Gemma on Verda, or any OpenAI-compatible endpoint. OPENAI_BASE_URL if set, else base_url in verda/out/endpoint.json.
  The key is OPENAI_API_KEY, else VERDA_INFERENCE_KEY. Nothing is deployed; a torn-down endpoint shows as unreachable.

A second table shows, for each role (coach hint, plan, lesson generation, motion from text), the chain the
backend builds from LLM_PROVIDER, LLM_FALLBACK and LLM_ROUTES, and the provider that would answer now: the first
one in the chain that answered above, else offline. A provider skipped with --only counts as not answering.

Settings come from backend/.env (the file the backend reads) and the repo-root .env. Keys are never printed.
The exit code is 0 when at least one model answered, else 1.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402
from dotenv import dotenv_values  # noqa: E402

from app.core.config import Settings  # noqa: E402
from app.services.llm.base import LLMRequest  # noqa: E402
from app.services.llm.gemini import GeminiLLM  # noqa: E402
from app.services.llm.openai_compat import OpenAICompatLLM  # noqa: E402
from app.services.llm.registry import ROLES, LLMState  # noqa: E402

BACKEND = Path(__file__).resolve().parent.parent
REPO = BACKEND.parent
ENDPOINT_FILE = REPO / "verda" / "out" / "endpoint.json"
PROVIDERS = ("gemini", "openai")
ROLE_NAMES = {"hint": "coach hint", "plan": "plan", "lesson": "lesson generation", "motion": "motion from text"}
PROBE_TIMEOUT_S = 5.0
ANSWER_TIMEOUT_S = 60.0
FIRST_WORDS = 8
UNSET_OPENAI_URL = "http://localhost:8000"  # the Settings default, which is this backend, not a model server
PROMPT = LLMRequest(
    system="You are a health check. Answer in one short plain sentence.",
    prompt="Say that you are ready to coach a hand-skill learner.",
    user_text="health check",
    task="hint",
)


@dataclass
class Row:
    """One provider's result."""

    provider: str
    model: str
    reachable: str = "no"
    answered: str = "no"
    latency: str = "-"
    words: str = ""


def _env_values() -> dict[str, str]:
    """Merge the root .env and backend/.env (backend wins), plus the process environment. Values stay in memory."""
    import os

    merged: dict[str, str] = {}
    for path in (REPO / ".env", BACKEND / ".env"):
        if path.exists():
            merged.update({k.upper(): v for k, v in dotenv_values(path).items() if v is not None})
    merged.update({k: v for k, v in os.environ.items() if k.isupper()})
    return merged


def _secrets(env: dict[str, str]) -> list[str]:
    """Every value that looks secret, so it can be scrubbed from error text."""
    names = ("KEY", "TOKEN", "SECRET", "CLIENT_ID", "PASSWORD")
    return [v for k, v in env.items() if v and len(v) > 6 and any(n in k for n in names)]


def _scrub(text: str, secrets: list[str]) -> str:
    """Remove secrets from text and keep it short."""
    for value in secrets:
        text = text.replace(value, "***")
    return " ".join(text.split())[:120]


def _first_words(text: str) -> str:
    """The first few words of an answer, on one line."""
    words = text.split()
    tail = " ..." if len(words) > FIRST_WORDS else ""
    return " ".join(words[:FIRST_WORDS]) + tail


def _endpoint() -> dict[str, Any]:
    """The Verda deployment record, or an empty dict."""
    if not ENDPOINT_FILE.exists():
        return {}
    try:
        return json.loads(ENDPOINT_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


async def _probe(url: str, headers: dict[str, str] | None = None) -> int | None:
    """The HTTP status of a GET, or None when nothing answers."""
    try:
        async with httpx.AsyncClient(timeout=PROBE_TIMEOUT_S, headers=headers or {}) as client:
            return (await client.get(url)).status_code
    except httpx.HTTPError:
        return None


async def _ask(row: Row, client: Any, secrets: list[str]) -> Row:
    """Send the prompt and fill in the answer, latency and first words."""
    start = time.perf_counter()
    try:
        text = await asyncio.wait_for(client.generate_text(PROMPT), timeout=ANSWER_TIMEOUT_S)
    except Exception as exc:  # noqa: BLE001 - every failure is reported, none is fatal
        row.latency = f"{time.perf_counter() - start:.2f} s"
        row.words = _scrub(f"{type(exc).__name__}: {exc}", secrets)
        return row
    row.latency = f"{time.perf_counter() - start:.2f} s"
    row.answered = "yes" if text.strip() else "empty"
    row.words = _first_words(text)
    return row


async def check_gemini(settings: Settings, secrets: list[str]) -> Row:
    """One real Gemini request, if a key is set."""
    row = Row("gemini", settings.gemini_model)
    if not settings.gemini_api_key:
        row.words = "GEMINI_API_KEY is not set"
        return row
    row = await _ask(row, GeminiLLM(settings.gemini_api_key, settings.gemini_model), secrets)
    row.reachable = "yes" if row.answered == "yes" or "ClientError" in row.words or "ServerError" in row.words else "no"
    return row


async def check_openai(settings: Settings, env: dict[str, str], secrets: list[str]) -> Row:
    """The OpenAI-compatible endpoint (vLLM on Verda or any other). Read-only: nothing is deployed."""
    info = _endpoint()
    explicit = "OPENAI_BASE_URL" in env and settings.openai_base_url != UNSET_OPENAI_URL
    base = settings.openai_base_url if explicit else info.get("base_url", "")
    model = env.get("OPENAI_MODEL") or info.get("model") or settings.openai_model
    row = Row("openai", model)
    if not base:
        row.words = "no OPENAI_BASE_URL and no verda/out/endpoint.json"
        return row
    key = settings.openai_api_key or env.get("VERDA_INFERENCE_KEY")
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    status = await _probe(base.rstrip("/") + "/v1/models", headers)
    if status is None or status >= 400:
        torn = "; endpoint.json says torn down" if not explicit and info.get("torn_down_at") else ""
        row.reachable = "no" if status is None else f"no (HTTP {status})"
        row.words = f"unreachable at {base}{torn}"
        return row
    row.reachable = "yes"
    return await _ask(row, OpenAICompatLLM(base, key, model), secrets)


def role_table(state: LLMState, rows: list[Row]) -> list[tuple[str, str, str]]:
    """For each role: its chain after the fallback rules, and who would answer now."""
    healthy = {r.provider for r in rows if r.answered == "yes"} | {"fake"}
    table = []
    for role in ROLES:
        chain = state.chain_for(role)
        last = "offline note" if role == "hint" else "template"
        if chain == ["fake"]:
            table.append((ROLE_NAMES[role], "fake", "fake (no model)"))
            continue
        now = next((name for name in chain if name in healthy), f"offline ({last})")
        table.append((ROLE_NAMES[role], " then ".join([*chain, last]), now))
    return table


def render_roles(table: list[tuple[str, str, str]]) -> str:
    """The role table as plain text."""
    return _table(("role", "chain", "answers now"), table)


def render(rows: list[Row]) -> str:
    """The provider table as plain text."""
    head = ("provider", "model", "reachable", "answered", "latency", "first words or reason")
    return _table(head, [(r.provider, r.model, r.reachable, r.answered, r.latency, r.words) for r in rows])


def _table(head: tuple[str, ...], body: list[tuple[str, ...]]) -> str:
    """Columns padded to width; the last column is left ragged."""
    cells = [head, *body]
    widths = [max(len(row[i]) for row in cells) for i in range(len(head) - 1)]

    def line(row: tuple[str, ...]) -> str:
        return " | ".join([c.ljust(w) for c, w in zip(row[:-1], widths, strict=True)] + [row[-1]])

    rule = "-+-".join("-" * w for w in widths) + "-+-" + "-" * len(head[-1])
    return "\n".join([line(head), rule] + [line(r) for r in cells[1:]])


async def main(only: list[str]) -> int:
    """Run the checks in parallel, print the table and return the exit code."""
    env = _env_values()
    settings = Settings(_env_file=[REPO / ".env", BACKEND / ".env"])  # type: ignore[call-arg]
    secrets = _secrets(env)
    jobs = {
        "gemini": lambda: check_gemini(settings, secrets),
        "openai": lambda: check_openai(settings, env, secrets),
    }
    rows = list(await asyncio.gather(*(jobs[name]() for name in only)))
    print(f"LLM_PROVIDER={settings.llm_provider}  LLM_FALLBACK={settings.llm_fallback}  LLM_ROUTES={settings.llm_routes or '-'}")
    print(render(rows))
    print()
    print(render_roles(role_table(LLMState(settings), rows)))
    return 0 if any(r.answered == "yes" for r in rows) else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--only", default=",".join(PROVIDERS), help="comma-separated subset of gemini,openai")
    names = [n.strip() for n in parser.parse_args().only.split(",") if n.strip()]
    bad = [n for n in names if n not in PROVIDERS]
    if bad:
        parser.error(f"unknown provider: {', '.join(bad)}")
    sys.exit(asyncio.run(main(names)))
