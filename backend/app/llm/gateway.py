"""The LLM gateway (AD-3, AD-4): one typed function per task, live through OpenRouter or deterministic mock.

Live requests always ask the provider not to collect or retain data (`data_collection: "deny"`, `zdr`)
and to honour every parameter (`require_parameters`), and ask for a JSON-schema reply. The reply is
validated against the task's Pydantic schema with one retry, then `LLMOutputError`. Provider failures
become `ProviderRateLimited` / `ProviderUnavailable`.

Logs carry task, model, duration, and outcome only; never keys, prompts, or material text.
"""

import asyncio
import base64
import json
import logging
import time
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any, Protocol

import httpx2
import openai
from pydantic import BaseModel, ValidationError

from app.config import ConfigError, LlmMode, Settings
from app.extraction.text import count_words
from app.llm import fixtures
from app.llm.citations import LabelStripper
from app.llm.errors import LLMError, LLMOutputError, ProviderRateLimited, ProviderStreamError, ProviderUnavailable
from app.llm.schemas import (
    FLASHCARDS_MAX,
    PRACTICE_MAX,
    QUIZ_MAX,
    SUMMARY_SECTIONS_MAX,
    DetectedTopics,
    FlashcardDraft,
    ImageText,
    PracticeDraft,
    ProjectName,
    QuizDraft,
    SummaryDraft,
)

logger = logging.getLogger(__name__)

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
PROVIDER_PREFERENCES = {"require_parameters": True, "data_collection": "deny", "zdr": True}
# One retry after a schema-invalid reply (AD-3).
SCHEMA_ATTEMPTS = 2
# A name comes from the start of the file; more text only costs tokens.
NAME_PROJECT_MAX_CHARS = 12_000
# Estimated tokens per character of material, for the context budget (AD-3).
CHARS_PER_TOKEN = 4
MOCK_MODEL = "mock"
# A focus label in a request is cut to this many characters.
FOCUS_LABEL_MAX = 100
PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"
# A chat answer: at most this many tokens, and the whole stream within this many seconds (AD-25).
CHAT_MAX_TOKENS = 1500
CHAT_STREAM_DEADLINE_SECONDS = 60.0


class SectionLike(Protocol):
    """What tasks read from a Section: extraction's `ExtractedSection` and stored Sections both fit."""

    @property
    def text(self) -> str: ...


class LabelledSection(SectionLike, Protocol):
    """A Section with its source label, e.g. "Page 4"."""

    @property
    def label(self) -> str: ...


class IdentifiedSection(LabelledSection, Protocol):
    """A stored Section with its id, so targets sharing a Section send it once."""

    @property
    def id(self) -> Any: ...


@dataclass(frozen=True)
class PracticeTarget:
    """A Mistake to write a practice question for (AD-11): the original question, its correct answer's
    text, the Sections it cited, and the student's wrong answer, so the practice can target it."""

    mistake_id: Any
    question_text: str
    correct_text: str
    sections: Sequence[IdentifiedSection]
    wrong_text: str = ""


@dataclass(frozen=True)
class ChatTurn:
    """An earlier message of the chat, sent as context: `role` is "user" or "assistant"."""

    role: str
    text: str


@dataclass(frozen=True)
class ChatDelta:
    """Answer text to forward now, with the inline labels already removed."""

    text: str


@dataclass(frozen=True)
class ChatSources:
    """The end of a streamed answer: the cited Sections' ids, validated and in first-cited order."""

    section_ids: tuple[Any, ...]


def practice_sections(targets: Sequence[PracticeTarget]) -> list[IdentifiedSection]:
    """Every target's Sections once, in first-seen order: what `S1…Sn` number in `generate_practice`.
    The caller maps an item's numbers back with this same list."""
    seen: dict[Any, IdentifiedSection] = {}
    for target in targets:
        for section in target.sections:
            seen.setdefault(section.id, section)
    return list(seen.values())


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


def focus_block(topic_labels: Sequence[str]) -> str:
    """The "Focus topics:" block of a generation request: each label JSON-quoted on its own line and cut
    to 100 characters; empty when there are none."""
    if not topic_labels:
        return ""
    lines = [f"- {json.dumps(label[:FOCUS_LABEL_MAX], ensure_ascii=False)}" for label in topic_labels]
    return "Focus topics:\n" + "\n".join(lines)


