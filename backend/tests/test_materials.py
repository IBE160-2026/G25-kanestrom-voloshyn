"""Upload, processing, the job runner, polling, and the restart sweep (Story 2.2, FR-6, FR-8, AD-5, AD-6,
AD-16, AD-20). Uses the files in test-data/.

Needs `npx supabase start`, `npx supabase db reset` (the bucket), and the two local keys in .env.
"""

import asyncio
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx2
import pytest
from fastapi.testclient import TestClient

from psycopg_pool import AsyncConnectionPool

from app.config import Settings
from app.errors import AppError
from app.main import create_app
from app.services import jobs, materials
from tests.test_auth import (  # noqa: F401 -- shared fixtures
    LOOP,
    assert_error,
    bearer,
    client,
    created,
    db,
    gotrue,
    settings,
    sign_up,
)

TEST_DATA = Path(__file__).resolve().parents[2] / "test-data"
PDF = "application/pdf"


@pytest.fixture
def student(gotrue, created, db, settings, client) -> dict:
    body = sign_up(gotrue, created)
    # Uploads need the Privacy notice accepted first (Story 2.3); new_student() covers the refusal.
    accepted = client.post("/api/me/privacy-notice", headers=bearer(body["access_token"]))
    assert accepted.status_code == 200, accepted.text
    yield {"token": body["access_token"], "id": body["user"]["id"]}
    # Accounts are deleted through the admin API afterwards; their stored originals go here.
    delete_objects(db, settings, body["user"]["id"])


def delete_objects(db, settings, account_id: str) -> None:
    """Storage refuses SQL deletes, so remove the Account's objects through the Storage API."""
    names = [
        row[0]
        for row in db.execute(
            "SELECT name FROM storage.objects WHERE bucket_id = 'study-materials' AND name LIKE %s",
            (f"{account_id}/%",),
        ).fetchall()
    ]
    if names:
        secret = settings.supabase_secret_key.get_secret_value()
        httpx2.request(
            "DELETE",
            f"{settings.supabase_url}/storage/v1/object/study-materials",
            headers={"apikey": secret, "Authorization": f"Bearer {secret}"},
            json={"prefixes": names},
            timeout=10,
        )


def create_project(client, token: str) -> str:
    response = client.post("/api/projects", headers=bearer(token))
    assert response.status_code == 201, response.text
    return response.json()["id"]


def upload(client, token: str, project_id: str, name: str, data: bytes | None = None, content_type: str = PDF):
    if data is None:
        data = (TEST_DATA / name).read_bytes()
    return client.post(
        f"/api/projects/{project_id}/materials", headers=bearer(token), files={"file": (name, data, content_type)}
    )


def materials_of(client, token: str, project_id: str) -> list[dict]:
    response = client.get(f"/api/projects/{project_id}/materials", headers=bearer(token))
    assert response.status_code == 200, response.text
    return response.json()


def wait_until_done(client, token: str, project_id: str, timeout: float = 30.0) -> list[dict]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        listed = materials_of(client, token, project_id)
        if all(m["status"] != "processing" for m in listed):
            return listed
        time.sleep(0.1)
    raise AssertionError("processing did not finish")


def upload_and_wait(client, token: str, project_id: str, name: str) -> dict:
    response = upload(client, token, project_id, name)
    assert response.status_code == 202, response.text
    material_id = response.json()["material"]["id"]
    return next(m for m in wait_until_done(client, token, project_id) if m["id"] == material_id)


def stored_objects(db, account_id: str, project_id: str, material_id: str) -> int:
    return db.execute(
        "SELECT count(*) FROM storage.objects WHERE bucket_id = 'study-materials' AND name = %s",
        (f"{account_id}/{project_id}/{material_id}/original",),
    ).fetchone()[0]


def wait_for(condition, timeout: float = 15.0) -> None:
    """Poll until `condition()` holds; after-commit steps (like deleting an original) trail the commit."""
    deadline = time.monotonic() + timeout
    while not condition():
        assert time.monotonic() < deadline, "timed out"
        time.sleep(0.05)


