"""Ask AI: the Project's chat and its streamed, sourced answers (Story 4.4: FR-16, AD-7, AD-12, AD-18, AD-25).

Story 4.4 keeps one chat per Project. `open_chat` returns it, creating it on first use; a read, so it
also opens in a read-only Project. A chat whose one-file scope is no longer Ready falls back to all
materials on its next read (and on the next send).

A send runs in three steps, and no connection is held while the answer streams (AD-18):

1. `prepare_send`, transaction 1 on its own pooled connection: the chat (`404`), one stream per chat
   (`409 chat_busy`, nothing reserved), `projects.require_active` (`409 project_read_only`), the scope
   through `topics.resolve_scope` (`422 insufficient_material` with no Ready file), the context, and
   `usage.reserve("ask_ai_message")` (`429 quota_exceeded`). It commits before the stream starts.
2. `stream`: the gateway's deltas, forwarded with the labels already stripped.
3. On a complete answer, transaction 2 inserts the question and the answer together, `seq` assigned
   under the chat row lock. Anything else (a disconnect, a provider error, a mid-stream error chunk, an
   empty answer, a Project deleted meanwhile) closes the provider call, releases the unit against the reserved day, and stores
   nothing (`abandon`, which is idempotent).

The context: when the scope's `est_tokens` fit the budget, every Section of it; otherwise the Sections
ranked by full-text match with the question (`ts_rank`), taking the best that fit. Earlier turns,
newest first, take at most a fifth of the budget, and the Sections get what is left.

Chat messages are insert-only (AD-8). Logs carry counts only, never questions or answers.
"""

import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from datetime import date
from typing import Any
from uuid import UUID

import anyio
from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

from app.db import chats as repo
from app.db import projects as projects_repo
from app.db import sections as section_repo
from app.db import topics as topics_repo
from app.errors import AppError
from app.llm import ChatDelta, ChatTurn, Gateway, LLMError, chat_overhead_tokens, estimate_tokens, fit_tokens
from app.services import projects, topics, usage
from app.services.projects import ProjectReadOnly
from app.services.quiz import LLM_UNAVAILABLE, _Section

logger = logging.getLogger(__name__)

ALL_MATERIALS: dict[str, Any] = {"all_materials": True}
QUESTION_MAX_LENGTH = 2000
# Earlier turns take at most this share of the context budget.
HISTORY_BUDGET_SHARE = 5
# How many earlier messages are looked at before the budget decides.
HISTORY_MAX_MESSAGES = 40
# A save that failed after a complete answer: the SPA shows its generic error.
INTERNAL_ERROR = "internal_error"

# The chats with an answer streaming now (one instance, so in-process is enough; AD-25).
_busy: set[UUID] = set()


class ChatNotFound(AppError):
    def __init__(self) -> None:
        super().__init__(404, "not_found", "No such chat")


class ChatBusy(AppError):
    def __init__(self) -> None:
        super().__init__(409, "chat_busy", "An answer is still streaming in this chat")


def is_busy(chat_id: UUID) -> bool:
    return chat_id in _busy


# --- Scope ---


def _stored_scope(scope: Any) -> dict[str, Any]:
    """`{"material_id": "<uuid>"}` for a one-file scope, else all materials."""
    if isinstance(scope, dict) and scope.get("material_id"):
        return {"material_id": str(scope["material_id"])}
    return dict(ALL_MATERIALS)


def _resolver_scope(scope: dict[str, Any]) -> dict[str, Any]:
    """The chat scope as `topics.resolve_scope` takes it (AD-7)."""
    if scope.get("material_id"):
        return {"material_id": UUID(scope["material_id"])}
    return {"all_topics": True}


async def _current_scope(conn: AsyncConnection, account_id: UUID, chat: dict[str, Any]) -> dict[str, Any]:
    """The chat's scope; a file that is no longer Ready falls back to all materials, saved."""
    scope = _stored_scope(chat["current_scope"])
    if "material_id" not in scope:
        return scope
    ready = await topics_repo.ready_material(conn, account_id, chat["project_id"], UUID(scope["material_id"]))
    if ready is None:
        scope = dict(ALL_MATERIALS)
        await repo.set_scope(conn, chat["id"], scope)
    return scope


async def get_chat(conn: AsyncConnection, account_id: UUID, chat_id: UUID) -> dict[str, Any]:
    chat = await repo.get(conn, account_id, chat_id)
    if chat is None:
        raise ChatNotFound()
    return chat


async def set_scope(conn: AsyncConnection, account_id: UUID, chat_id: UUID, scope: dict[str, Any]) -> dict[str, Any]:
    """Narrow the chat to one Ready file or broaden it to all materials; it stays until changed.
    `{id, current_scope}`."""
    chat = await get_chat(conn, account_id, chat_id)
    await projects.require_active(conn, account_id, chat["project_id"])
    stored = _stored_scope(scope)
    if "material_id" in stored:
        # Only through the resolver (AD-7): a file that isn't Ready here is 404, one with no text 422.
        await topics.resolve_scope(conn, account_id, chat["project_id"], _resolver_scope(stored))
    await repo.set_scope(conn, chat_id, stored)
    return {"id": chat_id, "current_scope": stored}


