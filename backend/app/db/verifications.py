"""The `email_verifications` repository (AD-16, AD-19). Plain SQL; takes `conn`, never commits.

Tokens never reach this module: it stores and looks up only their SHA-256 hashes.
"""

from datetime import timedelta
from uuid import UUID

from psycopg import AsyncConnection


async def exists_for(conn: AsyncConnection, account_id: UUID) -> bool:
    """Whether the Account has a link that is still within its 24 h and was not invalidated.

    An expired link doesn't count, so the next sign-in sends a new one (FR-1: resendable until
    verified). That also recovers a link that was stored but never sent (a crash before the send,
    or a failed invalidation after a failed send): at most a day later.
    """
    cur = await conn.execute(
        """
        SELECT 1 FROM email_verifications
        WHERE account_id = %s AND invalidated_at IS NULL AND expires_at > now()
        LIMIT 1
        """,
        (account_id,),
    )
    return await cur.fetchone() is not None


async def invalidate_unused_by_hash(conn: AsyncConnection, token_hash: str) -> None:
    """Retire one link that was never used, e.g. after its email failed to send."""
    await conn.execute(
        """
        UPDATE email_verifications
        SET invalidated_at = now()
        WHERE token_hash = %s AND used_at IS NULL AND invalidated_at IS NULL
        """,
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