def insert_material(db, account_id: str, project_id: str, status: str = "ready", **extra) -> str:
    reason = "unreadable" if status == "rejected" else None
    row = db.execute(
        """
        INSERT INTO study_materials (account_id, project_id, file_name, file_type, size_bytes, status, reject_reason,
                                     created_at)
        VALUES (%s, %s, 'seed.pdf', 'pdf', 1, %s, %s, coalesce(%s::timestamptz, now()))
        RETURNING id
        """,
        (account_id, project_id, status, reason, extra.get("created_at")),
    ).fetchone()
    return str(row[0])


# --- Accept, warn, reject (matrix rows) ---


def test_accept_returns_202_then_becomes_ready_with_its_sections(client, student, db):
    project_id = create_project(client, student["token"])

    response = upload(client, student["token"], project_id, "photosynthesis-lecture.pdf")

    assert response.status_code == 202, response.text
    body = response.json()
    assert set(body) == {"material", "job_id"}
    assert body["material"]["status"] == "processing"
    assert body["material"]["file_name"] == "photosynthesis-lecture.pdf"
    assert body["material"]["file_type"] == "pdf"

    material = next(m for m in wait_until_done(client, student["token"], project_id))
    assert material["status"] == "ready"
    assert material["warning"] is False and material["warning_pages"] == []
    labels = [r[0] for r in db.execute(
        "SELECT label FROM sections WHERE material_id = %s ORDER BY position", (material["id"],)
    ).fetchall()]
    assert labels == [f"Page {n}" for n in range(1, 9)]
    hits = db.execute(
        "SELECT count(*) FROM sections WHERE material_id = %s AND tsv @@ to_tsquery('simple', 'chloroplasts')",
        (material["id"],),
    ).fetchone()[0]
    assert hits >= 1
    # A Ready file keeps its original.
    assert stored_objects(db, student["id"], project_id, material["id"]) == 1


@pytest.mark.parametrize(
    ("name", "pages"),
    [
        ("integrity-warn.pdf", [2, 4]),
        ("integrity-warn.pptx", [2, 4]),
        ("integrity-warn.docx", []),
        ("integrity-warn.txt", []),
    ],
)
def test_warn_is_ready_partly_unreadable(client, student, name, pages):
    project_id = create_project(client, student["token"])
    material = upload_and_wait(client, student["token"], project_id, name)
    assert material["status"] == "ready"
    assert material["warning"] is True
    assert material["warning_pages"] == pages


@pytest.mark.parametrize(
    ("name", "reason"),
    [
        ("integrity-reject.pdf", "unreadable"),
        ("integrity-reject.pptx", "unreadable"),
        ("integrity-reject.docx", "unreadable"),
        ("integrity-reject.txt", "unreadable"),
        ("integrity-reject-corrupt.pdf", "unparseable"),
    ],
)
def test_reject_frees_the_slot_and_deletes_the_original(client, student, db, name, reason):
    project_id = create_project(client, student["token"])
    material = upload_and_wait(client, student["token"], project_id, name)

    assert material["status"] == "rejected"
    assert material["reject_reason"] == reason
    assert material["file_name"] == name
    wait_for(lambda: stored_objects(db, student["id"], project_id, material["id"]) == 0)
    assert db.execute("SELECT count(*) FROM sections WHERE material_id = %s", (material["id"],)).fetchone()[0] == 0
    # The finished job is reported once, with the Material as its result.
    jobs = client.get(f"/api/projects/{project_id}/jobs", headers=bearer(student["token"])).json()
    assert [(j["kind"], j["status"], j["result_ref"]) for j in jobs] == [
        ("material_processing", "completed", material["id"])
    ]


def test_markdown_upload_is_ready(client, student):
    project_id = create_project(client, student["token"])
    assert upload_and_wait(client, student["token"], project_id, "photosynthesis-notes.md")["status"] == "ready"


# --- Refusals: nothing stored ---


