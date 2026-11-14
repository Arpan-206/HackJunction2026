"""Local Gemma via Ollama, with the `format` field carrying a JSON schema for constrained decoding."""

import asyncio
from typing import Any

import httpx

from app import constants as c
from app.core.errors import LLMTimeoutError, ServiceUnavailableError
from app.services.llm.base import LLMRequest


class OllamaLLM:
    """Talks to an Ollama server over HTTP."""

    name = "ollama"

    def __init__(self, base_url: str, model: str) -> None:
        """Remember the server URL and model tag."""
        self._url = base_url.rstrip("/") + "/api/chat"
        self._model = model

    async def _call(self, request: LLMRequest, schema: dict[str, Any] | None) -> str:
        """Run one chat call, capping the total time at LLM_TIMEOUT_S."""
        try:
            return await asyncio.wait_for(
                self._chat(request, schema), timeout=c.LLM_TIMEOUT_S
            )
        except TimeoutError as exc:
            raise LLMTimeoutError(
                f"Ollama did not answer within {c.LLM_TIMEOUT_S:g} s"
            ) from exc

    async def _chat(self, request: LLMRequest, schema: dict[str, Any] | None) -> str:
        """Run one non-streaming chat call."""
        body: dict[str, Any] = {
            "model": self._model,
            "stream": False,
            "messages": [
                {"role": "system", "content": request.system},
                {"role": "user", "content": request.prompt},
            ],
            "options": {"num_ctx": c.OLLAMA_NUM_CTX, "temperature": c.LLM_TEMPERATURE},
        }
        if schema is not None:
            body["format"] = schema
        try:
            async with httpx.AsyncClient(timeout=c.LLM_TIMEOUT_S) as client:
                response = await client.post(self._url, json=body)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise ServiceUnavailableError(f"Ollama request failed: {exc}") from exc
        return response.json()["message"]["content"]

    async def generate_json(self, request: LLMRequest) -> str:
        """Return schema-constrained JSON text."""
        return await self._call(request, request.schema)

    async def generate_text(self, request: LLMRequest) -> str:
        """Return plain text."""
        return await self._call(request, None)
