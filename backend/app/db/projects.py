"""The `projects` repository (AD-2, AD-14, AD-22). Plain SQL; every query is scoped by `account_id`.

Takes the request's `conn` and never commits.
"""

from typing import Any
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import dict_row

# `purge_at`: when a deleted Project is permanently deleted (FR-24: 30 days after `deleted_at`).
_COLUMNS = "id, name, name_source, archived_at, deleted_at, deleted_at + interval '30 days' AS purge_at, created_at"

# A Project deleted more than 30 days ago is gone to every read, even before the purge task removes it
# (FR-24, AD-22: a host that slept never shows it).
_NOT_EXPIRED = "(deleted_at IS NULL OR deleted_at > now() - interval '30 days')"


async def insert(conn: AsyncConnection, account_id: UUID) -> dict[str, Any]:
    """A new Project with no name (AD-14)."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(f"INSERT INTO projects (account_id) VALUES (%s) RETURNING {_COLUMNS}", (account_id,))
        return await cur.fetchone()


async def list_for(conn: AsyncConnection, account_id: UUID) -> list[dict[str, Any]]:
    """Every Project of the Account, newest first."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"SELECT {_COLUMNS} FROM projects WHERE account_id = %s AND {_NOT_EXPIRED} "
            "ORDER BY created_at DESC, id DESC",
            (account_id,),
        )
        return await cur.fetchall()


async def get(conn: AsyncConnection, account_id: UUID, project_id: UUID) -> dict[str, Any] | None:
    """The Project, or None when it doesn't exist, belongs to another Account, or has expired."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"SELECT {_COLUMNS} FROM projects WHERE id = %s AND account_id = %s AND {_NOT_EXPIRED}",
            (project_id, account_id),
        )
        return await cur.fetchone()


async def get_for_update(
    conn: AsyncConnection, account_id: UUID, project_id: UUID, *, include_expired: bool = False
) -> dict[str, Any] | None:
    """Like `get`, but locks the row until the transaction ends (the read-only guard, AD-22).

    `include_expired` only for the purge task, which must still find an expired Project to remove it.
    """
    expiry = "" if include_expired else f" AND {_NOT_EXPIRED}"
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"SELECT {_COLUMNS} FROM projects WHERE id = %s AND account_id = %s{expiry} FOR UPDATE",
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


async def set_auto_name(
    conn: AsyncConnection, account_id: UUID, project_id: UUID, name: str
) -> dict[str, Any] | None:
    """Save an auto-name (FR-4, AD-14), only while the Project is still unnamed and active.

    None when a name (a student's rename or an earlier auto-name) landed first, or the Project is gone.
    """
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"""
            UPDATE projects SET name = %s, name_source = 'auto'
            WHERE id = %s AND account_id = %s AND name_source IS NULL
              AND archived_at IS NULL AND deleted_at IS NULL
            RETURNING {_COLUMNS}
            """,
            (name, project_id, account_id),
        )
        return await cur.fetchone()


async def set_deleted(conn: AsyncConnection, account_id: UUID, project_id: UUID) -> dict[str, Any] | None:
    """Delete the Project (FR-24), keeping the first `deleted_at` and `archived_at`; touches nothing else."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"""
            UPDATE projects SET deleted_at = coalesce(deleted_at, now())
            WHERE id = %s AND account_id = %s
            RETURNING {_COLUMNS}
            """,
            (project_id, account_id),
        )
        return await cur.fetchone()


async def set_restored(conn: AsyncConnection, account_id: UUID, project_id: UUID) -> dict[str, Any] | None:
    """Restore the Project to the active list (FR-23, FR-24): clears both `archived_at` and `deleted_at`."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"""
            UPDATE projects SET archived_at = NULL, deleted_at = NULL
            WHERE id = %s AND account_id = %s
            RETURNING {_COLUMNS}
            """,
            (project_id, account_id),
        )
        return await cur.fetchone()


async def set_archived(
    conn: AsyncConnection, account_id: UUID, project_id: UUID
) -> dict[str, Any] | None:
    """Archive the Project, keeping the first `archived_at` (FR-23); touches nothing else."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"""
            UPDATE projects SET archived_at = coalesce(archived_at, now())
            WHERE id = %s AND account_id = %s
            RETURNING {_COLUMNS}
            """,
            (project_id, account_id),
        )
        return await cur.fetchone()


async def delete_deleted(conn: AsyncConnection, account_id: UUID, project_id: UUID) -> bool:
    """Remove a deleted Project for good (FR-24); every child row goes by cascade. Never touches a
    Project that isn't deleted. True when a row was removed."""
    async with conn.cursor() as cur:
        await cur.execute(
            "DELETE FROM projects WHERE id = %s AND account_id = %s AND deleted_at IS NOT NULL",
            (project_id, account_id),
        )
        return cur.rowcount > 0


async def expired_ids(conn: AsyncConnection) -> list[tuple[UUID, UUID]]:
    """(account_id, project_id) of every Project deleted more than 30 days ago, oldest first."""
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT account_id, id FROM projects
            WHERE deleted_at IS NOT NULL AND deleted_at <= now() - interval '30 days'
            ORDER BY deleted_at
            """
        )
        return [(row[0], row[1]) for row in await cur.fetchall()]
