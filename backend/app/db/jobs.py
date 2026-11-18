"""The `generation_jobs` repository (AD-20). Only `services/jobs` calls it. Plain SQL; never commits."""

from datetime import datetime
from typing import Any
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

_COLUMNS = (
    "id, account_id, project_id, kind, params, status, progress_step, cancel_requested, result_ref, error_code, "
    "created_at, finished_at, seen_at, vision_started_at"
)
ACTIVE = "status IN ('queued', 'running')"


async def insert(
    conn: AsyncConnection,
    *,
    account_id: UUID,
    project_id: UUID,
    kind: str,
    params: dict[str, Any],
    result_ref: UUID | None,
) -> dict[str, Any]:
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"""
            INSERT INTO generation_jobs (account_id, project_id, kind, params, result_ref)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING {_COLUMNS}
            """,
            (account_id, project_id, kind, Jsonb(params), result_ref),
        )
        return await cur.fetchone()


async def claim(conn: AsyncConnection, job_id: UUID) -> dict[str, Any] | None:
    """queued -> running at the `reading` step; None when the job is no longer queued or was cancelled."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"""
            UPDATE generation_jobs SET status = 'running', progress_step = 'reading'
            WHERE id = %s AND status = 'queued' AND NOT cancel_requested
            RETURNING {_COLUMNS}
            """,
            (job_id,),
        )
        return await cur.fetchone()


async def mark_vision_started(conn: AsyncConnection, job_id: UUID) -> bool:
    """Stamp `vision_started_at` on a running job; False when it is no longer running or a cancel was
    requested (the call must then not start)."""
    async with conn.cursor() as cur:
        await cur.execute(
            """
            UPDATE generation_jobs SET vision_started_at = now()
            WHERE id = %s AND status = 'running' AND NOT cancel_requested
            """,
            (job_id,),
        )
        return cur.rowcount == 1


async def get_for_update(conn: AsyncConnection, job_id: UUID) -> dict[str, Any] | None:
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(f"SELECT {_COLUMNS} FROM generation_jobs WHERE id = %s FOR UPDATE", (job_id,))
        return await cur.fetchone()


async def finish(
    conn: AsyncConnection, job_id: UUID, status: str, *, error_code: str | None = None, result_ref: UUID | None = None
) -> dict[str, Any] | None:
    """Move an active job to `completed`, `failed`, or `cancelled`."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"""
            UPDATE generation_jobs
            SET status = %s, error_code = %s, result_ref = coalesce(%s, result_ref), progress_step = NULL,
                finished_at = now()
            WHERE id = %s AND {ACTIVE}
            RETURNING {_COLUMNS}
            """,
            (status, error_code, result_ref, job_id),
        )
        return await cur.fetchone()


async def cancel_queued_for(conn: AsyncConnection, account_id: UUID, result_ref: UUID) -> list[dict[str, Any]]:
    """Finish every queued job working on `result_ref` as `cancelled`, so it never runs.

    Skips rows another transaction holds (`SKIP LOCKED`): only `claim` locks a queued job, and a job it
    claims is caught at its save step instead (the removed Material aborts it). Waiting would risk a
    deadlock with the runner, which locks the job before the Project and Material rows.
    """
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"""
            UPDATE generation_jobs
            SET status = 'cancelled', progress_step = NULL, finished_at = now()
            WHERE id IN (
                SELECT id FROM generation_jobs
                WHERE account_id = %s AND result_ref = %s AND status = 'queued'
                FOR UPDATE SKIP LOCKED
            )
            RETURNING {_COLUMNS}
            """,
            (account_id, result_ref),
        )
        return await cur.fetchall()


async def request_cancel_running_for(conn: AsyncConnection, account_id: UUID, result_ref: UUID) -> int:
    """Set `cancel_requested` on every running job working on `result_ref`; its save step cancels it.

    `SKIP LOCKED` for the same reason as `cancel_queued_for`: a locked running job is in its save
    transaction, which waits for this one and then sees the removed Material.
    """
    async with conn.cursor() as cur:
        await cur.execute(
            """
            UPDATE generation_jobs SET cancel_requested = true
            WHERE id IN (
                SELECT id FROM generation_jobs
                WHERE account_id = %s AND result_ref = %s AND status = 'running' AND NOT cancel_requested
                FOR UPDATE SKIP LOCKED
            )
            """,
            (account_id, result_ref),
        )
        return cur.rowcount


async def now(conn: AsyncConnection) -> datetime:
    async with conn.cursor() as cur:
        await cur.execute("SELECT now()")
        return (await cur.fetchone())[0]


async def fail_active_before(conn: AsyncConnection, started_at: datetime, error_code: str) -> list[dict[str, Any]]:
    """The restart sweep: every job still queued or running from before this process started."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"""
            UPDATE generation_jobs
            SET status = 'failed', error_code = %s, progress_step = NULL, finished_at = now()
            WHERE {ACTIVE} AND created_at < %s
            RETURNING {_COLUMNS}
            """,
            (error_code, started_at),
        )
        return await cur.fetchall()


async def project_deleted(conn: AsyncConnection, project_id: UUID) -> bool:
    """True when the Project is gone or soft-deleted; locks the row so a delete can't slip in (AD-20)."""
    async with conn.cursor() as cur:
        await cur.execute("SELECT deleted_at FROM projects WHERE id = %s FOR SHARE", (project_id,))
        row = await cur.fetchone()
        return row is None or row[0] is not None


async def any_material_removed(conn: AsyncConnection, material_ids: list[UUID]) -> bool:
    """True when a cited Material is gone or removed; locks the rows until the save commits (AD-5, AD-20)."""
    if not material_ids:
        return False
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT id, removed_at FROM study_materials WHERE id = ANY(%s) FOR UPDATE", (material_ids,)
        )
        rows = await cur.fetchall()
    return len(rows) < len(set(material_ids)) or any(removed_at is not None for _, removed_at in rows)


async def list_for_project(conn: AsyncConnection, account_id: UUID, project_id: UUID) -> list[dict[str, Any]]:
    """Active jobs and finished ones not yet seen, oldest first (AD-20)."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"""
            SELECT {_COLUMNS} FROM generation_jobs
            WHERE project_id = %s AND account_id = %s AND ({ACTIVE} OR seen_at IS NULL)
            ORDER BY created_at, id
            """,
            (project_id, account_id),
        )
        return await cur.fetchall()


async def mark_seen(conn: AsyncConnection, account_id: UUID, job_id: UUID) -> bool:
    """Dismiss a finished job; an active one stays unseen. False when there is no such job."""
    async with conn.cursor() as cur:
        await cur.execute(
            f"""
            UPDATE generation_jobs
            SET seen_at = CASE WHEN {ACTIVE} THEN seen_at ELSE coalesce(seen_at, now()) END
            WHERE id = %s AND account_id = %s
            """,
            (job_id, account_id),
        )
        return cur.rowcount == 1
