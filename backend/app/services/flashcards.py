"""Flashcard generation (Story 4.1: FR-13, AD-7, AD-18, AD-20).

The request (`request`) mirrors the Quiz: the read-only guard, then the scope resolved once
(`topics.resolve_scope`) and checked against the context budget, then a `flashcards` job whose params
freeze `{count, section_ids, topic_labels}`, the count being the one asked for (5, 10, or 20) cut to the
scope's capacity. The job uses only those params:

1. reading: load the Sections; when a Material of the scope was removed or a cancel was requested
   meanwhile, stop before the model call, and the save step ends the job `cancelled`;
2. writing: `llm.generate_flashcards` with no connection held (AD-18);
3. checking: map `S1…Sn` back to Section ids, drop uncited cards and those with a blank question or
   answer, keep at most `count`;
4. the runner's save transaction inserts the set and its cards, unless the job was cancelled, the
   Project deleted, or a Material of the scope removed. Archived Projects still save (AD-20).

A provider error fails the job with `llm_unavailable`, invalid output with `llm_output_invalid`, and no
usable card with `insufficient_material`.

Studying a set (Story 4.2: FR-14, AD-8, AD-22, AD-27): the server owns the session. `get` serves the
cards with their Source labels plus the session derived from the stored marks (`session`); `mark` saves
one "Got it" or "Not yet" as an insert-only row, with no model call. A set ends (`ended_at`) when the
final card is "Got it", when it is read or marked after 30 minutes with no new mark, or when the
student opens another set; a set with no marks is never ended, and an ended set takes no more marks
(`409 flashcard_set_ended`). Flashcards never create Mistakes: this module never calls
`services/mistakes` (AD-10). Logs carry counts only, never material text.
"""

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import timedelta
from typing import Any
from uuid import UUID, uuid4

from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

from app.db import flashcards as repo
from app.db import sections as section_repo
from app.errors import AppError
from app.llm import FlashcardDraft, Gateway, LLMOutputError, ProviderError
from app.llm.schemas import FLASHCARDS_MAX
from app.services import jobs, projects, topics
from app.services.quiz import COUNTS, INSUFFICIENT_MATERIAL, LLM_OUTPUT_INVALID, LLM_UNAVAILABLE, _Section

logger = logging.getLogger(__name__)

KIND = "flashcards"

GOT_IT = "got_it"
NOT_YET = "not_yet"
MARKS = (GOT_IT, NOT_YET)
# A set with no new mark for this long is ended on its next read or mark.
IDLE = timedelta(minutes=30)


class FlashcardSetNotFound(AppError):
    def __init__(self) -> None:
        super().__init__(404, "not_found", "No such flashcard set")


class FlashcardSetEnded(AppError):
    """A mark on a set that has ended: the client reloads and shows the end screen."""

    def __init__(self) -> None:
        super().__init__(409, "flashcard_set_ended", "The flashcard set has ended")


# --- In the request ---


async def request(
    conn: AsyncConnection,
    account_id: UUID,
    project_id: UUID,
    scope: dict[str, Any],
    count: int,
    budget_tokens: int,
    words_per_item: int,
) -> dict[str, Any]:
    """Queue a `flashcards` job (FR-13). Returns the job; the caller submits it after the commit."""
    await projects.require_active(conn, account_id, project_id)
    if count not in COUNTS:
        raise AppError(422, "invalid_request", "count must be 5, 10, or 20", {"fields": ["count"]})
    resolved = await topics.resolve_scope(conn, account_id, project_id, scope)
    resolved.require_within(budget_tokens)
    params = {
        "count": min(count, resolved.max_items(words_per_item)),
        "section_ids": [str(section_id) for section_id in resolved.section_ids],
        "topic_labels": list(resolved.topic_labels),
    }
    return await jobs.enqueue(conn, account_id, project_id, KIND, params=params)


# --- Studying a set (Story 4.2) ---


@dataclass(frozen=True)
class Session:
    """What the stored marks say: the card ids still to show, in order; the cards marked "Got it"; and
    the cards marked "Not yet" at least once."""

    queue: list[UUID]
    done: set[UUID]
    second_try: set[UUID]


