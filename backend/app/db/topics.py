"""The `topics` and `topic_sections` repository (AD-21). Plain SQL.

Only `services/topics` calls the writers here. Takes the caller's `conn` and never commits. Callers
scope by `account_id` through the Material they already checked.
"""

from typing import Any
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import dict_row


async def insert_many(
    conn: AsyncConnection,
    material_id: UUID,
    topics: list[tuple[UUID, str, str | None]],
    links: list[tuple[UUID, UUID]],
    origin: str = "auto",
) -> None:
    """Topics as (id, label, group_label), positioned in list order, and their (topic_id, section_id)
    links."""
    async with conn.cursor() as cur:
        await cur.executemany(
            "INSERT INTO topics (id, material_id, label, group_label, position, origin) VALUES (%s, %s, %s, %s, %s, %s)",
            [
                (topic_id, material_id, label, group_label, position, origin)
                for position, (topic_id, label, group_label) in enumerate(topics)
            ],
        )
        await cur.executemany("INSERT INTO topic_sections (topic_id, section_id) VALUES (%s, %s)", links)


async def list_for_materials(conn: AsyncConnection, material_ids: list[UUID]) -> list[dict[str, Any]]:
    """The Topics of these Materials (`material_id`, `id`, `label`, `group_label`, `position`), each
    Material's in position order."""
    if not material_ids:
        return []
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT material_id, id, label, group_label, position FROM topics
            WHERE material_id = ANY(%s)
            ORDER BY material_id, position
            """,
            (material_ids,),
        )
        return await cur.fetchall()
