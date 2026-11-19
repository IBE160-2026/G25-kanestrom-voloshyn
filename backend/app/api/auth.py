"""Auth routes (AD-1, AD-19).

- `POST /api/auth/after-sign-in`: the SPA calls it after sign-up and after every sign-in. On the
  first call for an email Account it also sends the verification email, after the commit.
- `GET /api/auth/verify?token=`: the emailed link; redirects to the SPA's result screen.
- `POST /api/auth/password-reset`: always the same `202`; the reset email goes out in a detached task.
- `POST /api/auth/after-password-reset`: the SPA calls it after a completed reset; ends every
  other session of the Account.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, StringConstraints

from app.api.conn import Conn
from app.api.me import Me, to_me
from app.auth import UserAuth
from app.services import identity, password_reset, verification

router = APIRouter(prefix="/auth")

FirstName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]

# A light check, as in the SPA: something@something, no spaces. Anything else is 422 invalid_request,
# which reveals nothing about Accounts.
Email = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=3, max_length=254, pattern=r"^[^\s@]+@[^\s@]+$")
]

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
    # With Google linked, the Google first name is the one stored (FR-19); it fills only an unset name.
    google_name = user.google.first_name if user.google else None
    profile = await identity.after_sign_in(conn, user.account_id, google_name or body.first_name, body.language)
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
    return to_me(profile, user)


@router.get("/verify", include_in_schema=False)
async def verify_email(conn: Conn, token: str | None = None) -> RedirectResponse:
    # No bearer token: the link itself is the credential (AD-2 system-context exception).
    verified = await verification.verify(conn, token)
    return RedirectResponse(VERIFIED_URL if verified else EXPIRED_URL, status_code=303)


class PasswordResetRequest(BaseModel):
    email: Email
    # The SPA's language before sign-in; the Account's saved language wins.
    language: Literal["en", "nb"] | None = None


class PasswordResetAccepted(BaseModel):
    status: Literal["accepted"] = "accepted"


@router.post("/password-reset", status_code=202, response_model=PasswordResetAccepted)
async def request_password_reset(body: PasswordResetRequest, request: Request) -> PasswordResetAccepted:
    # No lookup here, and no BackgroundTasks (which would hold the response cycle open longer for
    # existing Accounts): the work runs detached, so every email gets the same reply and timing (FR-3).
    state = request.app.state
    password_reset.start_reset(state.settings, state.pool, state.http, body.email, body.language)
    return PasswordResetAccepted()


@router.post("/after-password-reset", status_code=204)
async def after_password_reset(user: UserAuth, conn: Conn) -> Response:
    await password_reset.end_other_sessions(conn, user.account_id, user.session_id)
    return Response(status_code=204)
