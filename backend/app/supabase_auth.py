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


async def set_password(client: httpx2.AsyncClient, settings: Settings, account_id: UUID, password: str) -> None:
    """Set the user's password with admin `PUT /auth/v1/admin/users/{id}` (the Google takeover, AD-19).

    Supabase Auth also ends every session of the user when it sets a password, the caller's
    included (GoTrue v2.197, checked 2026-11-19). A timeout, connection error, or any
    answer but 200 raises `auth_unavailable` (503). The password is never logged.
    """
    try:
        response = await client.put(
            f"/auth/v1/admin/users/{account_id}",
            headers=admin_headers(settings),
            json={"password": password},
        )
    except httpx2.HTTPError as exc:
        logger.warning("Supabase Auth set password failed: %s", type(exc).__name__)
        raise _unavailable(type(exc).__name__) from None
    if response.status_code != 200:
        logger.warning("Supabase Auth answered %s to set password", response.status_code)
        raise _unavailable(f"HTTP {response.status_code}")


async def delete_user(client: httpx2.AsyncClient, settings: Settings, account_id: UUID) -> None:
    """Delete the user with admin `DELETE /auth/v1/admin/users/{id}` (Account deletion, FR-28, AD-19).

    `profiles` and every app table cascade from `auth.users`. A 404 means already deleted and is fine.
    A timeout, connection error, or any other answer but 200/204 raises `auth_unavailable` (503). No
    response body is ever logged.
    """
    try:
        response = await client.delete(f"/auth/v1/admin/users/{account_id}", headers=admin_headers(settings))
    except httpx2.HTTPError as exc:
        logger.warning("Supabase Auth delete user failed: %s", type(exc).__name__)
        raise _unavailable(type(exc).__name__) from None
    if response.status_code == 404:
        return
    if response.status_code not in (200, 204):
        logger.warning("Supabase Auth answered %s to delete user", response.status_code)
        raise _unavailable(f"HTTP {response.status_code}")


async def check_password(client: httpx2.AsyncClient, settings: Settings, email: str, password: str) -> bool:
    """Whether `password` is the Account's current password (Settings › Change password, FR-27).

    Signs in with `POST /auth/v1/token?grant_type=password` and the publishable key. On 200 the
    session this created is ended at once (`POST /auth/v1/logout?scope=local`) and True is returned;
    a 400 `invalid_credentials` returns False; a 429 (Supabase's sign-in rate limit) raises
    `too_many_attempts` (429). A timeout, connection error, or any other answer raises
    `auth_unavailable` (503). A failed logout is logged, not raised: the password was right, and the
    extra session ends with its token's expiry. Neither the password nor a response body is ever logged.
    """
    headers = {"apikey": settings.supabase_publishable_key}
    try:
        response = await client.post(
            "/auth/v1/token",
            params={"grant_type": "password"},
            headers=headers,
            json={"email": email, "password": password},
        )
    except httpx2.HTTPError as exc:
        logger.warning("Supabase Auth password check failed: %s", type(exc).__name__)
        raise _unavailable(type(exc).__name__) from None

    if response.status_code == 400:
        try:
            code = response.json().get("error_code")
        except (ValueError, AttributeError):
            code = None
        if code == "invalid_credentials":
            return False
        logger.warning("Supabase Auth answered 400 (%s) to the password check", code)
        raise _unavailable("HTTP 400")
    if response.status_code == 429:
        logger.warning("Supabase Auth rate-limited the password check")
        raise AppError(429, "too_many_attempts", "Too many password checks; wait and try again")
    if response.status_code != 200:
        logger.warning("Supabase Auth answered %s to the password check", response.status_code)
        raise _unavailable(f"HTTP {response.status_code}")
    try:
        token = response.json()["access_token"]
    except (ValueError, KeyError, TypeError):
        raise _unavailable("no access token") from None
    if not isinstance(token, str) or not token:
        raise _unavailable("no access token")
    await _end_session(client, settings, token)
    return True


