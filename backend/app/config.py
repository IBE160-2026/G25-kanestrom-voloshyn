"""All application settings, read from environment variables (spine: Consistency Conventions)."""

import logging
from functools import lru_cache
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import Field, SecretStr, field_validator
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
    # OpenRouter model id for text tasks; required when LLM_MODE=live (AD-3).
    llm_text_model: str | None = None
    # OpenRouter model id for reading photos of notes (`extract_image_text`); required when LLM_MODE=live.
    llm_vision_model: str | None = None
    # Seconds before a provider request gives up (AD-3).
    llm_timeout_seconds: float = Field(60, gt=0, le=600)
    # Milliseconds every mock task waits, so progress steps and cancel can be exercised (AD-4).
    llm_mock_delay_ms: int = Field(0, ge=0, le=600_000)
    # Estimated tokens (characters / 4) of material one request may carry; above it a task like
    # `detect_topics` is split into chunks and the results merged (AD-3).
    llm_context_budget_tokens: int = Field(100_000, ge=1_000, le=2_000_000)

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

    # Outgoing SMTP for auth emails, used only by mailer.py (AD-19). Locally: Mailpit from
    # `npx supabase start`. docker-compose.yml sets the container's host (host.docker.internal).
    smtp_host: str = "127.0.0.1"
    smtp_port: int = Field(54325, ge=1, le=65535)
    smtp_from: str = "Study Buddy <no-reply@studybuddy.local>"
    smtp_username: str | None = None
    smtp_password: SecretStr | None = None
    # none: plain SMTP (Mailpit); starttls: upgrade after connecting; tls: TLS from the start.
    smtp_tls: Literal["none", "starttls", "tls"] = "none"

    # Google sign-in switch, shared with supabase/config.toml (AD-2).
    supabase_auth_external_google_enabled: bool = False
    supabase_auth_external_google_client_id: str = ""
    supabase_auth_external_google_secret: SecretStr | None = None

    # Background jobs run in-process, at most this many at once (AD-20, AD-29).
    jobs_max_concurrent: int = Field(3, ge=1, le=32)

    # Content Integrity thresholds (AD-6). A readable page or slide has at least this many characters.
    integrity_min_page_chars: int = Field(20, ge=1)
    # Paged files (PDF, .pptx): share of readable pages to accept, and below which to reject.
    integrity_paged_accept_ratio: float = Field(0.8, gt=0, le=1)
    integrity_paged_reject_ratio: float = Field(0.3, ge=0, le=1)
    # Every format: fewer characters in total than this rejects.
    integrity_min_total_chars: int = Field(200, ge=0)
    # Non-paged files (.docx, .txt, .md): at least this many characters to accept without a warning.
    integrity_text_accept_chars: int = Field(1000, ge=0)
    # Images: fewer characters of extracted text than this rejects the photo as unreadable.
    integrity_min_image_chars: int = Field(50, ge=0)

    # Daily limits count calendar days in this IANA time zone (AD-12).
    quota_timezone: str = "Europe/Oslo"

    @field_validator("quota_timezone")
    @classmethod
    def _known_timezone(cls, value: str) -> str:
        """Fail at startup, not on the first upload, when the zone doesn't exist."""
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError(f"QUOTA_TIMEZONE is not a known IANA time zone: {value!r}") from None
        return value

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