@pytest.mark.parametrize("name", ["unsupported-type.rtf", "notes-photo.gif", "no-extension"])
def test_unsupported_type_is_refused_and_nothing_is_stored(client, student, db, name):
    project_id = create_project(client, student["token"])
    response = upload(client, student["token"], project_id, name, data=b"some bytes")
    assert_error(response, 422, "unsupported_file_type")
    assert materials_of(client, student["token"], project_id) == []
    assert db.execute("SELECT count(*) FROM storage.objects WHERE name LIKE %s", (f"{student['id']}/%",)).fetchone()[0] == 0


def test_file_over_50_mb_is_refused(client, student, db):
    project_id = create_project(client, student["token"])
    response = upload(client, student["token"], project_id, "big.pdf", data=b"x" * (materials.MAX_BYTES + 1))
    assert_error(response, 413, "file_too_large")
    assert materials_of(client, student["token"], project_id) == []


def test_exactly_50_mb_passes_the_size_check():
    assert materials.validate("notes.pdf", materials.MAX_BYTES) == ("pdf", PDF)
    with pytest.raises(materials.FileTooLarge):
        materials.validate("notes.pdf", materials.MAX_BYTES + 1)


def test_eleventh_file_is_refused_and_a_rejected_file_does_not_count(client, student, db):
    project_id = create_project(client, student["token"])
    for _ in range(9):
        insert_material(db, student["id"], project_id, "ready")
    insert_material(db, student["id"], project_id, "rejected")
    insert_material(db, student["id"], project_id, "processing")  # Reading… counts

    assert_error(upload(client, student["token"], project_id, "integrity-warn.txt"), 409, "material_limit_reached")
    assert len(materials_of(client, student["token"], project_id)) == 11


def test_a_removed_file_does_not_count(client, student, db):
    project_id = create_project(client, student["token"])
    for _ in range(9):
        insert_material(db, student["id"], project_id, "ready")
    removed = insert_material(db, student["id"], project_id, "ready")
    db.execute("UPDATE study_materials SET removed_at = now() WHERE id = %s", (removed,))

    response = upload(client, student["token"], project_id, "integrity-warn.txt")

    assert response.status_code == 202, response.text
    assert removed not in [m["id"] for m in materials_of(client, student["token"], project_id)]
    wait_until_done(client, student["token"], project_id)


def test_parallel_uploads_at_nine_give_exactly_one_202(client, student, db):
    project_id = create_project(client, student["token"])
    for _ in range(9):
        insert_material(db, student["id"], project_id, "ready")
    barrier = threading.Barrier(2)

    def one() -> int:
        barrier.wait()
        return upload(client, student["token"], project_id, "integrity-warn.txt").status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = sorted(pool.map(lambda _: one(), range(2)))

    assert statuses == [202, 409]
    wait_until_done(client, student["token"], project_id)
    slots = db.execute(
        "SELECT count(*) FROM study_materials WHERE project_id = %s AND status IN ('processing', 'ready')",
        (project_id,),
    ).fetchone()[0]
    assert slots == 10
    # The loser's original was stored before the lock, and deleted after its rollback.
    assert objects_in_project(db, student["id"], project_id) == 1


def objects_in_project(db, account_id: str, project_id: str) -> int:
    return db.execute(
        "SELECT count(*) FROM storage.objects WHERE bucket_id = 'study-materials' AND name LIKE %s",
        (f"{account_id}/{project_id}/%",),
    ).fetchone()[0]


def test_a_failure_after_the_original_is_stored_rolls_back_and_deletes_it(client, student, db, monkeypatch):
    async def broken_enqueue(*args, **kwargs):
        raise AppError(500, "internal_error", "enqueue failed")

    monkeypatch.setattr(materials.jobs, "enqueue", broken_enqueue)
    project_id = create_project(client, student["token"])

    assert_error(upload(client, student["token"], project_id, "integrity-warn.txt"), 500, "internal_error")

    assert db.execute("SELECT count(*) FROM study_materials WHERE project_id = %s", (project_id,)).fetchone()[0] == 0
    # The rollback callback runs before the response, so the object is already gone.
    assert objects_in_project(db, student["id"], project_id) == 0


