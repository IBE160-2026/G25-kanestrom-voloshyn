"""The request connection: one pooled connection and one transaction per request (AD-18).

Kept apart from `deps.py`, so `app/auth.py` can use it while `deps.py` builds on `user_auth`.

A handler can register work to run right after the transaction commits (`after_commit`, e.g.
starting a background job) or after it rolls back (`on_rollback`, e.g. deleting a stored original
that no row will refer to). Both run before the response is sent, so they don't depend on it being
delivered. Callbacks are zero-argument functions returning an awaitable or None; failures are
logged and swallowed.
"""

import inspect
import logging
from collections.abc import AsyncIterator, Callable
from typing import Annotated, Any

from fastapi import Depends, Request
from psycopg import AsyncConnection

logger = logging.getLogger(__name__)

Callback = Callable[[], Any]


def after_commit(request: Request, callback: Callback) -> None:
    """Run `callback` once the request transaction has committed."""
    request.state.after_commit.append(callback)


def on_rollback(request: Request, callback: Callback) -> None:
    """Run `callback` if the request transaction rolls back (the handler raised, or the commit failed)."""
    request.state.on_rollback.append(callback)


async def _run(callbacks: list[Callback]) -> None:
    for callback in callbacks:
        try:
            result = callback()
            if inspect.isawaitable(result):
                await result
        except Exception as exc:  # noqa: BLE001 -- the transaction outcome is already decided
            logger.warning("Transaction callback failed: %s", type(exc).__name__)


async def request_conn(request: Request) -> AsyncIterator[AsyncConnection]:
    """One pooled connection and one transaction per request (AD-18).

    Commits when the handler returns, rolls back when it raises. Services take this `conn`
    and never commit themselves.
    """
    request.state.after_commit = []
    request.state.on_rollback = []
    try:
        async with request.app.state.pool.connection() as conn:
            async with conn.transaction():
                yield conn
    except BaseException:
        await _run(request.state.on_rollback)
        raise
    await _run(request.state.after_commit)


# scope="function": the transaction ends (commit or rollback) before the response starts, so a
# failed commit becomes an error response instead of a 200 for work that was never saved.
Conn = Annotated[AsyncConnection, Depends(request_conn, scope="function")]
