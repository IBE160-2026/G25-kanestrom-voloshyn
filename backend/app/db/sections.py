"""Section reads shared by the generation services (`services/quiz`, `services/review`; AD-7, AD-9).
Plain SQL; read-only. Takes the caller's `conn`; never commits.
"""

from typing import Any
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import dict_row


async def load_sections(conn: AsyncConnection, section_ids: list[UUID]) -> list[dict[str, Any]]:
    """The Sections (`id`, `material_id`, `label`, `text`) in the order of `section_ids`. A removed
    Material's Sections come back with empty text (AD-23)."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT s.id, s.material_id, s.label, s.text
            FROM unnest(%s::uuid[]) WITH ORDINALITY AS wanted(id, ord)
            JOIN sections s ON s.id = wanted.id
            ORDER BY wanted.ord
            """,
            (section_ids,),
        )
        return await cur.fetchall()


async def removed_materials(conn: AsyncConnection, material_ids: list[UUID]) -> set[UUID]:
    """The Materials among `material_ids` that are removed or gone (a plain read; the save step locks)."""
    wanted = set(material_ids)
    if not wanted:
        return set()
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT id FROM study_materials WHERE id = ANY(%s) AND removed_at IS NULL", (list(wanted),)
        )
        present = {row[0] for row in await cur.fetchall()}
    return wanted - present


async def any_removed(conn: AsyncConnection, material_ids: list[UUID]) -> bool:
    """True when one of the Materials is removed or gone."""
    return bool(await removed_materials(conn, material_ids))


async def source_labels(conn: AsyncConnection, account_id: UUID, section_ids: list[UUID]) -> dict[UUID, str]:
    """`"{file_name} · {section label}"` by Section id. A removed file keeps its name and label (AD-23)."""
    if not section_ids:
        return {}
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT s.id, m.file_name || ' · ' || s.label
            FROM sections s JOIN study_materials m ON m.id = s.material_id
            WHERE s.id = ANY(%s) AND m.account_id = %s
            """,
            (section_ids, account_id),
        )
        return {row[0]: row[1] for row in await cur.fetchall()}
