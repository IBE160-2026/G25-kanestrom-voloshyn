"""All application settings, read from environment variables (spine: Consistency Conventions)."""

import logging
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

# Repository root: backend/app/config.py -> parents[2]. In the Docker image this is /app.
REPO_ROOT = Path(__file__).resolve().parents[2]

LlmMode = Literal["mock", "live"]


class ConfigError(RuntimeError):
    """Raised when the settings cannot start the app (AD-4)."""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        # An empty value in .env (as copied from .env.example) means "unset".
        env_ignore_empty=True,
        extra="ignore",
    )

    app_env: Literal["development", "production"] = "development"

    # LLM (AD-3, AD-4). Resolved at startup by resolve_llm_mode().
    llm_mode: LlmMode | None = None
    openrouter_api_key: SecretStr | None = None

    # Database: direct Postgres URL (AD-16, AD-29).
    database_url: SecretStr = SecretStr("postgresql://postgres:postgres@127.0.0.1:54322/postgres")

    # Supabase (AD-1, AD-17). SUPABASE_URL is server to server; SUPABASE_PUBLIC_URL is for the browser.
    supabase_url: str = "http://127.0.0.1:54321"
    supabase_public_url: str = "http://127.0.0.1:54321"
    supabase_publishable_key: str = ""
    supabase_secret_key: SecretStr | None = None

    # Sessions end this many days after sign-in, whatever Supabase's refresh tokens allow (AD-2).
    session_max_age_days: int = Field(30, ge=1, le=3650)

    # What the phone QR code encodes (AD-17, AD-24).
    app_public_url: str = "http://localhost:8000"

    # Google sign-in switch, shared with supabase/config.toml (AD-2).
    supabase_auth_external_google_enabled: bool = False
    supabase_auth_external_google_client_id: str = ""
    supabase_auth_external_google_secret: SecretStr | None = None

    # Built SPA served by FastAPI (AD-17).
    frontend_dist: Path = REPO_ROOT / "frontend" / "dist"

    @property
    def google_enabled(self) -> bool:
        secret = self.supabase_auth_external_google_secret
        return bool(
            self.supabase_auth_external_google_enabled
            and self.supabase_auth_external_google_client_id
            and secret is not None
            and secret.get_secret_value()
        )


def resolve_llm_mode(settings: Settings) -> LlmMode:
    """Decide the LLM mode at startup (AD-4). Never falls back silently in production."""
    has_key = bool(settings.openrouter_api_key and settings.openrouter_api_key.get_secret_value())
    mode = settings.llm_mode

    if mode is None:
        if settings.app_env == "production":
            raise ConfigError("LLM_MODE must be set to 'mock' or 'live' when APP_ENV=production")
        if not has_key:
            logger.warning("LLM_MODE is not set and OPENROUTER_API_KEY is missing; using mock mode")
            return "mock"
        mode = "live"

    if mode == "live" and not has_key:
        raise ConfigError("OPENROUTER_API_KEY is required when LLM_MODE=live")
    return mode


@lru_cache
def get_settings() -> Settings:
    return Settings()
