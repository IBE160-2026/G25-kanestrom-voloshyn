"""The `phone_upload_links`, `phone_batches`, and `phone_batch_photos` repository (AD-24). Plain SQL.

Every query is scoped by `account_id`, except the closed list of system-context lookups (AD-2): the
token-hash lookup (`find_link`) and the stale-batch cleanup (`stale_batches`, `delete_batch`). Only
`services/phone` writes these tables; `settle_photos` is `services/materials`' one exception.
Takes the caller's `conn` and never commits.
"""

from typing import Any
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import dict_row

_LINK = "id, project_id, account_id, expires_at, revoked_at, created_at"
_BATCH = "id, link_id, project_id, account_id, created_at, finalized_at, material_id"
_PHOTO = (
    "id, batch_id, position, storage_path, usage_day, size_bytes, file_name, file_type, unit_settled_at, created_at"
)


# --- Links ---


async def insert_link(
    conn: AsyncConnection, account_id: UUID, project_id: UUID, token_hash: str, ttl_seconds: int
) -> dict[str, Any]:
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"""
            INSERT INTO phone_upload_links (token_hash, project_id, account_id, expires_at)
            VALUES (%s, %s, %s, now() + make_interval(secs => %s))
            RETURNING {_LINK}
            """,
            (token_hash, project_id, account_id, ttl_seconds),
        )
        return await cur.fetchone()


async def find_link(conn: AsyncConnection, token_hash: str, grace_seconds: int) -> dict[str, Any] | None:
    """The link with this token hash, not revoked, not past `expires_at + grace_seconds`, and whose
    Project is still active, with the Project's name. A system-context lookup by token hash (AD-2)."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            """
            SELECT l.id, l.project_id, l.account_id, l.expires_at, p.name AS project_name
            FROM phone_upload_links l
            JOIN projects p ON p.id = l.project_id AND p.account_id = l.account_id
            WHERE l.token_hash = %s
              AND l.revoked_at IS NULL
              AND now() < l.expires_at + make_interval(secs => %s)
              AND p.archived_at IS NULL AND p.deleted_at IS NULL
            """,
            (token_hash, grace_seconds),
        )
        return await cur.fetchone()


async def revoke(conn: AsyncConnection, account_id: UUID, link_id: UUID) -> bool:
    """Revoke a link; True when it was found (also when it was revoked already)."""
    async with conn.cursor() as cur:
        await cur.execute(
            """
            UPDATE phone_upload_links SET revoked_at = coalesce(revoked_at, now())
            WHERE id = %s AND account_id = %s
            """,
            (link_id, account_id),
        )
        return cur.rowcount == 1


async def get_link_for_project(
    conn: AsyncConnection, account_id: UUID, project_id: UUID, link_id: UUID
) -> dict[str, Any] | None:
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"SELECT {_LINK} FROM phone_upload_links WHERE id = %s AND account_id = %s AND project_id = %s",
            (link_id, account_id, project_id),
        )
        return await cur.fetchone()


# --- Batches ---


async def insert_batch(conn: AsyncConnection, link: dict[str, Any]) -> dict[str, Any]:
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"""
            INSERT INTO phone_batches (link_id, project_id, account_id) VALUES (%s, %s, %s)
            RETURNING {_BATCH}
            """,
            (link["id"], link["project_id"], link["account_id"]),
        )
        return await cur.fetchone()


async def get_batch(conn: AsyncConnection, account_id: UUID, link_id: UUID, batch_id: UUID) -> dict[str, Any] | None:
    """The batch, only through the link that created it."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"SELECT {_BATCH} FROM phone_batches WHERE id = %s AND link_id = %s AND account_id = %s",
            (batch_id, link_id, account_id),
        )
        return await cur.fetchone()


