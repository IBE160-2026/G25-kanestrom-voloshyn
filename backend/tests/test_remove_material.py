"""Remove a file (Story 2.7, FR-20, AD-20, AD-22, AD-23).

Runs through real uploads and `material_processing` jobs in mock mode. Needs local Supabase, like
test_materials.py.
"""

import asyncio
import threading
import uuid

import pytest
from fastapi.testclient import TestClient

from app.errors import AppError
from app.main import create_app
from app.storage import Storage
from app.services import materials
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
from tests.test_materials import (  # noqa: F401 -- shared fixtures
    create_project,
    insert_material,
    materials_of,
    stored_objects,
    student,
    upload,
    upload_and_wait,
    wait_for,
    wait_for_job,
    wait_until_done,
)

LECTURE = "photosynthesis-lecture.pdf"


def remove(client, token: str, project_id: str, material_id: str):
    return client.delete(f"/api/projects/{project_id}/materials/{material_id}", headers=bearer(token))


def sections_of(db, material_id: str) -> list[tuple[str, str]]:
    return db.execute(
        "SELECT label, text FROM sections WHERE material_id = %s ORDER BY position", (material_id,)
    ).fetchall()


def job_of(db, material_id: str) -> tuple[str, bool]:
    return db.execute(
        "SELECT status, cancel_requested FROM generation_jobs WHERE result_ref = %s", (material_id,)
    ).fetchone()


def removed_at(db, material_id: str):
    return db.execute("SELECT removed_at FROM study_materials WHERE id = %s", (material_id,)).fetchone()[0]


class HeldExtraction:
    """Holds every extraction until released, and counts the ones that started."""

    def __init__(self, monkeypatch) -> None:
        self.release = threading.Event()
        self.started = 0
        real_extract = materials.extraction.extract

        async def held(data, file_type):
            self.started += 1
            while not self.release.is_set():
                await asyncio.sleep(0.02)
            return await real_extract(data, file_type)

        monkeypatch.setattr(materials.extraction, "extract", held)


# --- Matrix rows ---


def test_remove_ready_tombstones_the_file_and_frees_its_slot(client, student, db):
    project_id = create_project(client, student["token"])
    material = upload_and_wait(client, student["token"], project_id, LECTURE)
    assert material["status"] == "ready"
    labels = [label for label, _ in sections_of(db, material["id"])]

    response = remove(client, student["token"], project_id, material["id"])

    assert response.status_code == 204, response.text
    assert response.content == b""
    assert removed_at(db, material["id"]) is not None
    # The row and its file name stay; Section labels stay, their text and tsvector are emptied.
    row = db.execute("SELECT file_name, status FROM study_materials WHERE id = %s", (material["id"],)).fetchone()
    assert row == (LECTURE, "ready")
    assert sections_of(db, material["id"]) == [(label, "") for label in labels]
    hits = db.execute(
        "SELECT count(*) FROM sections WHERE material_id = %s AND tsv <> ''::tsvector", (material["id"],)
    ).fetchone()[0]
    assert hits == 0
    wait_for(lambda: stored_objects(db, student["id"], project_id, material["id"]) == 0)
    # Gone from the list on reopen, and no longer counted.
    assert materials_of(client, student["token"], project_id) == []
    count = db.execute(
        f"SELECT count(*) FROM study_materials WHERE project_id = %s AND {materials.repo.OCCUPIES_SLOT}",
        (project_id,),
    ).fetchone()[0]
    assert count == 0


def test_remove_reading_running_cancels_the_job_and_saves_nothing(settings, student, db, monkeypatch):
    held = HeldExtraction(monkeypatch)
    try:
        with TestClient(create_app(settings), backend_options=LOOP) as c:
            project_id = create_project(c, student["token"])
            response = upload(c, student["token"], project_id, LECTURE)
            assert response.status_code == 202, response.text
            material_id, job_id = response.json()["material"]["id"], response.json()["job_id"]
            wait_for(lambda: held.started == 1)
            assert job_of(db, material_id) == ("running", False)

            assert remove(c, student["token"], project_id, material_id).status_code == 204

            # The slot frees at once, while the job is still held mid-extraction.
            assert materials_of(c, student["token"], project_id) == []
            assert job_of(db, material_id) == ("running", True)

            held.release.set()
            assert wait_for_job(db, job_id) == "cancelled"
    finally:
        held.release.set()

    assert sections_of(db, material_id) == []
    wait_for(lambda: stored_objects(db, student["id"], project_id, material_id) == 0)


