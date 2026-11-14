"""An OpenAI-compatible provider for the backend's `LLMClient` protocol: vLLM on Verda, or any `/v1/chat/completions`.

This module is written so it can be copied unchanged to `backend/app/services/llm/openai_compat.py`. The six lines that
wire it into `Settings` and `LLMState` are in STATUS-verda.md. Until then the verda lane imports it from here and
installs it with `LLMState.use()`.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx

from app import constants as c
from app.core.errors import LLMTimeoutError, ServiceUnavailableError
from app.services.llm.base import LLMRequest

CHAT_PATH = "/v1/chat/completions"
OPENAI_MAX_TOKENS = 2048


class OpenAICompatLLM:
    """Talks to an OpenAI-compatible chat completions server; JSON output is constrained with `response_format`."""

    name = "openai"
    supports_video = False

    def __init__(
        self,
        base_url: str,
        api_key: str | None,
        model: str,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        """Remember the server, the key and the model tag; nothing is contacted until a call is made."""
        self._url = base_url.rstrip("/") + CHAT_PATH
        self._headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        self._model = model
        self._transport = transport

    async def _call(self, request: LLMRequest, schema: dict[str, Any] | None) -> str:
        """Run one chat call, capping the total time at LLM_TIMEOUT_S."""
        try:
            return await asyncio.wait_for(
                self._chat(request, schema), timeout=c.LLM_TIMEOUT_S
            )
        except TimeoutError as exc:
            raise LLMTimeoutError(
                f"{self._model} did not answer within {c.LLM_TIMEOUT_S:g} s"
            ) from exc

    async def _chat(self, request: LLMRequest, schema: dict[str, Any] | None) -> str:
        """One non-streaming chat completion. A 400 on a schema means an unsupported JSON Schema feature: ask for any JSON."""
        body: dict[str, Any] = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": request.system},
                {"role": "user", "content": request.prompt},
            ],
            "temperature": c.LLM_TEMPERATURE,
            "max_tokens": OPENAI_MAX_TOKENS,
        }
        if schema is not None:
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": request.task, "schema": schema},
            }
        try:
            async with httpx.AsyncClient(
                timeout=c.LLM_TIMEOUT_S,
                headers=self._headers,
                transport=self._transport,
            ) as client:
                response = await client.post(self._url, json=body)
                if response.status_code == 400 and schema is not None:
                    body["response_format"] = {"type": "json_object"}
                    response = await client.post(self._url, json=body)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise ServiceUnavailableError(
                f"OpenAI-compatible request failed: {exc}"
            ) from exc
        return response.json()["choices"][0]["message"].get("content") or ""

    async def generate_json(self, request: LLMRequest) -> str:
        """Return schema-constrained JSON text."""
        return await self._call(request, request.schema)

    async def generate_text(self, request: LLMRequest) -> str:
        """Return plain text."""
        return await self._call(request, None)
