"""GET and PATCH /api/me, PATCH /api/me/prefs, and the notice routes: the signed-in Account's profile (AD-19)."""

from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator

from app.api.conn import Conn
from app.auth import CurrentUser, UserAuth
from app.services import identity

router = APIRouter()


class Me(BaseModel):
    first_name: str | None
    language: str | None
    email_verified: bool
    # Interface state saved to the Account, e.g. {"sidebar_collapsed": true}.
    ui_prefs: dict[str, Any]
    # Where login lands; only set while that Project is active (FR-8).
    last_project_id: UUID | None
    # The one-time Privacy notice before the first upload has been accepted (FR-6, AD-19).
    privacy_notice_accepted: bool
    # Show "Your account now signs in with Google." once, then POST .../google-takeover/seen (AD-19).
    notice_google_takeover: bool
    # The Google profile picture for the Avatar, linked from the Google identity, never stored (FR-27).
    picture_url: str | None


class MeUpdate(BaseModel):
    # Only the interface language for now (Story 1.4); any other field is refused.
    model_config = ConfigDict(extra="forbid")

    language: Literal["en", "nb"]


class PrefsUpdate(BaseModel):
    # Merged into ui_prefs. Either key may be sent alone; files_collapsed is merged per Project.
    model_config = ConfigDict(extra="forbid")

    sidebar_collapsed: StrictBool | None = None
    # {project_id: collapsed} for the Files panel (EXPERIENCE.md › Files strip); a few at a time.
    files_collapsed: Annotated[dict[UUID, StrictBool], Field(min_length=1, max_length=20)] | None = None

    @model_validator(mode="after")
    def _not_empty(self) -> "PrefsUpdate":
        if self.sidebar_collapsed is None and self.files_collapsed is None:
            raise ValueError("send sidebar_collapsed or files_collapsed")
        return self


def to_me(profile: dict[str, Any], user: CurrentUser) -> Me:
    return Me(
        first_name=profile["first_name"],
        language=profile["language"],
        email_verified=profile["email_verified_at"] is not None,
        ui_prefs=profile["ui_prefs"] or {},
        last_project_id=profile["last_project_id"],
        privacy_notice_accepted=profile["privacy_notice_ack_at"] is not None,
        notice_google_takeover=profile["notice_google_takeover"],
        picture_url=user.google_picture_url,
    )


@router.get("/me", response_model=Me)
async def get_me(user: UserAuth, conn: Conn) -> Me:
    return to_me(await identity.get_profile(conn, user.account_id), user)


@router.patch("/me", response_model=Me)
async def patch_me(body: MeUpdate, user: UserAuth, conn: Conn) -> Me:
    return to_me(await identity.set_language(conn, user.account_id, body.language), user)


@router.patch("/me/prefs", response_model=Me)
async def patch_prefs(body: PrefsUpdate, user: UserAuth, conn: Conn) -> Me:
    prefs = body.model_dump(mode="json", exclude_none=True)
    return to_me(await identity.set_prefs(conn, user.account_id, prefs), user)


@router.post("/me/privacy-notice", response_model=Me)
async def accept_privacy_notice(user: UserAuth, conn: Conn) -> Me:
    """Accept the Privacy notice (FR-6, AD-19). Idempotent.

    Account bookkeeping, not a Project content change, so it is on the AD-22 route-guard allowlist.
    """
    return to_me(await identity.accept_privacy_notice(conn, user.account_id), user)


@router.post("/me/notices/google-takeover/seen", response_model=Me)
async def google_takeover_notice_seen(user: UserAuth, conn: Conn) -> Me:
    """The one-time Google takeover notice was shown; it isn't shown again (AD-19). Idempotent.

    Account bookkeeping, not a Project content change, so it is on the AD-22 route-guard allowlist.
    """
    return to_me(await identity.mark_takeover_notice_seen(conn, user.account_id), user)