def test_remove_reading_queued_cancels_the_job_at_once_and_it_never_runs(settings, student, db, monkeypatch):
    held = HeldExtraction(monkeypatch)
    try:
        with TestClient(
            create_app(settings.model_copy(update={"jobs_max_concurrent": 1})), backend_options=LOOP
        ) as c:
            project_id = create_project(c, student["token"])
            first = upload(c, student["token"], project_id, "integrity-warn.txt").json()
            wait_for(lambda: held.started == 1)
            second = upload(c, student["token"], project_id, LECTURE).json()
            second_id = second["material"]["id"]
            assert job_of(db, second_id) == ("queued", False)

            assert remove(c, student["token"], project_id, second_id).status_code == 204
            assert job_of(db, second_id)[0] == "cancelled"

            held.release.set()
            assert wait_for_job(db, first["job_id"]) == "completed"
            wait_until_done(c, student["token"], project_id)
    finally:
        held.release.set()

    assert held.started == 1  # the cancelled job never ran
    assert job_of(db, second_id)[0] == "cancelled"
    assert sections_of(db, second_id) == []
    wait_for(lambda: stored_objects(db, student["id"], project_id, second_id) == 0)


def test_remove_rejected(client, student, db):
    project_id = create_project(client, student["token"])
    material = upload_and_wait(client, student["token"], project_id, "integrity-reject.txt")
    assert material["status"] == "rejected"

    assert remove(client, student["token"], project_id, material["id"]).status_code == 204

    assert removed_at(db, material["id"]) is not None
    assert materials_of(client, student["token"], project_id) == []


def test_remove_twice_answers_204_changes_nothing_and_retries_the_delete(client, student, db, monkeypatch):
    project_id = create_project(client, student["token"])
    material_id = insert_material(db, student["id"], project_id, "ready")
    deleted: list[str] = []
    real_delete = Storage.delete

    async def recording_delete(self, path):
        deleted.append(path)
        await real_delete(self, path)

    monkeypatch.setattr(Storage, "delete", recording_delete)
    path = f"{student['id']}/{project_id}/{material_id}/original"
    assert remove(client, student["token"], project_id, material_id).status_code == 204
    first = removed_at(db, material_id)

    assert remove(client, student["token"], project_id, material_id).status_code == 204

    assert removed_at(db, material_id) == first
    # A retry deletes the original again, in case the first delete failed.
    assert deleted == [path, path]


def test_foreign_or_missing_material_is_not_found(client, gotrue, created, student, db):
    other = sign_up(gotrue, created)
    foreign_project = create_project(client, other["access_token"])
    foreign = insert_material(db, other["user"]["id"], foreign_project, "ready")
    project_id = create_project(client, student["token"])
    # A Material of another Project of the same Account is not found under this one either.
    elsewhere = create_project(client, student["token"])
    sibling = insert_material(db, student["id"], elsewhere, "ready")

    assert_error(remove(client, student["token"], project_id, foreign), 404, "not_found")
    assert_error(remove(client, student["token"], foreign_project, foreign), 404, "not_found")
    assert_error(remove(client, student["token"], project_id, sibling), 404, "not_found")
    assert_error(remove(client, student["token"], project_id, str(uuid.uuid4())), 404, "not_found")
    assert removed_at(db, foreign) is None
    assert removed_at(db, sibling) is None


@pytest.mark.parametrize("column", ["archived_at", "deleted_at"])
def test_read_only_project_refuses_removal(client, student, db, column):
    project_id = create_project(client, student["token"])
    material_id = insert_material(db, student["id"], project_id, "ready")
    db.execute(f"UPDATE projects SET {column} = now() WHERE id = %s", (project_id,))

    assert_error(remove(client, student["token"], project_id, material_id), 409, "project_read_only")
    assert removed_at(db, material_id) is None


def test_eleventh_file_is_accepted_after_a_removal(client, student, db):
    project_id = create_project(client, student["token"])
    ids = [insert_material(db, student["id"], project_id, "ready") for _ in range(10)]
    assert_error(upload(client, student["token"], project_id, "integrity-warn.txt"), 409, "material_limit_reached")

    assert remove(client, student["token"], project_id, ids[0]).status_code == 204

    assert upload(client, student["token"], project_id, "integrity-warn.txt").status_code == 202
    wait_until_done(client, student["token"], project_id)


def test_a_failed_removal_changes_nothing(client, student, db, monkeypatch):
    project_id = create_project(client, student["token"])
    material = upload_and_wait(client, student["token"], project_id, LECTURE)
    before = sections_of(db, material["id"])

    async def broken(*args, **kwargs):
        raise AppError(500, "internal_error", "cancel failed")

    monkeypatch.setattr(materials.jobs, "cancel_for_material", broken)
    assert_error(remove(client, student["token"], project_id, material["id"]), 500, "internal_error")

    assert removed_at(db, material["id"]) is None
    assert sections_of(db, material["id"]) == before
    assert stored_objects(db, student["id"], project_id, material["id"]) == 1


def test_remove_without_token_is_unauthorized(client, student, db):
    project_id = create_project(client, student["token"])
    material_id = insert_material(db, student["id"], project_id, "ready")
    assert_error(client.delete(f"/api/projects/{project_id}/materials/{material_id}"), 401, "unauthorized")
