"""The `quizzes`, `quiz_questions`, and `quiz_answers` repository (AD-8, AD-9). Plain SQL; scoped by
`account_id`.

Only `services/quiz` calls it. All three tables are insert-only. Takes the caller's `conn`; never commits.
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
) -> dict[str, Any]:
    """Save the answer once (idempotent): a second submit keeps the first. Returns the stored answer."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            INSERT INTO quiz_answers (quiz_question_id, account_id, submitted_option_id, is_correct)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (quiz_question_id) DO NOTHING
            """,
            (question_id, account_id, option_id, is_correct),
        )
        await cur.execute(
            """
            SELECT id, quiz_question_id, submitted_option_id, is_correct
            FROM quiz_answers WHERE quiz_question_id = %s AND account_id = %s
            """,
            (question_id, account_id),
        )
        return await cur.fetchone()


async def source_labels(conn: AsyncConnection, account_id: UUID, section_ids: list[UUID]) -> dict[UUID, str]:
    """`"{file_name} · {section label}"` by Section id. A removed file keeps its name and label (AD-23)."""
    if not section_ids:
        return {}
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT s.id, m.file_name || ' · ' || s.label
            FROM sections s JOIN study_materials m ON m.id = s.material_id
            WHERE s.id = ANY(%s) AND m.account_id = %s
            """,
            (section_ids, account_id),
        )
        return {row[0]: row[1] for row in await cur.fetchall()}