def test_the_job_is_submitted_after_the_commit_before_the_response_is_sent(settings, student, monkeypatch):
    events: list[str] = []
    real_submit = jobs.Runner.submit

    def spy_submit(self, job, payload=None):
        events.append("submit")
        return real_submit(self, job, payload)

    monkeypatch.setattr(jobs.Runner, "submit", spy_submit)
    app = create_app(settings)

    async def watched(scope, receive, send):
        async def spy_send(message):
            if message["type"] == "http.response.start" and scope.get("method") == "POST":
                events.append(f"response {message['status']}")
            await send(message)

        await app(scope, receive, spy_send)

    with TestClient(watched, backend_options=LOOP) as c:
        project_id = create_project(c, student["token"])
        events.clear()
        assert upload(c, student["token"], project_id, "integrity-warn.txt").status_code == 202
        assert events == ["submit", "response 202"]
        wait_until_done(c, student["token"], project_id)


@pytest.mark.parametrize("column", ["archived_at", "deleted_at"])
def test_read_only_project_refuses_uploads(client, student, db, column):
    project_id = create_project(client, student["token"])
    db.execute(f"UPDATE projects SET {column} = now() WHERE id = %s", (project_id,))
    assert_error(upload(client, student["token"], project_id, "integrity-warn.txt"), 409, "project_read_only")


def test_foreign_project_is_not_found(client, gotrue, created, student, db):
    other = sign_up(gotrue, created)
    foreign = create_project(client, other["access_token"])

    assert_error(upload(client, student["token"], foreign, "integrity-warn.txt"), 404, "not_found")
    assert_error(client.get(f"/api/projects/{foreign}/materials", headers=bearer(student["token"])), 404, "not_found")
    assert_error(client.get(f"/api/projects/{foreign}/jobs", headers=bearer(student["token"])), 404, "not_found")
    assert db.execute("SELECT count(*) FROM study_materials WHERE project_id = %s", (foreign,)).fetchone()[0] == 0


def test_upload_without_file_field_is_invalid_request(client, student):
    project_id = create_project(client, student["token"])
    response = client.post(f"/api/projects/{project_id}/materials", headers=bearer(student["token"]), data={"x": "1"})
    assert_error(response, 422, "invalid_request")


def test_upload_without_token_is_unauthorized(client, student):
    project_id = create_project(client, student["token"])
    response = client.post(f"/api/projects/{project_id}/materials", files={"file": ("a.txt", b"x", "text/plain")})
    assert_error(response, 401, "unauthorized")


def test_file_name_is_cleaned():
    assert materials.clean_file_name("C:\\Users\\emma\\notes.pdf") == "notes.pdf"
    assert materials.clean_file_name("../../etc/notes.md") == "notes.md"
    assert materials.clean_file_name("a\x00b\nc.txt") == "abc.txt"
    long = materials.clean_file_name("x" * 300 + ".pdf")
    assert len(long) == 255 and long.endswith(".pdf")


# --- The list and the jobs endpoints ---


def test_reopened_project_lists_every_non_removed_file_with_its_last_status(client, student, db):
    project_id = create_project(client, student["token"])
    upload_and_wait(client, student["token"], project_id, "photosynthesis-lecture.pdf")
    upload_and_wait(client, student["token"], project_id, "integrity-reject.txt")

    client.get(f"/api/projects/{project_id}", headers=bearer(student["token"]))  # reopen
    listed = materials_of(client, student["token"], project_id)

    assert [(m["file_name"], m["status"]) for m in listed] == [
        ("photosynthesis-lecture.pdf", "ready"),
        ("integrity-reject.txt", "rejected"),
    ]
    assert set(listed[0]) == {
        "id", "file_name", "file_type", "size_bytes", "status", "reject_reason", "warning", "warning_pages", "created_at",
        "topics",
    }


