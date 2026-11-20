"""Identity service: profiles after sign-up and sign-in (AD-19). Takes `conn`, never commits (AD-18)."""

import unicodedata
from typing import Any
from uuid import UUID

from psycopg import AsyncConnection

from app.db import profiles
from app.db import projects as project_repo
from app.errors import AppError


async def after_sign_in(
    conn: AsyncConnection,
    account_id: UUID,
    first_name: str | None,
    language: str | None,
    google_created: bool = False,
) -> dict[str, Any]:
    """Fill the first name and language while they are still unset. A repeated call changes nothing.

    `google_created` (a Google identity and no email identity): Google proved the address, so the
    email counts as verified (AD-19), which also rules out a later takeover.
    """
    await profiles.ensure(conn, account_id)
    await profiles.fill_unset(conn, account_id, first_name, language)
    if google_created:
        await profiles.mark_email_verified(conn, account_id)
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
    """Merge interface preferences (Sidebar collapse; Files panel collapse per Project; the theme and
    accent colour from Settings › Appearance) into ui_prefs (AD-19)."""
    await profiles.merge_ui_prefs(conn, account_id, prefs)
    return await get_profile(conn, account_id)


# The profile's first_name column allows at most 100 characters.
FIRST_NAME_MAX_LENGTH = 100


class InvalidFirstName(AppError):
    def __init__(self) -> None:
        super().__init__(422, "invalid_name", "The first name is blank or has control characters")


class NameFromGoogle(AppError):
    def __init__(self) -> None:
        super().__init__(409, "name_from_google", "The name of an Account with a Google identity follows Google")


def clean_first_name(raw: str) -> str:
    """Trim, refuse blank, and cut to 100 characters, as `projects.clean_name` does. Control
    characters (NUL, which Postgres can't store, among them) and lone surrogates are refused."""
    name = raw.strip()
    if not name or any(unicodedata.category(char) in ("Cc", "Cs") for char in name):
        raise InvalidFirstName()
    return name[:FIRST_NAME_MAX_LENGTH].rstrip()


def require_name_editable(providers: frozenset[str]) -> None:
    """A Google-linked Account's name follows Google and is read-only in Settings (FR-27)."""
    if "google" in providers:
        raise NameFromGoogle()


async def set_first_name(
    conn: AsyncConnection, account_id: UUID, providers: frozenset[str], raw: str
) -> dict[str, Any]:
    """Save the first name edited in Settings (FR-27); refused for a Google-linked Account."""
    require_name_editable(providers)
    await profiles.set_first_name(conn, account_id, clean_first_name(raw))
    return await get_profile(conn, account_id)


async def link_google(conn: AsyncConnection, account_id: UUID, google_first_name: str | None) -> dict[str, Any]:
    """After Settings › Link Google account (FR-19, FR-27): a linked Account's name follows Google, so
    the first name is replaced from Google (kept when Google gives none)."""
    if google_first_name:
        await profiles.set_first_name(conn, account_id, google_first_name)
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


async def mark_takeover_notice_seen(conn: AsyncConnection, account_id: UUID) -> dict[str, Any]:
    """The one-time "Your account now signs in with Google." notice was shown (AD-19)."""
    await profiles.clear_takeover_notice(conn, account_id)
    return await get_profile(conn, account_id)
