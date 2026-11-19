"""Background jobs (AD-20, AD-29): the sole writer of `generation_jobs`, and the in-process runner.

A request inserts a job with `enqueue` (inside its transaction) and, after the commit, hands it to
the `Runner`. The runner starts each job as an `asyncio` task, at most `JOBS_MAX_CONCURRENT` at a
time, and keeps a reference to every task. A job runs in three steps (AD-18):

1. claim it (queued -> running) in a short transaction;
2. run the kind's handler with no connection held; it returns a `SavePlan`;
3. the save transaction: lock the job row, abort (saving nothing) when the job was cancelled, the
   Project deleted, or a cited Material removed; otherwise apply the plan and mark it completed.

A handler that raises fails the job (`processing_failed`), or with the code of a `JobFailed` it raises.
Handlers move `progress_step` (reading -> writing -> checking) through `set_progress`. A student's
cancel (`request_cancel`) ends a queued job at once, or flags a running one; the runner then also
interrupts the handler's task (`Runner.interrupt`), so an in-flight model call stops. Feature services never write job rows;
they register a `JobKind` with a handler and an `on_terminal` hook, which runs in the same
transaction as a job's failure or cancellation. At startup, `sweep_interrupted` fails every job left
queued or running by the previous process (`interrupted`). Logs job id, kind, duration, and outcome.
"""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from uuid import UUID

from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

from app.db import jobs as repo
from app.errors import AppError

logger = logging.getLogger(__name__)

PROCESSING_FAILED = "processing_failed"
INTERRUPTED = "interrupted"

# Progress steps, in order (AD-20). `claim` starts every job at `reading`.
READING = "reading"
WRITING = "writing"
CHECKING = "checking"

# Kinds a student may cancel. `material_processing` ends only through file removal (AD-23).
STUDENT_CANCELLABLE = ("quiz", "flashcards", "summary", "review_round")

AfterCommit = Callable[[], Awaitable[None]]


@dataclass(frozen=True)
class SavePlan:
    """What a handler wants saved. `apply` runs inside the save transaction (it never commits)."""

    apply: Callable[[AsyncConnection], Awaitable[None]]
    # Materials the result depends on; a removed one aborts the save (AD-20).
    material_ids: tuple[UUID, ...] = ()
    result_ref: UUID | None = None
    # Runs after the save commits, e.g. deleting a stored original (AD-16).
    after_commit: AfterCommit | None = None


@dataclass(frozen=True)
class JobKind:
    # Runs the job's steps with no connection held and returns the save plan.
    run: Callable[[dict[str, Any], Any], Awaitable[SavePlan]]
    # Called inside the transaction that fails or cancels the job (also by the restart sweep).
    on_terminal: Callable[[AsyncConnection, dict[str, Any]], Awaitable[AfterCommit | None]] | None = None


class JobNotFound(AppError):
    def __init__(self) -> None:
        super().__init__(404, "not_found", "No such job")


