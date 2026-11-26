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
from app.api import chats as chats_api
from app.api import config as config_api
from app.api import flashcards as flashcards_api
from app.api import history as history_api
from app.api import jobs as jobs_api
from app.api import materials as materials_api
from app.api import me as me_api
from app.api import mistakes as mistakes_api
from app.api import phone as phone_api
from app.api import projects as projects_api
from app.api import quizzes as quizzes_api
from app.api import review as review_api
from app.api import summaries as summaries_api
from app.api import topics as topics_api
from app.api import usage as usage_api
from app.config import Settings, get_settings, resolve_llm_mode
from app.db.pool import create_pool
from app.errors import error_response, install_error_handlers
from app.llm import create_gateway
from app.services import flashcards, jobs, materials, password_reset, phone, projects, quiz, review, summaries
from app.storage import Storage

logger = logging.getLogger(__name__)

# Seconds between restart-sweep attempts while the database is still coming up.
SWEEP_RETRY_SECONDS = 5.0

ALL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]

# Any query parameter named `...token` or `token_hash`: the email links (`token=`, `token_hash=`)
# and Supabase session values (`access_token=`, `refresh_token=`).
_TOKEN_QUERY = re.compile(r"(?<=[?&])((?:[a-z_]*token(?:_hash)?|code)=)[^&\s]*", re.IGNORECASE)
_REDACTED = "[redacted]"
_REPLACEMENT = r"\1" + _REDACTED
# The phone-link token sits in the path: the phone page `/u/{token}` and `/api/phone/{token}/...` (AD-24).
_TOKEN_PATH = re.compile(r"(/u/|/api/phone/)[^/?#\s\"]+")


def _redact(text: str) -> str:
    return _TOKEN_PATH.sub(_REPLACEMENT, _TOKEN_QUERY.sub(_REPLACEMENT, text))


class _RedactTokens(logging.Filter):
    """Blanks token query values (`token=`, `token_hash=`, `access_token=`, `code=`, any case) in access-log
    lines (AD-19), and the phone-link token in `/u/{token}` and `/api/phone/{token}` paths (AD-24)."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(_redact(arg) if isinstance(arg, str) else arg for arg in record.args)
        if isinstance(record.msg, str):
            record.msg = _redact(record.msg)
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
    api.include_router(topics_api.router)
    api.include_router(quizzes_api.router)
    api.include_router(flashcards_api.router)
    api.include_router(summaries_api.router)
    api.include_router(chats_api.router)
    api.include_router(history_api.router)
    api.include_router(mistakes_api.router)
    api.include_router(review_api.router)
    api.include_router(jobs_api.router)
    api.include_router(usage_api.router)
    api.include_router(phone_api.links)
    api.include_router(phone_api.router)

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
        kinds = {
            materials.KIND: materials.processing_kind(settings, storage, pool, llm),
            quiz.KIND: quiz.quiz_kind(pool, llm),
            flashcards.KIND: flashcards.flashcards_kind(pool, llm),
            summaries.KIND: summaries.summary_kind(pool, llm),
            review.KIND: review.review_kind(pool, llm, settings.llm_context_budget_tokens),
        }
        runner = jobs.Runner(pool, kinds, settings.jobs_max_concurrent)
        app.state.runner = runner
        sweep = asyncio.create_task(_sweep_until_done(pool, kinds))
        app.state.sweep = sweep
        # The stale phone-batch cleanup (AD-24): at startup, then hourly, in this process.
        cleanup = asyncio.create_task(phone.cleanup_forever(pool, storage))
        app.state.phone_cleanup = cleanup
        # The 30-day purge of Deleted projects (FR-24): at startup, then hourly, in this process (AD-20).
        purge = asyncio.create_task(projects.purge_expired_forever(pool, storage, runner))
        app.state.purge = purge
        try:
            yield
        finally:
            sweep.cancel()
            cleanup.cancel()
            purge.cancel()
            await asyncio.gather(sweep, cleanup, purge, return_exceptions=True)
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

    @app.middleware("http")
    async def _no_referrer_on_phone_page(request, call_next):
        """The phone page's URL holds the link token: never send it on as a Referer (AD-24)."""
        response = await call_next(request)
        if request.url.path.startswith("/u/"):
            response.headers["Referrer-Policy"] = "no-referrer"
        return response
    app.include_router(_api_router())

    dist = settings.frontend_dist
    if (dist / "index.html").is_file():
        app.frontend("/", directory=dist, fallback="index.html")
    else:
        logger.warning("No built SPA at %s; serving the API only", dist)

    return app


logging.basicConfig(level=logging.INFO)
app = create_app()
