"""History (Story 5.1: FR-25, FR-8, AD-27).

- `GET /api/projects/{project_id}/history?type=&cursor=`: one page of everything made in the Project,
  newest first: `{items, next_cursor}`. `type` is `chat`, `quiz`, `flashcards`, or `summary`, or absent
  for all (anything else is `422`). `next_cursor` is null on the last page. A read, so a read-only
  Project's History still answers; a missing or foreign Project is `404 not_found`.
"""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.api.deps import Conn
from app.auth import UserAuth
from app.services import history

router = APIRouter(prefix="/projects/{project_id}")


class QuizItem(BaseModel):
    type: Literal["quiz"]
    id: UUID
    created_at: datetime
    # The frozen Topic labels joined with ", "; null for all topics.
    title: str | None
    question_count: int
    answered_count: int
    correct_count: int


class FlashcardsItem(BaseModel):
    type: Literal["flashcards"]
    id: UUID
    created_at: datetime
    title: str | None
    card_count: int


class SummaryItem(BaseModel):
    type: Literal["summary"]
    id: UUID
    created_at: datetime
    # The summary's stored title, and the frozen file name.
    title: str
    file_name: str


class ChatItem(BaseModel):
    type: Literal["chat"]
    id: UUID
    created_at: datetime
    # The chat's first question.
    title: str | None
    message_count: int
    # The scoped file's name while it is Ready; null means all materials.
    scope_file_name: str | None


HistoryItem = Annotated[QuizItem | FlashcardsItem | SummaryItem | ChatItem, Field(discriminator="type")]


class HistoryPage(BaseModel):
    items: list[HistoryItem]
    next_cursor: str | None


@router.get("/history", response_model=HistoryPage)
async def get_history(
    project_id: UUID,
    user: UserAuth,
    conn: Conn,
    type: Literal["chat", "quiz", "flashcards", "summary"] | None = None,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
) -> HistoryPage:
    return HistoryPage.model_validate(await history.list_page(conn, user.account_id, project_id, type, cursor))
