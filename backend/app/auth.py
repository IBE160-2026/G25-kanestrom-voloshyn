"""`user_auth`: the only parser of user bearer tokens (AD-2), including step 4, the Google takeover (AD-19)."""

import base64
import binascii
import json
import logging
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any
from uuid import UUID

from fastapi import Depends, Request

from app import supabase_auth
from app.api.conn import Conn
from app.db import profiles, sessions
from app.errors import AppError

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CurrentUser:
    account_id: UUID
    session_id: UUID
    email: str | None
    # Sign-in providers of the Supabase user's identities, e.g. {"email"}, {"email", "google"}.
    providers: frozenset[str] = frozenset()
    # The Google first name and picture while a Google identity is linked (FR-19, FR-27).
    google: supabase_auth.GoogleProfile | None = None


def _unauthorized(message: str) -> AppError:
    return AppError(401, "unauthorized", message)


def _bearer_token(request: Request) -> str:
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token:
        raise _unauthorized("A bearer token is required")
    return token


def _claims(token: str) -> dict[str, Any]:
    """The token's claims. Supabase Auth has already validated the token (step 1)."""
    try:
        payload = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (IndexError, ValueError, TypeError, binascii.Error):
        raise _unauthorized("The token has no session") from None
    if not isinstance(claims, dict):
        raise _unauthorized("The token has no session")
    return claims


def _session_id(claims: dict[str, Any]) -> UUID:
    """Read the `session_id` claim."""
    try:
        return UUID(claims["session_id"])
    except (ValueError, KeyError, TypeError, AttributeError):
        raise _unauthorized("The token has no session") from None


def _sign_in_methods(claims: dict[str, Any]) -> frozenset[str]:
    """The `amr` methods of the token's session, e.g. {"password"} or {"oauth"}."""
    amr = claims.get("amr")
    if not isinstance(amr, list):
        return frozenset()
    return frozenset(
        entry["method"] for entry in amr if isinstance(entry, dict) and isinstance(entry.get("method"), str)
    )


@dataclass(frozen=True)
class _ValidToken:
    account_id: UUID
    session_id: UUID
    email: str | None
    providers: frozenset[str]
    google: supabase_auth.GoogleProfile | None
    # The bearer token itself, for the own-token calls of step 4. Never logged.
    token: str = field(repr=False)
    # How this session signed in (`amr`); the takeover needs "oauth" (AD-19).
    methods: frozenset[str] = frozenset()
    # Supabase's user object, for step 4's identity checks.
    user: dict[str, Any] = field(default_factory=dict, repr=False, compare=False)


async def _validated_token(request: Request) -> _ValidToken:
    """Step 1: Supabase Auth validates the token. No database connection is held during the call."""
    token = _bearer_token(request)
    user = await supabase_auth.get_user(request.app.state.http, request.app.state.settings, token)
    try:
        account_id = UUID(user["id"])
    except ValueError:
        raise _unauthorized("The token has no valid user") from None
    claims = _claims(token)
    return _ValidToken(
        account_id=account_id,
        session_id=_session_id(claims),
        email=user.get("email"),
        providers=supabase_auth.providers(user),
        google=supabase_auth.google_profile(user, supabase_auth.account_email(user)),
        token=token,
        methods=_sign_in_methods(claims),
        user=user,
    )


def _session_error(found: bool, created_at: datetime | None, max_age_days: int) -> AppError | None:
    """Step 2's verdict on a session row: None while it exists and is younger than the max age."""
    if not found:
        return _unauthorized("The session has ended")
    if created_at is None or created_at < datetime.now(UTC) - timedelta(days=max_age_days):
        return AppError(401, "session_expired", "The session is too old")
    return None


