"""Mistakes (Story 3.3: FR-9, FR-12, AD-10).

- `GET /api/projects/{project_id}/mistakes/summary`: `{outstanding, by_material: {material_id: n}}`,
  computed each time from the outstanding Mistakes (neither cleared nor withdrawn). A read, so no
  read-only guard: an archived or deleted Project still answers, and the SPA hides the card there.
"""

from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.deps import Conn
from app.auth import UserAuth
from app.services import mistakes

router = APIRouter(prefix="/projects/{project_id}/mistakes")


class MistakesSummary(BaseModel):
    outstanding: int
    # Outstanding Mistakes per cited Material; a Mistake citing two files counts for each.
    by_material: dict[UUID, int]


@router.get("/summary", response_model=MistakesSummary)
async def get_summary(project_id: UUID, user: UserAuth, conn: Conn) -> MistakesSummary:
    return MistakesSummary.model_validate(await mistakes.summary(conn, user.account_id, project_id))
