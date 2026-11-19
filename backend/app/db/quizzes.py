"""The `quizzes`, `quiz_questions`, and `quiz_answers` repository (AD-8, AD-9). Plain SQL; scoped by
`account_id`.

Only `services/quiz` calls it; Section reads shared with `services/review` live in `db/sections`. All
three tables are insert-only. Takes the caller's `conn`; never commits.
"""

from typing import Any
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


async def insert(
    conn: AsyncConnection,
    *,
    quiz_id: UUID,
    account_id: UUID,
    project_id: UUID,
    job_id: UUID,
    generation_params: dict[str, Any],
    requested_count: int,
    questions: list[dict[str, Any]],
) -> None:
    """The Quiz and its Questions, in order."""
    async with conn.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO quizzes (id, account_id, project_id, job_id, generation_params, requested_count)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (quiz_id, account_id, project_id, job_id, Jsonb(generation_params), requested_count),
        )
        await cur.executemany(
            """
            INSERT INTO quiz_questions
                (quiz_id, position, question, options, correct_option_id, explanation, source_section_ids,
                 material_ids)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            [
                (
                    quiz_id,
                    position,
                    q["question"],
                    Jsonb(q["options"]),
                    q["correct_option_id"],
                    q["explanation"],
                    list(q["source_section_ids"]),
                    list(q["material_ids"]),
                )
                for position, q in enumerate(questions)
            ],
        )


async def get(conn: AsyncConnection, account_id: UUID, project_id: UUID, quiz_id: UUID) -> dict[str, Any] | None:
    """`id`, `requested_count`, and `question_count`; None for a missing or foreign Quiz."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT q.id, q.requested_count,
                   (SELECT count(*) FROM quiz_questions qq WHERE qq.quiz_id = q.id)::int AS question_count
            FROM quizzes q
            WHERE q.id = %s AND q.account_id = %s AND q.project_id = %s
            """,
            (quiz_id, account_id, project_id),
        )
        return await cur.fetchone()


async def questions_for(conn: AsyncConnection, account_id: UUID, quiz_id: UUID) -> list[dict[str, Any]]:
    """Every Question of the Account's Quiz, in order, with its answer key."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT qq.id, qq.position, qq.question, qq.options, qq.correct_option_id, qq.explanation,
                   qq.source_section_ids
            FROM quiz_questions qq
            JOIN quizzes q ON q.id = qq.quiz_id
            WHERE qq.quiz_id = %s AND q.account_id = %s
            ORDER BY qq.position
            """,
            (quiz_id, account_id),
        )
        return await cur.fetchall()


async def question(
    conn: AsyncConnection, account_id: UUID, project_id: UUID, quiz_id: UUID, question_id: UUID
) -> dict[str, Any] | None:
    """One Question of the URL's Quiz, which must belong to the Project and Account; None otherwise."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT qq.id, qq.position, qq.question, qq.options, qq.correct_option_id, qq.explanation,
                   qq.source_section_ids
            FROM quiz_questions qq
            JOIN quizzes q ON q.id = qq.quiz_id
            WHERE qq.id = %s AND q.id = %s AND q.account_id = %s AND q.project_id = %s
            """,
            (question_id, quiz_id, account_id, project_id),
        )
        return await cur.fetchone()


async def answers_for(conn: AsyncConnection, account_id: UUID, question_ids: list[UUID]) -> dict[UUID, dict[str, Any]]:
    """The stored answers of these Questions, by Question id."""
    if not question_ids:
        return {}
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT quiz_question_id, submitted_option_id, is_correct
            FROM quiz_answers WHERE account_id = %s AND quiz_question_id = ANY(%s)
            """,
            (account_id, question_ids),
        )
        return {row["quiz_question_id"]: row for row in await cur.fetchall()}


async def insert_answer(
    conn: AsyncConnection, account_id: UUID, question_id: UUID, option_id: str, is_correct: bool
) -> tuple[dict[str, Any], bool]:
    """Save the answer once (idempotent): a second submit keeps the first. Returns the stored answer and
    whether this call inserted it."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            INSERT INTO quiz_answers (quiz_question_id, account_id, submitted_option_id, is_correct)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (quiz_question_id) DO NOTHING
            """,
            (question_id, account_id, option_id, is_correct),
        )
        inserted = cur.rowcount == 1
        await cur.execute(
            """
            SELECT id, quiz_question_id, submitted_option_id, is_correct
            FROM quiz_answers WHERE quiz_question_id = %s AND account_id = %s
            """,
            (question_id, account_id),
        )
        return await cur.fetchone(), inserted

