"""Flashcard generation (Story 4.1: FR-13, AD-7, AD-20).

- `POST /api/projects/{project_id}/flashcard-sets` `{scope, count}`: requires an active Project
  (`ActiveProject`); resolves the scope, refuses one over the context budget (`422 scope_too_large`), and
  queues a `flashcards` job: `202 {job_id}`.
- `GET /api/projects/{project_id}/flashcard-sets/{set_id}`: `{id, requested_count, card_count}`. A read,
  so a read-only Project's set still opens. The cards are served from Story 4.2.

`scope` is the Quiz's (`{"all_topics": true}` or `{"topic_ids": [...]}`, AD-7); `max_cards` comes from the
shared capacity endpoint in `api/quizzes`.
"""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict

from app.api.conn import after_commit
from app.api.deps import ActiveProject, Conn
from app.api.quizzes import JobAccepted, Scope, scope_dict
from app.auth import UserAuth
from app.services import flashcards

router = APIRouter(prefix="/projects/{project_id}")


class FlashcardSetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scope: Scope
    count: Literal[5, 10, 20]


class FlashcardSet(BaseModel):
    id: UUID
    requested_count: int
    card_count: int


@router.post("/flashcard-sets", status_code=202, response_model=JobAccepted)
async def create_flashcard_set(
    request: Request, body: FlashcardSetRequest, project: ActiveProject, user: UserAuth, conn: Conn
) -> JobAccepted:
    settings = request.app.state.settings
    job = await flashcards.request(
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


@router.get("/flashcard-sets/{set_id}", response_model=FlashcardSet)
async def get_flashcard_set(project_id: UUID, set_id: UUID, user: UserAuth, conn: Conn) -> FlashcardSet:
    return FlashcardSet.model_validate(await flashcards.get(conn, user.account_id, project_id, set_id))
