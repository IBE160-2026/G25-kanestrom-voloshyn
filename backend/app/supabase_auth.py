"""The only code that calls Supabase Auth over HTTP (AD-2). No `supabase` Python SDK.

One `httpx2.AsyncClient`, created and closed in the lifespan, is kept on `app.state.http`.
Tokens are sent to Supabase but never logged.
"""

import logging
from typing import Any

import httpx2

from app.config import Settings
from app.errors import AppError

logger = logging.getLogger(__name__)

# Seconds to wait for Supabase Auth before answering 503 auth_unavailable.
TIMEOUT_SECONDS = 5.0


def create_client(settings: Settings) -> httpx2.AsyncClient:
    return httpx2.AsyncClient(base_url=settings.supabase_url, timeout=TIMEOUT_SECONDS)


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