async def _google_takeover(
    request: Request, valid: Annotated[_ValidToken, Depends(_validated_token)]
) -> _ValidToken:
    """Step 4 (AD-19): the Google identity check and takeover for an unverified email Account.

    Runs before the request's own connection is taken, on short pool connections of its own, and
    makes every Supabase Auth call with no transaction open (AD-18):
    1. read the state (no write open), and stop for an ended or expired session;
    2. unlink every Google identity whose email isn't the Account's (without an Account email,
       nothing is unlinked and nothing taken over). Only a Google identity with the Account's own
       email and `email_verified` true can take it over;
    3. while the takeover is due, only a Google sign-in (`amr` has "oauth") may run it. Any other
       session of the Account (the old password's) is deleted and refused with
       `google_sign_in_required`; that doesn't count as the takeover;
    4. re-read that it is still due, then set a random password with the caller's own token (it
       keeps the caller's session);
    5. in its own short transaction, end every other session and record the takeover, also
       marking the email verified (Google has proven the address).
    That transaction commits before the route handler runs, so a later rollback can't undo it. If
    a step fails, the next request retries; every step is idempotent. A Google-only Account has no
    `email` identity, so it never gets a password.
    """
    if not {"email", "google"} <= valid.providers:
        return valid
    state = request.app.state
    async with state.pool.connection() as conn:
        found, created_at = await sessions.find_created_at(conn, valid.session_id, valid.account_id)
        error = _session_error(found, created_at, state.settings.session_max_age_days)
        if error is not None:
            raise error
        unverified, taken_over = await profiles.google_state(conn, valid.account_id)
    if not unverified:
        return valid

    email = supabase_auth.account_email(valid.user)
    if email is None:
        return valid  # nothing to compare with: never unlink everything
    googles = supabase_auth.google_identities(valid.user)
    foreign = {g.identity_id for g in googles if not supabase_auth.same_email(g.email, email)}
    for identity_id in foreign:
        await supabase_auth.unlink_identity(state.http, state.settings, valid.token, identity_id)
    if foreign:
        user = supabase_auth.without_identities(valid.user, foreign)
        valid = replace(
            valid, user=user, providers=supabase_auth.providers(user), google=supabase_auth.google_profile(user, email)
        )
    matching = any(g.identity_id not in foreign and g.email_verified for g in googles)
    if taken_over or not matching:
        return valid

    if "oauth" not in valid.methods:
        # The old password's session of an Account Google is taking over: it keeps nothing.
        async with state.pool.connection() as conn:
            async with conn.transaction():
                await sessions.delete_one(conn, valid.account_id, valid.session_id)
        raise AppError(401, "google_sign_in_required", "Sign in with Google to continue")

    # Another request may have finished it meanwhile: then no second password.
    async with state.pool.connection() as conn:
        if not await profiles.takeover_due(conn, valid.account_id):
            return valid
    await supabase_auth.set_random_password(state.http, state.settings, valid.token)

    async with state.pool.connection() as conn:
        async with conn.transaction():
            await profiles.ensure(conn, valid.account_id)
            if await profiles.takeover_due(conn, valid.account_id, lock=True):
                await sessions.delete_others(conn, valid.account_id, valid.session_id)
                await profiles.mark_takeover(conn, valid.account_id)
            else:
                logger.warning("Google takeover lost a race: already recorded")
    return valid


async def user_auth(
    request: Request,
    # Declared before the connection, so FastAPI resolves it first: the pooled connection is
    # taken only after Supabase Auth has answered (AD-2 step 1) and the Google takeover (step 4)
    # has committed on its own connection (AD-18).
    valid: Annotated[_ValidToken, Depends(_google_takeover)],
    conn: Conn,
) -> CurrentUser:
    settings = request.app.state.settings

    # 2. The session must still exist and be younger than SESSION_MAX_AGE_DAYS.
    found, created_at = await sessions.find_created_at(conn, valid.session_id, valid.account_id)
    error = _session_error(found, created_at, settings.session_max_age_days)
    if error is not None:
        raise error

    # 3. Every signed-in Account has a profile.
    await profiles.ensure(conn, valid.account_id)

    return CurrentUser(
        account_id=valid.account_id,
        session_id=valid.session_id,
        email=valid.email,
        providers=valid.providers,
        google=valid.google,
    )


UserAuth = Annotated[CurrentUser, Depends(user_auth)]
