"""FastAPI app: /api/* routes, the /api catch-all, and the built SPA on one origin (AD-17)."""

import asyncio
import logging
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import APIRouter, FastAPI

from app import supabase_auth
from app.api import auth as auth_api
from app.api import config as config_api
from app.api import jobs as jobs_api
from app.api import materials as materials_api
from app.api import me as me_api
from app.api import projects as projects_api
from app.config import Settings, get_settings, resolve_llm_mode
from app.db.pool import create_pool
from app.errors import error_response, install_error_handlers
from app.llm import create_gateway
from app.services import jobs, materials, password_reset
from app.storage import Storage

logger = logging.getLogger(__name__)

# Seconds between restart-sweep attempts while the database is still coming up.
SWEEP_RETRY_SECONDS = 5.0

ALL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]

# Any query parameter named `...token` or `token_hash`: the email links (`token=`, `token_hash=`)
# and Supabase session values (`access_token=`, `refresh_token=`).
_TOKEN_QUERY = re.compile(r"(?<=[?&])([A-Za-z_]*token(?:_hash)?=)[^&\s]*")
_REDACTED = "[redacted]"
_REPLACEMENT = r"\1" + _REDACTED


class _RedactTokens(logging.Filter):
    """Blanks token query values (`token=`, `token_hash=`, `access_token=`, ...) in access-log lines (AD-19)."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(
                _TOKEN_QUERY.sub(_REPLACEMENT, arg) if isinstance(arg, str) else arg for arg in record.args
            )
        if isinstance(record.msg, str):
            record.msg = _TOKEN_QUERY.sub(_REPLACEMENT, record.msg)
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
    api.include_router(projects_api.router)
    api.include_router(materials_api.router)
    api.include_router(jobs_api.router)

    # Registered last, so it only catches paths no real API route matched.
    @api.api_route("", methods=ALL_METHODS, include_in_schema=False)
    @api.api_route("/{path:path}", methods=ALL_METHODS, include_in_schema=False)
    async def api_not_found(path: str = ""):
        return error_response(404, "not_found", "No API route matches this path")

    return api


async def _sweep_until_done(pool, kinds: dict[str, jobs.JobKind]) -> None:
    """The restart sweep (AD-20), retried until the database answers. Only jobs created before this
    process started are swept, so it never touches the jobs this process runs. The start time is the
    database's own clock (`SELECT now()`, taken once), the same clock as `created_at`."""
    started_at: datetime | None = None
    while True:
        try:
            if started_at is None:
                started_at = await jobs.database_now(pool)
            await jobs.sweep_interrupted(pool, kinds, started_at)
            return
        except Exception as exc:  # noqa: BLE001 -- retried until the database is up
            logger.warning("Restart sweep failed, retrying: %s", type(exc).__name__)
            await asyncio.sleep(SWEEP_RETRY_SECONDS)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # After uvicorn has configured its loggers, so the filter stays attached.
        _redact_access_log()
        app.state.llm_mode = resolve_llm_mode(settings)
        logger.info("Starting (APP_ENV=%s, LLM mode=%s)", settings.app_env, app.state.llm_mode)
        # The one LLM gateway (AD-3, AD-4); no client and no network in mock mode.
        llm = create_gateway(settings, app.state.llm_mode)
        app.state.llm = llm
        pool = create_pool(settings)
        # wait=False: the app starts even while the database is still coming up.
        await pool.open(wait=False)
        app.state.pool = pool
        # The one HTTP client for Supabase Auth (AD-2).
        http = supabase_auth.create_client(settings)
        app.state.http = http
        storage = Storage(http, settings)
        app.state.storage = storage
        # In-process background jobs (AD-20, AD-29), then the restart sweep for the previous process.
        kinds = {materials.KIND: materials.processing_kind(settings, storage, pool, llm)}
        runner = jobs.Runner(pool, kinds, settings.jobs_max_concurrent)
        app.state.runner = runner
        sweep = asyncio.create_task(_sweep_until_done(pool, kinds))
        app.state.sweep = sweep
        try:
            yield
        finally:
            sweep.cancel()
            await asyncio.gather(sweep, return_exceptions=True)
            # Let running jobs and reset emails finish before their pool and client close.
            await runner.drain()
            await password_reset.drain()
            await http.aclose()
            await llm.aclose()
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
