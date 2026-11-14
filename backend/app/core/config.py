"""Application settings read from environment variables and an optional .env file."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field
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
    # Gemma on Verda (or any OpenAI-compatible server). The Verda lane's own names work too: VERDA_GEMMA_URL for the
    # base URL (verda/out/endpoint.json "base_url"), VERDA_INFERENCE_KEY for the key, VERDA_GEMMA_MODEL for the model.
    openai_base_url: str = Field(
        default="http://localhost:8000",
        validation_alias=AliasChoices("openai_base_url", "verda_gemma_url"),
    )
    openai_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("openai_api_key", "verda_inference_key"),
    )
    openai_model: str = Field(
        default=c.DEFAULT_OPENAI_MODEL,
        validation_alias=AliasChoices("openai_model", "verda_gemma_model"),
    )
    llm_provider: Literal["fake", "gemini", "openai"] = "fake"
    # Providers tried after the first one fails, comma separated (gemini, openai); the first one is skipped.
    # openai joins only when OPENAI_BASE_URL is set. After the last one the coach shows its offline note.
    # "none" keeps one provider.
    llm_fallback: str = "gemini,openai"
    # Per-role first provider, for example "lesson=openai,plan=openai" sends those roles to Gemma on Verda first.
    llm_routes: str = ""
    # The tuned coach (coach_tune/): with COACH_MODEL=tuned and TUNED_BASE_URL set, live hints try the small fine-tuned
    # Gemma first, then the chain above. Off by default.
    coach_model: Literal["default", "tuned"] = "default"
    tuned_base_url: str = ""
    tuned_api_key: str | None = None
    tuned_model: str = c.DEFAULT_TUNED_MODEL
    tuned_lang: Literal["en", "de", "fi"] = "en"
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
    # Dev file reveal (POST /api/dev/reveal, GET /api/dev/locate): localhost only, and only while this is on.
    dev_reveal: bool = c.DEV_REVEAL_ENABLED
    # Every take and lesson is also written locally as a core lesson folder for Arpan's local tools and the Verda
    # request context (services/core_export.py); nothing is uploaded. None keeps the folders under <data_dir>/core_lessons.
    core_export: bool = True
    core_export_dir: Path | None = None


@lru_cache
def get_settings() -> Settings:
    """Return the cached process-wide settings."""
    return Settings()
