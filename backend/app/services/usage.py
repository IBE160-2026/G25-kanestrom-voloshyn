"""Daily usage limits (FR-7, AD-12): the only code that reads or writes `usage_counters`.

A unit is reserved before the metered work and released only when that work never happened, or
failed at the provider. `reserve` is one atomic upsert that increments only while the count is under
the limit, so two parallel requests at the last unit can't both pass. A day is the calendar day in
`QUOTA_TIMEZONE` (default Europe/Oslo); a release always names the day its `reserve` returned.

Takes the given `conn` and never commits (AD-18). Quotas apply in mock mode too.
"""

from datetime import date, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from psycopg import AsyncConnection

from app.config import get_settings
from app.errors import AppError

IMAGE_EXTRACTION = "image_extraction"
# One Ask AI message, across every chat and Project (FR-16, Story 4.4).
ASK_AI_MESSAGE = "ask_ai_message"

# Units per Account per day.
LIMITS = {IMAGE_EXTRACTION: 25, ASK_AI_MESSAGE: 50}


class QuotaExceeded(AppError):
    """`429 quota_exceeded {limit, kind}`; the SPA keys its copy by `kind`."""

    def __init__(self, limit: int, kind: str) -> None:
        super().__init__(429, "quota_exceeded", "Today's limit is used up", {"limit": limit, "kind": kind})


def usage_day(now: datetime | None = None, timezone: str | None = None) -> date:
    """Today's calendar day in `timezone` (default `QUOTA_TIMEZONE`)."""
    zone = ZoneInfo(timezone or get_settings().quota_timezone)
    moment = now if now is not None else datetime.now(zone)
    return moment.astimezone(zone).date()


def _limit(kind: str) -> int:
    try:
        return LIMITS[kind]
    except KeyError:
        raise ValueError(f"Unknown usage kind {kind!r}") from None


async def reserve(conn: AsyncConnection, account_id: UUID, kind: str, *, day: date | None = None) -> date:
    """Use one unit of today's `kind`; returns the day it counts toward. `QuotaExceeded` at the limit."""
    limit = _limit(kind)
    day = day or usage_day()
    async with conn.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO usage_counters (account_id, usage_day, kind, count)
            VALUES (%s, %s, %s, 1)
            ON CONFLICT (account_id, usage_day, kind)
            DO UPDATE SET count = usage_counters.count + 1
            WHERE usage_counters.count < %s
            RETURNING count
            """,
            (account_id, day, kind, limit),
        )
        if await cur.fetchone() is None:
            raise QuotaExceeded(limit, kind)
    return day


async def remaining(conn: AsyncConnection, account_id: UUID, kind: str, *, day: date | None = None) -> int:
    """Units of `kind` left today."""
    limit = _limit(kind)
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT count FROM usage_counters WHERE account_id = %s AND usage_day = %s AND kind = %s",
            (account_id, day or usage_day(), kind),
        )
        row = await cur.fetchone()
    return max(0, limit - (row[0] if row else 0))


async def release(conn: AsyncConnection, account_id: UUID, kind: str, day: date) -> None:
    """Give back one unit of `kind` on `day` (the day `reserve` returned); never below 0."""
    _limit(kind)
    async with conn.cursor() as cur:
        await cur.execute(
            """
            UPDATE usage_counters SET count = count - 1
            WHERE account_id = %s AND usage_day = %s AND kind = %s AND count > 0
            """,
            (account_id, day, kind),
        )
