"""The `mistakes` repository (AD-8, AD-10). Plain SQL; scoped by `account_id`.

Only `services/mistakes` calls it. A row is inserted once; only `cleared_at` and `withdrawn_at` change.
"Outstanding" means neither is set. Takes the caller's `conn`; never commits.
"""

from uuid import UUID

from psycopg import AsyncConnection

OUTSTANDING = "cleared_at IS NULL AND withdrawn_at IS NULL"


async def insert(
    conn: AsyncConnection, account_id: UUID, project_id: UUID, quiz_question_id: UUID, failed_answer_id: UUID
) -> bool:
    """Insert an outstanding Mistake for the Account's Question, unless it already has one. Only for a wrong
    answer of that same Question and Account (`failed_answer_id`); anything else inserts nothing. The Question's
    `material_ids` are copied and its text, options, answer key, explanation, and cited Sections are
    snapshotted as shown. True when a row was inserted."""
    async with conn.cursor() as cur:
        await cur.execute(
            f"""
            INSERT INTO mistakes
                (account_id, project_id, quiz_question_id, failed_answer_id, material_ids, question_snapshot)
            SELECT q.account_id, q.project_id, qq.id, qa.id, qq.material_ids,
                   jsonb_build_object(
                       'question', qq.question,
                       'options', qq.options,
                       'correct_option_id', qq.correct_option_id,
                       'explanation', qq.explanation,
                       'source_section_ids', to_jsonb(qq.source_section_ids)
                   )
            FROM quiz_questions qq
            JOIN quizzes q ON q.id = qq.quiz_id
            JOIN quiz_answers qa
              ON qa.id = %s AND qa.quiz_question_id = qq.id AND qa.account_id = q.account_id AND NOT qa.is_correct
            WHERE qq.id = %s AND q.account_id = %s AND q.project_id = %s
            ON CONFLICT (account_id, quiz_question_id) WHERE {OUTSTANDING} DO NOTHING
            """,
            (failed_answer_id, quiz_question_id, account_id, project_id),
        )
        return cur.rowcount == 1


async def withdraw_for_material(conn: AsyncConnection, account_id: UUID, project_id: UUID, material_id: UUID) -> int:
    """Stamp `withdrawn_at` on the Project's outstanding Mistakes citing the Material. Returns how many."""
    async with conn.cursor() as cur:
        await cur.execute(
            f"""
            UPDATE mistakes SET withdrawn_at = now()
            WHERE account_id = %s AND project_id = %s AND material_ids @> ARRAY[%s]::uuid[] AND {OUTSTANDING}
            """,
            (account_id, project_id, material_id),
        )
        return cur.rowcount


async def outstanding_count(conn: AsyncConnection, account_id: UUID, project_id: UUID) -> int:
    async with conn.cursor() as cur:
        await cur.execute(
            f"SELECT count(*) FROM mistakes WHERE account_id = %s AND project_id = %s AND {OUTSTANDING}",
            (account_id, project_id),
        )
        return (await cur.fetchone())[0]


async def outstanding_by_material(conn: AsyncConnection, account_id: UUID, project_id: UUID) -> dict[UUID, int]:
    """Outstanding Mistakes per cited Material; a Mistake citing two files counts for each."""
    async with conn.cursor() as cur:
        await cur.execute(
            f"""
            SELECT material_id, count(*)
            FROM mistakes, unnest(material_ids) AS material_id
            WHERE account_id = %s AND project_id = %s AND {OUTSTANDING}
            GROUP BY material_id
            """,
            (account_id, project_id),
        )
        return {row[0]: row[1] for row in await cur.fetchall()}
