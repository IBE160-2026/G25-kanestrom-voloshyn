"""The only code that calls Supabase Auth over HTTP (AD-2). No `supabase` Python SDK.

One `httpx2.AsyncClient`, created and closed in the lifespan, is kept on `app.state.http`.
Tokens are sent to Supabase but never logged.
"""

import logging
import secrets
import string
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


@dataclass(frozen=True)
class GoogleProfile:
    """What the Google identity data says about the person (FR-19, FR-27). Either may be None."""

    first_name: str | None
    picture_url: str | None


def _text(data: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def same_email(a: str | None, b: str | None) -> bool:
    """Case-insensitive; never true when either is missing."""
    return bool(a) and bool(b) and a.strip().lower() == b.strip().lower()


def _identity_email(identity: dict[str, Any]) -> str | None:
    data = identity.get("identity_data") if isinstance(identity.get("identity_data"), dict) else {}
    email = data.get("email") if isinstance(data.get("email"), str) else identity.get("email")
    return email if isinstance(email, str) and email.strip() else None


def account_email(user: dict[str, Any]) -> str | None:
    """The Account's email: `user.email`, else the email identity's `identity_data.email`, else None."""
    email = user.get("email")
    if isinstance(email, str) and email.strip():
        return email
    for identity in user.get("identities") if isinstance(user.get("identities"), list) else []:
        if isinstance(identity, dict) and identity.get("provider") == "email":
            return _identity_email(identity)
    return None


def google_profile(user: dict[str, Any], email: str | None = None) -> GoogleProfile | None:
    """The first name and picture from the user's `google` identity, or None without one.

    With `email`, the Google identity with that email is preferred; otherwise the first one. The
    first name is `given_name`, else the first word of `full_name` or `name`; the picture is
    `avatar_url`, else `picture` (only an http(s) URL).
    """
    identities = user.get("identities")
    if not isinstance(identities, list):
        return None
    googles = [i for i in identities if isinstance(i, dict) and i.get("provider") == "google"]
    googles.sort(key=lambda identity: not same_email(_identity_email(identity), email))
    for identity in googles:
        data = identity.get("identity_data")
        data = data if isinstance(data, dict) else {}
        first_name = _text(data, "given_name")
        if first_name is None:
            full = _text(data, "full_name", "name")
            first_name = full.split()[0] if full else None
        picture = _text(data, "avatar_url", "picture")
        if picture is not None and not picture.lower().startswith(("https://", "http://")):
            picture = None
        return GoogleProfile(first_name=first_name[:100] if first_name else None, picture_url=picture)
    return None


@dataclass(frozen=True)
class GoogleIdentity:
    identity_id: str
    email: str | None  # from identity_data; None when Google gave none
    email_verified: bool  # identity_data.email_verified is true


def google_identities(user: dict[str, Any]) -> list[GoogleIdentity]:
    """The user's `google` identities with their row id and email."""
    found = []
    for identity in user.get("identities") if isinstance(user.get("identities"), list) else []:
        if not isinstance(identity, dict) or identity.get("provider") != "google":
            continue
        identity_id = identity.get("identity_id")
        if not isinstance(identity_id, str):
            continue
        data = identity.get("identity_data") if isinstance(identity.get("identity_data"), dict) else {}
        found.append(
            GoogleIdentity(
                identity_id=identity_id,
                email=_identity_email(identity),
                email_verified=data.get("email_verified") is True,
            )
        )
    return found


def without_identities(user: dict[str, Any], identity_ids: set[str]) -> dict[str, Any]:
    """A copy of the user object without the given identities (after they were unlinked)."""
    identities = user.get("identities") if isinstance(user.get("identities"), list) else []
    kept = [i for i in identities if not (isinstance(i, dict) and i.get("identity_id") in identity_ids)]
    return {**user, "identities": kept}


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


# The takeover password: 40 characters with every character class (bcrypt allows 72 bytes).
_PASSWORD_LENGTH = 40
_PASSWORD_CLASSES = (string.ascii_lowercase, string.ascii_uppercase, string.digits, string.punctuation)
# Answers to the password update that mean Supabase Auth is set up wrongly (secure_password_change
# on, or a password policy the random password doesn't meet), not that the token is bad.
_CONFIG_ERROR_CODES = frozenset({"reauthentication_needed", "current_password_required", "weak_password"})


def _random_password() -> str:
    rng = secrets.SystemRandom()
    chars = [rng.choice(chars) for chars in _PASSWORD_CLASSES]
    alphabet = "".join(_PASSWORD_CLASSES)
    chars += [rng.choice(alphabet) for _ in range(_PASSWORD_LENGTH - len(chars))]
    rng.shuffle(chars)
    return "".join(chars)


def _error_code(response: httpx2.Response) -> str | None:
    try:
        body = response.json()
    except ValueError:
        return None
    code = body.get("error_code") or body.get("code") if isinstance(body, dict) else None
    return code if isinstance(code, str) else None


def user_token_headers(settings: Settings, token: str) -> dict[str, str]:
    return {"apikey": settings.supabase_publishable_key, "Authorization": f"Bearer {token}"}


async def set_random_password(client: httpx2.AsyncClient, settings: Settings, token: str) -> None:
    """Replace the Account's password with a random one nobody knows (the Google takeover, AD-19).

    The caller's own `PUT /auth/v1/user`, never the admin update: GoTrue's admin password update
    also ends the caller's session, while this one keeps it. Idempotent: a repeat just sets another
    random password. The password is never logged or returned. A 401/403 is `unauthorized`; a
    configuration error (reauthentication or the current password required, a weak-password
    refusal) is logged by code only and, like any other failure, raises `auth_unavailable` (503),
    so the request stops and the next one retries. Never call it inside an open write (AD-18).
    """
    try:
        response = await client.put(
            "/auth/v1/user", headers=user_token_headers(settings, token), json={"password": _random_password()}
        )
    except httpx2.HTTPError as exc:
        logger.warning("Supabase Auth password update failed: %s", type(exc).__name__)
        raise _unavailable(type(exc).__name__) from None
    if response.status_code in (401, 403):
        raise AppError(401, "unauthorized", "The access token is not valid")
    if response.status_code != 200:
        code = _error_code(response)
        if code in _CONFIG_ERROR_CODES:
            logger.error("Supabase Auth configuration error on the takeover password update: %s", code)
        else:
            logger.warning("Supabase Auth answered %s to the password update", response.status_code)
        raise _unavailable(f"HTTP {response.status_code}")


async def unlink_identity(client: httpx2.AsyncClient, settings: Settings, token: str, identity_id: str) -> None:
    """Remove one identity from the caller's Account (a foreign Google identity, AD-19).

    GoTrue has no admin identity delete, so this is the documented `DELETE /auth/v1/user/identities/
    {identity_id}` with the caller's own token (needs `enable_manual_linking`; keeps the session).
    A 401/403 is `unauthorized`; any other failure raises `auth_unavailable` (503), so the request
    stops before any takeover and the next one retries. Never call it inside an open write (AD-18).
    """
    try:
        response = await client.delete(
            f"/auth/v1/user/identities/{identity_id}", headers=user_token_headers(settings, token)
        )
    except httpx2.HTTPError as exc:
        logger.warning("Supabase Auth identity unlink failed: %s", type(exc).__name__)
        raise _unavailable(type(exc).__name__) from None
    if response.status_code in (200, 204):
        return
    code = _error_code(response)
    if code == "manual_linking_disabled":
        logger.error("Supabase Auth configuration error on the identity unlink: %s", code)
        raise _unavailable(f"HTTP {response.status_code}")
    if response.status_code in (401, 403):
        raise AppError(401, "unauthorized", "The access token is not valid")
    logger.warning("Supabase Auth answered %s to the identity unlink (%s)", response.status_code, code)
    raise _unavailable(f"HTTP {response.status_code}")
