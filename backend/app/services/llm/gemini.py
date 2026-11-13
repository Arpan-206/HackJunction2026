"""Gemini provider using google-genai structured output (responseMimeType + responseJsonSchema)."""

import asyncio
import logging
import time
from typing import Any

from app import constants as c
from app.core.errors import LLMTimeoutError, ServiceUnavailableError
from app.services.llm.base import LLMRequest

log = logging.getLogger(__name__)


def _state_name(file: Any) -> str:
    """Return a file's processing state as an upper-case string, whether it is an enum or text."""
    state = getattr(file, "state", None)
    return str(getattr(state, "name", state) or "").upper()


class GeminiLLM:
    """Calls the Gemini API; the client is created lazily so the key is only needed on first use."""

    name = "gemini"
    supports_video = True

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
        """Run one generate_content call, raising LLMTimeoutError if it takes too long."""
        limit = c.LLM_GEMINI_VIDEO_TIMEOUT_S if request.video_path else c.LLM_GEMINI_TIMEOUT_S
        try:
            return await asyncio.wait_for(self._generate(request, as_json), timeout=limit)
        except TimeoutError as exc:
            raise LLMTimeoutError(f"Gemini did not answer within {limit:g} s") from exc

    async def _upload_video(self, client: Any, request: LLMRequest) -> Any:
        """Upload the video, poll until Gemini reports it ACTIVE, and return the file."""
        assert request.video_path is not None
        file = await client.aio.files.upload(file=request.video_path, config={"mime_type": request.video_mime})
        deadline = time.monotonic() + c.VIDEO_PROCESSING_TIMEOUT_S
        while _state_name(file) != "ACTIVE":
            if _state_name(file) == "FAILED":
                raise ServiceUnavailableError("Gemini could not process the video")
            if time.monotonic() > deadline:
                raise LLMTimeoutError(f"Gemini did not finish processing the video within {c.VIDEO_PROCESSING_TIMEOUT_S:g} s")
            await asyncio.sleep(c.VIDEO_POLL_INTERVAL_S)
            file = await client.aio.files.get(name=file.name)
        return file

    async def _generate(self, request: LLMRequest, as_json: bool) -> str:
        """Run the underlying generate_content call without a time limit."""
        from google.genai import types  # noqa: PLC0415

        config: dict[str, Any] = {"system_instruction": request.system, "temperature": c.LLM_TEMPERATURE}
        if as_json:
            config["response_mime_type"] = "application/json"
            config["response_json_schema"] = request.schema
        client = self._get_client()
        contents: Any = request.prompt
        uploaded = None
        if request.video_path:
            uploaded = await self._upload_video(client, request)
            video = types.Part.from_uri(file_uri=uploaded.uri, mime_type=request.video_mime or uploaded.mime_type)
            contents = [video, request.prompt]
        try:
            response = await client.aio.models.generate_content(
                model=self._model, contents=contents, config=types.GenerateContentConfig(**config)
            )
        finally:
            if uploaded is not None:
                await self._forget(client, uploaded)
        return response.text or ""

    @staticmethod
    async def _forget(client: Any, uploaded: Any) -> None:
        """Delete the uploaded video from the Gemini file store, ignoring failures (files expire anyway)."""
        try:
            await client.aio.files.delete(name=uploaded.name)
        except Exception:  # noqa: BLE001 - best-effort cleanup
            log.warning("could not delete uploaded video %s", uploaded.name)

    async def generate_json(self, request: LLMRequest) -> str:
        """Return schema-constrained JSON text."""
        return await self._call(request, as_json=True)

    async def generate_text(self, request: LLMRequest) -> str:
        """Return plain text."""
        return await self._call(request, as_json=False)
