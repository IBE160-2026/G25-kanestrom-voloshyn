"""The `review_rounds`, `practice_questions`, `round_items`, and `practice_answers` repository (AD-8, AD-9,
AD-11). Plain SQL; scoped by `account_id`.

Only `services/review` calls it. All four tables are insert-only. Takes the caller's `conn`; never commits.
"""

from typing import Any
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

_ITEM = """
    pq.id, ri.position, pq.question, pq.options, pq.correct_option_id, pq.explanation, pq.source_section_ids,
    pq.mistake_id, pq.from_original
"""


async def insert_round(conn: AsyncConnection, round_id: UUID, account_id: UUID, project_id: UUID, job_id: UUID) -> None:
    async with conn.cursor() as cur:
        await cur.execute(
            "INSERT INTO review_rounds (id, account_id, project_id, job_id) VALUES (%s, %s, %s, %s)",
            (round_id, account_id, project_id, job_id),
        )


async def get_round(conn: AsyncConnection, account_id: UUID, project_id: UUID, round_id: UUID) -> dict[str, Any] | None:
    """`id` and its job's `status` and `error_code` (null when the job row is gone)."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT r.id, j.status, j.error_code
            FROM review_rounds r LEFT JOIN generation_jobs j ON j.id = r.job_id
            WHERE r.id = %s AND r.account_id = %s AND r.project_id = %s
            """,
            (round_id, account_id, project_id),
        )
        return await cur.fetchone()


async def unanswered_for(conn: AsyncConnection, account_id: UUID, mistake_ids: list[UUID]) -> dict[UUID, UUID]:
    """By Mistake id: its newest Practice Question with no answer yet (from an earlier round)."""
    if not mistake_ids:
        return {}
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT DISTINCT ON (pq.mistake_id) pq.mistake_id, pq.id
            FROM practice_questions pq
            WHERE pq.account_id = %s AND pq.mistake_id = ANY(%s)
              AND NOT EXISTS (SELECT 1 FROM practice_answers pa WHERE pa.practice_question_id = pq.id)
            ORDER BY pq.mistake_id, pq.created_at DESC, pq.id
            """,
            (account_id, mistake_ids),
        )
        return {row[0]: row[1] for row in await cur.fetchall()}


async def insert_items(conn: AsyncConnection, account_id: UUID, round_id: UUID, items: list[dict[str, Any]]) -> None:
    """The round's items in order. An item with `practice_question_id` reuses that Practice Question;
    any other is a new Practice Question (`mistake_id`, `question`, `options`, `correct_option_id`,
    `explanation`, `source_section_ids`, `material_ids`, `from_original`)."""
    async with conn.cursor() as cur:
        for position, item in enumerate(items):
            question_id = item.get("practice_question_id")
            if question_id is None:
                await cur.execute(
                    """
                    INSERT INTO practice_questions
                        (account_id, mistake_id, question, options, correct_option_id, explanation,
                         source_section_ids, material_ids, from_original)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        account_id,
                        item["mistake_id"],
                        item["question"],
                        Jsonb(item["options"]),
                        item["correct_option_id"],
                        item["explanation"],
                        list(item["source_section_ids"]),
                        list(item["material_ids"]),
                        item["from_original"],
                    ),
                )
                question_id = (await cur.fetchone())[0]
            await cur.execute(
                "INSERT INTO round_items (round_id, practice_question_id, position) VALUES (%s, %s, %s)",
                (round_id, question_id, position),
            )


async def items_for(conn: AsyncConnection, account_id: UUID, round_id: UUID) -> list[dict[str, Any]]:
    """Every item of the Account's round, in order, with its answer key and Mistake."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"""
            SELECT {_ITEM}
            FROM round_items ri
            JOIN practice_questions pq ON pq.id = ri.practice_question_id
            JOIN review_rounds r ON r.id = ri.round_id
            WHERE ri.round_id = %s AND r.account_id = %s
            ORDER BY ri.position
            """,
            (round_id, account_id),
        )
        return await cur.fetchall()


async def item(
    conn: AsyncConnection, account_id: UUID, project_id: UUID, round_id: UUID, practice_question_id: UUID
) -> dict[str, Any] | None:
    """One item of the URL's round, which must belong to the Project and Account; None otherwise."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"""
            SELECT {_ITEM}
            FROM round_items ri
            JOIN practice_questions pq ON pq.id = ri.practice_question_id
            JOIN review_rounds r ON r.id = ri.round_id
            WHERE ri.round_id = %s AND ri.practice_question_id = %s AND r.account_id = %s AND r.project_id = %s
            """,
            (round_id, practice_question_id, account_id, project_id),
        )
        return await cur.fetchone()


async def answers_for(conn: AsyncConnection, account_id: UUID, question_ids: list[UUID]) -> dict[UUID, dict[str, Any]]:
    """The stored answers of these Practice Questions, by Practice Question id."""
    if not question_ids:
        return {}
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT id, practice_question_id, submitted_option_id, is_correct
            FROM practice_answers WHERE account_id = %s AND practice_question_id = ANY(%s)
            """,
            (account_id, question_ids),
        )
        return {row["practice_question_id"]: row for row in await cur.fetchall()}


async def insert_answer(
    conn: AsyncConnection, account_id: UUID, question_id: UUID, option_id: str, is_correct: bool
) -> tuple[dict[str, Any], bool]:
    """Save the answer once (idempotent): a second submit keeps the first. Returns the stored answer and
    whether this call inserted it."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            INSERT INTO practice_answers (practice_question_id, account_id, submitted_option_id, is_correct)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (practice_question_id) DO NOTHING
            """,
            (question_id, account_id, option_id, is_correct),
        )
        inserted = cur.rowcount == 1
        await cur.execute(
            """
            SELECT id, practice_question_id, submitted_option_id, is_correct
            FROM practice_answers WHERE practice_question_id = %s AND account_id = %s
            """,
            (question_id, account_id),
        )
        return await cur.fetchone(), inserted
