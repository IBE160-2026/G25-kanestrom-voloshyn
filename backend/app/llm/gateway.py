"""The LLM gateway (AD-3, AD-4): one typed function per task, live through OpenRouter or deterministic mock.

Live requests always ask the provider not to collect or retain data (`data_collection: "deny"`, `zdr`)
and to honour every parameter (`require_parameters`), and ask for a JSON-schema reply. The reply is
validated against the task's Pydantic schema with one retry, then `LLMOutputError`. Provider failures
become `ProviderRateLimited` / `ProviderUnavailable`.

Logs carry task, model, duration, and outcome only; never keys, prompts, or material text.
"""

import asyncio
import logging
import time
from collections.abc import Sequence
from functools import cache
from pathlib import Path
from typing import Any, Protocol

import openai
from pydantic import BaseModel, ValidationError

from app.config import ConfigError, LlmMode, Settings
from app.llm import fixtures
from app.llm.errors import LLMError, LLMOutputError, ProviderRateLimited, ProviderUnavailable
from app.llm.schemas import ProjectName

logger = logging.getLogger(__name__)

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
PROVIDER_PREFERENCES = {"require_parameters": True, "data_collection": "deny", "zdr": True}
# One retry after a schema-invalid reply (AD-3).
SCHEMA_ATTEMPTS = 2
# A name comes from the start of the file; more text only costs tokens.
NAME_PROJECT_MAX_CHARS = 12_000
MOCK_MODEL = "mock"
PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"


class SectionLike(Protocol):
    """What tasks read from a Section: extraction's `ExtractedSection` and stored Sections both fit."""

    @property
    def text(self) -> str: ...


@cache
def load_prompt(name: str) -> str:
    return (PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")


def label_sections(texts: Sequence[str], max_chars: int | None = None) -> str:
    """The user message: Sections labelled `S1…Sn` locally (AD-3), cut at `max_chars` in total."""
    parts: list[str] = []
    used = 0
    for number, text in enumerate(texts, start=1):
        if max_chars is not None:
            room = max_chars - used
            if room <= 0:
                break
            text = text[:room]
            used += len(text)
        parts.append(f"[S{number}]\n{text}")
    return "\n\n".join(parts)


def _response_format(schema: type[BaseModel]) -> dict[str, Any]:
    return {
        "type": "json_schema",
        "json_schema": {"name": schema.__name__, "strict": True, "schema": schema.model_json_schema()},
    }


class Gateway:
    """Created once in the app lifespan and kept on `app.state.llm`."""

    def __init__(self, settings: Settings, mode: LlmMode, client: Any | None = None):
        self.mode = mode
        self._settings = settings
        self._client = client
        if mode == "live":
            if not settings.llm_text_model:
                raise ConfigError("LLM_TEXT_MODEL is required when LLM_MODE=live")
            if self._client is None:
                key = settings.openrouter_api_key
                self._client = openai.AsyncOpenAI(
                    api_key=key.get_secret_value() if key else "",
                    base_url=OPENROUTER_BASE_URL,
                    timeout=settings.llm_timeout_seconds,
                    # No hidden SDK retries: a 429 surfaces at once, and one call takes at most one timeout.
                    max_retries=0,
                )

    async def aclose(self) -> None:
        close = getattr(self._client, "close", None)
        if close is not None:
            await close()

    # --- Tasks ---

    async def name_project(self, sections: Sequence[SectionLike]) -> ProjectName:
        """A short Project name in the material's main language, from the supplied text only (FR-4)."""
        texts = [s.text for s in sections]
        return await self._run(
            task="name_project",
            schema=ProjectName,
            model=self._settings.llm_text_model,
            messages=lambda: [
                {"role": "system", "content": load_prompt("name_project")},
                {"role": "user", "content": label_sections(texts, NAME_PROJECT_MAX_CHARS)},
            ],
            fixture=lambda: fixtures.name_project(texts),
        )

    # --- Shared paths ---

    async def _run(self, *, task, schema, model, messages, fixture):
        started = time.perf_counter()
        used_model = MOCK_MODEL if self.mode == "mock" else model
        outcome = "error"
        try:
            if self.mode == "mock":
                result = await self._mock(schema, fixture)
            else:
                result = await self._live(schema, model, messages())
            outcome = "ok"
            return result
        except LLMError as exc:
            outcome = f"{type(exc).__name__} ({exc})"
            raise
        finally:
            logger.info(
                "LLM task=%s model=%s duration_ms=%d outcome=%s",
                task,
                used_model,
                (time.perf_counter() - started) * 1000,
                outcome,
            )

    async def _mock(self, schema, fixture):
        delay_ms = self._settings.llm_mock_delay_ms
        if delay_ms > 0:
            await asyncio.sleep(delay_ms / 1000)
        try:
            return schema.model_validate(fixture())
        except ValidationError:
            raise LLMOutputError(f"Mock output doesn't match {schema.__name__}") from None

    async def _live(self, schema, model, messages):
        for _ in range(SCHEMA_ATTEMPTS):
            content = await self._complete(schema, model, messages)
            try:
                return schema.model_validate_json(content or "")
            except ValidationError:
                continue
        raise LLMOutputError(f"Reply doesn't match {schema.__name__} after {SCHEMA_ATTEMPTS} attempts")

    async def _complete(self, schema, model, messages) -> str | None:
        try:
            response = await self._client.chat.completions.create(
                model=model,
                messages=messages,
                response_format=_response_format(schema),
                extra_body={"provider": dict(PROVIDER_PREFERENCES)},
            )
        except openai.RateLimitError:
            raise ProviderRateLimited("Provider rate limit (429)") from None
        except openai.APIStatusError as exc:
            raise ProviderUnavailable(f"Provider answered {exc.status_code}") from None
        except openai.APITimeoutError:
            raise ProviderUnavailable("Provider timed out") from None
        except openai.APIConnectionError:
            raise ProviderUnavailable("Provider unreachable") from None
        except openai.APIError:
            raise ProviderUnavailable("Provider error") from None
        # A 200 reply can carry an error body with no message; that is invalid output, retried once.
        choices = getattr(response, "choices", None) or []
        if not choices:
            return None
        message = getattr(choices[0], "message", None)
        return getattr(message, "content", None)


def create_gateway(settings: Settings, mode: LlmMode) -> Gateway:
    return Gateway(settings, mode)
