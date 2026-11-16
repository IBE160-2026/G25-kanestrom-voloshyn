"""Email verification (FR-1, AD-19): single-use links valid 24 h, and the first verification email.

Takes `conn` and never commits (AD-18). Tokens are stored only as SHA-256 hashes and are never
logged; neither are email addresses.
"""

import hashlib
import logging
import secrets
from datetime import timedelta
from uuid import UUID

from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

from app import mailer
from app.config import Settings
from app.db import profiles, verifications

logger = logging.getLogger(__name__)

TOKEN_BYTES = 32
VALID_FOR = timedelta(hours=24)
# Automatic emails on sign-in (FR-1, resendable until verified) without nagging: at least a week
# apart, at most three in all (decided by Cristoffer, 2026-11-16). Story 7.3's resend is not limited.
REMINDER_GAP = timedelta(days=7)
MAX_AUTOMATIC_EMAILS = 3
# Longer input can't be a token; it is refused without hashing.
_MAX_TOKEN_LENGTH = 256


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def issue(conn: AsyncConnection, account_id: UUID) -> str:
    """Issue a new link token for the Account and invalidate every older unused one.

    Returns the token; only its hash is stored. Story 7.3's resend reuses this.
    """
    await verifications.invalidate_unused(conn, account_id)
    token = secrets.token_urlsafe(TOKEN_BYTES)
    await verifications.insert(conn, account_id, hash_token(token), VALID_FOR)
    return token


async def issue_first(conn: AsyncConnection, account_id: UUID, has_email_identity: bool) -> str | None:
    """Issue the token for an automatic verification email on sign-in, or None when none is due.

    Due only when the Account has an email identity, its email isn't verified, fewer than
    MAX_AUTOMATIC_EMAILS links have been sent, and none within REMINDER_GAP. So the first sign-in
    sends the first email, and a later sign-in sends a reminder at most once a week, three emails
    in all. A link whose email failed to send is deleted, so the next sign-in tries again. The
    profile row is locked, so concurrent calls issue at most one token.
    """
    if not has_email_identity:
        return None
    found, verified_at = await profiles.lock_email_verified_at(conn, account_id)
    if not found or verified_at is not None:
        return None
    sent, recent = await verifications.sent_history(conn, account_id, REMINDER_GAP)
    if sent >= MAX_AUTOMATIC_EMAILS or recent:
        return None
    return await issue(conn, account_id)


async def verify(conn: AsyncConnection, token: str | None) -> bool:
    """Use a link token: mark it used and set `email_verified_at` in the caller's transaction.

    True also for an already used token whose Account is verified (second click, mail scanner).
    False for a missing, malformed, unknown, replaced, or expired token, or a used one of an
    unverified Account.
    """
    if not token or len(token) > _MAX_TOKEN_LENGTH:
        return False
    token_hash = hash_token(token)
    account_id = await verifications.consume(conn, token_hash)
    if account_id is None:
        return await verifications.used_and_verified(conn, token_hash)
    await profiles.mark_email_verified(conn, account_id)
    return True


def verify_link(settings: Settings, token: str) -> str:
    # token_urlsafe output needs no further encoding.
    return f"{settings.app_public_url.rstrip('/')}/api/auth/verify?token={token}"


async def send_verification_email(
    settings: Settings,
    pool: AsyncConnectionPool,
    to: str,
    first_name: str | None,
    language: str | None,
    token: str,
) -> None:
    """Email the verification link. Runs after the commit (AD-18); a failure is logged, never raised.

    After a failed send the link is deleted in its own short transaction, so it doesn't count as
    sent and the next `after-sign-in` issues and sends a fresh one.
    """
    subject, body = mailer.verification_email(language, first_name, verify_link(settings, token))
    try:
        await mailer.send(settings, to, subject, body)
        return
    except Exception as exc:  # noqa: BLE001 -- a send failure must never change the response
        # Only the exception type: SMTP errors can echo the recipient address.
        logger.warning("Verification email could not be sent: %s", type(exc).__name__)
    try:
        async with pool.connection() as conn:
            async with conn.transaction():
                await verifications.delete_unsent(conn, hash_token(token))
    except Exception as exc:  # noqa: BLE001
        # The link then counts as sent; the next reminder comes after REMINDER_GAP.
        logger.warning("Unsent verification link could not be removed: %s", type(exc).__name__)
