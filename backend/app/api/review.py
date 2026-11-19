"""Mistake Review rounds (Stories 3.4 + 3.5: FR-17, FR-18, AD-9, AD-10, AD-11, AD-20).

- `POST /api/projects/{project_id}/review-rounds`: requires an active Project (`ActiveProject`); with no
  outstanding Mistakes it refuses (`422 insufficient_material`), otherwise it queues a `review_round` job
  and its round: `202 {job_id, round_id}`. While one is queued or running: `409 review_in_progress`.
- `GET /api/projects/{project_id}/review-rounds/{round_id}`: `{id, status, error_code, items,
  cleared_count, total, remaining_outstanding}` (`status`, `error_code`: its job's). Each item is `{id, position, question, options, context: {question,
  earlier_answer_text, correct_text}, file_removed, from_original, answer}`; `answer` and `context.correct_text` are null
  until the item is answered, so the answer key never reaches the browser before (AD-9). A read, so a
  read-only Project's round still opens.
- `POST /api/projects/{project_id}/review-rounds/{round_id}/items/{practice_question_id}/answer`
  `{option_id}`: requires an active Project; scores with no model call, saves the answer once, clears the
  Mistake on a correct answer (AD-10), and returns the answered item plus `cleared`, `cleared_count`, and
  `remaining_outstanding`. A repeat submit returns the stored answer unchanged.
"""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict

from app.api.conn import after_commit
from app.api.deps import ActiveProject, Conn
from app.api.quizzes import Answer, Option
from app.auth import UserAuth
from app.services import review

router = APIRouter(prefix="/projects/{project_id}/review-rounds")


class RoundAccepted(BaseModel):
    job_id: UUID
    round_id: UUID


class Context(BaseModel):
    question: str
    earlier_answer_text: str
    correct_text: str | None


class Item(BaseModel):
    id: UUID
    position: int
    question: str
    options: list[Option]
    context: Context
    file_removed: bool
    # The saved original question served again (its file was removed, or the model's item was unusable).
    from_original: bool
    answer: Answer | None


class Round(BaseModel):
    id: UUID
    # The round's job: `queued`/`running` while it is being made; `failed`/`cancelled` leave it empty.
    status: str | None
    error_code: str | None
    items: list[Item]
    cleared_count: int
    total: int
    remaining_outstanding: int


class AnsweredItem(Item):
    cleared: bool
    cleared_count: int
    remaining_outstanding: int


class AnswerRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    option_id: Literal["a", "b", "c", "d"]


@router.post("", status_code=202, response_model=RoundAccepted)
async def start_round(request: Request, project: ActiveProject, user: UserAuth, conn: Conn) -> RoundAccepted:
    job, round_id = await review.request(conn, user.account_id, project["id"])
    # Started right after the commit, so the runner sees the job row (AD-20).
    runner = request.app.state.runner
    after_commit(request, lambda: runner.submit(job))
    return RoundAccepted(job_id=job["id"], round_id=round_id)


@router.get("/{round_id}", response_model=Round)
async def get_round(project_id: UUID, round_id: UUID, user: UserAuth, conn: Conn) -> Round:
    return Round.model_validate(await review.get(conn, user.account_id, project_id, round_id))


@router.post("/{round_id}/items/{practice_question_id}/answer", response_model=AnsweredItem)
async def answer_item(
    round_id: UUID, practice_question_id: UUID, body: AnswerRequest, project: ActiveProject, user: UserAuth, conn: Conn
) -> AnsweredItem:
    return AnsweredItem.model_validate(
        await review.answer(conn, user.account_id, project["id"], round_id, practice_question_id, body.option_id)
    )
