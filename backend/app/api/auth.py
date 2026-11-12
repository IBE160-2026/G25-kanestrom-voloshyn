"""POST /api/auth/after-sign-in: the SPA calls it after sign-up and after every sign-in (AD-1, AD-19)."""

from typing import Annotated, Literal

from fastapi import APIRouter
from pydantic import BaseModel, StringConstraints

from app.api.deps import Conn
from app.api.me import Me, to_me
from app.auth import UserAuth
from app.services import identity

router = APIRouter(prefix="/auth")

FirstName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class AfterSignIn(BaseModel):
    # Optional, so later sign-ins (Story 1.4) can call it without a name; blank is refused.
    first_name: FirstName | None = None
    language: Literal["en", "nb"] | None = None


@router.post("/after-sign-in", response_model=Me)
async def after_sign_in(
    body: AfterSignIn,
    user: UserAuth,
    conn: Conn,
) -> Me:
    profile = await identity.after_sign_in(conn, user.account_id, body.first_name, body.language)
    return to_me(profile)
