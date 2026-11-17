"""The only code that calls Supabase Auth over HTTP (AD-2). No `supabase` Python SDK.

One `httpx2.AsyncClient`, created and closed in the lifespan, is kept on `app.state.http`.
Tokens are sent to Supabase but never logged.
"""

import logging
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import httpx2

from app.config import Settings
from app.errors import AppError

logger = logging.getLogger(__name__)

# Seconds to wait for Supabase Auth before answering 503 auth_unavailable.
TIMEOUT_SECONDS = 5.0


def create_client(settings: Settings) -> httpx2.AsyncClient:
    return httpx2.AsyncClient(base_url=settings.supabase_url, timeout=TIMEOUT_SECONDS)


def providers(user: dict[str, Any]) -> frozenset[str]:
    """Sign-in providers of a Supabase user's identities, e.g. {"email"} or {"email", "google"}."""
    identities = user.get("identities")
    if not isinstance(identities, list):
        return frozenset()
    return frozenset(
        identity["provider"]
        for identity in identities
        if isinstance(identity, dict) and isinstance(identity.get("provider"), str)
    )


def admin_headers(settings: Settings) -> dict[str, str]:
    """The secret-key headers for Supabase admin calls; `storage.py` uses them for the private bucket."""
    secret = settings.supabase_secret_key.get_secret_value() if settings.supabase_secret_key else ""
    return {"apikey": secret, "Authorization": f"Bearer {secret}"}


def _unavailable(reason: str) -> AppError:
    return AppError(503, "auth_unavailable", f"Supabase Auth is unavailable ({reason})")


async def get_user(client: httpx2.AsyncClient, settings: Settings, token: str) -> dict[str, Any]:
    """Validate an access token with `GET /auth/v1/user` and return Supabase's user object.

    Only a 401 or 403 from Supabase means `unauthorized`. A timeout, connection error, or any
    other answer gives `auth_unavailable` (503), so the SPA keeps its session (AD-2 step 1).
    """
    try:
        response = await client.get(
            "/auth/v1/user",
            headers={
                "apikey": settings.supabase_publishable_key,
                "Authorization": f"Bearer {token}",
            },
        )
    except httpx2.HTTPError as exc:
        logger.warning("Supabase Auth request failed: %s", type(exc).__name__)
        raise _unavailable(type(exc).__name__) from None

    if response.status_code in (401, 403):
        raise AppError(401, "unauthorized", "The access token is not valid")
    if response.status_code != 200:
        logger.warning("Supabase Auth answered %s to the token check", response.status_code)
        raise _unavailable(f"HTTP {response.status_code}")
    try:
        user = response.json()
    except ValueError:
        raise _unavailable("invalid JSON") from None
    if not isinstance(user, dict) or not isinstance(user.get("id"), str):
        raise _unavailable("no user id")
    return user


@dataclass(frozen=True)
class RecoveryLink:
    """What `generate_recovery_link` returns. `hashed_token` is the link credential: never log it."""

    hashed_token: str
    account_id: UUID
    email: str
    providers: frozenset[str]


async def generate_recovery_link(
    client: httpx2.AsyncClient, settings: Settings, email: str
) -> RecoveryLink | None:
    """Create a password-reset token with admin `generate_link` (type recovery). Supabase sends nothing.

    Supabase makes the token valid for `otp_expiry` (1 h), single use, and replaces any older one
    (FR-3). Returns None for an unknown user, and also when Supabase fails or answers unexpectedly:
    the caller is a background task, so failures are logged (never the address) and swallowed.
    """
    try:
        response = await client.post(
            "/auth/v1/admin/generate_link",
            headers=admin_headers(settings),
            json={"type": "recovery", "email": email},
        )
    except httpx2.HTTPError as exc:
        logger.warning("Supabase Auth generate_link failed: %s", type(exc).__name__)
        return None

    if response.status_code == 404:
        return None  # no such user: a silent no-op (FR-3, no enumeration)
    if response.status_code != 200:
        logger.warning("Supabase Auth answered %s to generate_link", response.status_code)
        return None
    try:
        user = response.json()
        link = RecoveryLink(
            hashed_token=user["hashed_token"],
            account_id=UUID(user["id"]),
            email=user["email"],
            providers=providers(user),
        )
    except (ValueError, KeyError, TypeError, AttributeError):
        logger.warning("Supabase Auth generate_link answer is not usable")
        return None
    if not (isinstance(link.hashed_token, str) and link.hashed_token and isinstance(link.email, str) and link.email):
        logger.warning("Supabase Auth generate_link answer is not usable")
        return None
    return link