# --- Reading ---


async def open_chat(conn: AsyncConnection, account_id: UUID, project_id: UUID) -> dict[str, Any]:
    """`{id, current_scope, messages: [{id, role, text, sources: [{label}]}]}`, the chat created on first
    use. A read: no guard, so a read-only Project's thread still shows."""
    await projects.get(conn, account_id, project_id)
    chat = await repo.latest_for_project(conn, account_id, project_id)
    if chat is None:
        # Under the Project row lock, so two first opens create one chat.
        await projects_repo.get_for_update(conn, account_id, project_id)
        chat = await repo.latest_for_project(conn, account_id, project_id)
        if chat is None:
            chat = await repo.insert(conn, account_id, project_id)
    scope = await _current_scope(conn, account_id, chat)
    await repo.touch(conn, chat["id"])
    rows = await repo.messages(conn, chat["id"])
    section_ids = list(dict.fromkeys(s for row in rows for s in row["source_section_ids"]))
    labels = await section_repo.source_labels(conn, account_id, section_ids)
    return {
        "id": chat["id"],
        "current_scope": scope,
        "messages": [
            {
                "id": row["id"],
                "role": row["role"],
                "text": row["text"],
                "sources": [{"label": label} for label in _labels(row["source_section_ids"], labels)],
            }
            for row in rows
        ],
    }


def _labels(section_ids: list[UUID], labels: dict[UUID, str]) -> list[str]:
    return list(dict.fromkeys(labels[s] for s in section_ids if s in labels))


# --- Sending ---


@dataclass
class PendingSend:
    """A reserved send between transaction 1 and its end (saved or abandoned)."""

    account_id: UUID
    chat_id: UUID
    project_id: UUID
    scope: dict[str, Any]
    day: date
    question: str
    sections: list[_Section]
    history: list[ChatTurn]
    settled: bool = False
    closed: bool = field(default=False, repr=False)


async def _history(conn: AsyncConnection, chat_id: UUID, cap_tokens: int) -> tuple[list[ChatTurn], int]:
    """Earlier turns as whole question-and-answer pairs, taken newest first while they fit `cap_tokens`;
    returned oldest first, with the tokens they use."""
    rows = await repo.recent_messages(conn, chat_id, HISTORY_MAX_MESSAGES)
    pairs: list[tuple[ChatTurn, ChatTurn]] = []
    used = 0
    for index in range(0, len(rows) - 1, 2):
        answer, question = rows[index], rows[index + 1]
        if answer["role"] != "assistant" or question["role"] != "user":
            break
        tokens = estimate_tokens([question["text"], answer["text"]])
        if used + tokens > cap_tokens:
            break
        pairs.append((ChatTurn("user", question["text"]), ChatTurn("assistant", answer["text"])))
        used += tokens
    pairs.reverse()
    return [turn for pair in pairs for turn in pair], used


async def pick_context(
    conn: AsyncConnection, resolved: topics.ResolvedScope, question: str, budget_tokens: int
) -> list[_Section]:
    """The scope's Sections, in document order: all of them when they fit `budget_tokens`, otherwise the
    best full-text matches with the question that fit. When not even the best one fits alone, it is sent
    cut to the budget."""
    rows = await section_repo.load_sections(conn, list(resolved.section_ids))
    sections = [_Section(row["id"], row["material_id"], row["label"], row["text"]) for row in rows]
    if resolved.est_tokens <= budget_tokens:
        return sections
    by_id = {section.id: section for section in sections}
    keep: set[UUID] = set()
    used = 0
    ranked = await repo.rank_sections(conn, list(by_id), question)
    for section_id in ranked:
        tokens = estimate_tokens([by_id[section_id].text])
        if used + tokens <= budget_tokens:
            keep.add(section_id)
            used += tokens
    logger.info("Chat context: sections=%d sent=%d", len(sections), len(keep))
    if not keep and ranked and budget_tokens > 0:
        best = by_id[ranked[0]]
        return [_Section(best.id, best.material_id, best.label, fit_tokens(best.text, budget_tokens))]
    return [section for section in sections if section.id in keep]


