"""Holds the active LLM provider, switchable at runtime."""

from app.core.config import Settings
from app.services.llm.base import LLMClient
from app.services.llm.fake import FakeLLM
from app.services.llm.gemini import GeminiLLM
from app.services.llm.ollama import OllamaLLM


class LLMState:
    """Builds providers on demand and remembers which one is active."""

    def __init__(self, settings: Settings) -> None:
        """Start on the configured provider."""
        self._settings = settings
        self._clients: dict[str, LLMClient] = {}
        self.name: str = settings.llm_provider

    def _build(self, name: str) -> LLMClient:
        """Construct a provider by name."""
        if name == "gemini":
            return GeminiLLM(self._settings.gemini_api_key, self._settings.gemini_model)
        if name == "ollama":
            return OllamaLLM(self._settings.ollama_url, self._settings.ollama_model)
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
