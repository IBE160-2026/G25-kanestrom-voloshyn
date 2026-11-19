"""Projects (FR-4, FR-5, FR-8, AD-14, AD-22).

- `GET /api/projects`: every Project of the Account, newest first.
- `POST /api/projects`: a new Project with no name (`201`).
- `GET /api/projects/{project_id}`: opens the Project, which becomes the one login lands on.
- `PATCH /api/projects/{project_id}`: rename; requires an active Project (`ActiveProject`).
- `POST /api/projects/{project_id}/archive`, `/delete`, and `/restore` (FR-23, FR-24): idempotent
  bookkeeping, so no `ActiveProject`; each returns the Project. Archive and delete revoke the Project's
  phone links; delete also cancels its jobs. Restore clears both `archived_at` and `deleted_at`.
  A deleted Project carries `purge_at`, 30 days after `deleted_at`.
- `POST /api/projects/{project_id}/purge` ("Delete forever", FR-24): bookkeeping, so no `ActiveProject`;
  only a deleted Project (`409 project_not_deleted`), then it and everything in it is gone (`204`). Runs
  its own short transactions through the pool; no request `Conn` is held (AD-18).
"""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, ConfigDict

from app.api.conn import after_commit
from app.api.deps import ActiveProject, Conn
from app.auth import ReleasedUserAuth, UserAuth
from app.services import projects

router = APIRouter(prefix="/projects")


class Project(BaseModel):
    id: UUID
    name: str | None
    name_source: Literal["auto", "student"] | None
    archived_at: datetime | None
    deleted_at: datetime | None
    # When a deleted Project is permanently deleted (FR-24); null unless deleted.
    purge_at: datetime | None
    created_at: datetime


class ProjectUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Trimmed, refused when blank (invalid_name), and cut to 100 characters by the service.
    name: str


def to_project(row: dict[str, Any]) -> Project:
    return Project.model_validate(row)


@router.get("", response_model=list[Project])
async def list_projects(user: UserAuth, conn: Conn) -> list[Project]:
    return [to_project(row) for row in await projects.list_for(conn, user.account_id)]


@router.post("", status_code=201, response_model=Project)
async def create_project(user: UserAuth, conn: Conn) -> Project:
    return to_project(await projects.create(conn, user.account_id))


@router.get("/{project_id}", response_model=Project)
async def open_project(project_id: UUID, user: UserAuth, conn: Conn) -> Project:
    return to_project(await projects.open(conn, user.account_id, project_id))


@router.patch("/{project_id}", response_model=Project)
async def rename_project(
    project_id: UUID, body: ProjectUpdate, project: ActiveProject, user: UserAuth, conn: Conn
) -> Project:
    # ActiveProject has already run require_active; rename runs it again inside the service, so the
    # guard holds for any other caller too (AD-22).
    return to_project(await projects.rename(conn, user.account_id, project["id"], body.name))


@router.post("/{project_id}/archive", response_model=Project)
async def archive_project(request: Request, project_id: UUID, user: UserAuth, conn: Conn) -> Project:
    project, delete_photos = await projects.archive(conn, request.app.state.storage, user.account_id, project_id)
    # The revoked links' staged photos are deleted only once the archive has committed.
    after_commit(request, delete_photos)
    return to_project(project)


@router.post("/{project_id}/delete", response_model=Project)
async def delete_project(request: Request, project_id: UUID, user: UserAuth, conn: Conn) -> Project:
    runner = request.app.state.runner
    project, cleanup, running = await projects.delete(
        conn, request.app.state.storage, runner.kinds, user.account_id, project_id
    )
    # Only once the delete has committed: the discarded staged photos go, and the running jobs (now
    # `cancel_requested`) are interrupted, so an in-flight model call stops (AD-20).
    after_commit(request, cleanup)
    for job_id in running:
        after_commit(request, lambda job_id=job_id: runner.interrupt(job_id))
    return to_project(project)


@router.post("/{project_id}/restore", response_model=Project)
async def restore_project(project_id: UUID, user: UserAuth, conn: Conn) -> Project:
    return to_project(await projects.restore(conn, user.account_id, project_id))


@router.post("/{project_id}/purge", status_code=204)
async def purge_project(request: Request, project_id: UUID, user: ReleasedUserAuth) -> Response:
    # `ReleasedUserAuth`: no request connection stays open while the purge waits for running jobs.
    state = request.app.state
    await projects.purge(state.pool, state.storage, state.runner, user.account_id, project_id)
    return Response(status_code=204)