class JobFailed(Exception):
    """Raised by a handler to fail its job with `code` (e.g. `llm_unavailable`, `insufficient_material`)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


# --- In the request transaction ---


async def enqueue(
    conn: AsyncConnection,
    account_id: UUID,
    project_id: UUID,
    kind: str,
    params: dict[str, Any] | None = None,
    result_ref: UUID | None = None,
) -> dict[str, Any]:
    """Insert a queued job. Hand it to `Runner.submit` only after the transaction commits."""
    return await repo.insert(
        conn, account_id=account_id, project_id=project_id, kind=kind, params=params or {}, result_ref=result_ref
    )


async def cancel_for_material(conn: AsyncConnection, account_id: UUID, material_id: UUID) -> list[dict[str, Any]]:
    """Cancel the work on a removed Material (AD-20, AD-23), in the caller's transaction.

    A queued job is finished as `cancelled` at once and never runs; those jobs are returned, so the
    caller can undo what was set aside for them (an image's quota unit). They get no terminal hook. A
    running one gets `cancel_requested`; the runner's save step then ends it `cancelled` without
    saving, through the terminal hook. The only writer of `cancel_requested`.
    """
    cancelled = await repo.cancel_queued_for(conn, account_id, material_id)
    await repo.request_cancel_running_for(conn, account_id, material_id)
    return cancelled


async def list_for_project(conn: AsyncConnection, account_id: UUID, project_id: UUID) -> list[dict[str, Any]]:
    return await repo.list_for_project(conn, account_id, project_id)


async def mark_seen(conn: AsyncConnection, account_id: UUID, job_id: UUID) -> None:
    if not await repo.mark_seen(conn, account_id, job_id):
        raise JobNotFound()


async def request_cancel(conn: AsyncConnection, account_id: UUID, job_id: UUID) -> bool:
    """A student's cancel (AD-20), in the request transaction; bookkeeping, so no read-only guard.

    A queued job is finished `cancelled` at once and never runs. A running one gets `cancel_requested`,
    and its save step ends it `cancelled` without saving. A finished job is left as it is. `404` for
    another Account's job or one a student can't cancel. Returns True when the caller should interrupt
    the job's running task (`Runner.interrupt`) after the commit.
    """
    job = await repo.get(conn, account_id, job_id)
    if job is None or job["kind"] not in STUDENT_CANCELLABLE:
        raise JobNotFound()
    if job["status"] == "queued" and await repo.cancel_queued(conn, job_id) is not None:
        return False
    return await repo.request_cancel(conn, job_id)


# --- From a running handler ---


async def mark_vision_started(pool: AsyncConnectionPool, job_id: UUID) -> bool:
    """Record, in its own short transaction, that a running job is about to make its metered vision
    call (FR-7, AD-12). False when a cancel was requested or the job is no longer running: the handler
    then skips the call, and the save step ends the job. `vision_started_at` stays on the row, so
    `on_terminal` and the restart sweep can tell whether the call started."""
    async with pool.connection() as conn:
        async with conn.transaction():
            return await repo.mark_vision_started(conn, job_id)


async def mark_vision_started_in(conn: AsyncConnection, job_id: UUID) -> bool:
    """`mark_vision_started` in the caller's transaction, so the caller can record its own side of the
    call (a phone photo's settled unit) atomically with the check that no cancel was requested."""
    return await repo.mark_vision_started(conn, job_id)


async def set_progress(pool: AsyncConnectionPool, job_id: UUID, step: str) -> bool:
    """Move a running job to the next progress step, in its own short transaction (AD-20)."""
    async with pool.connection() as conn:
        async with conn.transaction():
            return await repo.set_progress(conn, job_id, step)


async def should_stop(pool: AsyncConnectionPool, job_id: UUID) -> bool:
    """True when a running handler should skip its model call: a cancel was requested or the job is no
    longer running. The handler then returns a plan; the save step ends the job (AD-20)."""
    async with pool.connection() as conn:
        job = await repo.get_by_id(conn, job_id)
    return job is None or job["status"] != "running" or job["cancel_requested"]


# --- Terminal transitions outside a request ---


async def _after(callbacks: list[AfterCommit | None]) -> None:
    for callback in callbacks:
        if callback is None:
            continue
        try:
            await callback()
        except Exception as exc:  # noqa: BLE001 -- after-commit work is best effort
            logger.warning("After-commit step failed: %s", type(exc).__name__)


async def _terminal_hook(kinds: dict[str, JobKind], conn: AsyncConnection, job: dict[str, Any]) -> AfterCommit | None:
    kind = kinds.get(job["kind"])
    if kind is None or kind.on_terminal is None:
        return None
    return await kind.on_terminal(conn, job)


async def database_now(pool: AsyncConnectionPool) -> datetime:
    """The database's clock, which stamps `created_at`; the restart sweep's start time."""
    async with pool.connection() as conn:
        return await repo.now(conn)


async def sweep_interrupted(pool: AsyncConnectionPool, kinds: dict[str, JobKind], started_at: datetime) -> int:
    """Fail every job left queued or running before `started_at` (`interrupted`, AD-20)."""
    callbacks: list[AfterCommit | None] = []
    async with pool.connection() as conn:
        async with conn.transaction():
            swept = await repo.fail_active_before(conn, started_at, INTERRUPTED)
            for job in swept:
                callbacks.append(await _terminal_hook(kinds, conn, job))
    await _after(callbacks)
    if swept:
        logger.info("Restart sweep: %d interrupted job(s)", len(swept))
    return len(swept)


# --- The runner ---


@dataclass
class Runner:
    pool: AsyncConnectionPool
    kinds: dict[str, JobKind]
    max_concurrent: int = 3
    _tasks: set[asyncio.Task] = field(default_factory=set)
    _semaphore: asyncio.Semaphore | None = None
    # Jobs whose handler is running, by id, and those a cancel interrupted.
    _in_handler: dict[UUID, asyncio.Task] = field(default_factory=dict)
    _interrupted: set[UUID] = field(default_factory=set)

    def submit(self, job: dict[str, Any], payload: Any = None) -> None:
        """Start the job as a task; `payload` is in-memory input (e.g. the uploaded bytes)."""
        if self._semaphore is None:
            self._semaphore = asyncio.Semaphore(self.max_concurrent)
        task = asyncio.create_task(self._run(job["id"], job["kind"], payload), name=f"job-{job['id']}")
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    def interrupt(self, job_id: UUID) -> None:
        """Stop a cancelled job's handler (and its in-flight model call) now, instead of at its save
        step (AD-20). Call after `cancel_requested` is committed; the save step then ends the job
        `cancelled`. Does nothing when the handler isn't running in this process."""
        task = self._in_handler.get(job_id)
        if task is not None and job_id not in self._interrupted:
            self._interrupted.add(job_id)
            task.cancel()

    @property
    def running(self) -> int:
        return len(self._tasks)

    async def drain(self, timeout: float = 30.0) -> None:
        """Wait for running jobs (at shutdown); cancel what is left after `timeout`. The restart sweep
        fails those on the next start."""
        if not self._tasks:
            return
        _, pending = await asyncio.wait(list(self._tasks), timeout=timeout)
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.wait(pending)

    async def _run(self, job_id: UUID, kind_name: str, payload: Any) -> None:
        assert self._semaphore is not None
        after: AfterCommit | None = None
        async with self._semaphore:
            started = time.monotonic()
            outcome = "error"
            try:
                outcome, after = await self._steps(job_id, kind_name, payload)
            except JobFailed as exc:
                logger.info("Job %s (%s) failed: %s", job_id, kind_name, exc.code)
                outcome = await self._end_safely(job_id, "failed", exc.code)
            except Exception as exc:  # noqa: BLE001 -- a job task must never raise
                logger.warning("Job %s (%s) failed: %s", job_id, kind_name, type(exc).__name__)
                outcome = await self._end_safely(job_id, "failed", PROCESSING_FAILED)
            finally:
                logger.info(
                    "Job %s (%s): %s in %.2f s", job_id, kind_name, outcome, time.monotonic() - started
                )
        # After the slot is released: a slow after-commit step (auto-naming's model call) never holds
        # one of the `max_concurrent` slots. Still awaited in this task, so `drain` waits for it.
        await _after([after])

    async def _steps(self, job_id: UUID, kind_name: str, payload: Any) -> tuple[str, AfterCommit | None]:
        """Returns the outcome and the after-commit step, which the caller runs outside the slot."""
        kind = self.kinds[kind_name]
        # 1. Claim it in a short transaction.
        async with self.pool.connection() as conn:
            async with conn.transaction():
                job = await repo.claim(conn, job_id)
        if job is None:
            return "skipped", None

        # 2. The work, with no connection held (AD-18). A student's cancel may interrupt it; the save
        # step below then sees `cancel_requested`.
        plan: SavePlan | None
        task = asyncio.current_task()
        self._in_handler[job_id] = task
        try:
            plan = await kind.run(job, payload)
        except asyncio.CancelledError:
            if job_id not in self._interrupted:
                raise  # shutdown: the restart sweep fails the job
            plan = None
        finally:
            self._in_handler.pop(job_id, None)
            if job_id in self._interrupted:
                self._interrupted.discard(job_id)
                # Withdraw our cancel, also when the handler finished before it landed, so the save
                # step below isn't cancelled instead.
                if task.cancelling():
                    task.uncancel()

        # 3. The save transaction (AD-20).
        aborted_status: str | None = None
        async with self.pool.connection() as conn:
            async with conn.transaction():
                locked = await repo.get_for_update(conn, job_id)
                if locked is None or locked["status"] != "running":
                    return "skipped", None
                if (
                    plan is None
                    or locked["cancel_requested"]
                    or await repo.project_deleted(conn, locked["project_id"])
                    or await repo.any_material_removed(conn, list(plan.material_ids))
                ):
                    aborted_status = "cancelled"
                    finished = await repo.finish(conn, job_id, "cancelled")
                    after = await _terminal_hook(self.kinds, conn, finished)
                else:
                    await plan.apply(conn)
                    await repo.finish(conn, job_id, "completed", result_ref=plan.result_ref)
                    after = plan.after_commit
        return aborted_status or "completed", after

    async def _end_safely(self, job_id: UUID, status: str, error_code: str) -> str:
        """Fail or cancel a job and run its terminal hook, in one transaction. Never raises."""
        try:
            async with self.pool.connection() as conn:
                async with conn.transaction():
                    job = await repo.finish(conn, job_id, status, error_code=error_code)
                    after = await _terminal_hook(self.kinds, conn, job) if job else None
            await _after([after])
        except Exception as exc:  # noqa: BLE001 -- the restart sweep is the fallback
            logger.warning("Job %s could not be marked %s: %s", job_id, status, type(exc).__name__)
        return status
