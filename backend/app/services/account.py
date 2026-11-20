"""Account deletion (FR-28, AD-16, AD-19, AD-20): immediate and permanent, Deleted projects and Mistake
history included. No grace period, no email step.

Runs its own short transactions through the pool, with no connection held during the wait (AD-18).
"""

import logging
from typing import TYPE_CHECKING
from uuid import UUID

import httpx2
from psycopg_pool import AsyncConnectionPool

from app import supabase_auth
from app.config import Settings
from app.db import projects as projects_repo
from app.services import jobs, phone
from app.services.projects import run_steps
from app.storage import Storage

if TYPE_CHECKING:
    from app.services.jobs import Runner

logger = logging.getLogger(__name__)

# How long the deletion waits for the Account's running jobs to end before it goes on (as the purge).
DELETE_WAIT_SECONDS = 30.0


async def delete_account(
    pool: AsyncConnectionPool,
    storage: Storage,
    runner: "Runner",
    http: httpx2.AsyncClient,
    settings: Settings,
    account_id: UUID,
) -> None:
    """Delete the Account and everything in it:

    1. in one transaction, for every Project (active, archived, deleted, expired): cancel its jobs and
       revoke its phone links; commit, then run the after-commit steps (staged photos, rejected files);
    2. interrupt the running jobs and wait for them, at most `DELETE_WAIT_SECONDS`; a job that outlives
       the wait is stopped at its save step by `cancel_requested`, and once step 4 has run it finds no rows;
    3. delete the Storage prefix `{account_id}/`;
    4. delete the auth user (admin API); `profiles` and every app table go with it by cascade.
       A failure there is `503 auth_unavailable`: the files are gone, the Account remains, and a retry works;
    5. delete the Storage prefix once more: `storage.objects` doesn't cascade, so this catches files an
       upload or a job started after step 1 (another tab) wrote during the wait.
    """
    logger.info("Account deletion of %s started", account_id)
    steps = []
    interrupt: list[UUID] = []
    waiting: list[UUID] = []
    async with pool.connection() as conn:
        async with conn.transaction():
            for project_id in await projects_repo.ids_for_account(conn, account_id):
                steps.append(await phone.revoke_for_project(conn, storage, account_id, project_id))
                job_steps, running = await jobs.cancel_for_project(conn, runner.kinds, account_id, project_id)
                steps += job_steps
                interrupt += running
                waiting += await jobs.active_ids_for_project(conn, account_id, project_id)
    await run_steps(steps)
    for job_id in interrupt:
        runner.interrupt(job_id)
    if not await runner.wait_for(waiting, DELETE_WAIT_SECONDS):
        logger.warning("Account deletion: jobs still running after %.0f s", DELETE_WAIT_SECONDS)

    await storage.delete_prefix(f"{account_id}/")
    await supabase_auth.delete_user(http, settings, account_id)
    await storage.delete_prefix(f"{account_id}/")
    logger.info("Account deletion of %s finished", account_id)