async def prepare_send(
    pool: AsyncConnectionPool, account_id: UUID, chat_id: UUID, question: str, budget_tokens: int
) -> PendingSend:
    """Transaction 1 (see the module docstring), committed and its connection returned before this
    returns. On success the chat is busy until `abandon`."""
    claimed = False
    try:
        async with pool.connection() as conn:
            async with conn.transaction():
                chat = await get_chat(conn, account_id, chat_id)
                if chat_id in _busy:
                    raise ChatBusy()
                _busy.add(chat_id)
                claimed = True
                project_id = chat["project_id"]
                await projects.require_active(conn, account_id, project_id)
                scope = await _current_scope(conn, account_id, chat)
                resolved = await topics.resolve_scope(conn, account_id, project_id, _resolver_scope(scope))
                history, history_tokens = await _history(conn, chat_id, budget_tokens // HISTORY_BUDGET_SHARE)
                # The Sections get what the prompt, the question, and the earlier turns leave.
                room = budget_tokens - chat_overhead_tokens(question) - history_tokens
                sections = await pick_context(conn, resolved, question, room)
                day = await usage.reserve(conn, account_id, usage.ASK_AI_MESSAGE)
    except BaseException:
        if claimed:
            _busy.discard(chat_id)
        raise
    return PendingSend(account_id, chat_id, project_id, scope, day, question, sections, history)


async def abandon(pool: AsyncConnectionPool, pending: PendingSend) -> None:
    """End a send: the chat is free again, and an unsaved answer's unit is released against the day it
    was reserved on. Safe to call more than once; runs to the end even when the caller is cancelled."""
    if pending.closed:
        return
    pending.closed = True
    _busy.discard(pending.chat_id)
    if pending.settled:
        return
    with anyio.CancelScope(shield=True):
        try:
            async with pool.connection() as conn:
                async with conn.transaction():
                    await usage.release(conn, pending.account_id, usage.ASK_AI_MESSAGE, pending.day)
        except Exception as exc:  # noqa: BLE001 -- nothing else to undo; the unit stays used
            logger.warning("Chat release failed: %s", type(exc).__name__)


async def _save(pool: AsyncConnectionPool, pending: PendingSend, text: str, cited: tuple) -> tuple[str, dict[str, Any]]:
    """Transaction 2: the question and its answer, under the Project and chat row locks. Returns the
    event to send: `done`, or `error` when the Project was deleted meanwhile (`project_read_only`; an
    archived one still saves, as jobs do, AD-20) or the chat is gone (`not_found`), saving nothing.
    `settled` is set only once the commit is done."""
    by_id = {section.id: section for section in pending.sections}
    section_ids = [s for s in cited if s in by_id]
    material_ids = list(dict.fromkeys(by_id[s].material_id for s in section_ids))
    async with pool.connection() as conn:
        async with conn.transaction():
            project = await projects_repo.get_for_update(conn, pending.account_id, pending.project_id)
            if project is None or project["deleted_at"] is not None:
                return "error", {"code": ProjectReadOnly().code}
            if await repo.get_for_update(conn, pending.account_id, pending.chat_id) is None:
                return "error", {"code": "not_found"}
            message_id = await repo.insert_turn(
                conn, pending.chat_id, pending.scope, pending.question, text, section_ids, material_ids
            )
            labels = await section_repo.source_labels(conn, pending.account_id, section_ids)
    pending.settled = True
    return "done", {
        "message_id": str(message_id),
        "sources": [{"label": label} for label in _labels(section_ids, labels)],
    }


async def stream(
    pool: AsyncConnectionPool,
    llm: Gateway,
    pending: PendingSend,
    is_disconnected: Callable[[], Awaitable[bool]],
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    """`("delta", {text})`… then `("done", {message_id, sources})` or `("error", {code})`. No connection is
    held while the answer streams; the save and the release each take their own."""
    try:
        parts: list[str] = []
        cited: tuple = ()
        answer = llm.answer_chat_stream(pending.sections, pending.history, pending.question)
        try:
            async for item in answer:
                if await is_disconnected():
                    logger.info("Chat: abandoned mid-stream")
                    return
                if isinstance(item, ChatDelta):
                    parts.append(item.text)
                    yield "delta", {"text": item.text}
                else:
                    cited = item.section_ids
        finally:
            # Closes the provider stream when the answer was left part-way, also when cancelled.
            with anyio.CancelScope(shield=True):
                await answer.aclose()
        # Left after the last words but before the save: the student never gets `done`, so nothing is kept.
        if await is_disconnected():
            logger.info("Chat: abandoned before the save")
            return
        text = "".join(parts).strip()
        if not text:
            yield "error", {"code": LLM_UNAVAILABLE}
            return
        try:
            # Shielded: a disconnect during the commit can't leave the answer saved and its unit released.
            with anyio.CancelScope(shield=True):
                event, data = await _save(pool, pending, text, cited)
        except Exception as exc:  # noqa: BLE001 -- reported as an error event; the unit is released
            logger.warning("Chat save failed: %s", type(exc).__name__)
            yield "error", {"code": INTERNAL_ERROR}
            return
        if event == "done":
            logger.info("Chat: answered sources=%d", len(data["sources"]))
        yield event, data
    except LLMError as exc:
        logger.info("Chat: gateway error %s", type(exc).__name__)
        yield "error", {"code": LLM_UNAVAILABLE}
    except Exception as exc:  # noqa: BLE001 -- the stream still ends with an error event; the unit is released
        logger.warning("Chat: stream failed %s", type(exc).__name__)
        yield "error", {"code": INTERNAL_ERROR}
    finally:
        await abandon(pool, pending)
