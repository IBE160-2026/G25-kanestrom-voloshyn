"""Reads and deletes of Supabase's `auth.sessions` (AD-2 step 2, AD-19). Plain SQL; takes the request's `conn`."""

from datetime import datetime
from uuid import UUID

from psycopg import AsyncConnection


async def find_created_at(
    conn: AsyncConnection, session_id: UUID, account_id: UUID
) -> tuple[bool, datetime | None]:
    """Return (found, created_at) for the Account's session. `created_at` may be NULL."""
    cur = await conn.execute(
        "SELECT created_at FROM auth.sessions WHERE id = %s AND user_id = %s",
        (session_id, account_id),
    )
    row = await cur.fetchone()
    if row is None:
        return False, None
    return True, row[0]


async def delete_others(conn: AsyncConnection, account_id: UUID, keep_session_id: UUID) -> int:
    """End every session of the Account except `keep_session_id` (FR-3, AD-19). Returns how many.

    Their refresh tokens go with them (ON DELETE CASCADE), so the ended sessions can't be renewed,
    and `user_auth` step 2 refuses their access tokens at once.
    """
    cur = await conn.execute(
        "DELETE FROM auth.sessions WHERE user_id = %s AND id <> %s",
        (account_id, keep_session_id),
    )
    return cur.rowcount
