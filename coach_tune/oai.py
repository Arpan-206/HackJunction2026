"""A small async client for one OpenAI-compatible vLLM server, with per-call latency. No key: the VM port is reached
through an SSH tunnel (ssh -L 8001:localhost:8001), so nothing is open to the internet."""

from __future__ import annotations

import asyncio
import time

import httpx

BASE_URL = "http://localhost:8001"


async def served_model(base_url: str = BASE_URL) -> str:
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(base_url + "/v1/models")
        r.raise_for_status()
        return r.json()["data"][0]["id"]


async def complete(client: httpx.AsyncClient, model: str, messages: list[dict], temperature: float, max_tokens: int = 48,
                   base_url: str = BASE_URL) -> tuple[str, float]:
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