async def _end_session(client: httpx2.AsyncClient, settings: Settings, token: str) -> None:
    """End only the session `token` belongs to, as supabase-js `signOut({scope: 'local'})` does.
    A failure is logged (never the token) and swallowed."""
    try:
        response = await client.post(
            "/auth/v1/logout",
            params={"scope": "local"},
            headers={"apikey": settings.supabase_publishable_key, "Authorization": f"Bearer {token}"},
        )
    except httpx2.HTTPError as exc:
        logger.warning("Supabase Auth logout after the password check failed: %s", type(exc).__name__)
        return
    if response.status_code not in (200, 204):
        logger.warning("Supabase Auth answered %s to the logout after the password check", response.status_code)


# The profile's first_name column allows at most 100 characters.
_MAX_FIRST_NAME = 100


@dataclass(frozen=True)
class GoogleProfile:
    """What the Google identity data gives the Account (FR-19, FR-27): first name and picture."""

    first_name: str | None
    picture_url: str | None


def _text(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def google_profile(user: dict[str, Any]) -> GoogleProfile | None:
    """The first name and picture from a Supabase user's Google identity, or None without one.

    The first name is `given_name`, else the first word of `name` (or `full_name`). The picture is
    `picture` (or `avatar_url`), only when it is an https URL; it is linked, never stored.
    """
    identities = user.get("identities")
    if not isinstance(identities, list):
        return None
    for identity in identities:
        if not isinstance(identity, dict) or identity.get("provider") != "google":
            continue
        data = identity.get("identity_data")
        data = data if isinstance(data, dict) else {}
        first_name = _text(data.get("given_name"))
        if first_name is None:
            full = _text(data.get("name")) or _text(data.get("full_name"))
            first_name = full.split()[0] if full else None
        picture = _text(data.get("picture")) or _text(data.get("avatar_url"))
        return GoogleProfile(
            first_name=first_name[:_MAX_FIRST_NAME] if first_name else None,
            picture_url=picture if picture and picture.startswith("https://") else None,
        )
    return None


@dataclass(frozen=True)
class GoogleIdentity:
    """A Supabase user's Google identity: its `identity_id` (what unlinking takes) and its email."""

    identity_id: str | None
    email: str | None


def google_identities(user: dict[str, Any]) -> tuple[GoogleIdentity, ...]:
    """Every Google identity's id and email (the manual-link guard, AD-19); empty without one.

    The email is the identity's `email`, else `identity_data.email`.
    """
    identities = user.get("identities")
    if not isinstance(identities, list):
        return ()
    found = []
    for identity in identities:
        if not isinstance(identity, dict) or identity.get("provider") != "google":
            continue
        data = identity.get("identity_data")
        data = data if isinstance(data, dict) else {}
        found.append(
            GoogleIdentity(
                identity_id=_text(identity.get("identity_id")),
                email=_text(identity.get("email")) or _text(data.get("email")),
            )
        )
    return tuple(found)


async def unlink_identity(client: httpx2.AsyncClient, settings: Settings, token: str, identity_id: str) -> None:
    """Remove one of the user's own identities with `DELETE /auth/v1/user/identities/{id}` and the
    user's token (the manual-link guard, AD-19). A 404 means already gone and is fine. A timeout,
    connection error, or any other answer but 200/204 raises `auth_unavailable` (503). Neither the
    token nor a response body is ever logged."""
    try:
        response = await client.delete(
            f"/auth/v1/user/identities/{identity_id}",
            headers={"apikey": settings.supabase_publishable_key, "Authorization": f"Bearer {token}"},
        )
    except httpx2.HTTPError as exc:
        logger.warning("Supabase Auth unlink identity failed: %s", type(exc).__name__)
        raise _unavailable(type(exc).__name__) from None
    if response.status_code == 404:
        return
    if response.status_code not in (200, 204):
        logger.warning("Supabase Auth answered %s to unlink identity", response.status_code)
        raise _unavailable(f"HTTP {response.status_code}")
