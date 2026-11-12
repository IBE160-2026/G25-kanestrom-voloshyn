"""`user_auth`: the only parser of user bearer tokens (AD-2). Story 1.6 adds step 4 (Google takeover)."""

import base64
import binascii
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Request

from app import supabase_auth
from app.api.deps import Conn
from app.db import profiles, sessions
from app.errors import AppError


@dataclass(frozen=True)
class CurrentUser:
    account_id: UUID
    session_id: UUID
    email: str | None


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


async def _validated_token(request: Request) -> _ValidToken:
    """Step 1: Supabase Auth validates the token. No database connection is held during the call."""
    token = _bearer_token(request)
    user = await supabase_auth.get_user(request.app.state.http, request.app.state.settings, token)
    try:
        account_id = UUID(user["id"])
    except ValueError:
        raise _unauthorized("The token has no valid user") from None
    return _ValidToken(account_id=account_id, session_id=_session_id(token), email=user.get("email"))


async def user_auth(
    request: Request,
    # Declared before the connection, so FastAPI resolves it first: the pooled connection is
    # taken only after Supabase Auth has answered (AD-2 step 1, AD-18).
    valid: Annotated[_ValidToken, Depends(_validated_token)],
    conn: Conn,
) -> CurrentUser:
    settings = request.app.state.settings

    # 2. The session must still exist and be younger than SESSION_MAX_AGE_DAYS.
    found, created_at = await sessions.find_created_at(conn, valid.session_id, valid.account_id)
    if not found:
        raise _unauthorized("The session has ended")
    max_age = timedelta(days=settings.session_max_age_days)
    if created_at is None or created_at < datetime.now(UTC) - max_age:
        raise AppError(401, "session_expired", "The session is too old")

    # 3. Every signed-in Account has a profile.
    await profiles.ensure(conn, valid.account_id)

    return CurrentUser(account_id=valid.account_id, session_id=valid.session_id, email=valid.email)


UserAuth = Annotated[CurrentUser, Depends(user_auth)]
