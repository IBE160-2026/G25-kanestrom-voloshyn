"""The two auth dependencies (AD-2): `user_auth`, the only parser of user bearer tokens, with the Google
takeover as step 4 (AD-19); and `phone_link_auth`, the only parser of phone-link tokens (AD-24)."""

import base64
import binascii
import json
import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any
from uuid import UUID

from fastapi import Depends, Request
from psycopg import AsyncConnection

from app import supabase_auth
from app.api.conn import Conn
from app.config import Settings
from app.db import profiles, sessions
from app.errors import AppError
from app.services import phone


@dataclass(frozen=True)
class CurrentUser:
    account_id: UUID
    session_id: UUID
    email: str | None
    # Sign-in providers of the Supabase user's identities, e.g. {"email"}, {"email", "google"}.
    providers: frozenset[str] = frozenset()
    # From the Google identity data, when the Account has one (FR-19, FR-27).
    google_first_name: str | None = None
    google_picture_url: str | None = None


def _unauthorized(message: str) -> AppError:
    return AppError(401, "unauthorized", message)


def _bearer_token(request: Request) -> str:
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token:
        raise _unauthorized("A bearer token is required")
    return token


def _session_id(token: str) -> UUID:
    """Read the `session_id` claim. Supabase Auth has already validated the token (step 1)."""
    try:
        payload = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        return UUID(claims["session_id"])
    except (IndexError, ValueError, KeyError, TypeError, binascii.Error):
        raise _unauthorized("The token has no session") from None


@dataclass(frozen=True)
class _ValidToken:
    account_id: UUID
    session_id: UUID
    email: str | None
    providers: frozenset[str]
    google: supabase_auth.GoogleProfile | None


async def _validated_token(request: Request) -> _ValidToken:
    """Step 1: Supabase Auth validates the token. No database connection is held during the call."""
    token = _bearer_token(request)
    user = await supabase_auth.get_user(request.app.state.http, request.app.state.settings, token)
    try:
        account_id = UUID(user["id"])
    except ValueError:
        raise _unauthorized("The token has no valid user") from None
    return _ValidToken(
        account_id=account_id,
        session_id=_session_id(token),
        email=user.get("email"),
        providers=supabase_auth.providers(user),
        google=supabase_auth.google_profile(user),
    )


async def _check_session(conn: AsyncConnection, settings: Settings, valid: _ValidToken) -> None:
    """Step 2: the session must still exist and be younger than SESSION_MAX_AGE_DAYS."""
    found, created_at = await sessions.find_created_at(conn, valid.session_id, valid.account_id)
    if not found:
        raise _unauthorized("The session has ended")
    max_age = timedelta(days=settings.session_max_age_days)
    if created_at is None or created_at < datetime.now(UTC) - max_age:
        raise AppError(401, "session_expired", "The session is too old")


# The random password a takeover sets: nobody knows it, so the old password stops working.
_TAKEOVER_PASSWORD_BYTES = 48


def _needs_takeover(valid: _ValidToken, found: bool, verified_at: Any, takeover_at: Any) -> bool:
    """Step 4's gate: an email and a Google identity, and a profile that is missing or neither
    verified nor taken over. Settled Accounts pay only the one read that decides this."""
    return {"email", "google"} <= valid.providers and (not found or (verified_at is None and takeover_at is None))


async def _google_takeover(request: Request, valid: _ValidToken) -> None:
    """Step 4: take over an unverified email Account that a Google identity has joined (AD-19).

    Each write runs in its own short transaction on its own pooled connection, and the admin call
    runs with none open (AD-18):
    1. claim with the conditional UPDATE and commit (a concurrent request finds it taken and goes on);
    2. set a random password through the admin API; Supabase Auth then ends every session of the
       Account, the caller's included; on failure release the claim and answer 503 auth_unavailable;
    3. end every session ourselves too, set the notice, mark the email verified (Google proved it),
       and replace the first name from Google;
    4. answer 401 google_takeover: the student signs in with Google again and sees the notice.
    """
    state = request.app.state
    account_id = valid.account_id
    async with state.pool.connection() as conn:
        async with conn.transaction():
            await profiles.ensure(conn, account_id)
            claimed_at = await profiles.claim_google_takeover(conn, account_id)
    if claimed_at is None:
        return
    try:
        await supabase_auth.set_password(
            state.http, state.settings, account_id, secrets.token_urlsafe(_TAKEOVER_PASSWORD_BYTES)
        )
    except BaseException:
        async with state.pool.connection() as conn:
            async with conn.transaction():
                await profiles.release_google_takeover(conn, account_id, claimed_at)
        raise
    async with state.pool.connection() as conn:
        async with conn.transaction():
            await sessions.delete_all(conn, account_id)
            first_name = valid.google.first_name if valid.google else None
            await profiles.finish_google_takeover(conn, account_id, claimed_at, first_name)
    raise AppError(401, "google_takeover", "The account now signs in with Google; sign in again")


async def user_auth(
    request: Request,
    # Declared before the connection, so FastAPI resolves it first: the pooled connection is
    # taken only after Supabase Auth has answered (AD-2 step 1, AD-18).
    valid: Annotated[_ValidToken, Depends(_validated_token)],
    conn: Conn,
) -> CurrentUser:
    # 2. The session must still exist and be young enough.
    await _check_session(conn, request.app.state.settings, valid)

    # 4. The Google takeover, decided by a plain read before step 3 writes anything, so this
    # transaction holds no lock the takeover's own transactions would wait for.
    if {"email", "google"} <= valid.providers:
        found, verified_at, takeover_at = await profiles.takeover_state(conn, valid.account_id)
        if _needs_takeover(valid, found, verified_at, takeover_at):
            await _google_takeover(request, valid)

    # 3. Every signed-in Account has a profile.
    await profiles.ensure(conn, valid.account_id)

    return CurrentUser(
        account_id=valid.account_id,
        session_id=valid.session_id,
        email=valid.email,
        providers=valid.providers,
        google_first_name=valid.google.first_name if valid.google else None,
        google_picture_url=valid.google.picture_url if valid.google else None,
    )


UserAuth = Annotated[CurrentUser, Depends(user_auth)]


# --- The phone link (AD-2, AD-24) ---

# A phone token is `secrets.token_urlsafe(32)`: 43 URL-safe characters. Anything far off that shape is
# refused before the database is asked.
_PHONE_TOKEN = re.compile(r"^[A-Za-z0-9_-]{16,128}$")


async def _phone_link(token: str, conn: AsyncConnection, grace_seconds: int) -> phone.PhoneLink:
    if not _PHONE_TOKEN.fullmatch(token):
        raise phone.LinkExpired()
    return await phone.find_link(conn, token, grace_seconds)


async def phone_link_auth(token: str, conn: Conn) -> phone.PhoneLink:
    """The phone link (AD-24), only for routes under `/api/phone/{token}`: hashes the token and accepts
    only a link that is neither revoked nor expired, whose Project is still active. Anything else is
    `410 link_expired`. Never logs the token."""
    return await _phone_link(token, conn, 0)


async def phone_link_finalize_auth(token: str, conn: Conn) -> phone.PhoneLink:
    """`phone_link_auth` for finalize, which is still allowed until 10 minutes after expiry (AD-24)."""
    return await _phone_link(token, conn, phone.FINALIZE_GRACE_SECONDS)


PhoneLinkAuth = Annotated[phone.PhoneLink, Depends(phone_link_auth)]
PhoneLinkFinalizeAuth = Annotated[phone.PhoneLink, Depends(phone_link_finalize_auth)]