def test_read_only_project_still_lists_its_files(client, student, db):
    project_id = create_project(client, student["token"])
    insert_material(db, student["id"], project_id, "ready")
    db.execute("UPDATE projects SET archived_at = now() WHERE id = %s", (project_id,))
    assert len(materials_of(client, student["token"], project_id)) == 1


def test_seen_hides_a_finished_job_and_is_scoped(client, gotrue, created, student):
    project_id = create_project(client, student["token"])
    upload_and_wait(client, student["token"], project_id, "integrity-warn.txt")
    jobs = client.get(f"/api/projects/{project_id}/jobs", headers=bearer(student["token"])).json()
    job_id = jobs[0]["id"]

    other = sign_up(gotrue, created)
    assert_error(client.post(f"/api/jobs/{job_id}/seen", headers=bearer(other["access_token"])), 404, "not_found")
    assert_error(client.post(f"/api/jobs/{uuid.uuid4()}/seen", headers=bearer(student["token"])), 404, "not_found")

    response = client.post(f"/api/jobs/{job_id}/seen", headers=bearer(student["token"]))
    assert response.status_code == 204, response.text
    assert client.get(f"/api/projects/{project_id}/jobs", headers=bearer(student["token"])).json() == []


# --- The runner: concurrency, failure, abort ---


def test_at_most_jobs_max_concurrent_jobs_run_at_once(settings, student, monkeypatch):
    running = 0
    peak = 0
    real_extract = materials.extraction.extract

    async def slow_extract(data, file_type):
        nonlocal running, peak
        running += 1
        peak = max(peak, running)
        await asyncio.sleep(0.3)
        running -= 1
        return await real_extract(data, file_type)

    monkeypatch.setattr(materials.extraction, "extract", slow_extract)
    with TestClient(create_app(settings.model_copy(update={"jobs_max_concurrent": 3})), backend_options=LOOP) as c:
        project_id = create_project(c, student["token"])
        for _ in range(5):
            assert upload(c, student["token"], project_id, "integrity-warn.txt").status_code == 202
        listed = wait_until_done(c, student["token"], project_id)

    assert peak == 3
    assert [m["status"] for m in listed] == ["ready"] * 5


def test_a_crashing_handler_rejects_the_file_as_processing_failed(client, student, db, monkeypatch):
    async def broken(data, file_type):
        raise RuntimeError("parser bug")

    monkeypatch.setattr(materials.extraction, "extract", broken)
    project_id = create_project(client, student["token"])

    material = upload_and_wait(client, student["token"], project_id, "integrity-warn.txt")

    assert (material["status"], material["reject_reason"]) == ("rejected", "processing_failed")
    wait_for(lambda: stored_objects(db, student["id"], project_id, material["id"]) == 0)
    job = db.execute("SELECT status, error_code FROM generation_jobs WHERE result_ref = %s", (material["id"],)).fetchone()
    assert job == ("failed", "processing_failed")


def test_a_material_removed_during_processing_saves_nothing(client, student, db, monkeypatch):
    real_extract = materials.extraction.extract

    async def remove_meanwhile(data, file_type):
        db.execute("UPDATE study_materials SET removed_at = now() WHERE status = 'processing' AND account_id = %s",
                   (student["id"],))
        return await real_extract(data, file_type)

    monkeypatch.setattr(materials.extraction, "extract", remove_meanwhile)
    project_id = create_project(client, student["token"])
    response = upload(client, student["token"], project_id, "photosynthesis-lecture.pdf")
    material_id = response.json()["material"]["id"]

    deadline = time.monotonic() + 30
    while db.execute(
        "SELECT status FROM generation_jobs WHERE id = %s", (response.json()["job_id"],)
    ).fetchone()[0] in ("queued", "running"):
        assert time.monotonic() < deadline
        time.sleep(0.1)

    assert db.execute("SELECT status FROM generation_jobs WHERE id = %s", (response.json()["job_id"],)).fetchone()[0] == "cancelled"
    assert db.execute("SELECT count(*) FROM sections WHERE material_id = %s", (material_id,)).fetchone()[0] == 0
    assert materials_of(client, student["token"], project_id) == []
    wait_for(lambda: stored_objects(db, student["id"], project_id, material_id) == 0)


