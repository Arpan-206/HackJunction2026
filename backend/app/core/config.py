"""Application settings read from environment variables and an optional .env file."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from app import constants as c


class Settings(BaseSettings):
    """Runtime configuration for the backend."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    gemini_api_key: str | None = None
    gemini_model: str = c.DEFAULT_GEMINI_MODEL
    gemini_hint_model: str = c.GEMINI_HINT_MODEL
    gemini_rpm_budget: int | None = None
    gemini_rpd_budget: int | None = None
    ollama_url: str = c.DEFAULT_OLLAMA_URL
    ollama_model: str = c.DEFAULT_OLLAMA_MODEL
    openai_base_url: str = "http://localhost:8000"
    openai_api_key: str | None = None
    openai_model: str = c.DEFAULT_OPENAI_MODEL
    llm_provider: Literal["fake", "gemini", "ollama", "openai"] = "fake"
    # Providers tried after the first one fails, comma separated (gemini, openai); the first one is skipped.
    # openai joins only when OPENAI_BASE_URL is set. After the last one the coach shows its offline note.
    # "none" keeps one provider.
    llm_fallback: str = "gemini,openai"
    # Per-role first provider, for example "lesson=openai,plan=openai" sends those roles to Gemma on Verda first.
    llm_routes: str = ""
    glove_source: Literal["simulator", "rokoko_udp", "rokoko_sdk", "external"] = (
        "simulator"
    )
    rokoko_udp_port: int = c.ROKOKO_DEFAULT_PORT
    data_dir: Path = c.DEFAULT_DATA_DIR
    cors_origins: list[str] = Field(
        default_factory=lambda: list(c.DEFAULT_CORS_ORIGINS)
    )
    # Real gloves (Rokoko Device SDK). The monitor watches the driver over RCSP and taps its RGMP for status flags.
    # Autostart runs rkk-hand-solver (which starts the driver) when nothing serves the driver port: "auto" does so only
    # with GLOVE_SOURCE=external, the real-glove route, so simulator sessions never touch the hardware.
    rokoko_sdk_dir: Path | None = None
    glove_monitor: bool = True
    glove_driver_tap: bool = True
    glove_autostart: Literal["auto", "on", "off"] = "auto"


@lru_cache
def get_settings() -> Settings:
    """Return the cached process-wide settings."""
    return Settings()
