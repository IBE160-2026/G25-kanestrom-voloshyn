"""Phone upload (FR-21, AD-24): the hashed, short-lived, upload-only link, its batches, and the cleanup.

The only writer of `phone_upload_links`, `phone_batches`, and `phone_batch_photos` (the batch job's
`unit_settled_at` stamps go through `services/materials`). Takes `conn` and never commits (AD-18),
except `cleanup_stale`, the hourly in-process task, which takes the pool.

- **The link.** `create_link` makes a random 32-byte token and stores only its SHA-256 hash. It needs
  an active Project and the accepted Privacy notice. The computer revokes it when the QR dialog closes.
- **What the link can do** (checked by `auth.phone_link_auth`): read the four status fields, open a
  batch, add one photo per request to its own batch, and finalize that batch.
- **A photo** reserves one image unit in its own short transaction before it is stored (AD-12), then
  its row is added under the batch lock. A photo over a limit is refused on its own.
- **Finalize** hands the photos to `materials.create_from_batch`, which takes one slot under AD-5's
  Project lock. With no photo it creates nothing; with a full Project the staged photos are deleted
  and their units released.
- **Revoke** (the QR dialog closed) also discards the link's open batches: their units come back and
  their staged photos are deleted after the commit, so nothing sent after the close is kept.
- **Cleanup** deletes unfinalized batches past their window (link expiry + `FINALIZE_GRACE_SECONDS`, or
  a revoked link), their staged photos, and releases their units; it also deletes links expired more
  than `LINK_RETENTION_SECONDS` ago with their finalized batch rows. It is one of AD-2's
  system-context exceptions.
- Every mutation runs `projects.require_active` (AD-22). Locks are taken in the order Project, batch,
  photos, usage counter.
Never logs a token.
"""

import asyncio
import hashlib
import logging
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

from app.db import phone as repo
from app.errors import AppError
from app.services import identity, materials, projects, usage
from app.storage import Storage, phone_photo_path

logger = logging.getLogger(__name__)

TOKEN_BYTES = 32
# Finalize is still allowed this long after the link expires (AD-24).
FINALIZE_GRACE_SECONDS = 600
# The stale-batch cleanup runs at startup, then this often (AD-24).
CLEANUP_INTERVAL_SECONDS = 3600
# Expired links, with their finalized batch and photo rows (file names, paths), are kept this long.
LINK_RETENTION_SECONDS = 86_400


@dataclass(frozen=True)
class PhoneLink:
    """What `auth.phone_link_auth` hands a phone route: the link and the one Project it may touch."""

    link_id: UUID
    project_id: UUID
    account_id: UUID
    expires_at: Any
    project_name: str | None


class LinkExpired(AppError):
    def __init__(self) -> None:
        super().__init__(410, "link_expired", "This phone link has expired")


class LinkNotFound(AppError):
    def __init__(self) -> None:
        super().__init__(404, "not_found", "No such phone link")


class BatchNotFound(AppError):
    def __init__(self) -> None:
        super().__init__(404, "not_found", "No such batch")


class BatchFinalized(AppError):
    def __init__(self) -> None:
        super().__init__(409, "conflict", "The batch has already been sent")


class NoPhotos(AppError):
    def __init__(self) -> None:
        super().__init__(422, "insufficient_material", "The batch holds no accepted photo")


def new_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def hash_token(token: str) -> str:
    """The SHA-256 hex digest stored in place of the token."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# --- The link (Story 6.1) ---


async def create_link(
    conn: AsyncConnection, account_id: UUID, project_id: UUID, ttl_seconds: int
) -> tuple[dict[str, Any], str]:
    """A new link for an active Project; returns (link row, token). The token is only ever returned
    here, once; the database keeps its hash."""
    # The Privacy notice gate comes first, as for uploads (AD-19).
    await identity.require_privacy_ack(conn, account_id)
    await projects.require_active(conn, account_id, project_id)
    token = new_token()
    link = await repo.insert_link(conn, account_id, project_id, hash_token(token), ttl_seconds)
    return link, token


async def revoke_link(
    conn: AsyncConnection, storage: Storage, account_id: UUID, project_id: UUID, link_id: UUID
) -> Callable[[], Any]:
    """The computer closed the QR dialog. Bookkeeping: no read-only guard; idempotent. Returns the
    after-commit step that deletes the staged photos of the link's discarded open batches."""
    if await repo.get_link_for_project(conn, account_id, project_id, link_id) is None:
        raise LinkNotFound()
    return await _revoke(conn, storage, account_id, link_id)