def wait_for_job(db, job_id: str, timeout: float = 30.0) -> str:
    deadline = time.monotonic() + timeout
    while (status := db.execute("SELECT status FROM generation_jobs WHERE id = %s", (job_id,)).fetchone()[0]) in (
        "queued",
        "running",
    ):
        assert time.monotonic() < deadline, "job did not finish"
        time.sleep(0.1)
    return status


def test_a_project_soft_deleted_during_processing_saves_nothing(client, student, db, monkeypatch):
    real_extract = materials.extraction.extract

    async def delete_meanwhile(data, file_type):
        db.execute("UPDATE projects SET deleted_at = now() WHERE account_id = %s", (student["id"],))
        return await real_extract(data, file_type)

    monkeypatch.setattr(materials.extraction, "extract", delete_meanwhile)
    project_id = create_project(client, student["token"])
    response = upload(client, student["token"], project_id, "photosynthesis-lecture.pdf")
    assert response.status_code == 202, response.text
    body = response.json()

    assert wait_for_job(db, body["job_id"]) == "cancelled"
    material_id = body["material"]["id"]
    assert db.execute("SELECT count(*) FROM sections WHERE material_id = %s", (material_id,)).fetchone()[0] == 0
    status = db.execute("SELECT status FROM study_materials WHERE id = %s", (material_id,)).fetchone()[0]
    assert status == "rejected"


def test_sweep_fails_only_jobs_created_before_the_start(settings, client, student, db):
    project_id = create_project(client, student["token"])
    started_at = db.execute("SELECT now()").fetchone()[0]
    before, after = (
        db.execute(
            """
            INSERT INTO generation_jobs (account_id, project_id, kind, status, created_at)
            VALUES (%s, %s, 'quiz', 'running', %s::timestamptz + %s * interval '1 second')
            RETURNING id
            """,
            (student["id"], project_id, started_at, offset),
        ).fetchone()[0]
        for offset in (-1, 1)
    )

    async def sweep() -> None:
        pool = AsyncConnectionPool(settings.database_url.get_secret_value(), min_size=1, max_size=1, open=False)
        await pool.open()
        try:
            await jobs.sweep_interrupted(pool, {}, started_at)
        finally:
            await pool.close()

    asyncio.run(sweep(), **LOOP)

    status = "SELECT status, error_code FROM generation_jobs WHERE id = %s"
    assert db.execute(status, (before,)).fetchone() == ("failed", "interrupted")
    assert db.execute(status, (after,)).fetchone() == ("running", None)
    db.execute("UPDATE generation_jobs SET status = 'cancelled' WHERE id = %s", (after,))


# --- Restart sweep (AD-20) ---


def test_restart_marks_running_jobs_interrupted_and_rejects_their_files(settings, client, student, db):
    project_id = create_project(client, student["token"])
    material_id = insert_material(
        db, student["id"], project_id, "processing", created_at="2026-01-01T00:00:00Z"
    )
    path = f"{student['id']}/{project_id}/{material_id}/original"
    storage_put(client, path)
    assert stored_objects(db, student["id"], project_id, material_id) == 1
    job_id = db.execute(
        """
        INSERT INTO generation_jobs (account_id, project_id, kind, status, result_ref, created_at)
        VALUES (%s, %s, 'material_processing', 'running', %s, now() - interval '1 minute')
        RETURNING id
        """,
        (student["id"], project_id, material_id),
    ).fetchone()[0]

    with TestClient(create_app(settings), backend_options=LOOP) as restarted:
        deadline = time.monotonic() + 15
        while db.execute("SELECT status FROM generation_jobs WHERE id = %s", (job_id,)).fetchone()[0] == "running":
            assert time.monotonic() < deadline
            time.sleep(0.1)
        material = materials_of(restarted, student["token"], project_id)[0]

    job = db.execute("SELECT status, error_code, finished_at FROM generation_jobs WHERE id = %s", (job_id,)).fetchone()
    assert job[:2] == ("failed", "interrupted") and job[2] is not None
    assert (material["status"], material["reject_reason"]) == ("rejected", "interrupted")
    wait_for(lambda: stored_objects(db, student["id"], project_id, material_id) == 0)


