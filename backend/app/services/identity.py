"""Identity service: profiles after sign-up and sign-in (AD-19). Takes `conn`, never commits (AD-18)."""

from typing import Any
from uuid import UUID

from psycopg import AsyncConnection

from app.db import profiles
from app.errors import AppError


async def after_sign_in(
    conn: AsyncConnection, account_id: UUID, first_name: str | None, language: str | None
) -> dict[str, Any]:
    """Fill the first name and language while they are still unset. A repeated call changes nothing."""
    await profiles.ensure(conn, account_id)
    await profiles.fill_unset(conn, account_id, first_name, language)
    return await get_profile(conn, account_id)


async def get_profile(conn: AsyncConnection, account_id: UUID) -> dict[str, Any]:
    profile = await profiles.get(conn, account_id)
    if profile is None:
        # user_auth creates the profile first, so this means the Account was just deleted.
        raise AppError(401, "unauthorized", "No profile for this Account")
    return profile
