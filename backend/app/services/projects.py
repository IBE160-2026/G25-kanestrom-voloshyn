"""Projects service: create, list, open, rename, archive, delete, restore, and purge, auto-naming, and the
read-only guard (FR-4, FR-5, FR-23, FR-24, AD-14, AD-22). The only writer of `archived_at` and `deleted_at`,
and the only deleter of `projects` rows.

Takes `conn`, never commits (AD-18); the exceptions take the pool and run their own short transactions:
`auto_name_if_unnamed` (an after-commit step) and the purge (`purge`, `purge_expired`,
`purge_expired_forever`). Every call is scoped by `account_id` (AD-2).
"""

import asyncio
import inspect
import logging
from collections.abc import Callable, Sequence
from typing import TYPE_CHECKING, Any
from uuid import UUID

from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

from app.db import profiles
from app.db import projects as repo
from app.errors import AppError
from app.llm import Gateway
from app.llm.gateway import SectionLike
from app.storage import Storage

if TYPE_CHECKING:
    from app.services.jobs import Runner

logger = logging.getLogger(__name__)

NAME_MAX_LENGTH = 100
# How long a purge waits for the Project's running jobs to end before it deletes anyway (FR-24).
PURGE_WAIT_SECONDS = 30.0
# The 30-day purge task runs at startup, then every hour (AD-20).
PURGE_INTERVAL_SECONDS = 3600


class ProjectNotFound(AppError):
    def __init__(self) -> None:
        super().__init__(404, "not_found", "No such Project")


class ProjectReadOnly(AppError):
    def __init__(self) -> None:
        super().__init__(409, "project_read_only", "The Project is archived or deleted")


class ProjectNotDeleted(AppError):
    def __init__(self) -> None:
        super().__init__(409, "project_not_deleted", "The Project isn't in Deleted projects")


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
        await _run_steps(steps)

    return deleted, after, running


async def _run_steps(steps: Sequence[Callable[[], Any] | None]) -> None:
    for step in steps:
        if step is None:
            continue
        try:
            result = step()
            if inspect.isawaitable(result):
                await result
        except Exception as exc:  # noqa: BLE001 -- the change has committed; cleanup is best effort
            logger.warning("After-commit step failed: %s", type(exc).__name__)


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


# --- Delete forever and the 30-day purge (FR-24, AD-18, AD-20, AD-22) ---


async def purge(
    pool: AsyncConnectionPool,
    storage: Storage,
    runner: "Runner",
    account_id: UUID,
    project_id: UUID,
    *,
    include_expired: bool = False,
    wait_seconds: float | None = None,
) -> None:
    """Delete a deleted Project forever (FR-24), in short transactions with no connection held during
    the wait (AD-18):

    1. lock it (`404 not_found` when missing, foreign or expired, unless `include_expired`;
       `409 project_not_deleted` when it isn't deleted) and cancel its jobs; commit;
    2. interrupt its running jobs and wait for them (`runner.wait_for`), at most `wait_seconds`
       (default `PURGE_WAIT_SECONDS`); a job
       that outlives the wait finds no Project at its save step and saves nothing;
    3. delete the row; every child row goes by cascade, Mistake history included;
    4. after that commit, delete the Storage prefix `{account_id}/{project_id}/`.
    """
    # Imported here: `jobs` is imported by services that import this module.
    from app.services import jobs

    async with pool.connection() as conn:
        async with conn.transaction():
            project = await repo.get_for_update(conn, account_id, project_id, include_expired=include_expired)
            if project is None:
                raise ProjectNotFound()
            if project["deleted_at"] is None:
                raise ProjectNotDeleted()
            steps, interrupt = await jobs.cancel_for_project(conn, runner.kinds, account_id, project_id)
            waiting = await jobs.active_ids_for_project(conn, account_id, project_id)
    await _run_steps(steps)
    for job_id in interrupt:
        runner.interrupt(job_id)
    if wait_seconds is None:
        wait_seconds = PURGE_WAIT_SECONDS
    if not await runner.wait_for(waiting, wait_seconds):
        logger.warning("Purge of Project %s: jobs still running after %.0f s", project_id, wait_seconds)

    async with pool.connection() as conn:
        async with conn.transaction():
            removed = await repo.delete_deleted(conn, account_id, project_id)
            if not removed:
                # Restored during the wait, or purged by someone else.
                if await repo.get_for_update(conn, account_id, project_id, include_expired=True) is None:
                    raise ProjectNotFound()
                raise ProjectNotDeleted()
    await storage.delete_prefix(f"{account_id}/{project_id}/")


async def purge_expired(pool: AsyncConnectionPool, storage: Storage, runner: "Runner") -> int:
    """Purge every Project deleted more than 30 days ago, one at a time; a failure is logged and the
    next goes on (it is retried on the next round). Returns how many were purged."""
    async with pool.connection() as conn:
        expired = await repo.expired_ids(conn)
    purged = 0
    for account_id, project_id in expired:
        try:
            await purge(pool, storage, runner, account_id, project_id, include_expired=True)
            purged += 1
        except Exception as exc:  # noqa: BLE001 -- the next Project still goes; retried next round
            logger.warning("Purge of expired Project %s failed: %s", project_id, type(exc).__name__)
    if purged:
        logger.info("Purge: %d expired Project(s) deleted", purged)
    return purged


async def purge_expired_forever(
    pool: AsyncConnectionPool, storage: Storage, runner: "Runner", interval: float = PURGE_INTERVAL_SECONDS
) -> None:
    """At startup, then every `interval` seconds, until cancelled (the app's lifespan, AD-20)."""
    while True:
        try:
            await purge_expired(pool, storage, runner)
        except Exception as exc:  # noqa: BLE001 -- retried on the next round
            logger.warning("Purge task failed: %s", type(exc).__name__)
        await asyncio.sleep(interval)


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
