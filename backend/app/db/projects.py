"""The `projects` repository (AD-2, AD-14, AD-22). Plain SQL; every query is scoped by `account_id`.

Takes the request's `conn` and never commits.
"""

from typing import Any
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import dict_row

_COLUMNS = "id, name, name_source, archived_at, deleted_at, created_at"


async def insert(conn: AsyncConnection, account_id: UUID) -> dict[str, Any]:
    """A new Project with no name (AD-14)."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(f"INSERT INTO projects (account_id) VALUES (%s) RETURNING {_COLUMNS}", (account_id,))
        return await cur.fetchone()


async def list_for(conn: AsyncConnection, account_id: UUID) -> list[dict[str, Any]]:
    """Every Project of the Account, newest first."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"SELECT {_COLUMNS} FROM projects WHERE account_id = %s ORDER BY created_at DESC, id DESC",
            (account_id,),
        )
        return await cur.fetchall()


async def get(conn: AsyncConnection, account_id: UUID, project_id: UUID) -> dict[str, Any] | None:
    """The Project, or None when it doesn't exist or belongs to another Account."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"SELECT {_COLUMNS} FROM projects WHERE id = %s AND account_id = %s", (project_id, account_id)
        )
        return await cur.fetchone()


async def get_for_update(conn: AsyncConnection, account_id: UUID, project_id: UUID) -> dict[str, Any] | None:
    """Like `get`, but locks the row until the transaction ends (the read-only guard, AD-22)."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"SELECT {_COLUMNS} FROM projects WHERE id = %s AND account_id = %s FOR UPDATE",
            (project_id, account_id),
        )
        return await cur.fetchone()


async def set_student_name(
    conn: AsyncConnection, account_id: UUID, project_id: UUID, name: str
) -> dict[str, Any] | None:
    """Save a student's rename (FR-5); it is never overwritten by auto-naming (AD-14)."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"""
            UPDATE projects SET name = %s, name_source = 'student'
            WHERE id = %s AND account_id = %s
            RETURNING {_COLUMNS}
            """,
            (name, project_id, account_id),
        )
        return await cur.fetchone()
