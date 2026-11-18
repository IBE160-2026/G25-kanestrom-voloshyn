"""The LLM gateway and mock mode (Story 2.4a, AD-3, AD-4). The live path uses a stubbed client, so nothing
calls a provider."""

import asyncio
import json
import logging
import time
from pathlib import Path
from types import SimpleNamespace

import httpx2
import openai
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import extraction
from app.config import ConfigError, Settings
from app.errors import install_error_handlers
from app.extraction import ExtractedSection
from app.llm.gateway import NAME_PROJECT_MAX_CHARS, label_sections
from app.llm import (
    Gateway,
    LLMOutputError,
    ProjectName,
    ProviderRateLimited,
    ProviderUnavailable,
    create_gateway,
)

TEST_DATA = Path(__file__).resolve().parents[2] / "test-data"
MODEL = "test/text-model"
VISION_MODEL = "test/vision-model"
SECRET_TEXT = "Chlorophyll absorbs blue light"


def settings(**values) -> Settings:
    return Settings(_env_file=None, **values)


def run(coro):
    return asyncio.run(coro)


def sections_from(name: str, file_type: str) -> tuple[ExtractedSection, ...]:
    return extraction.extract_sync((TEST_DATA / name).read_bytes(), file_type).sections


# --- Stubbed OpenAI-compatible client ---


def reply(content: str | None) -> SimpleNamespace:
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


class StubClient:
    """Records each `chat.completions.create` call and plays back the given replies or exceptions."""

    def __init__(self, *outcomes):
        self.calls: list[dict] = []
        self._outcomes = list(outcomes)
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        outcome = self._outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return reply(outcome)


def live(*outcomes) -> tuple[Gateway, StubClient]:
    client = StubClient(*outcomes)
    gateway = Gateway(
        settings(llm_mode="live", openrouter_api_key="sk-test", llm_text_model=MODEL, llm_vision_model=VISION_MODEL), "live", client=client
    )
    return gateway, client


def mock(**values) -> Gateway:
    return create_gateway(settings(llm_mode="mock", **values), "mock")


SECTIONS = (ExtractedSection(label="Part 1", text=f"# Light reactions\n\n{SECRET_TEXT} and red light."),)
_REQUEST = httpx2.Request("POST", "https://openrouter.ai/api/v1/chat/completions")


def status_error(cls, status: int):
    return cls("provider error", response=httpx2.Response(status, request=_REQUEST), body=None)


# --- Mock mode ---


def test_mock_names_from_the_first_heading_every_time():
    sections = sections_from("photosynthesis-notes.md", "md")
    gateway = mock()
    first = run(gateway.name_project(sections))
    second = run(gateway.name_project(sections))
    assert first == ProjectName(name="Photosynthesis: Study Notes")
    assert second == first


def test_mock_without_heading_uses_the_first_six_words():
    sections = (
        ExtractedSection(label="Part 1", text="Water evaporates from oceans and lakes when the sun heats them."),
        ExtractedSection(label="Part 2", text="# Not the first Section"),
    )
    assert run(mock().name_project(sections)) == ProjectName(name="Water evaporates from oceans and lakes")


def test_mock_name_is_trimmed_to_100_characters():
    sections = (ExtractedSection(label="Part 1", text="# " + "x" * 150),)
    assert run(mock().name_project(sections)).name == "x" * 100


def test_mock_skips_a_blank_first_section():
    sections = (
        ExtractedSection(label="Page 1", text="  \n "),
        ExtractedSection(label="Page 2", text="Water evaporates from oceans and lakes when the sun heats them."),
    )
    assert run(mock().name_project(sections)) == ProjectName(name="Water evaporates from oceans and lakes")


def test_mock_without_text_is_an_output_error():
    with pytest.raises(LLMOutputError):
        run(mock().name_project((ExtractedSection(label="Part 1", text="   "),)))


