"""Gemini provider using google-genai structured output (responseMimeType + responseJsonSchema)."""

from typing import Any

from app import constants as c
from app.core.errors import ServiceUnavailableError
from app.services.llm.base import LLMRequest


class GeminiLLM:
    """Calls the Gemini API; the client is created lazily so the key is only needed on first use."""

    name = "gemini"

    def __init__(self, api_key: str | None, model: str) -> None:
        """Remember credentials; nothing is contacted until a call is made."""
        self._api_key = api_key
        self._model = model
        self._client: Any = None

    def _get_client(self) -> Any:
        """Create the google-genai client on first use."""
        if not self._api_key:
            raise ServiceUnavailableError("GEMINI_API_KEY is not set")
        if self._client is None:
            from google import genai  # noqa: PLC0415 - heavy import, only needed for this provider

            self._client = genai.Client(api_key=self._api_key)
        return self._client

    async def _call(self, request: LLMRequest, as_json: bool) -> str:
        """Run one generate_content call."""
        from google.genai import types  # noqa: PLC0415

        config: dict[str, Any] = {"system_instruction": request.system, "temperature": c.LLM_TEMPERATURE}
        if as_json:
            config["response_mime_type"] = "application/json"
            config["response_json_schema"] = request.schema
        response = await self._get_client().aio.models.generate_content(
            model=self._model, contents=request.prompt, config=types.GenerateContentConfig(**config)
        )
        return response.text or ""

    async def generate_json(self, request: LLMRequest) -> str:
        """Return schema-constrained JSON text."""
        return await self._call(request, as_json=True)

    async def generate_text(self, request: LLMRequest) -> str:
        """Return plain text."""
        return await self._call(request, as_json=False)
