"""Mistakes (Story 3.3: FR-9, FR-12, FR-20, AD-10): the only writer of `mistakes`.

- `record_failure`: called by `quiz.answer` in the same transaction as a newly saved wrong answer. A
  repeat failure while the Question's Mistake is outstanding does nothing (partial unique index).
- `withdraw_for_material`: called by `materials.remove` inside the removal transaction when the student
  opted to take the file's Mistakes out of review (AD-23). A Mistake citing several files is withdrawn by
  the removal of any of them (AD-10).
- `outstanding_count` / `outstanding_by_material` / `summary`: computed every time, never stored.
  Cleared and withdrawn rows stay as history and never count.

- Mistake Review (Stories 3.4 + 3.5, AD-11): `oldest_outstanding`, `outstanding_among`, and `snapshots`
  are reads for `services/review`; `clear` is called by `review.answer` in the same transaction as a
  newly saved correct Practice answer. Practice answers never create Mistakes.

Takes `conn` and never commits (AD-18).
"""

from typing import Any
from uuid import UUID

from psycopg import AsyncConnection

from app.db import mistakes as repo
from app.services import projects


async def record_failure(
    conn: AsyncConnection, account_id: UUID, project_id: UUID, quiz_question_id: UUID, failed_answer_id: UUID
) -> bool:
    """Keep a wrong Quiz answer for review. True when a new Mistake was recorded; a correct or foreign
    `failed_answer_id` records nothing."""
    return await repo.insert(conn, account_id, project_id, quiz_question_id, failed_answer_id)


async def withdraw_for_material(conn: AsyncConnection, account_id: UUID, project_id: UUID, material_id: UUID) -> int:
    """Take the Project's outstanding Mistakes citing the Material out of review. Returns how many."""
    return await repo.withdraw_for_material(conn, account_id, project_id, material_id)


async def outstanding_count(conn: AsyncConnection, account_id: UUID, project_id: UUID) -> int:
    return await repo.outstanding_count(conn, account_id, project_id)


async def outstanding_by_material(conn: AsyncConnection, account_id: UUID, project_id: UUID) -> dict[UUID, int]:
    return await repo.outstanding_by_material(conn, account_id, project_id)


async def summary(conn: AsyncConnection, account_id: UUID, project_id: UUID) -> dict[str, Any]:
    """`{outstanding, by_material}` for the Project. A read: no guard, so a read-only Project answers."""
    await projects.get(conn, account_id, project_id)
    return {
        "outstanding": await outstanding_count(conn, account_id, project_id),
        "by_material": await outstanding_by_material(conn, account_id, project_id),
    }


# --- Mistake Review (Stories 3.4 + 3.5, AD-11) ---


async def oldest_outstanding(
    conn: AsyncConnection, account_id: UUID, project_id: UUID, limit: int
) -> list[dict[str, Any]]:
    """The Project's oldest outstanding Mistakes (at most `limit`), with their saved original question."""
    return await repo.oldest_outstanding(conn, account_id, project_id, limit)


async def outstanding_among(conn: AsyncConnection, account_id: UUID, mistake_ids: list[UUID]) -> set[UUID]:
    return await repo.outstanding_among(conn, account_id, mistake_ids)


async def snapshots(conn: AsyncConnection, account_id: UUID, mistake_ids: list[UUID]) -> dict[UUID, dict[str, Any]]:
    """The saved original question and the wrong answer's option id, by Mistake id (a read)."""
    return await repo.snapshots(conn, account_id, mistake_ids)


async def clear(conn: AsyncConnection, mistake_id: UUID, practice_answer_id: UUID) -> bool:
    """Clear a Mistake by a correct answer to its own Practice Question (FR-18, AD-10), in the answer's
    transaction. Idempotent: True when the Mistake is cleared by this answer, now or before; a wrong,
    foreign, or mismatched answer, or a Mistake withdrawn or cleared by another answer, changes nothing."""
    return await repo.clear(conn, mistake_id, practice_answer_id)


async def cleared_by(conn: AsyncConnection, account_id: UUID, answer_ids: list[UUID]) -> set[UUID]:
    """Which of these Practice answers cleared a Mistake."""
    return await repo.cleared_by(conn, account_id, answer_ids)
