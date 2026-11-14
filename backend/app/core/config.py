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
    ollama_url: str = c.DEFAULT_OLLAMA_URL
    ollama_model: str = c.DEFAULT_OLLAMA_MODEL
    llm_provider: Literal["fake", "gemini", "ollama"] = "fake"
    glove_source: Literal["simulator", "rokoko_udp", "rokoko_sdk", "external"] = "simulator"
    rokoko_udp_port: int = c.ROKOKO_DEFAULT_PORT
    data_dir: Path = c.DEFAULT_DATA_DIR
    cors_origins: list[str] = Field(default_factory=lambda: list(c.DEFAULT_CORS_ORIGINS))


@lru_cache
def get_settings() -> Settings:
    """Return the cached process-wide settings."""
    return Settings()
