"""Background jobs (AD-20).

- `GET /api/projects/{project_id}/jobs`: active jobs plus finished ones not yet seen; the SPA polls
  it every 2 s while something is active.
- `POST /api/jobs/{job_id}/seen`: dismisses a finished job (bookkeeping, on the guard's allowlist).
- `POST /api/jobs/{job_id}/cancel`: a student's cancel (bookkeeping, on the allowlist, so it also works
  in an archived Project); `204`, also for a job that already finished. A queued job ends `cancelled`
  at once; a running one is interrupted and ends `cancelled` with nothing saved.
"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

from app.api.conn import after_commit
from app.api.deps import Conn
from app.auth import UserAuth
from app.services import jobs, projects

router = APIRouter()


class Job(BaseModel):
    id: UUID
    kind: str
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    progress_step: str | None
    result_ref: UUID | None
    error_code: str | None
    created_at: datetime
    finished_at: datetime | None


@router.get("/projects/{project_id}/jobs", response_model=list[Job])
async def list_jobs(project_id: UUID, user: UserAuth, conn: Conn) -> list[Job]:
    await projects.get(conn, user.account_id, project_id)
    return [Job.model_validate(row) for row in await jobs.list_for_project(conn, user.account_id, project_id)]


@router.post("/jobs/{job_id}/seen", status_code=204)
async def mark_seen(job_id: UUID, user: UserAuth, conn: Conn) -> Response:
    await jobs.mark_seen(conn, user.account_id, job_id)
    return Response(status_code=204)


@router.post("/jobs/{job_id}/cancel", status_code=204)
async def cancel(request: Request, job_id: UUID, user: UserAuth, conn: Conn) -> Response:
    if await jobs.request_cancel(conn, user.account_id, job_id):
        runner = request.app.state.runner
        after_commit(request, lambda: runner.interrupt(job_id))
    return Response(status_code=204)
