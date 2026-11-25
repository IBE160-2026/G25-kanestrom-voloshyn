"""The `chats` and `chat_messages` repository (Story 4.4, AD-25). Plain SQL; scoped by `account_id`.

Only `services/chat` calls it. `chat_messages` is insert-only; on `chats` only `current_scope` and
`last_opened_at` change. Takes the caller's `conn`; never commits.
"""

from typing import Any
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

_COLUMNS = "id, account_id, project_id, current_scope, created_at, last_opened_at"


async def get(conn: AsyncConnection, account_id: UUID, chat_id: UUID) -> dict[str, Any] | None:
    """The chat; None for a missing or foreign one."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(f"SELECT {_COLUMNS} FROM chats WHERE id = %s AND account_id = %s", (chat_id, account_id))
        return await cur.fetchone()


async def get_for_update(conn: AsyncConnection, account_id: UUID, chat_id: UUID) -> dict[str, Any] | None:
    """The chat, locked until the transaction ends (seq is assigned under this lock)."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"SELECT {_COLUMNS} FROM chats WHERE id = %s AND account_id = %s FOR UPDATE", (chat_id, account_id)
        )
        return await cur.fetchone()


async def latest_for_project(conn: AsyncConnection, account_id: UUID, project_id: UUID) -> dict[str, Any] | None:
    """The Project's chat last opened (Story 4.5: `last_opened_at`, newest first; ties by creation)."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"""
            SELECT {_COLUMNS} FROM chats WHERE account_id = %s AND project_id = %s
            ORDER BY last_opened_at DESC, created_at DESC, id DESC LIMIT 1
            """,
            (account_id, project_id),
        )
        return await cur.fetchone()


async def insert(conn: AsyncConnection, account_id: UUID, project_id: UUID) -> dict[str, Any]:
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"INSERT INTO chats (account_id, project_id) VALUES (%s, %s) RETURNING {_COLUMNS}", (account_id, project_id)
        )
        return await cur.fetchone()


async def has_messages(conn: AsyncConnection, chat_id: UUID) -> bool:
    async with conn.cursor() as cur:
        await cur.execute("SELECT EXISTS (SELECT 1 FROM chat_messages WHERE chat_id = %s)", (chat_id,))
        row = await cur.fetchone()
    return bool(row and row[0])


async def touch(conn: AsyncConnection, chat_id: UUID) -> None:
    async with conn.cursor() as cur:
        await cur.execute("UPDATE chats SET last_opened_at = now() WHERE id = %s", (chat_id,))


async def set_scope(conn: AsyncConnection, chat_id: UUID, scope: dict[str, Any]) -> None:
    async with conn.cursor() as cur:
        await cur.execute("UPDATE chats SET current_scope = %s WHERE id = %s", (Jsonb(scope), chat_id))


async def messages(conn: AsyncConnection, chat_id: UUID) -> list[dict[str, Any]]:
    """The thread in `seq` order: `id`, `seq`, `role`, `text`, `source_section_ids`."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            "SELECT id, seq, role, text, source_section_ids FROM chat_messages WHERE chat_id = %s ORDER BY seq",
            (chat_id,),
        )
        return await cur.fetchall()


async def recent_messages(conn: AsyncConnection, chat_id: UUID, limit: int) -> list[dict[str, Any]]:
    """The last `limit` messages, newest first: `role`, `text`."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            "SELECT role, text FROM chat_messages WHERE chat_id = %s ORDER BY seq DESC LIMIT %s", (chat_id, limit)
        )
        return await cur.fetchall()


async def insert_turn(
    conn: AsyncConnection,
    chat_id: UUID,
    scope: dict[str, Any],
    question: str,
    answer: str,
    source_section_ids: list[UUID],
    material_ids: list[UUID],
) -> UUID:
    """The question and its answer as the next two `seq`s; the caller holds the chat row lock. Returns the
    answer's id."""
    async with conn.cursor() as cur:
        await cur.execute("SELECT coalesce(max(seq), 0) FROM chat_messages WHERE chat_id = %s", (chat_id,))
        last = (await cur.fetchone())[0]
        await cur.execute(
            "INSERT INTO chat_messages (chat_id, seq, role, scope, text) VALUES (%s, %s, 'user', %s, %s)",
            (chat_id, last + 1, Jsonb(scope), question),
        )
        await cur.execute(
            """
            INSERT INTO chat_messages (chat_id, seq, role, scope, text, source_section_ids, material_ids)
            VALUES (%s, %s, 'assistant', %s, %s, %s, %s) RETURNING id
            """,
            (chat_id, last + 2, Jsonb(scope), answer, source_section_ids, material_ids),
        )
        return (await cur.fetchone())[0]


async def rank_sections(conn: AsyncConnection, section_ids: list[UUID], question: str) -> list[UUID]:
    """`section_ids` ordered by full-text match with the question (`websearch_to_tsquery('simple')`
    against `sections.tsv`, `ts_rank`), best first; ties keep the given order."""
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT s.id
            FROM unnest(%s::uuid[]) WITH ORDINALITY AS wanted(id, ord)
            JOIN sections s ON s.id = wanted.id
            ORDER BY ts_rank(s.tsv, websearch_to_tsquery('simple', %s)) DESC, wanted.ord
            """,
            (section_ids, question),
        )
        return [row[0] for row in await cur.fetchall()]
