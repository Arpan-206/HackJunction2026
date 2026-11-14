"""A fallback chain of LLM providers: try each in order, move on after any failure, report who answered.

The usual chain is gemini, then ollama, then fake (rule lines). Any exception moves to the next link: a timeout,
a spent budget (RateLimitedError), a 429 or 503, a missing key or an unreachable server. The fake provider never
fails, so a chain that ends in fake always answers.

Who answered is kept in a context variable, so concurrent requests never see each other's provider. Callers read
it with answered_by() right after the call returns.
"""

from __future__ import annotations

import asyncio
import logging
from contextvars import ContextVar
from dataclasses import replace
from typing import Literal

from app.core.errors import LLMTimeoutError, ServiceUnavailableError
from app.services.llm.base import LLMClient, LLMRequest

log = logging.getLogger(__name__)

# Time caps for the links after the first one. A live hint is useless after a few seconds, so a fallback model
# gets a short cap there; lessons, plans and motions may wait longer.
FALLBACK_HINT_TIMEOUT_S = 8.0
FALLBACK_TIMEOUT_S = 60.0

_answered: ContextVar[str | None] = ContextVar("llm_answered_by", default=None)


def answered_by(default: str) -> str:
    """Return the provider that answered the last chain call in this request, or default when no chain ran."""
    return _answered.get() or default


def reset_answered() -> None:
    """Forget the last answer, so a later non-chain call does not inherit it."""
    _answered.set(None)


class ChainLLM:
    """Calls each provider in turn until one answers. Its name is the first link's name."""

    def __init__(self, links: list[LLMClient]) -> None:
        """Keep the links in order; at least one is required."""
        if not links:
            raise ValueError("a chain needs at least one provider")
        self.links = links
        self.name = links[0].name
        self.supports_video = bool(getattr(links[0], "supports_video", False))
        self.last_answered: str | None = None
        self.last_errors: list[str] = []

    @property
    def names(self) -> list[str]:
        """The provider names in the order they are tried."""
        return [link.name for link in self.links]

    def _request_for(self, index: int, request: LLMRequest) -> LLMRequest:
        """The first link gets the request unchanged; later links drop the first link's model override."""
        if index == 0 or request.model is None:
            return request
        return replace(request, model=None)

    def _usable(self, link: LLMClient, request: LLMRequest) -> bool:
        """A video request skips links that cannot watch video, except the fake template."""
        if not request.video_path or link.name == "fake":
            return True
        return bool(getattr(link, "supports_video", False))

    async def _run(self, method: Literal["generate_json", "generate_text"], request: LLMRequest) -> str:
        """Try every usable link in order and return the first answer."""
        reset_answered()
        errors: list[str] = []
        last_exc: Exception | None = None
        for index, link in enumerate(self.links):
            if not self._usable(link, request):
                continue
            call = getattr(link, method)(self._request_for(index, request))
            try:
                if index == 0:
                    text = await call
                else:
                    limit = FALLBACK_HINT_TIMEOUT_S if request.task == "hint" else FALLBACK_TIMEOUT_S
                    text = await asyncio.wait_for(call, timeout=limit)
            except TimeoutError:
                last_exc = LLMTimeoutError(f"{link.name} fallback did not answer in time")
                errors.append(f"{link.name}: timeout")
                log.warning("LLM chain: %s timed out on %s; trying the next provider", link.name, request.task)
                continue
            except Exception as exc:  # noqa: BLE001 - any failure moves to the next link
                last_exc = exc
                errors.append(f"{link.name}: {type(exc).__name__}: {exc}")
                log.warning("LLM chain: %s failed on %s (%s); trying the next provider", link.name, request.task, exc)
                continue
            self.last_answered = link.name
            self.last_errors = errors
            _answered.set(link.name)
            if index:
                log.info("LLM chain: %s answered %s after %s", link.name, request.task, "; ".join(errors))
            return text
        self.last_errors = errors
        if last_exc is None:
            raise ServiceUnavailableError("no provider in the chain can serve this request")
        raise last_exc

    async def generate_json(self, request: LLMRequest) -> str:
        """Return schema-constrained JSON text from the first provider that answers."""
        return await self._run("generate_json", request)

    async def generate_text(self, request: LLMRequest) -> str:
        """Return plain text from the first provider that answers."""
        return await self._run("generate_text", request)
