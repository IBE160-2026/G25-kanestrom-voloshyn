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


# --- Student edits (Story 2.6b, FR-22) ---

_TOPIC_COLUMNS = "t.id, t.material_id, t.label, t.group_label, t.position, m.status AS material_status"


async def get_many(
    conn: AsyncConnection, account_id: UUID, project_id: UUID, topic_ids: list[UUID]
) -> list[dict[str, Any]]:
    """The Topics among `topic_ids` whose Material belongs to this Account and Project and is not
    removed; any other id is simply missing from the result."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"""
            SELECT {_TOPIC_COLUMNS} FROM topics t
            JOIN study_materials m ON m.id = t.material_id
            WHERE t.id = ANY(%s) AND m.account_id = %s AND m.project_id = %s AND m.removed_at IS NULL
            ORDER BY t.position
            """,
            (topic_ids, account_id, project_id),
        )
        return await cur.fetchall()


async def get(conn: AsyncConnection, account_id: UUID, project_id: UUID, topic_id: UUID) -> dict[str, Any] | None:
    rows = await get_many(conn, account_id, project_id, [topic_id])
    return rows[0] if rows else None


async def count(conn: AsyncConnection, material_id: UUID) -> int:
    async with conn.cursor() as cur:
        await cur.execute("SELECT count(*) FROM topics WHERE material_id = %s", (material_id,))
        return (await cur.fetchone())[0]


async def max_position(conn: AsyncConnection, material_id: UUID) -> int | None:
    async with conn.cursor() as cur:
        await cur.execute("SELECT max(position) FROM topics WHERE material_id = %s", (material_id,))
        return (await cur.fetchone())[0]


async def update_label(conn: AsyncConnection, topic_id: UUID, label: str) -> None:
    async with conn.cursor() as cur:
        await cur.execute("UPDATE topics SET label = %s WHERE id = %s", (label, topic_id))


async def delete(conn: AsyncConnection, topic_ids: list[UUID]) -> None:
    """Delete these Topics; their Section links cascade."""
    async with conn.cursor() as cur:
        await cur.execute("DELETE FROM topics WHERE id = ANY(%s)", (topic_ids,))


async def relink(conn: AsyncConnection, to_topic_id: UUID, from_topic_ids: list[UUID], orphans_only: bool = False) -> None:
    """Link `to_topic_id` to the Sections of `from_topic_ids`. With `orphans_only`, only the Sections
    no other Topic covers, so a delete keeps every Section covered without widening other Topics."""
    orphan_filter = (
        "AND NOT EXISTS (SELECT 1 FROM topic_sections o WHERE o.section_id = ts.section_id AND o.topic_id <> ALL(%s))"
        if orphans_only
        else ""
    )
    params: tuple = (to_topic_id, from_topic_ids, from_topic_ids) if orphans_only else (to_topic_id, from_topic_ids)
    async with conn.cursor() as cur:
        await cur.execute(
            f"""
            INSERT INTO topic_sections (topic_id, section_id)
            SELECT %s, ts.section_id FROM topic_sections ts
            WHERE ts.topic_id = ANY(%s) {orphan_filter}
            ON CONFLICT DO NOTHING
            """,
            params,
        )


async def insert_one(
    conn: AsyncConnection, material_id: UUID, label: str, position: int, origin: str = "student"
) -> UUID:
    """One Topic with no Sections and no group."""
    async with conn.cursor() as cur:
        await cur.execute(
            "INSERT INTO topics (material_id, label, position, origin) VALUES (%s, %s, %s, %s) RETURNING id",
            (material_id, label, position, origin),
        )
        return (await cur.fetchone())[0]


# --- Scope resolution (AD-7) ---

# Sections in scope: of Ready, non-removed Materials only, in upload order, then page order.
_SCOPE_SECTIONS = """
    SELECT s.id, s.material_id, s.text FROM sections s
    JOIN study_materials m ON m.id = s.material_id
    WHERE m.account_id = %s AND m.project_id = %s AND m.removed_at IS NULL AND m.status = 'ready' AND ({where})
    ORDER BY m.created_at, m.id, s.position
"""


async def scope_sections_all(conn: AsyncConnection, account_id: UUID, project_id: UUID) -> list[dict[str, Any]]:
    """Every Section of every Ready, non-removed Material of the Project (`id`, `material_id`, `text`)."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(_SCOPE_SECTIONS.format(where="true"), (account_id, project_id))
        return await cur.fetchall()


async def scope_sections_of(
    conn: AsyncConnection, account_id: UUID, project_id: UUID, topic_ids: list[UUID], whole_material_ids: list[UUID]
) -> list[dict[str, Any]]:
    """The Sections the Topics cover, plus every Section of `whole_material_ids` (a student Topic with no
    Sections stands for its whole Material), each once."""
    where = "s.id IN (SELECT section_id FROM topic_sections WHERE topic_id = ANY(%s)) OR s.material_id = ANY(%s)"
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(_SCOPE_SECTIONS.format(where=where), (account_id, project_id, topic_ids, whole_material_ids))
        return await cur.fetchall()


async def topics_without_sections(conn: AsyncConnection, topic_ids: list[UUID]) -> set[UUID]:
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT t.id FROM topics t
            WHERE t.id = ANY(%s) AND NOT EXISTS (SELECT 1 FROM topic_sections ts WHERE ts.topic_id = t.id)
            """,
            (topic_ids,),
        )
        return {row[0] for row in await cur.fetchall()}
