"""Request-scoped dependencies shared by the routers."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import Depends

from app.api.conn import Conn, request_conn
from app.auth import UserAuth
from app.services import projects

__all__ = ["ActiveProject", "Conn", "active_project", "request_conn"]


async def active_project(project_id: UUID, user: UserAuth, conn: Conn) -> dict[str, Any]:
    """The URL's Project, owned by the caller and neither archived nor deleted (AD-22).

    Every Project content route takes this dependency, so `require_active` runs before the
    handler: `404 not_found` for a missing or foreign id, `409 project_read_only` otherwise.
    """
    return await projects.require_active(conn, user.account_id, project_id)


ActiveProject = Annotated[dict[str, Any], Depends(active_project)]
