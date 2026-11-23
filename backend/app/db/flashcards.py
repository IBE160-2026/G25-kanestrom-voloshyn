"""The `flashcard_sets` and `flashcards` repository (AD-8). Plain SQL; scoped by `account_id`.

Only `services/flashcards` calls it. The sets, cards, and marks (`flashcard_marks`, Story 4.2) are
insert-only, except `flashcard_sets.ended_at`. Takes the caller's `conn`; never commits.
"""

from datetime import timedelta
from typing import Any
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


async def insert(
    conn: AsyncConnection,
    *,
    set_id: UUID,
    account_id: UUID,
    project_id: UUID,
    job_id: UUID,
    generation_params: dict[str, Any],
    requested_count: int,
    cards: list[dict[str, Any]],
) -> None:
    """The set and its cards, in order."""
    async with conn.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO flashcard_sets (id, account_id, project_id, job_id, generation_params, requested_count)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (set_id, account_id, project_id, job_id, Jsonb(generation_params), requested_count),
        )
        await cur.executemany(
            """
            INSERT INTO flashcards (set_id, position, question, answer, source_section_ids, material_ids)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            [
                (
                    set_id,
                    position,
                    card["question"],
                    card["answer"],
                    list(card["source_section_ids"]),
                    list(card["material_ids"]),
                )
                for position, card in enumerate(cards)
            ],
        )


async def get(conn: AsyncConnection, account_id: UUID, project_id: UUID, set_id: UUID) -> dict[str, Any] | None:
    """`id`, `requested_count`, `card_count`, and `ended_at`; None for a missing or foreign set."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT s.id, s.requested_count, s.ended_at,
                   (SELECT count(*) FROM flashcards f WHERE f.set_id = s.id)::int AS card_count
            FROM flashcard_sets s
            WHERE s.id = %s AND s.account_id = %s AND s.project_id = %s
            """,
            (set_id, account_id, project_id),
        )
        return await cur.fetchone()


async def lock_open(conn: AsyncConnection, account_id: UUID, set_id: UUID) -> None:
    """Lock the Account's open sets plus `set_id` for the rest of the transaction, in id order. Every
    read or mark takes this one lock before ending or marking a set, so two tabs can't deadlock and an
    idle end can't race a mark."""
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT id FROM flashcard_sets
            WHERE account_id = %s AND (id = %s OR ended_at IS NULL)
            ORDER BY id
            FOR UPDATE
            """,
            (account_id, set_id),
        )


async def cards(conn: AsyncConnection, account_id: UUID, set_id: UUID) -> list[dict[str, Any]]:
    """The set's cards by `position`: `id`, `position`, `question`, `answer`, `source_section_ids`."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT f.id, f.position, f.question, f.answer, f.source_section_ids
            FROM flashcards f JOIN flashcard_sets s ON s.id = f.set_id
            WHERE f.set_id = %s AND s.account_id = %s
            ORDER BY f.position
            """,
            (set_id, account_id),
        )
        return await cur.fetchall()


async def marks(conn: AsyncConnection, account_id: UUID, set_id: UUID) -> list[dict[str, Any]]:
    """The set's marks in the order they were saved: `id`, `card_id`, `mark`."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT m.id, m.card_id, m.mark
            FROM flashcard_marks m JOIN flashcard_sets s ON s.id = m.set_id
            WHERE m.set_id = %s AND s.account_id = %s
            ORDER BY m.id
            """,
            (set_id, account_id),
        )
        return await cur.fetchall()


async def insert_mark(conn: AsyncConnection, set_id: UUID, card_id: UUID, mark: str) -> None:
    """One mark. The caller has checked that the card belongs to the Account's locked set."""
    async with conn.cursor() as cur:
        await cur.execute(
            "INSERT INTO flashcard_marks (set_id, card_id, mark) VALUES (%s, %s, %s)",
            (set_id, card_id, mark),
        )


async def end(conn: AsyncConnection, account_id: UUID, set_id: UUID) -> None:
    """End the set now, unless it has already ended."""
    async with conn.cursor() as cur:
        await cur.execute(
            "UPDATE flashcard_sets SET ended_at = now() WHERE id = %s AND account_id = %s AND ended_at IS NULL",
            (set_id, account_id),
        )


async def end_if_idle(conn: AsyncConnection, account_id: UUID, set_id: UUID, idle: timedelta) -> None:
    """End an open set whose last mark is older than `idle`. A set with no marks is never ended (the
    `max` of no marks is null, and the comparison then fails)."""
    async with conn.cursor() as cur:
        await cur.execute(
            """
            UPDATE flashcard_sets s SET ended_at = now()
            WHERE s.id = %s AND s.account_id = %s AND s.ended_at IS NULL
              AND (SELECT max(m.created_at) FROM flashcard_marks m WHERE m.set_id = s.id) < now() - %s
            """,
            (set_id, account_id, idle),
        )


async def end_others(conn: AsyncConnection, account_id: UUID, set_id: UUID) -> None:
    """End the Account's other open sets that have at least one mark (opening a set ends the others)."""
    async with conn.cursor() as cur:
        await cur.execute(
            """
            UPDATE flashcard_sets s SET ended_at = now()
            WHERE s.account_id = %s AND s.id <> %s AND s.ended_at IS NULL
              AND EXISTS (SELECT 1 FROM flashcard_marks m WHERE m.set_id = s.id)
            """,
            (account_id, set_id),
        )
