"""Study Materials (FR-6, FR-8, AD-5).

- `POST /api/projects/{project_id}/materials`: upload one file (multipart field `file`); `202
  {material, job_id}`. Requires an active Project (`ActiveProject`).
- `GET /api/projects/{project_id}/materials`: every non-removed Material with its last status.
"""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Request, UploadFile
from pydantic import BaseModel

from app.api.conn import after_commit, on_rollback
from app.api.deps import ActiveProject, Conn
from app.auth import UserAuth
from app.services import materials

router = APIRouter(prefix="/projects/{project_id}/materials")


class Material(BaseModel):
    id: UUID
    file_name: str
    file_type: str
    size_bytes: int
    status: Literal["processing", "ready", "rejected"]
    reject_reason: str | None
    warning: bool
    warning_pages: list[int]
    created_at: datetime


class UploadAccepted(BaseModel):
    material: Material
    job_id: UUID


def to_material(row: dict[str, Any]) -> Material:
    return Material.model_validate(row)


@router.get("", response_model=list[Material])
async def list_materials(project_id: UUID, user: UserAuth, conn: Conn) -> list[Material]:
    return [to_material(row) for row in await materials.list_for_project(conn, user.account_id, project_id)]


@router.post("", status_code=202, response_model=UploadAccepted)
async def upload_material(
    request: Request,
    file: UploadFile,
    project: ActiveProject,
    user: UserAuth,
    conn: Conn,
) -> UploadAccepted:
    # Read at most one byte past the limit: enough to refuse a larger file without holding all of it.
    data = await file.read(materials.MAX_BYTES + 1)
    material, job = await materials.upload(
        conn,
        request.app.state.storage,
        user.account_id,
        project["id"],
        file.filename,
        data,
        lambda callback: on_rollback(request, callback),
    )
    # Started right after the commit, so the runner sees the job row; it doesn't depend on the
    # response being delivered (AD-20).
    runner = request.app.state.runner
    after_commit(request, lambda: runner.submit(job, data))
    return UploadAccepted(material=to_material(material), job_id=job["id"])
