"""`GET /api/usage`: what is left of the signed-in Account's daily limits today (FR-7, AD-12)."""

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.conn import Conn
from app.auth import UserAuth
from app.services import usage

router = APIRouter()


class Usage(BaseModel):
    # Image uploads left today (25 a day, FR-7); the SPA shows the Limit notice at 10 or fewer.
    images_left_today: int
    # Ask AI messages left today (50 a day, FR-16); the chat's Limit notice shows at 10 or fewer.
    messages_left_today: int


@router.get("/usage", response_model=Usage)
async def get_usage(user: UserAuth, conn: Conn) -> Usage:
    return Usage(
        images_left_today=await usage.remaining(conn, user.account_id, usage.IMAGE_EXTRACTION),
        messages_left_today=await usage.remaining(conn, user.account_id, usage.ASK_AI_MESSAGE),
    )
