"""A small async client for one OpenAI-compatible vLLM server, with per-call latency.

The server is our own vLLM: on a Verda Serverless container (VMs are refused on the coupon balance), reached through
the Verda gateway with VERDA_INFERENCE_KEY, or through an SSH tunnel on localhost. COACH_TUNE_BASE_URL picks it."""

from __future__ import annotations

import asyncio
import os
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx

BASE_URL = os.environ.get("COACH_TUNE_BASE_URL", "http://localhost:8001").rstrip("/")
GATEWAY_HOST = "containers.datacrunch.io"  # the Verda container gateway (endpoint_base_url from the API)
# The only hosts this client will talk to: our own vLLM on Verda, through the container gateway or an SSH tunnel. No
# Gemini host, no Decisions API, no backend provider chain, and no key variable of another provider is read here.
ALLOWED_HOSTS = frozenset({"localhost", "127.0.0.1", GATEWAY_HOST})
ENV_FILE = Path("/Users/arpanpandey/Code/Junction/repo/.env")
KEY_NAME = "VERDA_INFERENCE_KEY"


def inference_key() -> str:
    """Only the Verda inference key, read from the environment or from its single line in .env; no other line is kept."""
    key = os.environ.get(KEY_NAME)
    if key:
        return key
    if ENV_FILE.is_file():
        for line in ENV_FILE.read_text().splitlines():
            if line.startswith(KEY_NAME + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit(f"{KEY_NAME} missing")


def headers(base_url: str = BASE_URL) -> dict[str, str]:
    return (
        {"Authorization": f"Bearer {inference_key()}"}
        if urlparse(base_url).hostname == GATEWAY_HOST
        else {}
    )


def where(base_url: str = BASE_URL) -> str:
    return (
        "verda serverless container"
        if urlparse(base_url).hostname == GATEWAY_HOST
        else "verda via ssh tunnel"
    )


# Labels may only come from a self-hosted open-weights Gemma 4 served under its Hugging Face id.
TEACHER_PREFIX = "google/gemma-4-"


class ForbiddenHost(RuntimeError):
    """A call to anything but our own tunnelled vLLM server."""


def check_host(url: str) -> None:
    host = urlparse(url).hostname
    if host not in ALLOWED_HOSTS:
        raise ForbiddenHost(
            f"coach_tune only talks to its own vLLM through the tunnel, not {host}"
        )


async def served_model(base_url: str = BASE_URL) -> str:
    check_host(base_url)
    async with httpx.AsyncClient(timeout=60, headers=headers(base_url)) as c:
        r = await c.get(base_url + "/v1/models")
        r.raise_for_status()
        return r.json()["data"][0]["id"]


async def complete(
    client: httpx.AsyncClient,
    model: str,
    messages: list[dict],
    temperature: float,
    max_tokens: int = 48,
    base_url: str = BASE_URL,
) -> tuple[str, float]:
    check_host(base_url)
    body = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    t0 = time.perf_counter()
    r = await client.post(base_url + "/v1/chat/completions", json=body)
    r.raise_for_status()
    return (
        r.json()["choices"][0]["message"].get("content") or ""
    ).strip(), time.perf_counter() - t0


async def run_all(items: list, call, concurrency: int) -> list:
    """Run `call(client, item)` for every item with at most `concurrency` in flight; keeps the order."""
    sem = asyncio.Semaphore(concurrency)
    async with httpx.AsyncClient(
        timeout=300, headers=headers(), limits=httpx.Limits(max_connections=concurrency)
    ) as client:

        async def one(item):
            async with sem:
                return await call(client, item)

        return await asyncio.gather(*(one(i) for i in items))
