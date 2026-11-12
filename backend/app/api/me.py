"""GET /api/me: the signed-in Account's profile (AD-19)."""

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.deps import Conn
from app.auth import UserAuth
from app.services import identity

router = APIRouter()


class Me(BaseModel):
    first_name: str | None
    language: str | None
    email_verified: bool


def to_me(profile: dict[str, Any]) -> Me:
    return Me(
        first_name=profile["first_name"],
        language=profile["language"],
        email_verified=profile["email_verified_at"] is not None,
    )


@router.get("/me", response_model=Me)
async def get_me(user: UserAuth, conn: Conn) -> Me:
    return to_me(await identity.get_profile(conn, user.account_id))
