"""Ask AI (Story 4.4: FR-16, AD-12, AD-18, AD-22, AD-25).

- `GET /api/projects/{project_id}/chat`: the Project's chat, created on first use, with its messages in
  `seq` order: `{id, current_scope, messages: [{id, role, text, sources: [{label}]}]}`. A read, so it also
  answers in a read-only Project.
- `PATCH /api/chats/{chat_id}` `{scope: {"all_materials": true} | {"material_id": M}}`: requires an active
  Project (`ActiveChat`, then `require_active` in the service); M must be a Ready file of the Project.
- `POST /api/chats/{chat_id}/messages` `{text}` (1-2000 characters): an `EventSourceResponse` of
  `delta {text}`, then `done {message_id, sources: [{label}]}` or `error {code}`. The refusals before
  the stream are ordinary JSON errors: `404 not_found`, `409 chat_busy`, `409 project_read_only`,
  `422 insufficient_material`, `429 quota_exceeded`. The route holds no request connection: auth and
  transaction 1 each run on a short connection returned before the stream starts (AD-18).
"""

from collections.abc import AsyncIterable, AsyncIterator
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.api.conn import Conn
from app.api.deps import ActiveChat
from app.auth import ReleasedUserAuth, UserAuth
from app.services import chat

router = APIRouter()


class AllMaterials(BaseModel):
    model_config = ConfigDict(extra="forbid")

    all_materials: Literal[True]


class OneFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    material_id: UUID


class ScopeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scope: AllMaterials | OneFile


class MessageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=chat.QUESTION_MAX_LENGTH)]


class Source(BaseModel):
    label: str


class ChatMessage(BaseModel):
    id: UUID
    role: Literal["user", "assistant"]
    text: str
    sources: list[Source]


class ChatScope(BaseModel):
    id: UUID
    # {"all_materials": true} or {"material_id": "<uuid>"}
    current_scope: dict[str, bool | str]


class Chat(ChatScope):
    messages: list[ChatMessage] = Field(default_factory=list)


@router.get("/projects/{project_id}/chat", response_model=Chat)
async def get_chat(project_id: UUID, user: UserAuth, conn: Conn) -> Chat:
    return Chat.model_validate(await chat.open_chat(conn, user.account_id, project_id))


@router.patch("/chats/{chat_id}", response_model=ChatScope)
async def set_scope(chat_id: UUID, body: ScopeRequest, _chat: ActiveChat, user: UserAuth, conn: Conn) -> ChatScope:
    return ChatScope.model_validate(
        await chat.set_scope(conn, user.account_id, chat_id, body.scope.model_dump(mode="json"))
    )


async def prepared_send(
    request: Request, chat_id: UUID, body: MessageRequest, user: ReleasedUserAuth
) -> AsyncIterator[chat.PendingSend]:
    """Transaction 1 of a send (the guard, the scope, the reservation), committed before the stream.

    The read-only guard for this route (AD-22): `chat.prepare_send` calls `projects.require_active`.
    Its teardown runs once the response has ended and releases a send the stream never settled, such as
    one whose stream never started.
    """
    state = request.app.state
    pending = await chat.prepare_send(
        state.pool, user.account_id, chat_id, body.text, state.settings.llm_context_budget_tokens
    )
    try:
        yield pending
    finally:
        await chat.abandon(state.pool, pending)


@router.post("/chats/{chat_id}/messages", response_class=EventSourceResponse)
async def send_message(
    request: Request, pending: Annotated[chat.PendingSend, Depends(prepared_send)]
) -> AsyncIterable[ServerSentEvent]:
    state = request.app.state
    async for event, data in chat.stream(state.pool, state.llm, pending, request.is_disconnected):
        yield ServerSentEvent(event=event, data=data)
