"""Reads of Supabase's `auth.sessions` (AD-2 step 2). Plain SQL; takes the request's `conn`."""

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
