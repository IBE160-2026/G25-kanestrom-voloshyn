"""The `quizzes` and `quiz_questions` repository (AD-8, AD-9). Plain SQL; scoped by `account_id`.

Only `services/quiz` calls it. Both tables are insert-only. Takes the caller's `conn`; never commits.
"""

from typing import Any
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


async def load_sections(conn: AsyncConnection, section_ids: list[UUID]) -> list[dict[str, Any]]:
    """The Sections (`id`, `material_id`, `label`, `text`) in the order of `section_ids`. A removed
    Material's Sections come back with empty text (AD-23)."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT s.id, s.material_id, s.label, s.text
            FROM unnest(%s::uuid[]) WITH ORDINALITY AS wanted(id, ord)
            JOIN sections s ON s.id = wanted.id
            ORDER BY wanted.ord
            """,
            (section_ids,),
        )
        return await cur.fetchall()


async def any_removed(conn: AsyncConnection, material_ids: list[UUID]) -> bool:
    """True when one of the Materials is removed or gone (a plain read; the save step locks)."""
    if not material_ids:
        return False
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT count(*) FILTER (WHERE removed_at IS NULL) FROM study_materials WHERE id = ANY(%s)",
            (material_ids,),
        )
        return (await cur.fetchone())[0] < len(set(material_ids))


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
