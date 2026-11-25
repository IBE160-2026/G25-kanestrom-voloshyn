"""Summaries (Story 4.3: FR-15, AD-7, AD-8, AD-20).

- `POST /api/projects/{project_id}/summaries` `{material_id, topic_id: null | uuid}`: requires an active
  Project (`ActiveProject`); resolves the scope (the whole Ready file, or one of its Topics), refuses one
  over the context budget (`422 scope_too_large`), and queues a `summary` job: `202 {job_id}`. A file
  that isn't Ready, is removed, or is foreign, and a Topic of another file, are `404 not_found`.
- `GET /api/projects/{project_id}/summaries/{summary_id}`: `{id, title, file_name, topic_label,
  sections: [{heading, text, sources: [{label}]}]}`. A read, so a read-only Project's summary still
  opens. The title and section text are the model's, in the material's language.
"""

from uuid import UUID

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict

from app.api.conn import after_commit
from app.api.deps import ActiveProject, Conn
from app.api.quizzes import JobAccepted
from app.auth import UserAuth
from app.services import summaries

router = APIRouter(prefix="/projects/{project_id}")


class SummaryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    material_id: UUID
    topic_id: UUID | None = None


class Source(BaseModel):
    label: str


class SummarySection(BaseModel):
    heading: str
    text: str
    sources: list[Source]


class Summary(BaseModel):
    id: UUID
    title: str
    file_name: str
    # The chosen Topic's frozen label; null for the whole file.
    topic_label: str | None
    sections: list[SummarySection]


@router.post("/summaries", status_code=202, response_model=JobAccepted)
async def create_summary(
    request: Request, body: SummaryRequest, project: ActiveProject, user: UserAuth, conn: Conn
) -> JobAccepted:
    settings = request.app.state.settings
    job = await summaries.request(
        conn, user.account_id, project["id"], body.material_id, body.topic_id, settings.llm_context_budget_tokens
    )
    # Started right after the commit, so the runner sees the job row (AD-20).
    runner = request.app.state.runner
    after_commit(request, lambda: runner.submit(job))
    return JobAccepted(job_id=job["id"])


@router.get("/summaries/{summary_id}", response_model=Summary)
async def get_summary(project_id: UUID, summary_id: UUID, user: UserAuth, conn: Conn) -> Summary:
    return Summary.model_validate(await summaries.get(conn, user.account_id, project_id, summary_id))
