"""Holds the active LLM provider, switchable at runtime."""

from app import constants as c
from app.core.config import Settings
from app.services.llm.base import LLMClient
from app.services.llm.chain import ChainLLM
from app.services.llm.fake import FakeLLM
from app.services.llm.gemini import GeminiLLM
from app.services.llm.ollama import OllamaLLM
from app.services.llm.openai_compat import OpenAICompatLLM
from app.services.llm.rate_limit import RateLimiter

PROVIDERS = ("fake", "gemini", "ollama", "openai")


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

    def fallback_names(self, primary: str) -> list[str]:
        """The providers tried after primary: LLM_FALLBACK in order, then fake. Empty for fake or "none"."""
        raw = (self._settings.llm_fallback or "").strip().lower()
        if primary == "fake" or raw in ("none", "off"):
            return []
        names = [n.strip() for n in raw.split(",") if n.strip()]
        known = [n for n in names if n in PROVIDERS and n != primary and n != "fake"]
        return list(dict.fromkeys(known)) + ["fake"]

    def _provider(self, name: str) -> LLMClient:
        """Return one bare provider, built once."""
        key = f"bare:{name}"
        if key not in self._clients:
            self._clients[key] = self._build(name)
        return self._clients[key]

    @property
    def chain(self) -> list[str]:
        """The provider names the active client tries, in order (for the dev state and logs)."""
        client = self.client
        return client.names if isinstance(client, ChainLLM) else [client.name]

    @property
    def last_answered(self) -> str | None:
        """The provider that answered the most recent chain call, or None before any call."""
        client = self.client
        return client.last_answered if isinstance(client, ChainLLM) else None

    @property
    def client(self) -> LLMClient:
        """Return the active provider, wrapped in a fallback chain when LLM_FALLBACK names one."""
        if self.name not in self._clients:
            primary = self._provider(self.name)
            rest = [self._provider(n) for n in self.fallback_names(self.name)]
            self._clients[self.name] = ChainLLM([primary, *rest]) if rest else primary
        return self._clients[self.name]

    def select(self, name: str) -> None:
        """Switch the active provider by name."""
        self.name = name

    def use(self, client: LLMClient) -> None:
        """Install a custom client under its own name (used by tests)."""
        self._clients[client.name] = client
        self.name = client.name
