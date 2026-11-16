"""The `email_verifications` repository (AD-16, AD-19). Plain SQL; takes `conn`, never commits.

Tokens never reach this module: it stores and looks up only their SHA-256 hashes.
"""

from datetime import timedelta
from uuid import UUID

from psycopg import AsyncConnection


async def sent_history(conn: AsyncConnection, account_id: UUID, within: timedelta) -> tuple[int, bool]:
    """How many links the Account has been sent, and whether one was sent within `within`.

    Every stored row is a sent link: a link whose email failed to send is deleted
    (`delete_unsent`). A link stored but never sent (a crash before the send) counts too; it is
    replaced after the gap like any other.
    """
    cur = await conn.execute(
        """
        SELECT count(*), coalesce(bool_or(created_at > now() - %s), false)
        FROM email_verifications
        WHERE account_id = %s
        """,
        (within, account_id),
    )
    count, recent = await cur.fetchone()
    return count, recent


async def delete_unsent(conn: AsyncConnection, token_hash: str) -> None:
    """Remove a link whose email failed to send, so it counts as neither sent nor live."""
    await conn.execute(
        "DELETE FROM email_verifications WHERE token_hash = %s AND used_at IS NULL",
        (token_hash,),
    )


async def used_and_verified(conn: AsyncConnection, token_hash: str) -> bool:
    """Whether the link was already used and its Account is verified (a second click or a mail scanner)."""
    cur = await conn.execute(
        """
        SELECT 1
        FROM email_verifications v
        JOIN profiles p ON p.account_id = v.account_id
        WHERE v.token_hash = %s AND v.used_at IS NOT NULL AND p.email_verified_at IS NOT NULL
        """,
        (token_hash,),
    )
    return await cur.fetchone() is not None


async def invalidate_unused(conn: AsyncConnection, account_id: UUID) -> None:
    """Retire every link of the Account that was neither used nor already replaced."""
    await conn.execute(
        """
        UPDATE email_verifications
        SET invalidated_at = now()
        WHERE account_id = %s AND used_at IS NULL AND invalidated_at IS NULL
        """,
        (account_id,),
    )


async def insert(conn: AsyncConnection, account_id: UUID, token_hash: str, valid_for: timedelta) -> None:
    await conn.execute(
        """
        INSERT INTO email_verifications (account_id, token_hash, expires_at)
        VALUES (%s, %s, now() + %s)
        """,
        (account_id, token_hash, valid_for),
    )


async def consume(conn: AsyncConnection, token_hash: str) -> UUID | None:
    """Mark a live link used and return its Account; None if it is unknown, used, replaced, or expired.

    A system-context lookup by token hash (AD-2): the link carries no bearer token.
    """
    cur = await conn.execute(
        """
        UPDATE email_verifications
        SET used_at = now()
        WHERE token_hash = %s
          AND used_at IS NULL
          AND invalidated_at IS NULL
          AND expires_at > now()
        RETURNING account_id
        """,
        (token_hash,),
    )
    row = await cur.fetchone()
    return row[0] if row else None
