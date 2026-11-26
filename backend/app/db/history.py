"""The History read model (Story 5.1: FR-25, FR-8, AD-27). Plain SQL; scoped by `account_id`.

Only `services/history` calls it. One read-only `UNION ALL` over `chats`, `quizzes`, `flashcard_sets`, and
`summaries`, newest first by `(created_at, id)`, with keyset pagination. It writes nothing. Takes the
caller's `conn`; never commits.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import dict_row

# Every branch selects the `_COLUMNS`, in that order; what a type doesn't carry is null.
_COLUMNS = (
    "type, id, created_at, generation_params, stored_title, question_count, answered_count, correct_count, "
    "card_count, message_count, first_question, scope_file_name"
)
_QUIZ = """
    SELECT 'quiz'::text, q.id, q.created_at, q.generation_params, NULL::text,
        (SELECT count(*) FROM quiz_questions qq WHERE qq.quiz_id = q.id),
        (SELECT count(*) FROM quiz_questions qq JOIN quiz_answers a ON a.quiz_question_id = qq.id
         WHERE qq.quiz_id = q.id),
        (SELECT count(*) FROM quiz_questions qq JOIN quiz_answers a ON a.quiz_question_id = qq.id
         WHERE qq.quiz_id = q.id AND a.is_correct),
        NULL::bigint, NULL::bigint, NULL::text, NULL::text
    FROM quizzes q
    WHERE q.account_id = %(account_id)s AND q.project_id = %(project_id)s
"""

_FLASHCARDS = """
    SELECT 'flashcards'::text, s.id, s.created_at, s.generation_params, NULL::text,
        NULL::bigint, NULL::bigint, NULL::bigint,
        (SELECT count(*) FROM flashcards f WHERE f.set_id = s.id),
        NULL::bigint, NULL::text, NULL::text
    FROM flashcard_sets s
    WHERE s.account_id = %(account_id)s AND s.project_id = %(project_id)s
"""

_SUMMARY = """
    SELECT 'summary'::text, s.id, s.created_at, s.generation_params, s.title,
        NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint, NULL::text, NULL::text
    FROM summaries s
    WHERE s.account_id = %(account_id)s AND s.project_id = %(project_id)s
"""

# A chat with no messages is not listed. Its scoped file's name only while that file is Ready.
_CHAT = """
    SELECT 'chat'::text, c.id, c.created_at, NULL::jsonb, NULL::text,
        NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint,
        (SELECT count(*) FROM chat_messages cm WHERE cm.chat_id = c.id),
        (SELECT cm.text FROM chat_messages cm WHERE cm.chat_id = c.id AND cm.role = 'user'
         ORDER BY cm.seq LIMIT 1),
        m.file_name
    FROM chats c
    LEFT JOIN study_materials m
        ON c.current_scope ? 'material_id'
        AND m.id = (c.current_scope ->> 'material_id')::uuid
        AND m.account_id = c.account_id AND m.project_id = c.project_id
        AND m.removed_at IS NULL AND m.status = 'ready'
    WHERE c.account_id = %(account_id)s AND c.project_id = %(project_id)s
        AND EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.chat_id = c.id)
"""

BRANCHES = {"chat": _CHAT, "quiz": _QUIZ, "flashcards": _FLASHCARDS, "summary": _SUMMARY}


async def page(
    conn: AsyncConnection,
    account_id: UUID,
    project_id: UUID,
    *,
    types: list[str],
    after: tuple[datetime, UUID] | None,
    limit: int,
) -> list[dict[str, Any]]:
    """At most `limit` items of the given types, `created_at DESC, id DESC`, strictly after the cursor
    `(created_at, id)` when one is given. Columns: `type`, `id`, `created_at`, `generation_params`,
    `stored_title`, `question_count`, `answered_count`, `correct_count`, `card_count`, `message_count`,
    `first_question`, `scope_file_name`."""
    union = "\n    UNION ALL\n".join(BRANCHES[kind] for kind in types)
    keyset = "WHERE (h.created_at, h.id) < (%(after_at)s, %(after_id)s)" if after is not None else ""
    params: dict[str, Any] = {"account_id": account_id, "project_id": project_id, "limit": limit}
    if after is not None:
        params["after_at"], params["after_id"] = after
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"""
            SELECT * FROM ({union}) AS h({_COLUMNS})
            {keyset}
            ORDER BY h.created_at DESC, h.id DESC
            LIMIT %(limit)s
            """,
            params,
        )
        return await cur.fetchall()
