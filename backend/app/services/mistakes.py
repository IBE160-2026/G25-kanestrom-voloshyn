"""Mistakes (Story 3.3: FR-9, FR-12, FR-20, AD-10): the only writer of `mistakes`.

- `record_failure`: called by `quiz.answer` in the same transaction as a newly saved wrong answer. A
  repeat failure while the Question's Mistake is outstanding does nothing (partial unique index).
- `withdraw_for_material`: called by `materials.remove` inside the removal transaction when the student
  opted to take the file's Mistakes out of review (AD-23). A Mistake citing several files is withdrawn by
  the removal of any of them (AD-10).
- `outstanding_count` / `outstanding_by_material` / `summary`: computed every time, never stored.
  Cleared and withdrawn rows stay as history and never count.

`clear` arrives with Story 3.5. Takes `conn` and never commits (AD-18).
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
