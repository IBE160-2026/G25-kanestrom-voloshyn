"""LLM_MODE resolution at startup (AD-4)."""

import logging

import pytest

from app.config import ConfigError, Settings, resolve_llm_mode


def settings(**values) -> Settings:
    return Settings(_env_file=None, **values)


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    monkeypatch.delenv("LLM_MODE", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)


def test_development_without_mode_or_key_is_mock_with_one_warning(caplog):
    with caplog.at_level(logging.WARNING, logger="app.config"):
        mode = resolve_llm_mode(settings(app_env="development"))
    assert mode == "mock"
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1


def test_development_without_mode_but_with_key_is_live_without_warning(caplog):
    with caplog.at_level(logging.WARNING, logger="app.config"):
        mode = resolve_llm_mode(settings(app_env="development", openrouter_api_key="sk-test"))
    assert mode == "live"
    assert [r for r in caplog.records if r.levelno == logging.WARNING] == []


def test_development_live_without_key_fails_naming_key():
    with pytest.raises(ConfigError, match="OPENROUTER_API_KEY"):
        resolve_llm_mode(settings(app_env="development", llm_mode="live"))


def test_production_without_mode_fails_naming_llm_mode():
    with pytest.raises(ConfigError, match="LLM_MODE"):
        resolve_llm_mode(settings(app_env="production"))


def test_production_live_without_key_fails_naming_key():
    with pytest.raises(ConfigError, match="OPENROUTER_API_KEY"):
        resolve_llm_mode(settings(app_env="production", llm_mode="live"))


def test_production_mock_is_allowed_explicitly():
    assert resolve_llm_mode(settings(app_env="production", llm_mode="mock")) == "mock"


def test_empty_env_values_count_as_unset(monkeypatch):
    # .env copied from .env.example has empty values.
    monkeypatch.setenv("LLM_MODE", "")
    monkeypatch.setenv("OPENROUTER_API_KEY", "")
    monkeypatch.setenv("APP_ENV", "production")
    with pytest.raises(ConfigError, match="LLM_MODE"):
        resolve_llm_mode(Settings(_env_file=None))


def test_startup_fails_in_production_without_mode():
    from fastapi.testclient import TestClient

    from app.main import create_app

    app = create_app(settings(app_env="production"))
    with pytest.raises(ConfigError, match="LLM_MODE"):
        with TestClient(app):
            pass
