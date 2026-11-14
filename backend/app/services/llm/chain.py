"""A fallback chain of LLM providers: try each in order with a short time cap, report who answered.

The chain is gemini then the OpenAI-compatible endpoint (Gemma on Verda) when it is configured, or the other way
round when a role is routed to Verda first. Any failure
moves to the next link: a timeout, a spent budget (RateLimitedError), a 429 or 503, a missing key or an
unreachable server. When every link fails the chain raises LLMOfflineError at once, so no caller hangs or retries:
the coach shows the offline note, and lessons, plans and motions use their templates.

Who answered is kept in a context variable, so concurrent requests never see each other's provider. Callers read
it with answered_by() right after the call returns.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from contextvars import ContextVar
from dataclasses import replace
from typing import Literal

from app.core.errors import LLMTimeoutError
from app.services.llm.base import LLMClient, LLMRequest

log = logging.getLogger(__name__)

# Time caps on every model call in the chain. A live hint is useless after a few seconds. Gemma on Verda (the
# openai provider) gets 20 s, then the same request goes to Gemini. A video lesson keeps the provider's own longer
# limit, because Gemini must upload and process the video first.
HINT_TIMEOUT_S = 5.0
CALL_TIMEOUT_S = 30.0
OPENAI_TIMEOUT_S = 20.0

OFFLINE = "offline"

_answered: ContextVar[str | None] = ContextVar("llm_answered_by", default=None)


class LLMOfflineError(LLMTimeoutError):
    """Every provider in the chain failed or timed out. Callers fall back at once, without retrying."""


def answered_by(default: str) -> str:
    """Return the provider that answered the last chain call in this request, or default when no chain ran."""
    return _answered.get() or default


def reset_answered() -> None:
    """Forget the last answer, so a later non-chain call does not inherit it."""
    _answered.set(None)


class ChainLLM:
    """Calls each provider in turn until one answers. Its name is the first link's name."""

    def __init__(
        self,
        links: list[LLMClient],
        on_answer: Callable[[str, str], None] | None = None,
    ) -> None:
        """Keep the links in order; at least one is required. on_answer(role, provider) hears every outcome."""
        if not links:
            raise ValueError("a chain needs at least one provider")
        self.links = links
        self.name = links[0].name
        self.supports_video = any(
            getattr(link, "supports_video", False) for link in links
        )
        self.last_answered: str | None = None
        self.last_errors: list[str] = []
        self._on_answer = on_answer

    @property
    def names(self) -> list[str]:
        """The provider names in the order they are tried."""
        return [link.name for link in self.links]

    def _request_for(self, index: int, request: LLMRequest) -> LLMRequest:
        """The first link gets the request unchanged; later links drop the first link's model override."""
        if index == 0 or request.model is None:
            return request
        return replace(request, model=None)

    @staticmethod
    def _usable(link: LLMClient, request: LLMRequest) -> bool:
        """A video request skips links that cannot watch video."""
        return not request.video_path or bool(getattr(link, "supports_video", False))

    @staticmethod
    def _limit(link: LLMClient, request: LLMRequest) -> float | None:
        """The time cap for one call: short for hints, 20 s for Verda, none extra for video."""
        if request.video_path:
            return None
        if request.task == "hint":
            return HINT_TIMEOUT_S
        return OPENAI_TIMEOUT_S if link.name == "openai" else CALL_TIMEOUT_S

    async def _run(
        self, method: Literal["generate_json", "generate_text"], request: LLMRequest
    ) -> str:
        """Try every usable link in order and return the first answer."""
        reset_answered()
        errors: list[str] = []
        first_failure: tuple[str, str, float] | None = None
        for index, link in enumerate(self.links):
            if not self._usable(link, request):
                continue
            limit = self._limit(link, request)
            call = getattr(link, method)(self._request_for(index, request))
            start = time.perf_counter()
            try:
                text = await asyncio.wait_for(call, timeout=limit)
            except TimeoutError:
                first_failure = first_failure or (
                    link.name,
                    f"timeout after {limit:g} s",
                    time.perf_counter() - start,
                )
                errors.append(f"{link.name}: timeout after {limit:g} s")
                log.warning(
                    "LLM chain: %s timed out on %s; trying the next provider",
                    link.name,
                    request.task,
                )
                continue
            except Exception as exc:  # noqa: BLE001 - any failure moves to the next link
                first_failure = first_failure or (
                    link.name,
                    f"{type(exc).__name__}: {exc}",
                    time.perf_counter() - start,
                )
                errors.append(f"{link.name}: {type(exc).__name__}: {exc}")
                log.warning(
                    "LLM chain: %s failed on %s (%s); trying the next provider",
                    link.name,
                    request.task,
                    exc,
                )
                continue
            self._note(request.task, link.name)
            self.last_errors = errors
            _answered.set(link.name)
            if first_failure is not None:
                failed, reason, failed_s = first_failure
                log.warning(
                    "LLM fallback: role=%s from=%s to=%s reason=%s failed_after=%.2fs answered_in=%.2fs",
                    request.task,
                    failed,
                    link.name,
                    reason,
                    failed_s,
                    time.perf_counter() - start,
                )
            return text
        self._note(request.task, OFFLINE)
        self.last_errors = errors
        raise LLMOfflineError(
            "no model answered: "
            + ("; ".join(errors) or "no provider can serve this request")
        )

    def _note(self, role: str, provider: str) -> None:
        """Remember who answered and tell the listener."""
        self.last_answered = provider
        if self._on_answer is not None:
            self._on_answer(role, provider)

    async def generate_json(self, request: LLMRequest) -> str:
        """Return schema-constrained JSON text from the first provider that answers."""
        return await self._run("generate_json", request)

    async def generate_text(self, request: LLMRequest) -> str:
        """Return plain text from the first provider that answers."""
        return await self._run("generate_text", request)
