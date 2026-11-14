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

FALLBACKS = ("gemini", "openai")  # providers LLM_FALLBACK and LLM_ROUTES may name
UNSET_OPENAI_URL = "http://localhost:8000"  # the Settings default: this backend, not a model server
ROLES = ("hint", "plan", "lesson", "motion")  # LLMRequest.task values


class LLMState:
    """Builds providers on demand and remembers which one is active."""

    def __init__(self, settings: Settings) -> None:
        """Start on the configured provider."""
        self._settings = settings
        self._clients: dict[str, LLMClient] = {}
        self.name: str = settings.llm_provider
        self._installed: LLMClient | None = None
        self._last_answered: dict[str, str] = {}
        self.limiter = RateLimiter(
            settings.data_dir / c.GEMINI_USAGE_FILE,
            rpm_override=settings.gemini_rpm_budget,
            rpd_override=settings.gemini_rpd_budget,
        )

    @property
    def hint_model(self) -> str | None:
        """The model for live coach hints: the Gemini hint model, or None so other providers use their own."""
        return self._settings.gemini_hint_model if self.primary_for("hint") == "gemini" else None

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

    def openai_configured(self) -> bool:
        """True when OPENAI_BASE_URL was set, in the environment or a .env file (the default is this backend itself)."""
        url = self._settings.openai_base_url.rstrip("/")
        return "openai_base_url" in self._settings.model_fields_set and bool(url) and url != UNSET_OPENAI_URL

    def fallback_names(self, primary: str) -> list[str]:
        """The providers tried after primary: the ones LLM_FALLBACK names that are configured. Empty for fake or none."""
        raw = (self._settings.llm_fallback or "").strip().lower()
        if primary == "fake" or raw in ("none", "off"):
            return []
        names = [n.strip() for n in raw.split(",") if n.strip()]
        usable = [n for n in names if n in FALLBACKS and n != primary]
        if "openai" in usable and not self.openai_configured():
            usable.remove("openai")
        return list(dict.fromkeys(usable))

    def _provider(self, name: str) -> LLMClient:
        """Return one bare provider, built once."""
        key = f"bare:{name}"
        if key not in self._clients:
            self._clients[key] = self._build(name)
        return self._clients[key]

    def routes(self) -> dict[str, str]:
        """Per-role first providers from LLM_ROUTES, for example lesson=openai,plan=openai."""
        out: dict[str, str] = {}
        for part in (self._settings.llm_routes or "").split(","):
            role, _, name = part.partition("=")
            role, name = role.strip().lower(), name.strip().lower()
            if role in ROLES and name in (*FALLBACKS, "fake"):
                out[role] = name
        return out

    def primary_for(self, role: str | None) -> str:
        """The first provider for a role. The dev panel's fake switch wins over every route."""
        if role is None or self.name == "fake":
            return self.name
        return self.routes().get(role, self.name)

    def chain_for(self, role: str | None) -> list[str]:
        """The provider names a role tries, in order, after the fallback rules."""
        primary = self.primary_for(role)
        return [primary] if primary == "fake" else [primary, *self.fallback_names(primary)]

    def client_for(self, role: str | None) -> LLMClient:
        """The client for one role (hint, plan, lesson, motion). Every real model runs inside a chain."""
        if self._installed is not None:
            return self._installed
        names = self.chain_for(role)
        key = "chain:" + ",".join(names)
        if key not in self._clients:
            links = [self._provider(n) for n in names]
            self._clients[key] = links[0] if names == ["fake"] else ChainLLM(links, on_answer=self.record)
        return self._clients[key]

    @property
    def chain(self) -> list[str]:
        """The provider names the default role tries, in order."""
        return self.chain_for(None)

    @property
    def last_answered(self) -> str | None:
        """The provider that answered the most recent call of any chain, or None before any call."""
        return self._last_answered.get("any")

    def record(self, role: str, provider: str) -> None:
        """Remember who answered a role, for the dev state."""
        self._last_answered[role] = provider
        self._last_answered["any"] = provider

    @property
    def client(self) -> LLMClient:
        """The client for requests with no role."""
        return self.client_for(None)

    def select(self, name: str) -> None:
        """Switch the active provider by name."""
        self.name = name
        self._installed = None

    def use(self, client: LLMClient) -> None:
        """Install a custom client for every role (used by tests)."""
        self._installed = client
        self.name = client.name