def session(cards: Sequence[dict[str, Any]], marks: Sequence[dict[str, Any]]) -> Session:
    """Derive the session from the cards (by `position`) and the marks (in saved order). The queue is
    the unmarked cards by position, then the "Not yet" cards not yet "Got it", by their latest "Not yet"
    mark, oldest first. Pure."""
    done: set[UUID] = set()
    second_try: set[UUID] = set()
    latest_not_yet: dict[UUID, int] = {}
    for order, row in enumerate(marks):
        if row["mark"] == GOT_IT:
            done.add(row["card_id"])
        else:
            second_try.add(row["card_id"])
            latest_not_yet[row["card_id"]] = order
    ordered = sorted(cards, key=lambda card: card["position"])
    unmarked = [card["id"] for card in ordered if card["id"] not in done and card["id"] not in latest_not_yet]
    again = sorted((card_id for card_id in latest_not_yet if card_id not in done), key=latest_not_yet.__getitem__)
    return Session(queue=unmarked + again, done=done, second_try=second_try)


async def _read(conn: AsyncConnection, account_id: UUID, project_id: UUID, set_id: UUID) -> dict[str, Any]:
    """The set with its cards (each with its Source labels, "file · label") and its session."""
    found = await repo.get(conn, account_id, project_id, set_id)
    if found is None:
        raise FlashcardSetNotFound()
    rows = await repo.cards(conn, account_id, set_id)
    state = session(rows, await repo.marks(conn, account_id, set_id))
    section_ids = list(dict.fromkeys(section_id for row in rows for section_id in row["source_section_ids"]))
    labels = await section_repo.source_labels(conn, account_id, section_ids)
    return {
        **found,
        "cards": [
            {
                "id": row["id"],
                "position": row["position"],
                "question": row["question"],
                "answer": row["answer"],
                "sources": [
                    {"label": label}
                    for label in dict.fromkeys(labels[s] for s in row["source_section_ids"] if s in labels)
                ],
            }
            for row in rows
        ],
        "queue": state.queue,
        "done_count": len(state.done),
        "second_try_count": len(state.second_try),
    }


async def get(conn: AsyncConnection, account_id: UUID, project_id: UUID, set_id: UUID) -> dict[str, Any]:
    """`{id, requested_count, card_count, ended_at, cards, queue, done_count, second_try_count}` (FR-14).
    A read: no guard, so a read-only Project's set still opens. Opening it ends the Account's other open
    sets that have marks, and ends this one when it was left idle (`IDLE`); `ended_at` is bookkeeping,
    not content (AD-27)."""
    await projects.get(conn, account_id, project_id)
    if await repo.get(conn, account_id, project_id, set_id) is None:
        raise FlashcardSetNotFound()
    await repo.lock_open(conn, account_id, set_id)
    await repo.end_others(conn, account_id, set_id)
    await repo.end_if_idle(conn, account_id, set_id, IDLE)
    return await _read(conn, account_id, project_id, set_id)


async def mark(
    conn: AsyncConnection, account_id: UUID, project_id: UUID, set_id: UUID, card_id: UUID, value: str
) -> dict[str, Any]:
    """Save one mark (FR-14) and return the set as `get` does, with no model call. A content mutation, so
    the read-only guard comes first (AD-22); then the same ordered lock as `get` (the Account's open sets
    plus this one), so marks and reads on the Account's sets run one at a time. A set left idle is ended here, then an ended set refuses the mark (`FlashcardSetEnded`); the
    caller commits that end before answering 409. A card of another set is not found. A mark on a card
    already "Got it" saves nothing and returns the current state. The final "Got it" ends the set in
    this same transaction. `value` is already one of `MARKS` (the request model owns that rule). No
    Mistake is ever written (AD-10)."""
    await projects.require_active(conn, account_id, project_id)
    if await repo.get(conn, account_id, project_id, set_id) is None:
        raise FlashcardSetNotFound()
    await repo.lock_open(conn, account_id, set_id)
    await repo.end_if_idle(conn, account_id, set_id, IDLE)
    current = await _read(conn, account_id, project_id, set_id)
    if current["ended_at"] is not None:
        raise FlashcardSetEnded()
    if card_id not in {card["id"] for card in current["cards"]}:
        raise FlashcardSetNotFound()
    if card_id not in current["queue"]:
        return current  # already "Got it": nothing to save
    await repo.insert_mark(conn, set_id, card_id, value)
    if value == GOT_IT and current["queue"] == [card_id]:
        await repo.end(conn, account_id, set_id)
    return await _read(conn, account_id, project_id, set_id)