def test_mock_delay_applies():
    gateway = mock(llm_mock_delay_ms=50)
    started = time.perf_counter()
    run(gateway.name_project(SECTIONS))
    # A little slack: Windows' clock is coarse and sleep may wake a few ms early.
    assert time.perf_counter() - started >= 0.045


def test_mock_mode_has_no_client():
    gateway = mock()
    assert gateway.mode == "mock"
    assert gateway._client is None
    run(gateway.aclose())


# --- Live mode with a stubbed client ---


def test_live_request_carries_model_privacy_flags_and_json_schema():
    gateway, client = live(json.dumps({"name": "Fotosyntese"}))
    assert run(gateway.name_project(SECTIONS)) == ProjectName(name="Fotosyntese")
    assert len(client.calls) == 1
    call = client.calls[0]
    assert call["model"] == MODEL
    assert call["extra_body"]["provider"] == {"require_parameters": True, "data_collection": "deny", "zdr": True}
    assert call["response_format"]["type"] == "json_schema"
    assert call["response_format"]["json_schema"]["schema"]["required"] == ["name"]
    # The supplied text reaches the model, labelled locally as S1.
    user = call["messages"][-1]["content"]
    assert user.startswith("[S1]") and SECRET_TEXT in user


def test_live_invalid_once_retries_exactly_once():
    gateway, client = live("not json", json.dumps({"name": "Photosynthesis"}))
    assert run(gateway.name_project(SECTIONS)).name == "Photosynthesis"
    assert len(client.calls) == 2


@pytest.mark.parametrize(
    "replies",
    [
        ("not json", json.dumps({"wrong": "field"})),
        (json.dumps({"name": "   "}), json.dumps({"name": ""})),
        (None, json.dumps({"name": "x" * 101})),
    ],
    ids=["invalid-twice", "blank-name", "empty-and-too-long"],
)
def test_live_invalid_twice_is_an_output_error(replies):
    gateway, client = live(*replies)
    with pytest.raises(LLMOutputError):
        run(gateway.name_project(SECTIONS))
    assert len(client.calls) == 2


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (status_error(openai.RateLimitError, 429), ProviderRateLimited),
        (status_error(openai.APIStatusError, 402), ProviderUnavailable),
        (status_error(openai.PermissionDeniedError, 403), ProviderUnavailable),
        (status_error(openai.InternalServerError, 502), ProviderUnavailable),
        (openai.APITimeoutError(request=_REQUEST), ProviderUnavailable),
        (openai.APIConnectionError(request=_REQUEST), ProviderUnavailable),
        (openai.APIError("provider error", request=_REQUEST, body=None), ProviderUnavailable),
    ],
    ids=["429", "402", "403", "502", "timeout", "connection", "other-api-error"],
)
def test_live_provider_errors_map_to_gateway_errors(error, expected):
    gateway, client = live(error)
    with pytest.raises(expected):
        run(gateway.name_project(SECTIONS))
    assert len(client.calls) == 1  # provider errors aren't schema retries


def test_live_reply_without_message_is_retried_then_an_output_error():
    no_message = SimpleNamespace(choices=[SimpleNamespace(message=None)])

    class NoMessageClient(StubClient):
        async def _create(self, **kwargs):
            self.calls.append(kwargs)
            return no_message

    client = NoMessageClient()
    gateway = Gateway(
        settings(llm_mode="live", openrouter_api_key="sk-test", llm_text_model=MODEL, llm_vision_model=VISION_MODEL), "live", client=client
    )
    with pytest.raises(LLMOutputError):
        run(gateway.name_project(SECTIONS))
    assert len(client.calls) == 2


def test_label_sections_caps_the_text_at_12000_characters():
    message = label_sections(["a" * 11_990, "b" * 50, "c" * 10], NAME_PROJECT_MAX_CHARS)
    assert NAME_PROJECT_MAX_CHARS == 12_000
    assert message == f"[S1]\n{'a' * 11_990}\n\n[S2]\n{'b' * 10}"
    assert "[S3]" not in message