def estimate_tokens(texts: Sequence[str]) -> int:
    return sum(len(text) for text in texts) // CHARS_PER_TOKEN


def fit_tokens(text: str, budget_tokens: int) -> str:
    """`text` cut to about `budget_tokens` (the same estimate as `estimate_tokens`)."""
    return text[: max(0, budget_tokens) * CHARS_PER_TOKEN]


def chat_overhead_tokens(question: str) -> int:
    """What a chat request spends besides its Sections and earlier turns: the system prompt and the
    question (AD-25)."""
    return estimate_tokens([load_prompt("answer_chat"), question])


def items_for(section_count: int, words: int, words_per_item: int, cap: int = QUIZ_MAX) -> int:
    """How many items (Quiz questions) a scope supports (AD-7): `max(sections, words // words_per_item)`,
    capped at `cap`. Deterministic, with no model call; the capacity endpoint and the mock fixtures both
    use it, so they agree."""
    return min(cap, max(section_count, words // words_per_item))


def estimate_items(texts: Sequence[str], words_per_item: int, cap: int = QUIZ_MAX) -> int:
    return items_for(len(texts), sum(count_words(text) for text in texts), words_per_item, cap)


def plan_chunks(texts: Sequence[str], budget_tokens: int) -> list[tuple[int, int]]:
    """Contiguous `(start, end)` runs of Sections whose estimated tokens stay within the budget; one
    run when everything fits. A single Section over the budget is a run of its own."""
    if estimate_tokens(texts) <= budget_tokens:
        return [(0, len(texts))]
    room = budget_tokens * CHARS_PER_TOKEN
    chunks: list[tuple[int, int]] = []
    start, used = 0, 0
    for index, text in enumerate(texts):
        if index > start and used + len(text) > room:
            chunks.append((start, index))
            start, used = index, 0
        used += len(text)
    chunks.append((start, len(texts)))
    return chunks


def chunk_target(target: int, size: int, total: int) -> int:
    """A chunk's share of the target, in proportion to its Sections, at least 1."""
    return max(1, round(target * size / total))


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
            if not settings.llm_vision_model:
                raise ConfigError("LLM_VISION_MODEL is required when LLM_MODE=live")
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

    async def detect_topics(self, sections: Sequence[LabelledSection], target: int) -> DetectedTopics:
        """About `target` Topics covering the Sections, with 1-based Section numbers (FR-22, AD-21).

        Live, the Sections are sent as `S1…Sn`. Above `LLM_CONTEXT_BUDGET_TOKENS` they go in contiguous
        chunks, each asked for its proportional share of the target; each chunk's numbers are shifted
        by its offset and the Topics concatenated in order. The merged result may then hold more than
        100 Topics or skip Sections: the caller repairs it. Mock mode derives the Topics from the
        Section count in one step (`fixtures.detect_topics`).
        """
        texts = [s.text for s in sections]
        labels = [s.label for s in sections]
        if self.mode == "mock":
            return await self._detect_chunk(texts, labels, target, target)
        chunks = plan_chunks(texts, self._settings.llm_context_budget_tokens)
        if len(chunks) == 1:
            return await self._detect_chunk(texts, labels, target, target)
        merged = []
        for start, end in chunks:
            part = await self._detect_chunk(
                texts[start:end], labels[start:end], chunk_target(target, end - start, len(texts)), target
            )
            # Only numbers inside this chunk are shifted; others would land on the next chunk's Sections.
            # A Topic left with none is dropped by the caller's repair.
            merged.extend(
                topic.model_copy(
                    update={"sections": [number + start for number in topic.sections if 1 <= number <= end - start]}
                )
                for topic in part.topics
            )
        # Already validated per chunk; together they may exceed the 100 the schema allows.
        return DetectedTopics.model_construct(topics=merged)

    async def _detect_chunk(self, texts: list[str], labels: list[str], target: int, total: int) -> DetectedTopics:
        """`target` Topics for these Sections; `total` is the whole file's target (it decides grouping)."""
        return await self._run(
            task="detect_topics",
            schema=DetectedTopics,
            model=self._settings.llm_text_model,
            messages=lambda: [
                {"role": "system", "content": load_prompt("detect_topics")
                    .replace("{target}", str(target))
                    .replace("{total}", str(total))},
                {"role": "user", "content": label_sections(texts)},
            ],
            fixture=lambda: fixtures.detect_topics(labels, target),
        )

    async def extract_image_text(self, jpeg: bytes, file_name: str) -> ImageText:
        """The text in a photo of notes as Markdown, with its legibility (FR-7, AD-6).

        Live, the JPEG goes to `LLM_VISION_MODEL` as a base64 `data:image/jpeg` content part. Mock mode
        looks only at `file_name` (`fixtures.extract_image_text`); the bytes are never logged.
        """
        return await self._run(
            task="extract_image_text",
            schema=ImageText,
            model=self._settings.llm_vision_model,
            messages=lambda: [
                {"role": "system", "content": load_prompt("extract_image_text")},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode("ascii")},
                        }
                    ],
                },
            ],
            fixture=lambda: fixtures.extract_image_text(file_name),
        )

    async def generate_quiz(
        self, sections: Sequence[LabelledSection], count: int, topic_labels: Sequence[str] = ()
    ) -> QuizDraft:
        """Up to `count` (at most 20) multiple-choice questions from the Sections, each citing the 1-based
        Section numbers it rests on (FR-10, AD-9). `topic_labels` asks the model to focus on those Topics.
        The caller has already checked the scope against the context budget (AD-7), so this is one call.
        Mock mode returns `min(count, capacity)` questions (`fixtures.generate_quiz`)."""
        texts = [s.text for s in sections]
        labels = [s.label for s in sections]
        count = max(0, min(count, QUIZ_MAX))
        mock_count = min(count, estimate_items(texts, self._settings.capacity_words_per_item))
        # Student-written labels are data: quoted in the user message, never in the system prompt.
        focus = focus_block(topic_labels)
        material = label_sections(texts)
        user = f"{focus}\n\n{material}" if focus else material
        return await self._run(
            task="generate_quiz",
            schema=QuizDraft,
            model=self._settings.llm_text_model,
            messages=lambda: [
                {"role": "system", "content": load_prompt("generate_quiz").replace("{count}", str(count))},
                {"role": "user", "content": user},
            ],
            fixture=lambda: fixtures.generate_quiz(labels, texts, mock_count),
        )

    async def generate_flashcards(
        self, sections: Sequence[LabelledSection], count: int, topic_labels: Sequence[str] = ()
    ) -> FlashcardDraft:
        """Up to `count` (at most 20) flashcards from the Sections, each a question and answer citing the
        1-based Section numbers it rests on (FR-13). `topic_labels` asks the model to focus on those
        Topics. The caller has already checked the scope against the context budget (AD-7), so this is
        one call. Mock mode returns `min(count, capacity)` cards (`fixtures.generate_flashcards`)."""
        texts = [s.text for s in sections]
        labels = [s.label for s in sections]
        count = max(0, min(count, FLASHCARDS_MAX))
        mock_count = min(count, estimate_items(texts, self._settings.capacity_words_per_item, FLASHCARDS_MAX))
        # Student-written labels are data: quoted in the user message, never in the system prompt.
        focus = focus_block(topic_labels)
        material = label_sections(texts)
        user = f"{focus}\n\n{material}" if focus else material
        return await self._run(
            task="generate_flashcards",
            schema=FlashcardDraft,
            model=self._settings.llm_text_model,
            messages=lambda: [
                {"role": "system", "content": load_prompt("generate_flashcards").replace("{count}", str(count))},
                {"role": "user", "content": user},
            ],
            fixture=lambda: fixtures.generate_flashcards(labels, texts, mock_count),
        )

    async def summarize(self, sections: Sequence[LabelledSection], topic_labels: Sequence[str] = ()) -> SummaryDraft:
        """A title and up to 8 sections summarizing the Sections, each citing the 1-based Section numbers it
        rests on (FR-15). `topic_labels` (at most one: the chosen Topic) asks the model to focus on it. The
        summary is written in the material's main language, whatever the UI language. The caller has
        already checked the scope against the context budget (AD-7), so this is one call. Mock mode
        returns `fixtures.summarize`."""
        texts = [s.text for s in sections]
        labels = [s.label for s in sections]
        # Student-written labels are data: quoted in the user message, never in the system prompt.
        focus = focus_block(topic_labels)
        material = label_sections(texts)
        user = f"{focus}\n\n{material}" if focus else material
        return await self._run(
            task="summarize",
            schema=SummaryDraft,
            model=self._settings.llm_text_model,
            messages=lambda: [
                {"role": "system", "content": load_prompt("summarize").replace("{max}", str(SUMMARY_SECTIONS_MAX))},
                {"role": "user", "content": user},
            ],
            fixture=lambda: fixtures.summarize(labels, texts, list(topic_labels)),
        )

    async def generate_practice(self, targets: Sequence[PracticeTarget]) -> PracticeDraft:
        """One practice question per target (at most 20), in one batched call (FR-18, AD-11). The targets'
        Sections are sent once each as `S1…Sn` (`practice_sections` gives the order), and each target
        lists its own numbers; items cite those numbers and copy the target's `mistake_id`. Mock mode
        writes one item per target from its question text (`fixtures.generate_practice`)."""
        targets = list(targets)[:PRACTICE_MAX]
        sections = practice_sections(targets)
        number = {section.id: n for n, section in enumerate(sections, start=1)}
        texts = [s.text for s in sections]
        labels = [s.label for s in sections]
        described = [
            {
                "mistake_id": str(target.mistake_id),
                "question": target.question_text,
                "correct_answer": target.correct_text,
                "student_answer": target.wrong_text,
                "sections": [number[section.id] for section in target.sections],
            }
            for target in targets
        ]
        # Targets come from earlier model output and student answers: data in the user message only.
        lines = "\n".join(json.dumps(target, ensure_ascii=False) for target in described)
        user = f"Targets:\n{lines}\n\n{label_sections(texts)}"
        return await self._run(
            task="generate_practice",
            schema=PracticeDraft,
            model=self._settings.llm_text_model,
            messages=lambda: [
                {"role": "system", "content": load_prompt("generate_practice")},
                {"role": "user", "content": user},
            ],
            fixture=lambda: fixtures.generate_practice(described, labels, texts),
        )

    async def answer_chat_stream(
        self, sections: Sequence[IdentifiedSection], history: Sequence[ChatTurn], question: str
    ) -> AsyncIterator[ChatDelta | ChatSources]:
        """A grounded answer to `question`, streamed (FR-16, AD-25): `ChatDelta`s, then one `ChatSources`.

        The Sections are sent as `S1…Sn`, `history` (oldest first) as the earlier turns. The model cites
        inline `[S3]` labels; they are stripped from the deltas (a label split across chunks is held
        back) and mapped back to Section ids, unknown labels dropped. An answer the material doesn't
        cover cites nothing. The caller has already fitted the context to the budget.

        Live, closing this generator (the student left) closes the provider stream. A provider failure,
        before or mid-stream (an error chunk with HTTP 200), raises a `ProviderError`. Mock mode streams
        `fixtures.answer_chat` in chunks, honouring `LLM_MOCK_DELAY_MS`.
        """
        sections = list(sections)
        texts = [s.text for s in sections]
        started = time.perf_counter()
        used_model = MOCK_MODEL if self.mode == "mock" else self._settings.llm_text_model
        outcome = "abandoned"
        stripper = LabelStripper()
        try:
            if self.mode == "mock":
                raw = self._mock_chat_stream(texts, question)
            else:
                messages = [
                    {"role": "system", "content": load_prompt("answer_chat")},
                    *({"role": turn.role, "content": turn.text} for turn in history),
                    # The question is student text: data in the user message, after the material.
                    {"role": "user", "content": f"{label_sections(texts)}\n\nQuestion: {question}"},
                ]
                raw = self._live_stream(self._settings.llm_text_model, messages)
            try:
                async for chunk in raw:
                    text = stripper.feed(chunk)
                    if text:
                        yield ChatDelta(text)
            finally:
                await raw.aclose()
            rest = stripper.flush()
            if rest:
                yield ChatDelta(rest)
            cited = [sections[n - 1].id for n in stripper.numbers if 1 <= n <= len(sections)]
            outcome = "ok"
            yield ChatSources(tuple(dict.fromkeys(cited)))
        except LLMError as exc:
            outcome = f"{type(exc).__name__} ({exc})"
            raise
        finally:
            logger.info(
                "LLM task=answer_chat model=%s duration_ms=%d outcome=%s",
                used_model,
                (time.perf_counter() - started) * 1000,
                outcome,
            )

    async def _mock_chat_stream(self, texts: list[str], question: str) -> AsyncIterator[str]:
        chunks = fixtures.chat_chunks(fixtures.answer_chat(texts, question))
        delay = self._settings.llm_mock_delay_ms / 1000
        if delay > 0:
            await asyncio.sleep(delay)
        for index, chunk in enumerate(chunks):
            if index and delay > 0:
                await asyncio.sleep(delay / len(chunks))
            yield chunk

    async def _live_stream(self, model: str | None, messages: list[dict[str, Any]]) -> AsyncIterator[str]:
        """Raw text deltas from a streamed completion; the stream is closed however this generator ends."""
        try:
            stream = await self._client.chat.completions.create(
                model=model,
                messages=messages,
                stream=True,
                max_tokens=CHAT_MAX_TOKENS,
                extra_body={"provider": dict(PROVIDER_PREFERENCES)},
            )
        except openai.APIError as exc:
            raise _provider_error(exc) from None
        deadline = time.monotonic() + CHAT_STREAM_DEADLINE_SECONDS
        chunks = stream.__aiter__()
        try:
            while True:
                # The whole answer within the deadline, also when the provider goes quiet.
                left = deadline - time.monotonic()
                if left <= 0:
                    raise ProviderStreamError("The answer took too long")
                try:
                    chunk = await asyncio.wait_for(anext(chunks), left)
                except StopAsyncIteration:
                    break
                except TimeoutError:
                    raise ProviderStreamError("The answer took too long") from None
                # OpenRouter reports a failure after the 200 as a chunk with `error` (AD-25).
                extra = getattr(chunk, "model_extra", None) or {}
                if getattr(chunk, "error", None) or extra.get("error"):
                    raise ProviderStreamError("Error chunk mid-stream")
                choices = getattr(chunk, "choices", None) or []
                if not choices:
                    continue
                if getattr(choices[0], "finish_reason", None) == "error":
                    raise ProviderStreamError("Stream finished with an error")
                delta = getattr(choices[0], "delta", None)
                content = getattr(delta, "content", None)
                if content:
                    yield content
        except (openai.APIError, httpx2.HTTPError):
            raise ProviderStreamError("The stream broke") from None
        finally:
            close = getattr(stream, "close", None)
            if close is not None:
                await close()

    async def mock_pause(self) -> None:
        """In mock mode, wait `LLM_MOCK_DELAY_MS`, so a job's other progress steps (reading, checking)
        can be seen and cancelled like its model call (AD-4). Does nothing live."""
        if self.mode == "mock" and self._settings.llm_mock_delay_ms > 0:
            await asyncio.sleep(self._settings.llm_mock_delay_ms / 1000)

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
        except openai.APIError as exc:
            raise _provider_error(exc) from None
        # A 200 reply can carry an error body with no message; that is invalid output, retried once.
        choices = getattr(response, "choices", None) or []
        if not choices:
            return None
        message = getattr(choices[0], "message", None)
        return getattr(message, "content", None)


def _provider_error(exc: openai.APIError) -> ProviderRateLimited | ProviderUnavailable:
    """The gateway error for an SDK error raised when a request is made."""
    if isinstance(exc, openai.RateLimitError):
        return ProviderRateLimited("Provider rate limit (429)")
    if isinstance(exc, openai.APIStatusError):
        return ProviderUnavailable(f"Provider answered {exc.status_code}")
    if isinstance(exc, openai.APITimeoutError):
        return ProviderUnavailable("Provider timed out")
    if isinstance(exc, openai.APIConnectionError):
        return ProviderUnavailable("Provider unreachable")
    return ProviderUnavailable("Provider error")


def create_gateway(settings: Settings, mode: LlmMode) -> Gateway:
    return Gateway(settings, mode)
