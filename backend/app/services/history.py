"""History: one list of everything made in a Project (Story 5.1: FR-25, FR-8, AD-27).

A pure read over chats, Quizzes, Flashcard sets, and Summaries: no history table and no write, so it
also answers in an archived or deleted Project (`projects.get`, no guard). A missing or foreign Project
is `404 not_found`. Items come newest first by `(created_at, id)`, 30 to a page; a chat sorts by
`created_at`, not `last_opened_at`. A chat with no messages is not listed.

The cursor is opaque to the SPA: base64 of the JSON `{"at": <created_at>, "id": <id>}` of the page's
last item. A cursor that doesn't decode is `422 invalid_request`.
"""

import base64
import binascii
import json
from datetime import datetime
from typing import Any
from uuid import UUID

from psycopg import AsyncConnection

from app.db import history as repo
from app.errors import AppError
from app.services import projects

PAGE_SIZE = 30
TYPES = ("chat", "quiz", "flashcards", "summary")


class InvalidCursor(AppError):
    def __init__(self) -> None:
        super().__init__(422, "invalid_request", "Invalid history cursor", {"fields": ["query.cursor"]})


def encode_cursor(created_at: datetime, item_id: UUID) -> str:
    raw = json.dumps({"at": created_at.isoformat(), "id": str(item_id)}).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        data = json.loads(raw)
        at = datetime.fromisoformat(data["at"])
        if at.tzinfo is None:
            raise ValueError("naive timestamp")
        return at, UUID(data["id"])
    except (binascii.Error, ValueError, TypeError, KeyError, UnicodeDecodeError):
        raise InvalidCursor() from None


def _topic_title(params: Any) -> str | None:
    """The frozen Topic labels joined with ", "; null for all topics."""
    labels = params.get("topic_labels") if isinstance(params, dict) else None
    labels = [label for label in labels or [] if isinstance(label, str) and label]
    return ", ".join(labels) if labels else None


def _item(row: dict[str, Any]) -> dict[str, Any]:
    kind = row["type"]
    item: dict[str, Any] = {"type": kind, "id": row["id"], "created_at": row["created_at"]}
    params = row["generation_params"] if isinstance(row["generation_params"], dict) else {}
    if kind == "quiz":
        item |= {
            "title": _topic_title(params),
            "question_count": row["question_count"],
            "answered_count": row["answered_count"],
            "correct_count": row["correct_count"],
        }
    elif kind == "flashcards":
        item |= {"title": _topic_title(params), "card_count": row["card_count"]}
    elif kind == "summary":
        item |= {"title": row["stored_title"], "file_name": params.get("file_name") or ""}
    else:
        item |= {
            "title": row["first_question"],
            "message_count": row["message_count"],
            "scope_file_name": row["scope_file_name"],
        }
    return item


async def list_page(
    conn: AsyncConnection, account_id: UUID, project_id: UUID, kind: str | None, cursor: str | None
) -> dict[str, Any]:
    """`{items, next_cursor}`: one page of the Project's History, of one type or all of them."""
    after = decode_cursor(cursor) if cursor else None
    await projects.get(conn, account_id, project_id)
    types = [kind] if kind else list(TYPES)
    rows = await repo.page(conn, account_id, project_id, types=types, after=after, limit=PAGE_SIZE + 1)
    shown = rows[:PAGE_SIZE]
    next_cursor = None
    if len(rows) > PAGE_SIZE:
        last = shown[-1]
        next_cursor = encode_cursor(last["created_at"], last["id"])
    return {"items": [_item(row) for row in shown], "next_cursor": next_cursor}