def test_live_logs_task_model_duration_and_outcome_but_no_text(caplog):
    gateway, _ = live(json.dumps({"name": "Secret Name"}))
    with caplog.at_level(logging.DEBUG, logger="app.llm"):
        run(gateway.name_project(SECTIONS))
    lines = [r.getMessage() for r in caplog.records]
    assert any("task=name_project" in line and f"model={MODEL}" in line and "outcome=ok" in line for line in lines)
    joined = "\n".join(lines)
    assert SECRET_TEXT not in joined and "Secret Name" not in joined and "sk-test" not in joined


def test_live_failure_is_logged_with_its_outcome(caplog):
    gateway, _ = live(status_error(openai.RateLimitError, 429))
    with caplog.at_level(logging.INFO, logger="app.llm"), pytest.raises(ProviderRateLimited):
        run(gateway.name_project(SECTIONS))
    assert any("outcome=ProviderRateLimited" in r.getMessage() for r in caplog.records)


def test_live_provider_failure_log_keeps_the_status_code(caplog):
    gateway, _ = live(status_error(openai.AuthenticationError, 401))
    with caplog.at_level(logging.INFO, logger="app.llm"), pytest.raises(ProviderUnavailable):
        run(gateway.name_project(SECTIONS))
    assert any("outcome=ProviderUnavailable (Provider answered 401)" in r.getMessage() for r in caplog.records)


def test_live_without_text_model_fails_at_startup():
    with pytest.raises(ConfigError, match="LLM_TEXT_MODEL"):
        create_gateway(settings(llm_mode="live", openrouter_api_key="sk-test"), "live")


def test_live_builds_an_openrouter_client_without_calling_it():
    gateway = create_gateway(
        settings(llm_mode="live", openrouter_api_key="sk-test", llm_text_model=MODEL, llm_vision_model=VISION_MODEL, llm_timeout_seconds=12), "live"
    )
    assert isinstance(gateway._client, openai.AsyncOpenAI)
    assert str(gateway._client.base_url).rstrip("/") == "https://openrouter.ai/api/v1"
    assert gateway._client.timeout == 12
    assert gateway._client.max_retries == 0
    run(gateway.aclose())


# --- Settings ---


def test_llm_settings_defaults(monkeypatch):
    for name in ("LLM_TEXT_MODEL", "LLM_TIMEOUT_SECONDS", "LLM_MOCK_DELAY_MS"):
        monkeypatch.delenv(name, raising=False)
    s = settings()
    assert s.llm_text_model is None
    assert s.llm_timeout_seconds == 60
    assert s.llm_mock_delay_ms == 0


# --- API envelope ---


@pytest.fixture
def envelope_client() -> TestClient:
    app = FastAPI()
    install_error_handlers(app)

    errors = {
        "rate-limited": ProviderRateLimited("429"),
        "unavailable": ProviderUnavailable("402"),
        "invalid": LLMOutputError("bad"),
    }

    @app.get("/raise/{kind}")
    async def _raise(kind: str):
        raise errors[kind]

    return TestClient(app)


@pytest.mark.parametrize(
    ("kind", "status", "code"),
    [
        ("rate-limited", 503, "llm_unavailable"),
        ("unavailable", 503, "llm_unavailable"),
        ("invalid", 502, "llm_output_invalid"),
    ],
)
def test_gateway_errors_reach_the_envelope(envelope_client, kind, status, code):
    response = envelope_client.get(f"/raise/{kind}")
    assert response.status_code == status
    body = response.json()
    assert body["error"]["code"] == code
    assert body["error"]["params"] == {}


# --- App lifespan ---


def test_lifespan_puts_a_mock_gateway_on_app_state():
    from app.main import create_app

    app = create_app(settings(app_env="development", llm_mode="mock"))
    with TestClient(app):
        assert isinstance(app.state.llm, Gateway)
        assert app.state.llm.mode == "mock"
