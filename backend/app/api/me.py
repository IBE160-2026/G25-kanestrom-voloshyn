"""GET and PATCH /api/me: the signed-in Account's profile (AD-19)."""

from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from app.api.deps import Conn
from app.auth import UserAuth
from app.services import identity

router = APIRouter()


class Me(BaseModel):
    first_name: str | None
    language: str | None
    email_verified: bool


class MeUpdate(BaseModel):
    # Only the interface language for now (Story 1.4); any other field is refused.
    model_config = ConfigDict(extra="forbid")

    language: Literal["en", "nb"]


def to_me(profile: dict[str, Any]) -> Me:
    return Me(
        first_name=profile["first_name"],
        language=profile["language"],
        email_verified=profile["email_verified_at"] is not None,
    )


@router.get("/me", response_model=Me)
async def get_me(user: UserAuth, conn: Conn) -> Me:
    return to_me(await identity.get_profile(conn, user.account_id))


@router.patch("/me", response_model=Me)
async def patch_me(body: MeUpdate, user: UserAuth, conn: Conn) -> Me:
    return to_me(await identity.set_language(conn, user.account_id, body.language))
