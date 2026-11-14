"""A small async client for one OpenAI-compatible vLLM server, with per-call latency. No key: the VM port is reached
through an SSH tunnel (ssh -L 8001:localhost:8001), so nothing is open to the internet."""

from __future__ import annotations

import asyncio
import time

from urllib.parse import urlparse

import httpx

BASE_URL = "http://localhost:8001"
# The only hosts this client will talk to: the SSH tunnel to our own vLLM on the Verda VM. No Gemini host, no
# Decisions API, no backend provider chain, and no key variable of another provider is read in coach_tune/.
ALLOWED_HOSTS = frozenset({"localhost", "127.0.0.1"})
# Labels may only come from a self-hosted open-weights Gemma 4 served under its Hugging Face id.
TEACHER_PREFIX = "google/gemma-4-"


class ForbiddenHost(RuntimeError):
    """A call to anything but our own tunnelled vLLM server."""


def check_host(url: str) -> None:
    host = urlparse(url).hostname
    if host not in ALLOWED_HOSTS:
        raise ForbiddenHost(f"coach_tune only talks to its own vLLM through the tunnel, not {host}")


async def served_model(base_url: str = BASE_URL) -> str:
    check_host(base_url)
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(base_url + "/v1/models")
        r.raise_for_status()
        return r.json()["data"][0]["id"]


async def complete(client: httpx.AsyncClient, model: str, messages: list[dict], temperature: float, max_tokens: int = 48,
                   base_url: str = BASE_URL) -> tuple[str, float]:
    check_host(base_url)
    body = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
    t0 = time.perf_counter()
    r = await client.post(base_url + "/v1/chat/completions", json=body)
    r.raise_for_status()
    return (r.json()["choices"][0]["message"].get("content") or "").strip(), time.perf_counter() - t0


async def run_all(items: list, call, concurrency: int) -> list:
    """Run `call(client, item)` for every item with at most `concurrency` in flight; keeps the order."""
    sem = asyncio.Semaphore(concurrency)
    async with httpx.AsyncClient(timeout=120, limits=httpx.Limits(max_connections=concurrency)) as client:

        async def one(item):
            async with sem:
                return await call(client, item)

        return await asyncio.gather(*(one(i) for i in items))
