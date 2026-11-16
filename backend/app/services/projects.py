"""Projects service: create, list, open, rename, and the read-only guard (FR-4, FR-5, AD-14, AD-22).

Takes `conn`, never commits (AD-18). Every call is scoped by `account_id` (AD-2).
"""

from typing import Any
from uuid import UUID

from psycopg import AsyncConnection

from app.db import profiles
from app.db import projects as repo
from app.errors import AppError

NAME_MAX_LENGTH = 100


class ProjectNotFound(AppError):
    def __init__(self) -> None:
        super().__init__(404, "not_found", "No such Project")


class ProjectReadOnly(AppError):
    def __init__(self) -> None:
        super().__init__(409, "project_read_only", "The Project is archived or deleted")


class InvalidName(AppError):
    def __init__(self) -> None:
        super().__init__(422, "invalid_name", "The name is blank")


def is_active(project: dict[str, Any]) -> bool:
    return project["archived_at"] is None and project["deleted_at"] is None


def clean_name(raw: str) -> str:
    """Trim, refuse blank, and cut to 100 characters (AD-14). Longer input is cut, not refused."""
    name = raw.strip()
    if not name:
        raise InvalidName()
    # Trim again: the cut can leave a space at the end.
    return name[:NAME_MAX_LENGTH].rstrip()


async def create(conn: AsyncConnection, account_id: UUID) -> dict[str, Any]:
    """A new, unnamed Project (FR-4). The SPA opens it next, which records it as the last one."""
    return await repo.insert(conn, account_id)


async def list_for(conn: AsyncConnection, account_id: UUID) -> list[dict[str, Any]]:
    return await repo.list_for(conn, account_id)


async def get(conn: AsyncConnection, account_id: UUID, project_id: UUID) -> dict[str, Any]:
    project = await repo.get(conn, account_id, project_id)
    if project is None:
        raise ProjectNotFound()
    return project


async def require_active(conn: AsyncConnection, account_id: UUID, project_id: UUID) -> dict[str, Any]:
    """The read-only guard (AD-22): every content mutation calls it first.

    Returns the Project row, locked FOR UPDATE; `404 not_found` for a missing or foreign id, `409 project_read_only`
    when it is archived or deleted.
    """
    # Locked for the rest of the transaction, so a concurrent archive or delete can't slip in
    # between the check and the mutation it guards.
    project = await repo.get_for_update(conn, account_id, project_id)
    if project is None:
        raise ProjectNotFound()
    if not is_active(project):
        raise ProjectReadOnly()
    return project


async def open(conn: AsyncConnection, account_id: UUID, project_id: UUID) -> dict[str, Any]:
    """Read the Project and remember it as the one login lands on (FR-8)."""
    project = await get(conn, account_id, project_id)
    await profiles.set_last_project(conn, account_id, project_id)
    return project


async def rename(conn: AsyncConnection, account_id: UUID, project_id: UUID, raw_name: str) -> dict[str, Any]:
    """A student's rename (FR-5): requires an active Project, sets name_source='student' (AD-14)."""
    await require_active(conn, account_id, project_id)
    project = await repo.set_student_name(conn, account_id, project_id, clean_name(raw_name))
    if project is None:
        raise ProjectNotFound()
    return project
