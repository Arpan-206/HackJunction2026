"""Holds the active LLM provider, switchable at runtime."""

from app import constants as c
from app.core.config import Settings
from app.services.llm.base import LLMClient
from app.services.llm.fake import FakeLLM
from app.services.llm.gemini import GeminiLLM
from app.services.llm.ollama import OllamaLLM
from app.services.llm.openai_compat import OpenAICompatLLM
from app.services.llm.rate_limit import RateLimiter


class LLMState:
    """Builds providers on demand and remembers which one is active."""

    def __init__(self, settings: Settings) -> None:
        """Start on the configured provider."""
        self._settings = settings
        self._clients: dict[str, LLMClient] = {}
        self.name: str = settings.llm_provider
        self.limiter = RateLimiter(
            settings.data_dir / c.GEMINI_USAGE_FILE,
            rpm_override=settings.gemini_rpm_budget,
            rpd_override=settings.gemini_rpd_budget,
        )

    @property
    def hint_model(self) -> str | None:
        """The model for live coach hints: the Gemini hint model, or None so other providers use their own."""
        return self._settings.gemini_hint_model if self.name == "gemini" else None

    def budgets(self) -> list[dict]:
        """Remaining Gemini budget for the models in use (main and hint), for GET /dev/state."""
        models = dict.fromkeys(
            [self._settings.gemini_model, self._settings.gemini_hint_model]
        )
        return [self.limiter.remaining(m) for m in models]

    def _build(self, name: str) -> LLMClient:
        """Construct a provider by name."""
        if name == "gemini":
            return GeminiLLM(
                self._settings.gemini_api_key, self._settings.gemini_model, self.limiter
            )
        if name == "ollama":
            return OllamaLLM(self._settings.ollama_url, self._settings.ollama_model)
        if name == "openai":
            return OpenAICompatLLM(
                self._settings.openai_base_url, self._settings.openai_api_key, self._settings.openai_model
            )
        return FakeLLM()

    @property
    def client(self) -> LLMClient:
        """Return the active provider."""
        if self.name not in self._clients:
            self._clients[self.name] = self._build(self.name)
        return self._clients[self.name]

    def select(self, name: str) -> None:
        """Switch the active provider by name."""
        self.name = name

    def use(self, client: LLMClient) -> None:
        """Install a custom client under its own name (used by tests)."""
        self._clients[client.name] = client
        self.name = client.name
