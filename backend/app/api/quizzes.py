"""Quiz setup, generation, and taking (FR-10, FR-11, FR-26, AD-7, AD-9, AD-20).

- `GET /api/projects/{project_id}/capacity?scope=<json>`: `{max_questions, max_cards}` for a scope,
  deterministic, with no model call; both are the same estimate (AD-7, Story 4.1). A read, so no read-only guard.
- `POST /api/projects/{project_id}/quizzes` `{scope, count}`: requires an active Project
  (`ActiveProject`); resolves the scope, refuses one over the context budget (`422 scope_too_large`), and
  queues a `quiz` job: `202 {job_id}`.
- `GET /api/projects/{project_id}/quizzes/{quiz_id}`: `{id, requested_count, question_count, questions}`.
  Each Question is `{id, position, question, options: [{id, text}], answer}`; `answer` is null until the
  Question is answered, so the answer key, explanation, and sources never reach the browser before
  (AD-9). A read, so a read-only Project's Quiz still opens.
- `POST /api/projects/{project_id}/quizzes/{quiz_id}/questions/{question_id}/answer` `{option_id}`
  (Story 3.2, FR-11): requires an active Project; scores with no model call, saves the answer once, and
  returns the answered Question, `answer: {submitted_option_id, is_correct, correct_option_id,
  explanation, sources: [{label}]}`. A repeat submit returns the stored answer unchanged.

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
    # Flashcards (Story 4.1) use the same capacity as Quiz questions.
    max_cards: int


class QuizRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scope: Scope
    count: Literal[5, 10, 20]


class JobAccepted(BaseModel):
    job_id: UUID


class Option(BaseModel):
    id: str
    text: str


class SourceLabel(BaseModel):
    label: str


class Answer(BaseModel):
    submitted_option_id: str
    is_correct: bool
    correct_option_id: str
    explanation: str
    sources: list[SourceLabel]


class Question(BaseModel):
    id: UUID
    position: int
    question: str
    options: list[Option]
    answer: Answer | None


class Quiz(BaseModel):
    id: UUID
    requested_count: int
    question_count: int
    questions: list[Question]


class AnswerRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    option_id: Literal["a", "b", "c", "d"]


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
    items = await quiz.capacity(conn, user.account_id, project_id, scope_dict(parsed), words_per_item)
    return Capacity(max_questions=items, max_cards=items)


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


@router.post("/quizzes/{quiz_id}/questions/{question_id}/answer", response_model=Question)
async def answer_question(
    quiz_id: UUID, question_id: UUID, body: AnswerRequest, project: ActiveProject, user: UserAuth, conn: Conn
) -> Question:
    return Question.model_validate(
        await quiz.answer(conn, user.account_id, project["id"], quiz_id, question_id, body.option_id)
    )
