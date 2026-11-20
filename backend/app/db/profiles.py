"""The `profiles` repository (AD-16, AD-19). Plain SQL; takes the request's `conn`, never commits."""

from datetime import datetime
from typing import Any
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

_COLUMNS = (
    "account_id, first_name, language, email_verified_at, ui_prefs, last_project_id, privacy_notice_ack_at,"
    " notice_google_takeover"
)


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

    A Google takeover counts as verified here (no verification email after one).

    Serialises concurrent first-email checks for the same Account (AD-19).
    """
    cur = await conn.execute(
        "SELECT COALESCE(email_verified_at, google_takeover_at) FROM profiles WHERE account_id = %s FOR UPDATE",
        (account_id,),
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


async def set_first_name(conn: AsyncConnection, account_id: UUID, first_name: str) -> None:
    """Save the first name edited in Settings (FR-27), replacing the earlier one."""
    await conn.execute("UPDATE profiles SET first_name = %s WHERE account_id = %s", (first_name, account_id))


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


async def accept_privacy_notice(conn: AsyncConnection, account_id: UUID) -> None:
    """Record the Privacy notice acceptance once; a repeat keeps the first time (FR-6, AD-19)."""
    await conn.execute(
        "UPDATE profiles SET privacy_notice_ack_at = coalesce(privacy_notice_ack_at, now()) WHERE account_id = %s",
        (account_id,),
    )



async def takeover_state(conn: AsyncConnection, account_id: UUID) -> tuple[bool, Any, Any]:
    """(found, email_verified_at, google_takeover_at) of the profile; a plain read, no lock."""
    cur = await conn.execute(
        "SELECT email_verified_at, google_takeover_at FROM profiles WHERE account_id = %s", (account_id,)
    )
    row = await cur.fetchone()
    return (False, None, None) if row is None else (True, row[0], row[1])


async def claim_google_takeover(conn: AsyncConnection, account_id: UUID) -> datetime | None:
    """Claim the Account's one Google takeover (AD-19): its `google_takeover_at`, or None when
    the email is verified or another request has claimed it. Commit before the admin call; a
    concurrent claim waits for that commit and then finds it taken."""
    cur = await conn.execute(
        """
        UPDATE profiles
        SET google_takeover_at = now()
        WHERE account_id = %s AND email_verified_at IS NULL AND google_takeover_at IS NULL
        RETURNING google_takeover_at
        """,
        (account_id,),
    )
    row = await cur.fetchone()
    return None if row is None else row[0]


async def release_google_takeover(conn: AsyncConnection, account_id: UUID, claimed_at: datetime) -> None:
    """Undo a claim whose admin call failed, so a later request can take over."""
    await conn.execute(
        "UPDATE profiles SET google_takeover_at = NULL WHERE account_id = %s AND google_takeover_at = %s",
        (account_id, claimed_at),
    )


async def finish_google_takeover(
    conn: AsyncConnection, account_id: UUID, claimed_at: datetime, first_name: str | None
) -> None:
    """After the takeover: the notice is due, Google proved the email, and the first name is
    replaced from Google (kept when Google gives none)."""
    await conn.execute(
        """
        UPDATE profiles
        SET notice_google_takeover = true,
            email_verified_at = COALESCE(email_verified_at, now()),
            first_name = COALESCE(%s, first_name)
        WHERE account_id = %s AND google_takeover_at = %s
        """,
        (first_name, account_id, claimed_at),
    )

async def clear_takeover_notice(conn: AsyncConnection, account_id: UUID) -> None:
    """The one-time takeover notice has been shown."""
    await conn.execute("UPDATE profiles SET notice_google_takeover = false WHERE account_id = %s", (account_id,))
