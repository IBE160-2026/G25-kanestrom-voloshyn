"""Delete a Project and restore it (Story 7.2a: FR-24, AD-20, AD-22, AD-24).

Runs the real routes in mock mode against local Supabase, like test_archive.py. Delete is idempotent
bookkeeping that sets `deleted_at` (keeping `archived_at`), revokes the phone links, and cancels the
Project's jobs; restore clears both `archived_at` and `deleted_at`. Nothing else changes.
"""

import time
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from tests.test_archive import archive, ok, project_row, restore
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
from tests.test_images import insert_image_job, set_used, used
from tests.test_images import job_row as image_job_row
from tests.test_materials import (  # noqa: F401 -- shared fixtures
    create_project,
    storage_put,
    stored_objects,
    student,
    upload,
    wait_for,
    wait_for_job,
)
from tests.test_mistakes import outstanding
from tests.test_phone_upload import (
    READABLE,
    batches_of,
    new_link,
    phone_get,
    send_batch,
    send_photo,
    staged_photos,
)
from tests.test_quiz_answers import answer, insert_quiz
from tests.test_quiz_generation import job_row, quizzes_in, started
from tests.test_scope import ALL, make_quiz, seed
from tests.test_topic_edits import rename as rename_topic
from tests.test_topic_edits import seed as seed_topics


def delete(client, token: str, project_id: str):
    return client.post(f"/api/projects/{project_id}/delete", headers=bearer(token))


def material_status(db, material_id: str) -> str:
    return db.execute("SELECT status FROM study_materials WHERE id = %s", (material_id,)).fetchone()[0]


# --- Delete ---


def test_delete_sets_deleted_at_and_purge_at_30_days_later(client, student, db):
    project_id = create_project(client, student["token"])

    body = ok(delete(client, student["token"], project_id))

    assert body["id"] == project_id
    assert body["deleted_at"] is not None and body["archived_at"] is None
    assert body["purge_at"] is not None
    assert project_row(db, project_id)[3] is not None
    listed = ok(client.get("/api/projects", headers=bearer(student["token"])))
    row = next(p for p in listed if p["id"] == project_id)
    assert row["deleted_at"] == body["deleted_at"] and row["purge_at"] == body["purge_at"]


def test_purge_at_is_exactly_30_days_after_deleted_at(client, student, db):
    from datetime import datetime

    project_id = create_project(client, student["token"])
    body = ok(delete(client, student["token"], project_id))

    deleted_at = datetime.fromisoformat(body["deleted_at"])
    purge_at = datetime.fromisoformat(body["purge_at"])
    assert purge_at - deleted_at == timedelta(days=30)


def test_an_active_project_has_no_purge_at(client, student):
    project_id = create_project(client, student["token"])
    listed = ok(client.get("/api/projects", headers=bearer(student["token"])))
    assert next(p for p in listed if p["id"] == project_id)["purge_at"] is None


def test_delete_an_archived_project_keeps_archived_at(client, student, db):
    project_id = create_project(client, student["token"])
    archived_at = ok(archive(client, student["token"], project_id))["archived_at"]

    body = ok(delete(client, student["token"], project_id))

    assert body["archived_at"] == archived_at and body["deleted_at"] is not None


def test_delete_twice_is_200_and_unchanged(client, student, db):
    project_id = create_project(client, student["token"])
    first = ok(delete(client, student["token"], project_id))

    second = ok(delete(client, student["token"], project_id))

    assert second == first


def test_a_deleted_project_refuses_archive(client, student):
    project_id = create_project(client, student["token"])
    ok(delete(client, student["token"], project_id))

    assert_error(archive(client, student["token"], project_id), 409, "project_read_only")


def test_a_foreign_or_missing_project_is_not_found(client, gotrue, created, student, db):
    project_id = create_project(client, student["token"])
    other = sign_up(gotrue, created)

    assert_error(delete(client, other["access_token"], project_id), 404, "not_found")
    assert_error(delete(client, student["token"], "00000000-0000-0000-0000-000000000000"), 404, "not_found")
    assert project_row(db, project_id)[3] is None


