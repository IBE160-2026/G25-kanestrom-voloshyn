"""The `profiles` repository (AD-16, AD-19). Plain SQL; takes the request's `conn`, never commits."""

from typing import Any
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import dict_row

_COLUMNS = "account_id, first_name, language, email_verified_at"


async def ensure(conn: AsyncConnection, account_id: UUID) -> None:
    """Create the Account's profile if it doesn't exist yet (AD-2 step 3)."""
    await conn.execute(
        "INSERT INTO profiles (account_id) VALUES (%s) ON CONFLICT (account_id) DO NOTHING",
        (account_id,),
    )


async def fill_unset(
    conn: AsyncConnection, account_id: UUID, first_name: str | None, language: str | None
) -> None:
    """Set first_name and language, each only while it is still NULL."""
    await conn.execute(
        """
        UPDATE profiles
        SET first_name = COALESCE(first_name, %s),
            language = COALESCE(language, %s)
        WHERE account_id = %s
        """,
        (first_name, language, account_id),
    )


async def get(conn: AsyncConnection, account_id: UUID) -> dict[str, Any] | None:
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(f"SELECT {_COLUMNS} FROM profiles WHERE account_id = %s", (account_id,))
        return await cur.fetchone()


async def lock_email_verified_at(conn: AsyncConnection, account_id: UUID) -> tuple[bool, Any]:
    """Lock the Account's profile row for this transaction; return (found, email_verified_at).

    Serialises concurrent first-email checks for the same Account (AD-19).
    """
    cur = await conn.execute(
        "SELECT email_verified_at FROM profiles WHERE account_id = %s FOR UPDATE", (account_id,)
    )
    row = await cur.fetchone()
    return (False, None) if row is None else (True, row[0])


async def mark_email_verified(conn: AsyncConnection, account_id: UUID) -> None:
    """Set email_verified_at, keeping the first time it was set."""
    await conn.execute(
        "UPDATE profiles SET email_verified_at = COALESCE(email_verified_at, now()) WHERE account_id = %s",
        (account_id,),
    )
