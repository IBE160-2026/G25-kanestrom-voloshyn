"""The async pool reaches local Supabase Postgres (AD-16, AD-29)."""

import asyncio
import sys

from app.config import Settings
from app.db.pool import create_pool


async def _select_one(settings: Settings) -> int:
    pool = create_pool(settings)
    try:
        await pool.open(wait=True, timeout=10)
        async with pool.connection() as conn:
            cur = await conn.execute("SELECT 1")
            row = await cur.fetchone()
            return row[0]
    finally:
        await pool.close()


def test_pool_runs_select_one_against_local_supabase():
    # Ignore .env: it may hold the Docker container's host.docker.internal URL. Tests run on the
    # host against local Supabase, so the default 127.0.0.1:54322 URL (or a DATABASE_URL env var) applies.
    settings = Settings(_env_file=None)
    # psycopg's async mode cannot use Windows' default ProactorEventLoop.
    loop_factory = asyncio.SelectorEventLoop if sys.platform == "win32" else None
    with asyncio.Runner(loop_factory=loop_factory) as runner:
        assert runner.run(_select_one(settings)) == 1
