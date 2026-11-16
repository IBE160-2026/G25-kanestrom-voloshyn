"""FastAPI app: /api/* routes, the /api catch-all, and the built SPA on one origin (AD-17)."""

import logging
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI

from app import supabase_auth
from app.api import auth as auth_api
from app.api import config as config_api
from app.api import me as me_api
from app.config import Settings, get_settings, resolve_llm_mode
from app.db.pool import create_pool
from app.errors import error_response, install_error_handlers

logger = logging.getLogger(__name__)

ALL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]

_TOKEN_QUERY = re.compile(r"(?<=token=)[^&\s]*")
_REDACTED = "[redacted]"


class _RedactTokens(logging.Filter):
    """Blanks `token=` query values in access-log lines, e.g. the email verification link (AD-19)."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(
                _TOKEN_QUERY.sub(_REDACTED, arg) if isinstance(arg, str) else arg for arg in record.args
            )
        if isinstance(record.msg, str):
            record.msg = _TOKEN_QUERY.sub(_REDACTED, record.msg)
        return True


def _redact_access_log() -> None:
    access = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, _RedactTokens) for f in access.filters):
        access.addFilter(_RedactTokens())


def _api_router() -> APIRouter:
    api = APIRouter(prefix="/api")
    api.include_router(config_api.router)
    api.include_router(auth_api.router)
    api.include_router(me_api.router)

    # Registered last, so it only catches paths no real API route matched.
    @api.api_route("", methods=ALL_METHODS, include_in_schema=False)
    @api.api_route("/{path:path}", methods=ALL_METHODS, include_in_schema=False)
    async def api_not_found(path: str = ""):
        return error_response(404, "not_found", "No API route matches this path")

    return api


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # After uvicorn has configured its loggers, so the filter stays attached.
        _redact_access_log()
        app.state.llm_mode = resolve_llm_mode(settings)
        logger.info("Starting (APP_ENV=%s, LLM mode=%s)", settings.app_env, app.state.llm_mode)
        pool = create_pool(settings)
        # wait=False: the app starts even while the database is still coming up.
        await pool.open(wait=False)
        app.state.pool = pool
        # The one HTTP client for Supabase Auth (AD-2).
        http = supabase_auth.create_client(settings)
        app.state.http = http
        try:
            yield
        finally:
            await http.aclose()
            await pool.close()

    # Docs live under /api (AD-17). FastAPI registers them in __init__, before the catch-all.
    app = FastAPI(
        title="AI Study Buddy",
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    app.state.settings = settings
    install_error_handlers(app)
    app.include_router(_api_router())

    dist = settings.frontend_dist
    if (dist / "index.html").is_file():
        app.frontend("/", directory=dist, fallback="index.html")
    else:
        logger.warning("No built SPA at %s; serving the API only", dist)

    return app


logging.basicConfig(level=logging.INFO)
app = create_app()
