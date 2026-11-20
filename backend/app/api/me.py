"""GET, PATCH, and DELETE /api/me, PATCH /api/me/prefs, the notice routes, and the password check: the
signed-in Account's profile (AD-19), Settings (FR-27), and Account deletion (FR-28)."""

from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictStr, model_validator

from app import supabase_auth
from app.api.conn import Conn
from app.auth import CurrentUser, ReleasedUserAuth, UserAuth
from app.errors import AppError
from app.services import account, identity

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
    # The Account's email, shown in Settings; it can't be changed (FR-27).
    email: str | None
    # How the Account signs in: ["email"], ["google"], or ["email", "google"] (FR-27).
    sign_in_methods: list[Literal["email", "google"]]


class MeUpdate(BaseModel):
    # The interface language (Story 1.4) and/or the first name (Settings, FR-27); nothing else.
    model_config = ConfigDict(extra="forbid")

    language: Literal["en", "nb"] | None = None
    # Trimmed, refused when blank (invalid_name), and cut to 100 characters by the service.
    first_name: Annotated[StrictStr, Field(max_length=1000)] | None = None

    @model_validator(mode="after")
    def _not_empty(self) -> "MeUpdate":
        if self.language is None and self.first_name is None:
            raise ValueError("send language or first_name")
        return self


class PasswordCheck(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: Annotated[StrictStr, Field(min_length=1, max_length=1000)]


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
        email=user.email,
        sign_in_methods=[method for method in ("email", "google") if method in user.providers],
    )


@router.get("/me", response_model=Me)
async def get_me(user: UserAuth, conn: Conn) -> Me:
    return to_me(await identity.get_profile(conn, user.account_id), user)


@router.patch("/me", response_model=Me)
async def patch_me(body: MeUpdate, user: UserAuth, conn: Conn) -> Me:
    # The name goes first: a refused name (name_from_google, invalid_name) writes nothing.
    profile: dict[str, Any] = {}
    if body.first_name is not None:
        profile = await identity.set_first_name(conn, user.account_id, user.providers, body.first_name)
    if body.language is not None:
        profile = await identity.set_language(conn, user.account_id, body.language)
    return to_me(profile, user)


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


@router.post("/me/password/check", status_code=204)
async def check_password(body: PasswordCheck, user: ReleasedUserAuth, request: Request) -> Response:
    """Check the current password before the browser sets a new one with `updateUser` (FR-27).

    `204` when it is right, `400 wrong_password` when not, `409 no_password` for an Account without an
    email identity, `429 too_many_attempts` when Supabase Auth rate-limits the sign-in. The sign-in it makes to check is ended at once; no request connection is held while
    Supabase Auth answers (AD-18). Account bookkeeping, on the AD-22 route-guard allowlist. The password
    is never stored or logged.
    """
    if "email" not in user.providers or not user.email:
        raise AppError(409, "no_password", "The Account has no password")
    state = request.app.state
    if not await supabase_auth.check_password(state.http, state.settings, user.email, body.current_password):
        raise AppError(400, "wrong_password", "That isn't the current password")
    return Response(status_code=204)


@router.delete("/me", status_code=204)
async def delete_me(user: ReleasedUserAuth, request: Request) -> Response:
    """Delete the Account now and for good (FR-28): every Project in any state, its files, Mistakes,
    and generated material, then the auth user (`profiles` and every app table cascade). `503
    auth_unavailable` when the last step fails; a retry works. Account bookkeeping, on the AD-22
    route-guard allowlist; no request connection is held while it waits for running jobs (AD-18).
    """
    state = request.app.state
    await account.delete_account(state.pool, state.storage, state.runner, state.http, state.settings, user.account_id)
    return Response(status_code=204)
