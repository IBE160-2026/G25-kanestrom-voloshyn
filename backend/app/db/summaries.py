"""The `summaries` and `summary_sections` repository (Story 4.3, AD-8). Plain SQL; scoped by `account_id`.

Only `services/summaries` calls it. Both tables are insert-only. Takes the caller's `conn`; never commits.
"""

from typing import Any
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


async def insert(
    conn: AsyncConnection,
    *,
    summary_id: UUID,
    account_id: UUID,
    project_id: UUID,
    job_id: UUID,
    generation_params: dict[str, Any],
    title: str,
    sections: list[dict[str, Any]],
) -> None:
    """The summary and its sections, in order."""
    async with conn.cursor() as cur:
        await cur.execute(
            """
            INSERT INTO summaries (id, account_id, project_id, job_id, generation_params, title)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (summary_id, account_id, project_id, job_id, Jsonb(generation_params), title),
        )
        await cur.executemany(
            """
            INSERT INTO summary_sections (summary_id, position, heading, text, source_section_ids, material_ids)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            [
                (
                    summary_id,
                    position,
                    section["heading"],
                    section["text"],
                    list(section["source_section_ids"]),
                    list(section["material_ids"]),
                )
                for position, section in enumerate(sections)
            ],
        )


async def get(conn: AsyncConnection, account_id: UUID, project_id: UUID, summary_id: UUID) -> dict[str, Any] | None:
    """`id`, `title`, and `generation_params`; None for a missing or foreign summary."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT id, title, generation_params FROM summaries
            WHERE id = %s AND account_id = %s AND project_id = %s
            """,
            (summary_id, account_id, project_id),
        )
        return await cur.fetchone()


async def sections(conn: AsyncConnection, account_id: UUID, summary_id: UUID) -> list[dict[str, Any]]:
    """The summary's sections by `position`: `position`, `heading`, `text`, `source_section_ids`."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT x.position, x.heading, x.text, x.source_section_ids
            FROM summary_sections x JOIN summaries s ON s.id = x.summary_id
            WHERE x.summary_id = %s AND s.account_id = %s
            ORDER BY x.position
            """,
            (summary_id, account_id),
        )
        return await cur.fetchall()
