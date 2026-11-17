"""GET and PATCH /api/me and PATCH /api/me/prefs: the signed-in Account's profile (AD-19)."""

from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator

from app.api.conn import Conn
from app.auth import UserAuth
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


def to_me(profile: dict[str, Any]) -> Me:
    return Me(
        first_name=profile["first_name"],
        language=profile["language"],
        email_verified=profile["email_verified_at"] is not None,
        ui_prefs=profile["ui_prefs"] or {},
        last_project_id=profile["last_project_id"],
        privacy_notice_accepted=profile["privacy_notice_ack_at"] is not None,
    )


@router.get("/me", response_model=Me)
async def get_me(user: UserAuth, conn: Conn) -> Me:
    return to_me(await identity.get_profile(conn, user.account_id))


@router.patch("/me", response_model=Me)
async def patch_me(body: MeUpdate, user: UserAuth, conn: Conn) -> Me:
    return to_me(await identity.set_language(conn, user.account_id, body.language))


@router.patch("/me/prefs", response_model=Me)
async def patch_prefs(body: PrefsUpdate, user: UserAuth, conn: Conn) -> Me:
    prefs = body.model_dump(mode="json", exclude_none=True)
    return to_me(await identity.set_prefs(conn, user.account_id, prefs))


@router.post("/me/privacy-notice", response_model=Me)
async def accept_privacy_notice(user: UserAuth, conn: Conn) -> Me:
    """Accept the Privacy notice (FR-6, AD-19). Idempotent.

    Account bookkeeping, not a Project content change, so it is on the AD-22 route-guard allowlist.
    """
    return to_me(await identity.accept_privacy_notice(conn, user.account_id))
