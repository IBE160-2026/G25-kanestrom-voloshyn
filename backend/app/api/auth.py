"""Auth routes (AD-1, AD-19).

- `POST /api/auth/after-sign-in`: the SPA calls it after sign-up and after every sign-in. On the
  first call for an email Account it also sends the verification email, after the commit.
- `GET /api/auth/verify?token=`: the emailed link; redirects to the SPA's result screen.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, StringConstraints

from app.api.deps import Conn
from app.api.me import Me, to_me
from app.auth import UserAuth
from app.services import identity, verification

router = APIRouter(prefix="/auth")

FirstName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]

VERIFIED_URL = "/email-verified"
EXPIRED_URL = "/email-verified?status=expired"


class AfterSignIn(BaseModel):
    # Optional, so later sign-ins (Story 1.4) can call it without a name; blank is refused.
    first_name: FirstName | None = None
    language: Literal["en", "nb"] | None = None


@router.post("/after-sign-in", response_model=Me)
async def after_sign_in(
    body: AfterSignIn,
    user: UserAuth,
    conn: Conn,
    request: Request,
    background: BackgroundTasks,
) -> Me:
    profile = await identity.after_sign_in(conn, user.account_id, body.first_name, body.language)
    # Nothing is issued unless Supabase reported an address to send it to.
    token = None
    if user.email:
        token = await verification.issue_first(conn, user.account_id, "email" in user.providers)
    if token is not None:
        # Background tasks run after the response, so after `conn` has committed (AD-18).
        background.add_task(
            verification.send_verification_email,
            request.app.state.settings,
            request.app.state.pool,
            user.email,
            profile["first_name"],
            profile["language"] or body.language or "en",
            token,
        )
    return to_me(profile)


@router.get("/verify", include_in_schema=False)
async def verify_email(conn: Conn, token: str | None = None) -> RedirectResponse:
    # No bearer token: the link itself is the credential (AD-2 system-context exception).
    verified = await verification.verify(conn, token)
    return RedirectResponse(VERIFIED_URL if verified else EXPIRED_URL, status_code=303)
