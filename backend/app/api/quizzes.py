"""Quiz setup and generation (FR-10, FR-26, AD-7, AD-20).

- `GET /api/projects/{project_id}/capacity?scope=<json>`: `{max_questions}` for a scope, deterministic,
  with no model call. A read, so no read-only guard.
- `POST /api/projects/{project_id}/quizzes` `{scope, count}`: requires an active Project
  (`ActiveProject`); resolves the scope, refuses one over the context budget (`422 scope_too_large`), and
  queues a `quiz` job: `202 {job_id}`.
- `GET /api/projects/{project_id}/quizzes/{quiz_id}`: `{id, requested_count, question_count}`; the
  Questions are served from Story 3.2.

`scope` is `{"all_topics": true}` or `{"topic_ids": [...]}` (AD-7). A foreign Topic is `404 not_found`;
a scope with no Ready material is `422 insufficient_material`.
"""

from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

from app.api.conn import after_commit
from app.api.deps import ActiveProject, Conn
from app.auth import UserAuth
from app.errors import AppError
from app.services import quiz

router = APIRouter(prefix="/projects/{project_id}")


class AllTopics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    all_topics: Literal[True]


class TopicIds(BaseModel):
    model_config = ConfigDict(extra="forbid")

    topic_ids: Annotated[list[UUID], Field(min_length=1, max_length=1000)]


Scope = AllTopics | TopicIds
_SCOPE = TypeAdapter(Scope)


def scope_dict(scope: Scope) -> dict[str, Any]:
    if isinstance(scope, AllTopics):
        return {"all_topics": True}
    return {"topic_ids": list(scope.topic_ids)}


class Capacity(BaseModel):
    max_questions: int


class QuizRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scope: Scope
    count: Literal[5, 10, 20]


class JobAccepted(BaseModel):
    job_id: UUID


class Quiz(BaseModel):
    id: UUID
    requested_count: int
    question_count: int


@router.get("/capacity", response_model=Capacity)
async def get_capacity(
    request: Request, project_id: UUID, user: UserAuth, conn: Conn, scope: Annotated[str, Query()]
) -> Capacity:
    try:
        parsed = _SCOPE.validate_json(scope)
    except ValidationError:
        raise AppError(422, "invalid_request", "scope must be {all_topics: true} or {topic_ids: [...]}",
                       {"fields": ["scope"]}) from None
    words_per_item = request.app.state.settings.capacity_words_per_item
    return Capacity(
        max_questions=await quiz.capacity(conn, user.account_id, project_id, scope_dict(parsed), words_per_item)
    )


@router.post("/quizzes", status_code=202, response_model=JobAccepted)
async def create_quiz(
    request: Request, body: QuizRequest, project: ActiveProject, user: UserAuth, conn: Conn
) -> JobAccepted:
    settings = request.app.state.settings
    job = await quiz.request(
        conn,
        user.account_id,
        project["id"],
        scope_dict(body.scope),
        body.count,
        settings.llm_context_budget_tokens,
        settings.capacity_words_per_item,
    )
    # Started right after the commit, so the runner sees the job row (AD-20).
    runner = request.app.state.runner
    after_commit(request, lambda: runner.submit(job))
    return JobAccepted(job_id=job["id"])


@router.get("/quizzes/{quiz_id}", response_model=Quiz)
async def get_quiz(project_id: UUID, quiz_id: UUID, user: UserAuth, conn: Conn) -> Quiz:
    return Quiz.model_validate(await quiz.get(conn, user.account_id, project_id, quiz_id))
