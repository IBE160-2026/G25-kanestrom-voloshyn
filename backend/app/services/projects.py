"""Projects service: create, list, open, rename, archive, delete and restore, auto-naming, and the
read-only guard (FR-4, FR-5, FR-23, FR-24, AD-14, AD-22). The only writer of `archived_at` and `deleted_at`.

Takes `conn`, never commits (AD-18); the exception is `auto_name_if_unnamed`, an after-commit step that
takes the pool. Every call is scoped by `account_id` (AD-2).
"""

import inspect
import logging
from collections.abc import Callable, Sequence
from typing import Any
from uuid import UUID

from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

from app.db import profiles
from app.db import projects as repo
from app.errors import AppError
from app.llm import Gateway
from app.llm.gateway import SectionLike
from app.storage import Storage

logger = logging.getLogger(__name__)

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


async def check_active(conn: AsyncConnection, account_id: UUID, project_id: UUID) -> dict[str, Any]:
    """The read-only guard without a row lock, for the `ActiveProject` dependency (AD-22).

    Same answers as `require_active`. Services lock with `require_active` where they mutate, so no
    lock is held for the rest of the request (for example during an upload's storage write).
    """
    project = await get(conn, account_id, project_id)
    if not is_active(project):
        raise ProjectReadOnly()
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


async def _lock_not_deleted(conn: AsyncConnection, account_id: UUID, project_id: UUID) -> dict[str, Any]:
    """The Project, locked; `404` when missing or foreign, `409 project_read_only` when deleted (archive
    only: a deleted Project can be restored, not archived)."""
    project = await repo.get_for_update(conn, account_id, project_id)
    if project is None:
        raise ProjectNotFound()
    if project["deleted_at"] is not None:
        raise ProjectReadOnly()
    return project


async def archive(
    conn: AsyncConnection, storage: Storage, account_id: UUID, project_id: UUID
) -> tuple[dict[str, Any], Callable[[], Any]]:
    """Archive the Project (FR-23): idempotent bookkeeping; nothing else on it changes. Its open phone
    links are revoked in the same transaction (AD-24); running generation is left to finish and save.
    Returns (Project, the after-commit step that deletes the discarded staged photos)."""
    # Imported here: `phone` imports this module.
    from app.services import phone

    project = await _lock_not_deleted(conn, account_id, project_id)
    if project["archived_at"] is not None:
        return project, _nothing
    delete_photos = await phone.revoke_for_project(conn, storage, account_id, project_id)
    return await repo.set_archived(conn, account_id, project_id), delete_photos


async def delete(
    conn: AsyncConnection, storage: Storage, kinds: dict[str, Any], account_id: UUID, project_id: UUID
) -> tuple[dict[str, Any], Callable[[], Any], list[UUID]]:
    """Delete the Project into Deleted projects (FR-24): idempotent bookkeeping that sets `deleted_at`
    and keeps `archived_at`. In the same transaction its open phone links are revoked (AD-24) and its
    jobs cancelled (AD-20): a queued one ends `cancelled` at once through its kind's terminal hook, a
    running one gets `cancel_requested`. Mistakes, History, Topics, and Ready files stay; a file whose
    reading was queued or running is rejected (its hook gives back its image unit) and its stored
    original or staged photos are deleted after the commit. Returns (Project, the after-commit step for
    the photo and file deletes, the running job ids to interrupt after the commit).
    """
    # Imported here: both import this module.
    from app.services import jobs, phone

    project = await repo.get_for_update(conn, account_id, project_id)
    if project is None:
        raise ProjectNotFound()
    if project["deleted_at"] is not None:
        return project, _nothing, []
    steps = [await phone.revoke_for_project(conn, storage, account_id, project_id)]
    job_steps, running = await jobs.cancel_for_project(conn, kinds, account_id, project_id)
    steps += job_steps
    deleted = await repo.set_deleted(conn, account_id, project_id)

    async def after() -> None:
        for step in steps:
            if step is None:
                continue
            try:
                result = step()
                if inspect.isawaitable(result):
                    await result
            except Exception as exc:  # noqa: BLE001 -- the delete has committed; cleanup is best effort
                logger.warning("After-delete step failed: %s", type(exc).__name__)

    return deleted, after, running


async def restore(conn: AsyncConnection, account_id: UUID, project_id: UUID) -> dict[str, Any]:
    """Restore an archived or deleted Project to the active list (FR-23, FR-24): clears both
    `archived_at` and `deleted_at`; idempotent."""
    project = await repo.get_for_update(conn, account_id, project_id)
    if project is None:
        raise ProjectNotFound()
    if is_active(project):
        return project
    return await repo.set_restored(conn, account_id, project_id)


def _nothing() -> None:
    return None


async def auto_name_if_unnamed(
    pool: AsyncConnectionPool,
    llm: Gateway,
    account_id: UUID,
    project_id: UUID,
    sections: Sequence[SectionLike],
) -> dict[str, Any] | None:
    """Name an unnamed Project from a Material that just became Ready (FR-4, AD-14).

    Runs after the Material's ready commit, outside any transaction: a short read, then the model with
    no connection held (AD-18), then a conditional write (`WHERE name_source IS NULL`), so a student
    rename that lands meanwhile wins. The only writer of `name_source='auto'`. Any failure is logged by
    type and leaves the name NULL; the next Ready file tries again. Returns the named Project, or None.
    """
    try:
        async with pool.connection() as conn:
            project = await repo.get(conn, account_id, project_id)
        if project is None or project["name_source"] is not None or not is_active(project):
            return None
        result = await llm.name_project(sections)
        name = clean_name(result.name)
        async with pool.connection() as conn:
            async with conn.transaction():
                return await repo.set_auto_name(conn, account_id, project_id, name)
    except Exception as exc:  # noqa: BLE001 -- naming never affects the file or the job
        logger.warning("Auto-naming Project %s failed: %s", project_id, type(exc).__name__)
        return None