# --- Checking (pure) ---


def check(draft: FlashcardDraft, sections: Sequence[_Section], count: int) -> list[dict[str, Any]]:
    """The cards to save, in order (AD-7): Section numbers mapped back to ids (unknown numbers dropped),
    uncited cards and cards with a blank question or answer dropped, at most `count` (never more than
    20). Question and answer are saved stripped of surrounding space."""
    kept: list[dict[str, Any]] = []
    for card in draft.cards:
        if len(kept) >= min(count, FLASHCARDS_MAX):
            break
        question, answer = card.question.strip(), card.answer.strip()
        if not question or not answer:
            continue
        numbers = dict.fromkeys(n for n in card.sections if 1 <= n <= len(sections))
        cited = [sections[n - 1] for n in numbers]
        if not cited:
            continue
        kept.append(
            {
                "question": question,
                "answer": answer,
                "source_section_ids": [section.id for section in cited],
                "material_ids": list(dict.fromkeys(section.material_id for section in cited)),
            }
        )
    return kept


# --- The flashcards job (AD-20) ---


async def _nothing(_conn: AsyncConnection) -> None:
    return None


def flashcards_kind(pool: AsyncConnectionPool, llm: Gateway) -> jobs.JobKind:
    """The handler for `flashcards` jobs. No terminal hook: a failed or cancelled job leaves nothing."""

    async def run(job: dict[str, Any], _payload: Any) -> jobs.SavePlan:
        params = job["params"]
        count = int(params["count"])
        section_ids = [UUID(value) for value in params["section_ids"]]
        topic_labels = list(params.get("topic_labels") or [])

        # 1. Reading (the claim already set the step).
        async with pool.connection() as conn:
            rows = await section_repo.load_sections(conn, section_ids)
        sections = [_Section(row["id"], row["material_id"], row["label"], row["text"]) for row in rows]
        material_ids = tuple(dict.fromkeys(section.material_id for section in sections))
        await llm.mock_pause()
        # A removed file's text is blank, and a cancelled job's result is thrown away: no model call.
        async with pool.connection() as conn:
            removed = await section_repo.any_removed(conn, list(material_ids))
        if removed or await jobs.should_stop(pool, job["id"]):
            return jobs.SavePlan(apply=_nothing, material_ids=material_ids)

        # 2. Writing, with no connection held (AD-18).
        await jobs.set_progress(pool, job["id"], jobs.WRITING)
        try:
            draft = await llm.generate_flashcards(sections, count, topic_labels)
        except ProviderError:
            raise jobs.JobFailed(LLM_UNAVAILABLE) from None
        except LLMOutputError:
            raise jobs.JobFailed(LLM_OUTPUT_INVALID) from None

        # 3. Checking.
        await jobs.set_progress(pool, job["id"], jobs.CHECKING)
        cards = check(draft, sections, count)
        await llm.mock_pause()
        logger.info("Flashcards: requested=%d returned=%d kept=%d", count, len(draft.cards), len(cards))
        if not cards:
            raise jobs.JobFailed(INSUFFICIENT_MATERIAL)

        set_id = uuid4()

        async def save(conn: AsyncConnection) -> None:
            await repo.insert(
                conn,
                set_id=set_id,
                account_id=job["account_id"],
                project_id=job["project_id"],
                job_id=job["id"],
                generation_params=params,
                requested_count=count,
                cards=cards,
            )

        # Every Material of the scope: removing any of them before the save saves nothing (AD-20).
        return jobs.SavePlan(apply=save, material_ids=material_ids, result_ref=set_id)

    return jobs.JobKind(run=run)
