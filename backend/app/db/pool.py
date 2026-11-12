"""The one async Postgres connection pool (AD-16, AD-29)."""

from psycopg_pool import AsyncConnectionPool

from app.config import Settings


def create_pool(settings: Settings) -> AsyncConnectionPool:
    """Create the pool closed; the lifespan opens it with `open(wait=False)`."""
    return AsyncConnectionPool(
        conninfo=settings.database_url.get_secret_value(),
        min_size=1,
        max_size=10,
        open=False,
        name="app",
    )