async def get_batch_for_update(
    conn: AsyncConnection, account_id: UUID, link_id: UUID, batch_id: UUID
) -> dict[str, Any] | None:
    """The batch, only through the link that created it, locked until the transaction ends."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"SELECT {_BATCH} FROM phone_batches WHERE id = %s AND link_id = %s AND account_id = %s FOR UPDATE",
            (batch_id, link_id, account_id),
        )
        return await cur.fetchone()


async def open_batches_for_update(conn: AsyncConnection, account_id: UUID, link_id: UUID) -> list[dict[str, Any]]:
    """The link's unfinalized batches, locked (waiting for a finalize that holds one)."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"""
            SELECT {_BATCH} FROM phone_batches
            WHERE link_id = %s AND account_id = %s AND finalized_at IS NULL
            FOR UPDATE
            """,
            (link_id, account_id),
        )
        return await cur.fetchall()


async def delete_old_links(conn: AsyncConnection, retention_seconds: int) -> None:
    """Delete links expired more than `retention_seconds` ago that hold no open batch; their finalized
    batch and photo rows go by cascade. The cleanup's system-context write (AD-2)."""
    await conn.execute(
        """
        DELETE FROM phone_upload_links l
        WHERE l.expires_at < now() - make_interval(secs => %s)
          AND NOT EXISTS (SELECT 1 FROM phone_batches b WHERE b.link_id = l.id AND b.finalized_at IS NULL)
        """,
        (retention_seconds,),
    )


async def mark_finalized(conn: AsyncConnection, account_id: UUID, batch_id: UUID, material_id: UUID) -> None:
    await conn.execute(
        "UPDATE phone_batches SET finalized_at = now(), material_id = %s WHERE id = %s AND account_id = %s",
        (material_id, batch_id, account_id),
    )


async def delete_batch(conn: AsyncConnection, batch_id: UUID) -> None:
    """Delete a batch and (by cascade) its photo rows."""
    await conn.execute("DELETE FROM phone_batches WHERE id = %s", (batch_id,))


async def stale_batches(conn: AsyncConnection, grace_seconds: int) -> list[dict[str, Any]]:
    """Unfinalized batches whose link is revoked or past `expires_at + grace_seconds`, locked; the cleanup's
    system-context read (AD-2, AD-24). Rows a concurrent finalize holds are skipped until next time."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"""
            SELECT {", ".join("b." + c.strip() for c in _BATCH.split(","))}
            FROM phone_batches b JOIN phone_upload_links l ON l.id = b.link_id
            WHERE b.finalized_at IS NULL
              AND (l.revoked_at IS NOT NULL OR now() >= l.expires_at + make_interval(secs => %s))
            FOR UPDATE OF b SKIP LOCKED
            """,
            (grace_seconds,),
        )
        return await cur.fetchall()


# --- Photos ---


async def next_position(conn: AsyncConnection, batch_id: UUID) -> int:
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT coalesce(max(position) + 1, 0) FROM phone_batch_photos WHERE batch_id = %s", (batch_id,)
        )
        return (await cur.fetchone())[0]


async def insert_photo(
    conn: AsyncConnection,
    *,
    photo_id: UUID,
    batch_id: UUID,
    position: int,
    storage_path: str,
    usage_day: Any,
    size_bytes: int,
    file_name: str,
    file_type: str,
) -> dict[str, Any]:
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"""
            INSERT INTO phone_batch_photos
              (id, batch_id, position, storage_path, usage_day, size_bytes, file_name, file_type)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING {_PHOTO}
            """,
            (photo_id, batch_id, position, storage_path, usage_day, size_bytes, file_name, file_type),
        )
        return await cur.fetchone()


async def photos_of(conn: AsyncConnection, batch_id: UUID) -> list[dict[str, Any]]:
    """The batch's photos in page order."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(f"SELECT {_PHOTO} FROM phone_batch_photos WHERE batch_id = %s ORDER BY position", (batch_id,))
        return await cur.fetchall()


async def photos_of_material(conn: AsyncConnection, account_id: UUID, material_id: UUID) -> list[dict[str, Any]]:
    """The photos of the batch finalized into this Material, in page order."""
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"""
            SELECT {", ".join("p." + c.strip() for c in _PHOTO.split(","))}
            FROM phone_batch_photos p JOIN phone_batches b ON b.id = p.batch_id
            WHERE b.material_id = %s AND b.account_id = %s
            ORDER BY p.position
            """,
            (material_id, account_id),
        )
        return await cur.fetchall()


async def settle_photos(conn: AsyncConnection, photo_ids: list[UUID]) -> list[dict[str, Any]]:
    """Mark these photos' image units settled: used by a vision call that is about to start, or given
    back by the caller in the same transaction (AD-12). Returns the photos that were still unsettled,
    so a unit is never settled twice."""
    if not photo_ids:
        return []
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(
            f"""
            UPDATE phone_batch_photos SET unit_settled_at = now()
            WHERE id = ANY(%s) AND unit_settled_at IS NULL
            RETURNING {_PHOTO}
            """,
            (photo_ids,),
        )
        return await cur.fetchall()
