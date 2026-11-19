"""Study Materials (FR-6, FR-8, AD-5, AD-6): upload, the `material_processing` job, and the list.

The only writer of `study_materials.status`. Takes `conn` and never commits (AD-18).

Upload (one file per request, AD-5):
1. validate the type and size; for an image, reserve one `image_extraction` unit of today's limit
   (FR-7, AD-12) in its own short transaction, released again if the request rolls back;
2. store the original in the private bucket, registering its deletion for a rollback;
3. lock the Project row (`projects.require_active`, FOR UPDATE) and re-check the slot count, so two
   parallel uploads at 9 of 10 can't both pass;
4. insert the Material in `processing` and enqueue its job. The route hands the job to the runner
   right after the commit and answers `202`.
If anything after step 2 fails, or the commit does, the stored original is deleted after the rollback.

Processing: extract (in a thread) -> Content Integrity -> Topics (`detect_topics`, no transaction open)
-> one save transaction with the Sections, the Topics and their links, and `ready`, or `rejected` with
its reason; a rejected Material's original is deleted after the commit. A Topic detection error fails
the job, and the terminal hook rejects the Material (`processing_failed`) with nothing saved.
After a `ready` commit, an unnamed Project is named from that Material's Sections (FR-4, AD-14).

An image (FR-7) is normalized to JPEG (in a thread), then read by the gateway's `extract_image_text`
with no transaction open; its text becomes one Section "Image", judged by its legibility and length,
and from there it is handled like any other file. Right before the vision call the job's
`vision_started_at` is stamped; that marker decides the reserved unit's fate. The unit is given
back only when the call never started (removed or cancelled before it, a job that never reached it,
a file that can't be decoded) or failed at the provider; once the call started it stays used.

Removal (FR-20, AD-23): one transaction sets `removed_at`, empties the Sections' text, cancels the
Material's job, and, when asked, withdraws the file's outstanding Mistakes; the stored original is deleted
after the commit.
"""

import logging
import posixpath
from collections.abc import Callable
from datetime import date
from typing import Any
from uuid import UUID, uuid4

from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

from app import extraction
from app.config import Settings
from app.db import materials as repo
from app.errors import AppError
from app.extraction import Extracted, ExtractedSection, images, integrity
from app.extraction.types import clean
from app.llm import Gateway, ProviderError
from app.services import identity, jobs, mistakes, projects, topics, usage
from app.storage import Storage, material_path

logger = logging.getLogger(__name__)

KIND = "material_processing"
MAX_MATERIALS = 10
MAX_BYTES = 50 * 1024 * 1024
FILE_NAME_MAX = 255

