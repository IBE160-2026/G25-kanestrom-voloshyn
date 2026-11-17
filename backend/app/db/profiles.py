"""The `profiles` repository (AD-16, AD-19). Plain SQL; takes the request's `conn`, never commits."""

from typing import Any
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

_COLUMNS = "account_id, first_name, language, email_verified_at, ui_prefs, last_project_id"


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


async def set_language(conn: AsyncConnection, account_id: UUID, language: str) -> None:
    """Save the Account's interface language (FR-29), replacing any earlier choice."""
    await conn.execute("UPDATE profiles SET language = %s WHERE account_id = %s", (language, account_id))


async def set_last_project(conn: AsyncConnection, account_id: UUID, project_id: UUID) -> None:
    """Remember the Project the Account opened last, where the next login lands (FR-8)."""
    await conn.execute("UPDATE profiles SET last_project_id = %s WHERE account_id = %s", (project_id, account_id))


async def merge_ui_prefs(conn: AsyncConnection, account_id: UUID, prefs: dict[str, Any]) -> None:
    """Merge `prefs` into ui_prefs, keeping the keys it doesn't name (AD-19).

    `files_collapsed` ({project_id: bool}) is merged one level deeper, so saving one Project's
    Files panel choice keeps the others.
    """
    prefs = dict(prefs)
    files = prefs.pop("files_collapsed", None)
    await conn.execute(
        """
        UPDATE profiles SET ui_prefs = CASE
            WHEN %(files)s::jsonb IS NULL THEN ui_prefs || %(top)s
            ELSE ui_prefs || %(top)s || jsonb_build_object(
                'files_collapsed', coalesce(ui_prefs -> 'files_collapsed', '{}'::jsonb) || %(files)s
            )
        END
        WHERE account_id = %(account_id)s
        """,
        {"top": Jsonb(prefs), "files": Jsonb(files) if files is not None else None, "account_id": account_id},
    )
