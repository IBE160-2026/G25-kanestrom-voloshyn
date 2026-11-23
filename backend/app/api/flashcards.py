"""Flashcard sets: generation (Story 4.1: FR-13, AD-7, AD-20) and study (Story 4.2: FR-14, AD-8, AD-22).

- `POST /api/projects/{project_id}/flashcard-sets` `{scope, count}`: requires an active Project
  (`ActiveProject`); resolves the scope, refuses one over the context budget (`422 scope_too_large`), and
  queues a `flashcards` job: `202 {job_id}`.
- `GET /api/projects/{project_id}/flashcard-sets/{set_id}`: `{id, requested_count, card_count, ended_at,
  cards: [{id, position, question, answer, sources: [{label}]}], queue, done_count, second_try_count}`.
  `queue` lists the card ids still to show, in order. A read, so a read-only Project's set still opens;
  it ends the Account's other open sets that have marks, and this one when it was left idle 30 minutes.
- `POST /api/projects/{project_id}/flashcard-sets/{set_id}/cards/{card_id}/mark` `{mark: "got_it" |
  "not_yet"}`: requires an active Project; saves one insert-only mark with no model call and returns the
  set as GET does. A repeat "Got it" saves nothing. An ended set answers `409 flashcard_set_ended`, and an
  idle end found by this request is still saved. Flashcards never create Mistakes.

`scope` is the Quiz's (`{"all_topics": true}` or `{"topic_ids": [...]}`, AD-7); `max_cards` comes from the
shared capacity endpoint in `api/quizzes`.
"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from app.api.conn import after_commit
from app.api.deps import ActiveProject, Conn
from app.api.quizzes import JobAccepted, Scope, scope_dict
from app.auth import UserAuth
from app.errors import error_response
from app.services import flashcards

router = APIRouter(prefix="/projects/{project_id}")


class FlashcardSetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scope: Scope
    count: Literal[5, 10, 20]


class Source(BaseModel):
    label: str


class Card(BaseModel):
    id: UUID
    position: int
    question: str
    answer: str
    sources: list[Source]


class FlashcardSet(BaseModel):
    id: UUID
    requested_count: int
    card_count: int
    ended_at: datetime | None
    cards: list[Card]
    # The card ids still to show, in order: unmarked cards by position, then "Not yet" cards.
    queue: list[UUID]
    done_count: int
    second_try_count: int


class MarkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mark: Literal["got_it", "not_yet"]


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


@router.post("/flashcard-sets/{set_id}/cards/{card_id}/mark", response_model=FlashcardSet)
async def mark_card(
    set_id: UUID, card_id: UUID, body: MarkRequest, project: ActiveProject, user: UserAuth, conn: Conn
) -> FlashcardSet | JSONResponse:
    try:
        found = await flashcards.mark(conn, user.account_id, project["id"], set_id, card_id, body.mark)
    except flashcards.FlashcardSetEnded as exc:
        # Answered, not raised, so the request transaction still commits an idle end found here.
        return error_response(exc.status, exc.code, exc.message, exc.params)
    return FlashcardSet.model_validate(found)
