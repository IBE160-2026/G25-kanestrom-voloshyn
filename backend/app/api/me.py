"""GET and PATCH /api/me and PATCH /api/me/prefs: the signed-in Account's profile (AD-19)."""

from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

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


class MeUpdate(BaseModel):
    # Only the interface language for now (Story 1.4); any other field is refused.
    model_config = ConfigDict(extra="forbid")

    language: Literal["en", "nb"]


class PrefsUpdate(BaseModel):
    # Merged into ui_prefs; the Files panel's per-Project collapse joins it in a later story.
    model_config = ConfigDict(extra="forbid")

    sidebar_collapsed: bool


def to_me(profile: dict[str, Any]) -> Me:
    return Me(
        first_name=profile["first_name"],
        language=profile["language"],
        email_verified=profile["email_verified_at"] is not None,
        ui_prefs=profile["ui_prefs"] or {},
        last_project_id=profile["last_project_id"],
    )


@router.get("/me", response_model=Me)
async def get_me(user: UserAuth, conn: Conn) -> Me:
    return to_me(await identity.get_profile(conn, user.account_id))


@router.patch("/me", response_model=Me)
async def patch_me(body: MeUpdate, user: UserAuth, conn: Conn) -> Me:
    return to_me(await identity.set_language(conn, user.account_id, body.language))


@router.patch("/me/prefs", response_model=Me)
async def patch_prefs(body: PrefsUpdate, user: UserAuth, conn: Conn) -> Me:
    return to_me(await identity.set_prefs(conn, user.account_id, body.model_dump()))