async def revoke_by_token(conn: AsyncConnection, storage: Storage, link: PhoneLink) -> Callable[[], Any]:
    """The beacon fallback: a beacon can't carry a bearer token, so the link revokes itself."""
    return await _revoke(conn, storage, link.account_id, link.link_id)


async def revoke_for_project(
    conn: AsyncConnection, storage: Storage, account_id: UUID, project_id: UUID
) -> Callable[[], Any]:
    """Revoke every open link of the Project (archive, AD-22/AD-24): each goes through `_revoke`, so its
    open batches are discarded. Returns one after-commit step that deletes all their staged photos."""
    deletes = [
        await _revoke(conn, storage, account_id, link_id)
        for link_id in await repo.open_link_ids_for_project(conn, account_id, project_id)
    ]

    async def delete_all() -> None:
        for delete in deletes:
            await delete()

    return delete_all


async def _revoke(conn: AsyncConnection, storage: Storage, account_id: UUID, link_id: UUID) -> Callable[[], Any]:
    """Revoke the link and discard its open batches: their units come back now, their staged photos go
    after the commit. A batch a finalize is committing is waited for, then left alone (finalized)."""
    await repo.revoke(conn, account_id, link_id)
    deletes = []
    for batch in await repo.open_batches_for_update(conn, account_id, link_id):
        photos = await repo.photos_of(conn, batch["id"])
        deletes.append(await _discard(conn, storage, account_id, batch["id"], photos))

    async def delete_all() -> None:
        for delete in deletes:
            await delete()

    return delete_all


async def find_link(conn: AsyncConnection, token: str, grace_seconds: int = 0) -> PhoneLink:
    """The usable link for this token, or `410 link_expired` (unknown, revoked, expired past the
    grace, or its Project is no longer active)."""
    row = await repo.find_link(conn, hash_token(token), grace_seconds)
    if row is None:
        raise LinkExpired()
    return PhoneLink(
        link_id=row["id"],
        project_id=row["project_id"],
        account_id=row["account_id"],
        expires_at=row["expires_at"],
        project_name=row["project_name"],
    )


# --- The phone page (Story 6.2) ---


async def status(conn: AsyncConnection, link: PhoneLink) -> dict[str, Any]:
    """The only four things the link can read (AD-24)."""
    return {
        "project_name": link.project_name,
        "images_left_today": await usage.remaining(conn, link.account_id, usage.IMAGE_EXTRACTION),
        "slot_available": await materials.slot_available(conn, link.account_id, link.project_id),
        "expires_at": link.expires_at,
    }


async def create_batch(conn: AsyncConnection, link: PhoneLink) -> dict[str, Any]:
    # The read-only guard (AD-22), on top of the link's own check.
    await projects.require_active(conn, link.account_id, link.project_id)
    return await repo.insert_batch(
        conn, {"id": link.link_id, "project_id": link.project_id, "account_id": link.account_id}
    )


async def _open_batch(conn: AsyncConnection, link: PhoneLink, batch_id: UUID) -> dict[str, Any]:
    """The link's own batch, locked, still open; `404` for any other batch."""
    return _check_open(await repo.get_batch_for_update(conn, link.account_id, link.link_id, batch_id))


def _check_open(batch: dict[str, Any] | None) -> dict[str, Any]:
    if batch is None:
        raise BatchNotFound()
    if batch["finalized_at"] is not None:
        raise BatchFinalized()
    return batch


async def add_photo(
    conn: AsyncConnection,
    storage: Storage,
    pool: AsyncConnectionPool,
    link: PhoneLink,
    batch_id: UUID,
    raw_file_name: str | None,
    data: bytes,
    on_rollback: Callable[[Callable[[], Any]], None],
) -> dict[str, Any]:
    """Accept one photo into the batch (AD-24), or refuse it on its own: `unsupported_file_type`,
    `file_too_large`, or `quota_exceeded`. The unit is reserved before storing, in its own short
    transaction (as in `materials.upload`), and released if this request rolls back."""
    file_name = materials.clean_file_name(raw_file_name)
    file_type, content_type = materials.validate(file_name, len(data))
    if file_type not in materials.IMAGE_TYPES:
        raise materials.UnsupportedFileType()
    # Checked before the unit and the storage, so a closed or foreign batch costs nothing. No row lock
    # is held while storing; the batch is locked and checked again before the row is added.
    _check_open(await repo.get_batch(conn, link.account_id, link.link_id, batch_id))
    day = await materials.reserve_image(pool, link.account_id)
    on_rollback(lambda: materials.release_image(pool, link.account_id, day))
    photo_id = uuid4()
    path = phone_photo_path(link.account_id, link.project_id, batch_id, photo_id)
    await storage.put(path, data, content_type)
    on_rollback(lambda: storage.delete(path))
    # The read-only guard (AD-22) after the storage write, as in the upload pipeline (AD-5): no row
    # lock is held while storing. Then the batch lock (lock order: Project, then batch).
    await projects.require_active(conn, link.account_id, link.project_id)
    await _open_batch(conn, link, batch_id)
    position = await repo.next_position(conn, batch_id)
    return await repo.insert_photo(
        conn,
        photo_id=photo_id,
        batch_id=batch_id,
        position=position,
        storage_path=path,
        usage_day=day,
        size_bytes=len(data),
        file_name=file_name,
        file_type=file_type,
    )


