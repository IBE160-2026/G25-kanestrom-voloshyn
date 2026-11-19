"""Phone upload (FR-21, AD-24).

The computer, signed in (`user_auth`):
- `POST /api/projects/{project_id}/phone-links`: a new link for an active Project, after the Privacy
  notice (`privacy_notice_required`); `201 {link_id, token, expires_at}`. The token is shown only here.
- `DELETE /api/projects/{project_id}/phone-links/{link_id}`: revoke it when the QR dialog closes;
  `204`. Bookkeeping, so it has no read-only guard (AD-22). The link's open batches are discarded:
  their units come back and their staged photos are deleted.

The phone, with the link's token in the path (`phone_link_auth`; anything unusable is `410 link_expired`):
- `GET /api/phone/{token}`: only `{project_name, images_left_today, slot_available, expires_at}`.
- `POST /api/phone/{token}/revoke`: the `navigator.sendBeacon` fallback for the computer's revoke; `204`.
- `POST /api/phone/{token}/batches`: a new batch; `201 {batch_id}`.
- `POST /api/phone/{token}/batches/{batch_id}/photos`: one photo (multipart field `file`, jpg/png/heic,
  at most 50 MB); `201 {page}`. Refused on its own: `unsupported_file_type`, `file_too_large`,
  `quota_exceeded`.
- `POST /api/phone/{token}/batches/{batch_id}/finalize`: allowed until 10 minutes after expiry; `202
  {pages}`. No photo: `422 insufficient_material`. A full Project: `409 material_limit_reached`, the
  staged photos deleted and their units released.
"""

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.api.conn import after_commit, on_rollback
from app.api.deps import ActiveProject, Conn
from app.auth import PhoneLinkAuth, PhoneLinkFinalizeAuth, UserAuth
from app.errors import error_response
from app.services import materials, phone

links = APIRouter(prefix="/projects/{project_id}/phone-links")
router = APIRouter(prefix="/phone/{token}")


class PhoneLinkCreated(BaseModel):
    link_id: UUID
    token: str
    expires_at: datetime


class PhoneStatus(BaseModel):
    project_name: str | None
    images_left_today: int
    slot_available: bool
    expires_at: datetime


class BatchCreated(BaseModel):
    batch_id: UUID


class PhotoAccepted(BaseModel):
    # 1-based page number among the batch's accepted photos.
    page: int


class BatchFinalized(BaseModel):
    pages: int


@links.post("", status_code=201, response_model=PhoneLinkCreated)
async def create_link(request: Request, project: ActiveProject, user: UserAuth, conn: Conn) -> PhoneLinkCreated:
    link, token = await phone.create_link(
        conn, user.account_id, project["id"], request.app.state.settings.phone_link_ttl_seconds
    )
    return PhoneLinkCreated(link_id=link["id"], token=token, expires_at=link["expires_at"])


@links.delete("/{link_id}", status_code=204, response_class=Response)
async def revoke_link(request: Request, project_id: UUID, link_id: UUID, user: UserAuth, conn: Conn) -> Response:
    delete_photos = await phone.revoke_link(conn, request.app.state.storage, user.account_id, project_id, link_id)
    after_commit(request, delete_photos)
    return Response(status_code=204)


@router.get("", response_model=PhoneStatus)
async def phone_status(link: PhoneLinkAuth, conn: Conn) -> PhoneStatus:
    return PhoneStatus.model_validate(await phone.status(conn, link))


@router.post("/revoke", status_code=204, response_class=Response)
async def revoke_by_beacon(request: Request, link: PhoneLinkAuth, conn: Conn) -> Response:
    after_commit(request, await phone.revoke_by_token(conn, request.app.state.storage, link))
    return Response(status_code=204)


@router.post("/batches", status_code=201, response_model=BatchCreated)
async def create_batch(link: PhoneLinkAuth, conn: Conn) -> BatchCreated:
    batch = await phone.create_batch(conn, link)
    return BatchCreated(batch_id=batch["id"])


@router.post("/batches/{batch_id}/photos", status_code=201, response_model=PhotoAccepted)
async def add_photo(
    request: Request, batch_id: UUID, file: UploadFile, link: PhoneLinkAuth, conn: Conn
) -> PhotoAccepted:
    # Read at most one byte past the limit: enough to refuse a larger photo without holding all of it.
    data = await file.read(materials.MAX_BYTES + 1)
    photo = await phone.add_photo(
        conn,
        request.app.state.storage,
        request.app.state.pool,
        link,
        batch_id,
        file.filename,
        data,
        lambda callback: on_rollback(request, callback),
    )
    return PhotoAccepted(page=photo["position"] + 1)


@router.post("/batches/{batch_id}/finalize", status_code=202, response_model=BatchFinalized)
async def finalize(
    request: Request, batch_id: UUID, link: PhoneLinkFinalizeAuth, conn: Conn
) -> BatchFinalized | JSONResponse:
    done = await phone.finalize(conn, request.app.state.storage, link, batch_id)
    if done.after_commit is not None:
        after_commit(request, done.after_commit)
    if done.refusal is not None:
        # The discard (units released, batch deleted) commits with this answer.
        refusal = done.refusal
        return error_response(refusal.status, refusal.code, refusal.message, refusal.params)
    # Started right after the commit, so the runner sees the job row (AD-20).
    runner = request.app.state.runner
    job = done.job
    after_commit(request, lambda: runner.submit(job))
    return BatchFinalized(pages=done.pages)
