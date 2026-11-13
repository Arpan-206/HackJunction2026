"""The contract every LLM provider implements."""

from dataclasses import dataclass
from typing import Any, Protocol

from app.schemas.common import Skill


@dataclass(frozen=True)
class LLMRequest:
    """One model call. user_text is the raw request, which offline providers use instead of parsing the prompt."""

    system: str
    prompt: str
    user_text: str
    skill: Skill | None = None
    schema: dict[str, Any] | None = None


class LLMClient(Protocol):
    """A text and structured-JSON generator."""

    name: str

    async def generate_json(self, request: LLMRequest) -> str:
        """Return a JSON document (as text) that should match request.schema."""
        ...

    async def generate_text(self, request: LLMRequest) -> str:
        """Return a short plain-text answer."""
        ...