@dataclass(frozen=True)
class Finalized:
    """The outcome of `finalize`: the Material and its job, or a refusal to send after the commit
    (the batch is discarded in this same transaction). `after_commit` deletes staged photos."""

    material: dict[str, Any] | None
    job: dict[str, Any] | None
    refusal: AppError | None
    after_commit: Callable[[], Any] | None
    pages: int


async def finalize(conn: AsyncConnection, storage: Storage, link: PhoneLink, batch_id: UUID) -> Finalized:
    """Turn the batch into one Study Material (AD-24). No photo: `422 insufficient_material`, nothing
    created. A full Project: the batch is discarded (photos deleted after the commit, units released
    now), and `material_limit_reached` is returned as the refusal. A batch that is gone after the link
    expired (the cleanup deleted it) is `410 link_expired`."""
    # The read-only guard (AD-22) first: lock order Project, then batch, as for photos.
    await projects.require_active(conn, link.account_id, link.project_id)
    batch = await repo.get_batch_for_update(conn, link.account_id, link.link_id, batch_id)
    if batch is None and link.expires_at <= datetime.now(UTC):
        raise LinkExpired()
    _check_open(batch)
    photos = await repo.photos_of(conn, batch_id)
    if not photos:
        raise NoPhotos()
    try:
        material, job = await materials.create_from_batch(
            conn, link.account_id, link.project_id, len(photos), sum(p["size_bytes"] for p in photos)
        )
    except materials.MaterialLimitReached as refusal:
        delete = await _discard(conn, storage, link.account_id, batch_id, photos)
        return Finalized(material=None, job=None, refusal=refusal, after_commit=delete, pages=len(photos))
    await repo.mark_finalized(conn, link.account_id, batch_id, material["id"])
    return Finalized(material=material, job=job, refusal=None, after_commit=None, pages=len(photos))


async def _discard(
    conn: AsyncConnection, storage: Storage, account_id: UUID, batch_id: UUID, photos: list[dict[str, Any]]
) -> Callable[[], Any]:
    """Release every photo's unit and delete the batch, in the caller's transaction. Returns the
    after-commit step that deletes the staged photos (AD-16)."""
    for photo in photos:
        await usage.release(conn, account_id, usage.IMAGE_EXTRACTION, photo["usage_day"])
    await repo.delete_batch(conn, batch_id)
    return materials.delete_paths(storage, [p["storage_path"] for p in photos])


# --- The stale-batch cleanup (AD-24) ---


async def cleanup_stale(pool: AsyncConnectionPool, storage: Storage) -> int:
    """Delete every unfinalized batch past its window or of a revoked link: its staged photos go, its
    units come back, and nothing is created. Then delete links expired more than a day ago, with their
    (finalized) batch and photo rows. Returns how many batches went."""
    deletes: list[Callable[[], Any]] = []
    async with pool.connection() as conn:
        async with conn.transaction():
            stale = await repo.stale_batches(conn, FINALIZE_GRACE_SECONDS)
            for batch in stale:
                photos = await repo.photos_of(conn, batch["id"])
                deletes.append(await _discard(conn, storage, batch["account_id"], batch["id"], photos))
            await repo.delete_old_links(conn, LINK_RETENTION_SECONDS)
    for delete in deletes:
        try:
            await delete()
        except Exception as exc:  # noqa: BLE001 -- a failed delete is logged; the rows are gone
            logger.warning("Phone photo delete failed: %s", type(exc).__name__)
    if stale:
        logger.info("Phone cleanup: %d stale batch(es) deleted", len(stale))
    return len(stale)


async def cleanup_forever(
    pool: AsyncConnectionPool, storage: Storage, interval: float = CLEANUP_INTERVAL_SECONDS
) -> None:
    """At startup, then every `interval` seconds, until cancelled (the app's lifespan)."""
    while True:
        try:
            await cleanup_stale(pool, storage)
        except Exception as exc:  # noqa: BLE001 -- retried on the next round
            logger.warning("Phone cleanup failed: %s", type(exc).__name__)
        await asyncio.sleep(interval)
