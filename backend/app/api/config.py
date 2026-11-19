"""GET /api/config: the only Supabase values the browser receives, at runtime (AD-1, AD-17), and the
public address the phone QR code encodes (AD-24)."""

from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter()


class PublicConfig(BaseModel):
    supabase_url: str
    supabase_publishable_key: str
    google_enabled: bool
    # What the QR code points the phone at: `{app_public_url}/u/{token}` (AD-17, AD-24).
    app_public_url: str


@router.get("/config", response_model=PublicConfig)
async def get_config(request: Request) -> PublicConfig:
    settings = request.app.state.settings
    return PublicConfig(
        supabase_url=settings.supabase_public_url,
        supabase_publishable_key=settings.supabase_publishable_key,
        google_enabled=settings.google_enabled,
        app_public_url=settings.app_public_url.rstrip("/"),
    )