def test_delete_needs_a_session(client, student):
    project_id = create_project(client, student["token"])
    assert_error(client.post(f"/api/projects/{project_id}/delete"), 401, "unauthorized")


def test_delete_changes_nothing_else(client, student, db):
    token = student["token"]
    project_id = create_project(client, token)
    client.patch(f"/api/projects/{project_id}", headers=bearer(token), json={"name": "Biology"})
    material_id = upload(client, token, project_id, "photosynthesis-notes.md").json()["material"]["id"]
    wait_for(lambda: material_status(db, material_id) != "processing")
    _, topic_ids = seed_topics(db, student["id"], project_id, [[0]])
    quiz_id, question_ids, _ = insert_quiz(db, student["id"], project_id, correct="b")
    for question_id in question_ids:
        assert answer(client, token, project_id, quiz_id, question_id, "a").status_code == 200
    status = material_status(db, material_id)
    name, name_source, *_ = project_row(db, project_id)

    ok(delete(client, token, project_id))

    assert material_status(db, material_id) == status
    assert project_row(db, project_id)[:2] == (name, name_source)
    assert db.execute("SELECT count(*) FROM topics WHERE id = ANY(%s::uuid[])", (topic_ids,)).fetchone()[0] == 1
    assert db.execute("SELECT count(*) FROM quizzes WHERE id = %s", (quiz_id,)).fetchone()[0] == 1
    assert outstanding(client, token, project_id) == 3


# --- Read-only while deleted, and restore ---


def test_mutations_while_deleted_are_refused_and_work_again_after_restore(client, student, db):
    token = student["token"]
    project_id = create_project(client, token)
    _, topic_ids = seed_topics(db, student["id"], project_id, [[0]])
    quiz_id, question_ids, _ = insert_quiz(db, student["id"], project_id)
    ok(delete(client, token, project_id))

    assert_error(upload(client, token, project_id, "photosynthesis-notes.md"), 409, "project_read_only")
    assert_error(client.patch(f"/api/projects/{project_id}", headers=bearer(token), json={"name": "X"}), 409,
                 "project_read_only")
    assert_error(rename_topic(client, token, project_id, topic_ids[0], "Nope"), 409, "project_read_only")

    ok(restore(client, token, project_id))

    assert rename_topic(client, token, project_id, topic_ids[0], "Renamed").status_code == 200
    assert answer(client, token, project_id, quiz_id, question_ids[0], "b").status_code == 200
    assert upload(client, token, project_id, "photosynthesis-notes.md").status_code == 202


def test_restore_of_a_deleted_archived_project_clears_both_columns(client, student, db):
    project_id = create_project(client, student["token"])
    ok(archive(client, student["token"], project_id))
    ok(delete(client, student["token"], project_id))

    body = ok(restore(client, student["token"], project_id))

    assert (body["archived_at"], body["deleted_at"], body["purge_at"]) == (None, None, None)
    assert project_row(db, project_id)[2:4] == (None, None)
    listed = ok(client.get("/api/projects", headers=bearer(student["token"])))
    row = next(p for p in listed if p["id"] == project_id)
    assert (row["archived_at"], row["deleted_at"]) == (None, None)


