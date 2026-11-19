"""Identity service: profiles after sign-up and sign-in (AD-19). Takes `conn`, never commits (AD-18)."""

from typing import Any
from uuid import UUID

from psycopg import AsyncConnection

from app.db import profiles
from app.db import projects as project_repo
from app.errors import AppError


async def after_sign_in(
    conn: AsyncConnection, account_id: UUID, first_name: str | None, language: str | None
) -> dict[str, Any]:
    """Fill the first name and language while they are still unset. A repeated call changes nothing."""
    await profiles.ensure(conn, account_id)
    await profiles.fill_unset(conn, account_id, first_name, language)
    return await get_profile(conn, account_id)


async def get_profile(conn: AsyncConnection, account_id: UUID) -> dict[str, Any]:
    """The profile. `last_project_id` is kept only while that Project is active, so login never
    lands on an archived or deleted Project (FR-8)."""
    profile = await profiles.get(conn, account_id)
    if profile is None:
        # user_auth creates the profile first, so this means the Account was just deleted.
        raise AppError(401, "unauthorized", "No profile for this Account")
    if profile["last_project_id"] is not None:
        last = await project_repo.get(conn, account_id, profile["last_project_id"])
        if last is None or last["archived_at"] is not None or last["deleted_at"] is not None:
            profile["last_project_id"] = None
    return profile


async def set_language(conn: AsyncConnection, account_id: UUID, language: str) -> dict[str, Any]:
    """Save the interface language chosen in the Account menu, so it follows the Account (FR-29)."""
    await profiles.set_language(conn, account_id, language)
    return await get_profile(conn, account_id)


async def set_prefs(conn: AsyncConnection, account_id: UUID, prefs: dict[str, Any]) -> dict[str, Any]:
    """Merge interface preferences (Sidebar collapse; Files panel collapse per Project) into ui_prefs (AD-19)."""
    await profiles.merge_ui_prefs(conn, account_id, prefs)
    return await get_profile(conn, account_id)


async def clear_google_takeover_notice(conn: AsyncConnection, account_id: UUID) -> dict[str, Any]:
    """The one-time Google takeover notice has been shown (AD-19). Idempotent."""
    await profiles.clear_google_takeover_notice(conn, account_id)
    return await get_profile(conn, account_id)


class PrivacyNoticeRequired(AppError):
    def __init__(self) -> None:
        super().__init__(403, "privacy_notice_required", "Accept the privacy notice before the first upload")


async def accept_privacy_notice(conn: AsyncConnection, account_id: UUID) -> dict[str, Any]:
    """The Account accepts the one-time Privacy notice (FR-6, §5.3). Idempotent."""
    await profiles.accept_privacy_notice(conn, account_id)
    return await get_profile(conn, account_id)


async def require_privacy_ack(conn: AsyncConnection, account_id: UUID) -> None:
    """Uploads (and later phone links) are refused until the notice is accepted (AD-19)."""
    profile = await profiles.get(conn, account_id)
    if profile is None or profile["privacy_notice_ack_at"] is None:
        raise PrivacyNoticeRequired()