# Accepted extensions -> (file_type, content type): documents (FR-6) and photos of notes (FR-7).
DOCUMENT_TYPES = {
    ".pdf": ("pdf", "application/pdf"),
    ".docx": ("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ".pptx": ("pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
    ".txt": ("txt", "text/plain"),
    ".md": ("md", "text/markdown"),
    ".jpg": ("jpg", "image/jpeg"),
    ".jpeg": ("jpg", "image/jpeg"),
    ".png": ("png", "image/png"),
    ".heic": ("heic", "image/heic"),
}
IMAGE_TYPES = images.IMAGE_TYPES
# The one Section an image becomes.
IMAGE_SECTION_LABEL = "Image"

# Reject reasons (AD-6): codes the SPA translates.
UNREADABLE = "unreadable"
UNPARSEABLE = "unparseable"


class MaterialNotFound(AppError):
    def __init__(self) -> None:
        super().__init__(404, "not_found", "No such file")


class UnsupportedFileType(AppError):
    def __init__(self) -> None:
        super().__init__(422, "unsupported_file_type", "This file type isn't supported")


class FileTooLarge(AppError):
    def __init__(self) -> None:
        super().__init__(413, "file_too_large", "The file is over 50 MB", {"max_mb": 50})


class MaterialLimitReached(AppError):
    def __init__(self) -> None:
        super().__init__(409, "material_limit_reached", "The Project already holds 10 files", {"max": MAX_MATERIALS})


def clean_file_name(raw: str | None) -> str:
    """The base name, without control characters, at most 255 characters (keeping the extension)."""
    name = posixpath.basename((raw or "").replace("\\", "/"))
    name = "".join(ch for ch in name if ch.isprintable()).strip()
    if len(name) > FILE_NAME_MAX:
        stem, ext = posixpath.splitext(name)
        name = stem[: FILE_NAME_MAX - len(ext)] + ext
    return name


def file_type_of(file_name: str) -> tuple[str, str]:
    """(file_type, content type) from the extension, or `unsupported_file_type`."""
    ext = posixpath.splitext(file_name)[1].lower()
    try:
        return DOCUMENT_TYPES[ext]
    except KeyError:
        raise UnsupportedFileType() from None


def validate(file_name: str, size_bytes: int) -> tuple[str, str]:
    """Step 1 (sync): the type, then the size. Returns (file_type, content type)."""
    types = file_type_of(file_name)
    if size_bytes > MAX_BYTES:
        raise FileTooLarge()
    return types


async def upload(
    conn: AsyncConnection,
    storage: Storage,
    account_id: UUID,
    project_id: UUID,
    raw_file_name: str | None,
    data: bytes,
    on_rollback: Callable[[Callable[[], Any]], None],
    pool: AsyncConnectionPool,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Steps 1-4 of the upload pipeline (AD-5). Returns (material, job); the caller submits the job
    after the commit. `on_rollback` registers work to run if the request transaction rolls back.
    `pool` gives an image's quota reservation its own transaction."""
    # The Privacy notice gate comes first (AD-19): without acceptance nothing is validated, stored, or
    # inserted. (The request body itself has already been received by then.)
    await identity.require_privacy_ack(conn, account_id)
    file_name = clean_file_name(raw_file_name)
    file_type, content_type = validate(file_name, len(data))
    params: dict[str, Any] = {"file_type": file_type}
    if file_type in IMAGE_TYPES:
        # Its own short transaction: no counter row lock is held while storing, so a removal (which
        # releases under the Project lock) can't deadlock with an upload. The 26th image stops here.
        day = await _reserve_image(pool, account_id)
        on_rollback(lambda: _release_image(pool, account_id, day))
        # The mock reads the outcome from the file name (AD-4).
        params.update(usage_day=day.isoformat(), file_name=file_name)

    material_id = uuid4()
    path = material_path(account_id, project_id, material_id)
    # Stored before any row lock is taken (AD-5, AD-18). After a rollback no row refers to it.
    await storage.put(path, data, content_type)
    on_rollback(lambda: storage.delete(path))

    # The read-only guard, and the Project row lock the slot count is re-checked under.
    await projects.require_active(conn, account_id, project_id)
    if await repo.count_slots(conn, account_id, project_id) >= MAX_MATERIALS:
        raise MaterialLimitReached()
    material = await repo.insert(
        conn,
        material_id=material_id,
        account_id=account_id,
        project_id=project_id,
        file_name=file_name,
        file_type=file_type,
        size_bytes=len(data),
    )
    job = await jobs.enqueue(conn, account_id, project_id, KIND, params=params, result_ref=material_id)
    return material, job


# --- The daily image limit (FR-7, AD-12) ---


async def _reserve_image(pool: AsyncConnectionPool, account_id: UUID) -> date:
    async with pool.connection() as conn:
        async with conn.transaction():
            return await usage.reserve(conn, account_id, usage.IMAGE_EXTRACTION)


async def _release_image(pool: AsyncConnectionPool, account_id: UUID, day: date) -> None:
    async with pool.connection() as conn:
        async with conn.transaction():
            await usage.release(conn, account_id, usage.IMAGE_EXTRACTION, day)


def _image_unit(job: dict[str, Any]) -> date | None:
    """The day of the unit an image job holds; None for a document."""
    params = job.get("params") or {}
    if params.get("file_type") not in IMAGE_TYPES or not params.get("usage_day"):
        return None
    return date.fromisoformat(params["usage_day"])


async def _release_if_unread(conn: AsyncConnection, job: dict[str, Any]) -> None:
    """Give back an image job's unit when its vision call never started (no `vision_started_at`)."""
    day = _image_unit(job)
    if day is not None and job.get("vision_started_at") is None:
        await usage.release(conn, job["account_id"], usage.IMAGE_EXTRACTION, day)


async def list_for_project(conn: AsyncConnection, account_id: UUID, project_id: UUID) -> list[dict[str, Any]]:
    """Every non-removed Material of the Project with its last status (FR-8) and its Topics in order
    (FR-22). A read: no guard."""
    await projects.get(conn, account_id, project_id)
    rows = await repo.list_for_project(conn, account_id, project_id)
    by_material = await topics.list_for_materials(conn, [row["id"] for row in rows])
    return [{**row, "topics": by_material.get(row["id"], [])} for row in rows]


async def remove(
    conn: AsyncConnection,
    storage: Storage,
    account_id: UUID,
    project_id: UUID,
    material_id: UUID,
    withdraw_mistakes: bool = False,
) -> Callable[[], Any]:
    """Remove a Material, all or nothing (FR-20, AD-23). Returns the after-commit step that deletes the
    stored original. An already removed Material keeps its removal as it was (only the Mistakes
    withdrawal below can still run), and the delete is returned again, so a retry deletes an original whose earlier delete failed (it is idempotent).

    The row, its file name, and its Section labels stay; the text goes. Generated content stays. With
    `withdraw_mistakes`, the outstanding Mistakes citing the file leave review in the same transaction
    (Story 3.3, AD-10); without it they stay outstanding. The withdrawal also runs for a file that is
    already removed, so a retried (or later) removal with the flag still withdraws its Mistakes.
    """
    await projects.require_active(conn, account_id, project_id)
    material = await repo.get_for_update(conn, account_id, material_id)
    if material is None or material["project_id"] != project_id:
        raise MaterialNotFound()
    if material["removed_at"] is None:
        await repo.mark_removed(conn, account_id, material_id)
        await repo.empty_sections(conn, material_id)
        # A queued image job never reaches its vision call, so its unit comes back. A running one is
        # ended by its save step, and its terminal hook decides.
        for cancelled in await jobs.cancel_for_material(conn, account_id, material_id):
            await _release_if_unread(conn, cancelled)
    if withdraw_mistakes:
        await mistakes.withdraw_for_material(conn, account_id, project_id, material_id)
    path = material_path(account_id, project_id, material_id)
    return lambda: storage.delete(path)


# --- The material_processing job (AD-5, AD-20) ---


def _reject_reason(job: dict[str, Any]) -> str:
    return jobs.INTERRUPTED if job.get("error_code") == jobs.INTERRUPTED else jobs.PROCESSING_FAILED


def processing_kind(
    settings: Settings, storage: Storage, pool: AsyncConnectionPool, llm: Gateway
) -> jobs.JobKind:
    """The handler and terminal hook for `material_processing`, bound to the settings, storage, the
    pool, and the LLM gateway (for Topic detection, and auto-naming after a ready commit)."""
    thresholds = integrity.Thresholds.from_settings(settings)

    def _delete_original(job: dict[str, Any]) -> jobs.AfterCommit:
        path = material_path(job["account_id"], job["project_id"], job["result_ref"])
        return lambda: storage.delete(path)

    async def read_image(job: dict[str, Any], data: bytes) -> tuple[Extracted, integrity.Verdict] | None:
        """Normalize (in a thread), then the vision call with no connection held (AD-18). None when a
        cancel came first. Raises `extraction.Unparseable` for an image that can't be decoded."""
        jpeg = await images.normalize(data, job["params"]["file_type"])
        if not await jobs.mark_vision_started(pool, job["id"]):
            return None
        try:
            read = await llm.extract_image_text(jpeg, job["params"].get("file_name", ""))
        except ProviderError:
            # The provider did no work: the unit comes back, and the job fails as usual.
            try:
                await _release_image(pool, job["account_id"], _image_unit(job))
            except Exception as exc:  # noqa: BLE001 -- the job still fails with the provider error
                logger.warning("Image unit release failed: %s", type(exc).__name__)
            raise
        text = clean(read.text)
        extracted = Extracted(paged=True, sections=(ExtractedSection(IMAGE_SECTION_LABEL, text),))
        return extracted, integrity.judge_image(read.legibility, text, thresholds)

    async def nothing(conn: AsyncConnection) -> None:
        return None

    async def run(job: dict[str, Any], data: bytes | None) -> jobs.SavePlan:
        account_id, material_id = job["account_id"], job["result_ref"]
        if data is None:
            raise RuntimeError("the upload is no longer in memory")
        file_type = job["params"]["file_type"]
        is_image = _image_unit(job) is not None
        try:
            if is_image:
                read = await read_image(job, data)
                if read is None:
                    # Cancelled before the vision call: the save step ends the job, and the terminal
                    # hook gives the unit back.
                    return jobs.SavePlan(apply=nothing, material_ids=(material_id,), result_ref=material_id)
                extracted, verdict = read
            else:
                extracted = await extraction.extract(data, file_type)
                verdict = integrity.judge(extracted, thresholds)
        except extraction.Unparseable:
            extracted, verdict = None, integrity.Verdict("rejected", UNPARSEABLE)
            # An image that can't be decoded never reached the vision call: its unit comes back.
            release_on_save = is_image
        else:
            release_on_save = False

        if verdict.outcome == "rejected":
            rejected: list[bool] = []

            async def save_rejected(conn: AsyncConnection) -> None:
                rejected.append(await repo.set_rejected(conn, account_id, material_id, verdict.reason) is not None)
                if release_on_save:
                    await usage.release(conn, account_id, usage.IMAGE_EXTRACTION, _image_unit(job))

            delete = _delete_original(job)

            async def after_rejected() -> None:
                if any(rejected):
                    await delete()

            return jobs.SavePlan(
                apply=save_rejected, material_ids=(material_id,), result_ref=material_id, after_commit=after_rejected
            )

        # The LLM call happens here, with no connection held (AD-18); an error fails the job.
        drafts = await topics.detect(llm, extracted)
        sections = [(section.label, section.text) for section in extracted.sections]
        section_ids = [uuid4() for _ in sections]
        saved: list[bool] = []

        async def save_ready(conn: AsyncConnection) -> None:
            material = await repo.get_for_update(conn, account_id, material_id)
            if material is None or material["status"] != "processing":
                return
            await repo.insert_sections(conn, material_id, sections, section_ids)
            await topics.save(conn, material_id, drafts, section_ids)
            await repo.set_ready(
                conn,
                account_id,
                material_id,
                warning=verdict.outcome == "accepted_with_warning",
                warning_pages=list(verdict.warning_pages),
            )
            saved.append(True)

        async def after_ready() -> None:
            # Only a Material this job saved as ready names the Project; never inside a transaction.
            if any(saved):
                await projects.auto_name_if_unnamed(pool, llm, account_id, job["project_id"], extracted.sections)

        return jobs.SavePlan(
            apply=save_ready, material_ids=(material_id,), result_ref=material_id, after_commit=after_ready
        )

    async def on_terminal(conn: AsyncConnection, job: dict[str, Any]) -> jobs.AfterCommit | None:
        """A failed, interrupted, or cancelled job rejects its Material, freeing the slot (AD-5). An
        image job whose vision call never started gives its unit back (a provider error already did,
        and its marker stays, so it isn't given back twice)."""
        if job.get("result_ref") is None:
            return None
        await _release_if_unread(conn, job)
        rejected = await repo.set_rejected(conn, job["account_id"], job["result_ref"], _reject_reason(job))
        return _delete_original(job) if rejected is not None else None

    return jobs.JobKind(run=run, on_terminal=on_terminal)