def test_a_failed_restore_leaves_the_project_deleted(client, student, db, monkeypatch):
    project_id = create_project(client, student["token"])
    ok(delete(client, student["token"], project_id))
    from app.db import projects as repo

    async def boom(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(repo, "set_restored", boom)

    with pytest.raises(RuntimeError):
        restore(client, student["token"], project_id)

    assert project_row(db, project_id)[3] is not None


def test_login_skips_a_deleted_last_project(client, student, db):
    token = student["token"]
    older = create_project(client, token)
    last = create_project(client, token)
    ok(client.get(f"/api/projects/{last}", headers=bearer(token)))

    ok(delete(client, token, last))

    me = ok(client.get("/api/me", headers=bearer(token)))
    assert me["last_project_id"] != last
    listed = ok(client.get("/api/projects", headers=bearer(token)))
    active = [p["id"] for p in listed if p["archived_at"] is None and p["deleted_at"] is None]
    assert active and active[0] == older


# --- Phone links (AD-24) ---


def test_delete_revokes_open_phone_links_and_discards_their_batches(client, student, db):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    batch_id = send_batch(client, link, [READABLE])
    assert (used(db, student["id"]), staged_photos(db, student["id"], project_id)) == (1, 1)

    ok(delete(client, student["token"], project_id))

    assert batches_of(db, project_id) == 0
    assert used(db, student["id"]) == 0
    wait_for(lambda: staged_photos(db, student["id"], project_id) == 0)
    assert_error(send_photo(client, link, batch_id, READABLE), 410, "link_expired")
    assert_error(phone_get(client, link), 410, "link_expired")


def test_a_failed_delete_rolls_back_and_leaves_the_link_and_jobs_untouched(client, student, db, monkeypatch):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    send_batch(client, link, [READABLE])
    set_used(db, student["id"], 2)
    material_id, job_id = insert_image_job(db, student["id"], project_id, "queued", False)
    from app.db import projects as repo

    async def boom(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(repo, "set_deleted", boom)

    with pytest.raises(RuntimeError):
        delete(client, student["token"], project_id)

    assert project_row(db, project_id)[3] is None
    assert phone_get(client, link).status_code == 200
    assert batches_of(db, project_id) == 1
    assert staged_photos(db, student["id"], project_id) == 1
    assert image_job_row(db, job_id)[0] == "queued"
    assert material_status(db, material_id) == "processing"
    assert used(db, student["id"]) == 2


# --- Jobs (AD-20) ---


def test_delete_cancels_a_queued_image_job_and_returns_its_unit(client, student, db):
    project_id = create_project(client, student["token"])
    set_used(db, student["id"], 1)
    material_id, job_id = insert_image_job(db, student["id"], project_id, "queued", False)
    storage_put(client, f"{student['id']}/{project_id}/{material_id}/original")
    assert stored_objects(db, student["id"], project_id, material_id) == 1

    ok(delete(client, student["token"], project_id))

    assert image_job_row(db, job_id)[0] == "cancelled"
    assert used(db, student["id"]) == 0
    # The file isn't left Reading… forever: it is rejected, as a cancelled running job's would be, and
    # its never-read original is deleted after the commit.
    assert material_status(db, material_id) == "rejected"
    wait_for(lambda: stored_objects(db, student["id"], project_id, material_id) == 0)


def test_delete_cancels_a_queued_quiz_job(client, student, db):
    project_id = create_project(client, student["token"])
    job_id = db.execute(
        """
        INSERT INTO generation_jobs (account_id, project_id, kind, params, status)
        VALUES (%s, %s, 'quiz', '{}'::jsonb, 'queued') RETURNING id
        """,
        (student["id"], project_id),
    ).fetchone()[0]

    ok(delete(client, student["token"], project_id))

    assert job_row(db, job_id)[0] == "cancelled"


def test_delete_leaves_other_projects_jobs_alone(client, student, db):
    project_id = create_project(client, student["token"])
    other = create_project(client, student["token"])
    set_used(db, student["id"], 1)
    _, job_id = insert_image_job(db, student["id"], other, "queued", False)

    ok(delete(client, student["token"], project_id))

    assert image_job_row(db, job_id)[0] == "queued"
    assert used(db, student["id"]) == 1


def test_delete_interrupts_a_running_quiz_which_ends_cancelled_and_saves_nothing(settings, student, db):
    # A long model call: the delete interrupts it instead of waiting for it.
    with TestClient(create_app(settings.model_copy(update={"llm_mock_delay_ms": 5000})), backend_options=LOOP) as c:
        project_id = create_project(c, student["token"])
        seed(db, student["id"], project_id, ["text"] * 5)
        job_id = started(make_quiz(c, student["token"], project_id, ALL, count=5))
        wait_for(lambda: job_row(db, job_id)[1] == "writing", timeout=15)

        began = time.monotonic()
        ok(delete(c, student["token"], project_id))
        assert wait_for_job(db, job_id) == "cancelled"
        assert time.monotonic() - began < 3

    status, step, _, result_ref, requested = job_row(db, job_id)
    assert (status, step, requested, result_ref) == ("cancelled", None, True, None)
    assert quizzes_in(db, project_id) == 0