def storage_put(client, path: str) -> None:
    """Store a small object through the app's own storage client."""
    app = client.app
    client.portal.call(app.state.storage.put, path, b"%PDF-1.4", PDF)


def test_tables_are_closed_to_the_browser_keys(db):
    for table in ("study_materials", "sections", "generation_jobs"):
        row = db.execute(
            "SELECT has_table_privilege('anon', %s, 'SELECT'), has_table_privilege('authenticated', %s, 'SELECT')",
            (f"public.{table}", f"public.{table}"),
        ).fetchone()
        assert row == (False, False)
    bucket = db.execute("SELECT public FROM storage.buckets WHERE id = 'study-materials'").fetchone()
    assert bucket == (False,)


def test_settings_default_to_three_concurrent_jobs():
    assert Settings(_env_file=None).jobs_max_concurrent == 3


# --- The Privacy notice gate (Story 2.3, FR-6, AD-19) ---


def test_upload_without_the_privacy_notice_is_refused_and_nothing_is_stored(client, gotrue, created, db):
    body = sign_up(gotrue, created)
    headers = bearer(body["access_token"])
    project_id = client.post("/api/projects", headers=headers).json()["id"]
    me = client.get("/api/me", headers=headers).json()
    assert me["privacy_notice_accepted"] is False

    response = client.post(
        f"/api/projects/{project_id}/materials", headers=headers, files={"file": ("notes.md", b"# Notes\n" * 50)}
    )

    assert_error(response, 403, "privacy_notice_required")
    assert db.execute("SELECT count(*) FROM study_materials WHERE project_id = %s", (project_id,)).fetchone()[0] == 0
    assert stored_objects_for_account(db, body["user"]["id"]) == 0


def test_accepting_the_privacy_notice_is_saved_once_and_unlocks_uploads(client, gotrue, created, db):
    body = sign_up(gotrue, created)
    headers = bearer(body["access_token"])

    first = client.post("/api/me/privacy-notice", headers=headers)
    assert first.status_code == 200, first.text
    assert first.json()["privacy_notice_accepted"] is True
    at = db.execute("SELECT privacy_notice_ack_at FROM profiles WHERE account_id = %s", (body["user"]["id"],)).fetchone()[0]

    again = client.post("/api/me/privacy-notice", headers=headers)
    assert again.status_code == 200
    # Idempotent: the first acceptance time is kept.
    assert db.execute(
        "SELECT privacy_notice_ack_at FROM profiles WHERE account_id = %s", (body["user"]["id"],)
    ).fetchone()[0] == at
    assert client.get("/api/me", headers=headers).json()["privacy_notice_accepted"] is True


def test_privacy_notice_without_token_is_unauthorized(client):
    assert_error(client.post("/api/me/privacy-notice"), 401, "unauthorized")


def stored_objects_for_account(db, account_id: str) -> int:
    return db.execute(
        "SELECT count(*) FROM storage.objects WHERE bucket_id = 'study-materials' AND name LIKE %s",
        (f"{account_id}/%",),
    ).fetchone()[0]

def test_the_privacy_gate_comes_before_the_file_checks(client, gotrue, created):
    body = sign_up(gotrue, created)
    headers = bearer(body["access_token"])
    project_id = client.post("/api/projects", headers=headers).json()["id"]

    response = client.post(
        f"/api/projects/{project_id}/materials", headers=headers, files={"file": ("notes.rtf", b"{\\rtf1 x}")}
    )

    assert_error(response, 403, "privacy_notice_required")
