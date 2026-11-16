"""Projects (FR-4, FR-5, FR-8, AD-14, AD-22).

- `GET /api/projects`: every Project of the Account, newest first.
- `POST /api/projects`: a new Project with no name (`201`).
- `GET /api/projects/{project_id}`: opens the Project, which becomes the one login lands on.
- `PATCH /api/projects/{project_id}`: rename; requires an active Project (`ActiveProject`).
"""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from app.api.deps import ActiveProject, Conn
from app.auth import UserAuth
from app.services import projects

router = APIRouter(prefix="/projects")


class Project(BaseModel):
    id: UUID
    name: str | None
    name_source: Literal["auto", "student"] | None
    archived_at: datetime | None
    deleted_at: datetime | None
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
