"""The `flashcard_sets` and `flashcards` repository (AD-8). Plain SQL; scoped by `account_id`.

Only `services/flashcards` calls it. Both tables are insert-only, except `flashcard_sets.ended_at`
(Story 4.2). Takes the caller's `conn`; never commits.
"""

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
    """`id`, `requested_count`, and `card_count`; None for a missing or foreign set."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT s.id, s.requested_count,
                   (SELECT count(*) FROM flashcards f WHERE f.set_id = s.id)::int AS card_count
            FROM flashcard_sets s
            WHERE s.id = %s AND s.account_id = %s AND s.project_id = %s
            """,
            (set_id, account_id, project_id),
        )
        return await cur.fetchone()
