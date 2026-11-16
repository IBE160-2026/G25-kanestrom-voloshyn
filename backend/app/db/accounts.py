"""Reads of Supabase's `auth.users` and `auth.identities` for the password-reset request (FR-3).

Plain SQL; takes a `conn`, never commits. Never logs an address.
"""

from typing import Any

from psycopg import AsyncConnection
from psycopg.rows import dict_row


async def find_for_reset(conn: AsyncConnection, email: str) -> dict[str, Any] | None:
    """The Account with this email (case-insensitive), or None.

    Returns `account_id`, `has_email_identity`, and the profile's `first_name` and `language`
    (both None when the Account has no profile yet). SSO users and soft-deleted users are skipped,
    as Supabase Auth does when it looks up an email.
    """
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT u.id AS account_id,
                   EXISTS (
                       SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'email'
                   ) AS has_email_identity,
                   p.first_name,
                   p.language
            FROM auth.users u
            LEFT JOIN profiles p ON p.account_id = u.id
            WHERE lower(u.email) = lower(%s)
              AND u.is_sso_user = false
              AND u.deleted_at IS NULL
            LIMIT 1
            """,
            (email,),
        )
        return await cur.fetchone()
