"""Request-scoped dependencies shared by the routers."""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from psycopg import AsyncConnection


async def request_conn(request: Request) -> AsyncIterator[AsyncConnection]:
    """One pooled connection and one transaction per request (AD-18).

    Commits when the handler returns, rolls back when it raises. Services take this `conn`
    and never commit themselves.
    """
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            yield conn


# scope="function": the transaction ends (commit or rollback) before the response starts, so a
# failed commit becomes an error response instead of a 200 for work that was never saved.
Conn = Annotated[AsyncConnection, Depends(request_conn, scope="function")]
