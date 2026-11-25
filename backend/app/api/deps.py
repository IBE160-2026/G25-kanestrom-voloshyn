"""Request-scoped dependencies shared by the routers."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import Depends

from app.api.conn import Conn, request_conn
from app.auth import UserAuth
from app.services import chat, projects

__all__ = ["ActiveChat", "ActiveProject", "Conn", "active_chat", "active_project", "request_conn"]


async def active_project(project_id: UUID, user: UserAuth, conn: Conn) -> dict[str, Any]:
    """The URL's Project, owned by the caller and neither archived nor deleted (AD-22).

    Every Project content route takes this dependency, so the guard runs before the handler:
    `404 not_found` for a missing or foreign id, `409 project_read_only` otherwise. It takes no row
    lock; the service calls the locking `projects.require_active` where it mutates.
    """
    return await projects.check_active(conn, user.account_id, project_id)


ActiveProject = Annotated[dict[str, Any], Depends(active_project)]


async def active_chat(chat_id: UUID, user: UserAuth, conn: Conn) -> dict[str, Any]:
    """The URL's chat, owned by the caller, in a Project that is neither archived nor deleted (AD-22).

    The guard for chat routes, which carry no Project id: `404 not_found` for a missing or foreign
    chat, `409 project_read_only` otherwise. Like `active_project`, it takes no row lock.
    """
    found = await chat.get_chat(conn, user.account_id, chat_id)
    await projects.check_active(conn, user.account_id, found["project_id"])
    return found


ActiveChat = Annotated[dict[str, Any], Depends(active_chat)]
