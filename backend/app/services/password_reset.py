"""Password reset (FR-3, AD-19): the emailed reset link, and ending other sessions after a reset.

The request runs entirely in a detached task started before the identical `202` is returned, so
neither the reply nor the response cycle depends on whether the Account exists. At most one reset
email per address every 60 s (in-process cooldown, Ihor 2026-11-16). Supabase makes and checks the token (admin
`generate_link`, type recovery: 1 h, single use, a newer one replaces older ones); this app only
emails the link. Never logs an address, token, or link.
"""

import asyncio
import hashlib
import logging
import time
from uuid import UUID

import httpx2
from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

from app import mailer, supabase_auth
from app.config import Settings
from app.db import accounts, sessions

logger = logging.getLogger(__name__)

COOLDOWN_SECONDS = 60.0
# Clock for the cooldown; tests patch it.
_now = time.monotonic
# sha256(lower-cased address) -> monotonic time of the last accepted request. Never the address.
_last_request: dict[str, float] = {}
# Strong references to running reset tasks, so they aren't garbage-collected mid-flight.
_tasks: set[asyncio.Task] = set()


def _cooling_down(email: str) -> bool:
    """True when this address had a request in the last 60 s; otherwise records this one."""
    now = _now()
    for key, at in list(_last_request.items()):
        if now - at >= COOLDOWN_SECONDS:
            del _last_request[key]
    key = hashlib.sha256(email.encode("utf-8")).hexdigest()
    if key in _last_request:
        return True
    _last_request[key] = now
    return False


def start_reset(
    settings: Settings,
    pool: AsyncConnectionPool,
    http: httpx2.AsyncClient,
    email: str,
    language: str | None,
) -> None:
    """Start the reset work detached from the response; returns at once, the same way for every email."""
    email = email.lower()
    if _cooling_down(email):
        return
    task = asyncio.create_task(_send_reset_email_safely(settings, pool, http, email, language))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def drain(timeout: float = 10.0) -> None:
    """Wait (up to `timeout` s) for running reset tasks, e.g. at shutdown, before the pool closes."""
    if _tasks:
        await asyncio.wait(list(_tasks), timeout=timeout)


async def _send_reset_email_safely(*args) -> None:
    try:
        await send_reset_email(*args)
    except Exception as exc:  # noqa: BLE001 -- a detached task must never raise
        logger.warning("Password reset failed: %s", type(exc).__name__)


def reset_link(settings: Settings, hashed_token: str) -> str:
    # The SPA's page verifies the token from JavaScript, so a mail scanner fetching the URL
    # can't use it up. Supabase's hashed_token is hex: no further encoding needed.
    return f"{settings.app_public_url.rstrip('/')}/reset-password?token_hash={hashed_token}"


async def send_reset_email(
    settings: Settings,
    pool: AsyncConnectionPool,
    http: httpx2.AsyncClient,
    email: str,
    language: str | None,
) -> None:
    """Email a reset link when `email` belongs to an Account with an email identity; else do nothing.

    Runs detached from the response (`start_reset`); every failure is logged and swallowed.
    Order: lookup -> identity check -> link -> language -> send. No transaction is open during the
    admin call or the SMTP send (AD-18).
    """
    try:
        async with pool.connection() as conn:
            account = await accounts.find_for_reset(conn, email)
    except Exception as exc:  # noqa: BLE001 -- a background task must never raise
        logger.warning("Password reset lookup failed: %s", type(exc).__name__)
        return
    # Unknown email or a Google-only Account: nothing is sent. Unverified Accounts are treated
    # the same as verified ones.
    if account is None or not account["has_email_identity"]:
        return

    link = await supabase_auth.generate_recovery_link(http, settings, email)
    if link is None or link.account_id != account["account_id"] or "email" not in link.providers:
        return

    subject, body = mailer.password_reset_email(
        account["language"] or language or "en",
        account["first_name"],
        reset_link(settings, link.hashed_token),
    )
    try:
        await mailer.send(settings, link.email, subject, body)
    except Exception as exc:  # noqa: BLE001 -- a send failure is logged only
        # Only the exception type: SMTP errors can echo the recipient address.
        logger.warning("Password reset email could not be sent: %s", type(exc).__name__)


async def end_other_sessions(conn: AsyncConnection, account_id: UUID, keep_session_id: UUID) -> int:
    """After a completed reset, end every session of the Account but the caller's (FR-3, AD-19)."""
    return await sessions.delete_others(conn, account_id, keep_session_id)
