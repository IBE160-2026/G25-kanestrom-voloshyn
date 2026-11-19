"""Archive and restore a Project (Story 7.1: FR-23, AD-22, AD-24).

Runs the real routes in mock mode against local Supabase, like test_projects.py. Archive and restore
are idempotent bookkeeping; a deleted Project answers `409 project_read_only` to archive (its delete
and restore are in test_delete_project.py).
"""

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.services import phone
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
from tests.test_images import used
from tests.test_materials import (  # noqa: F401 -- shared fixtures
    create_project,
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
from tests.test_quiz_generation import DELAY_MS, quizzes_in, started, wait_for_step
from tests.test_scope import ALL, make_quiz, seed
from tests.test_topic_edits import rename as rename_topic
from tests.test_topic_edits import seed as seed_topics


def archive(client, token: str, project_id: str):
    return client.post(f"/api/projects/{project_id}/archive", headers=bearer(token))


def restore(client, token: str, project_id: str):
    return client.post(f"/api/projects/{project_id}/restore", headers=bearer(token))


def ok(response) -> dict:
    assert response.status_code == 200, response.text
    return response.json()


def project_row(db, project_id: str) -> tuple:
    return db.execute(
        "SELECT name, name_source, archived_at, deleted_at, created_at FROM projects WHERE id = %s", (project_id,)
    ).fetchone()


# --- Archive and restore ---


def test_archive_sets_archived_at_and_returns_the_project(client, student, db):
    project_id = create_project(client, student["token"])

    body = ok(archive(client, student["token"], project_id))

    assert body["id"] == project_id
    assert body["archived_at"] is not None and body["deleted_at"] is None
    assert project_row(db, project_id)[2] is not None
    listed = ok(client.get("/api/projects", headers=bearer(student["token"])))
    assert next(p for p in listed if p["id"] == project_id)["archived_at"] is not None


def test_archive_twice_is_200_and_unchanged(client, student, db):
    project_id = create_project(client, student["token"])
    first = ok(archive(client, student["token"], project_id))

    second = ok(archive(client, student["token"], project_id))

    assert second == first


def test_restore_clears_archived_at_only(client, student, db):
    project_id = create_project(client, student["token"])
    client.patch(f"/api/projects/{project_id}", headers=bearer(student["token"]), json={"name": "Biology"})
    before = project_row(db, project_id)
    ok(archive(client, student["token"], project_id))

    body = ok(restore(client, student["token"], project_id))

    assert body["archived_at"] is None
    assert project_row(db, project_id) == before
    assert (body["name"], body["name_source"]) == ("Biology", "student")


def test_restore_of_an_active_project_is_200_and_unchanged(client, student, db):
    project_id = create_project(client, student["token"])
    before = project_row(db, project_id)

    assert ok(restore(client, student["token"], project_id))["archived_at"] is None
    assert project_row(db, project_id) == before


@pytest.mark.parametrize("archived", [False, True])
def test_a_deleted_project_refuses_archive(client, student, db, archived):
    # Its restore is Story 7.2's (test_delete_project.py).
    project_id = create_project(client, student["token"])
    archived_sql = ", archived_at = now()" if archived else ""
    db.execute(f"UPDATE projects SET deleted_at = now(){archived_sql} WHERE id = %s", (project_id,))
    before = project_row(db, project_id)

    assert_error(archive(client, student["token"], project_id), 409, "project_read_only")
    assert project_row(db, project_id) == before


def test_a_foreign_or_missing_project_is_not_found(client, gotrue, created, student, db):
    project_id = create_project(client, student["token"])
    other = sign_up(gotrue, created)
    token = other["access_token"]

    assert_error(archive(client, token, project_id), 404, "not_found")
    assert_error(restore(client, token, project_id), 404, "not_found")
    missing = "00000000-0000-0000-0000-000000000000"
    assert_error(archive(client, student["token"], missing), 404, "not_found")
    assert_error(restore(client, student["token"], missing), 404, "not_found")
    assert project_row(db, project_id)[2] is None


def test_archive_and_restore_need_a_session(client, student):
    project_id = create_project(client, student["token"])
    assert_error(client.post(f"/api/projects/{project_id}/archive"), 401, "unauthorized")
    assert_error(client.post(f"/api/projects/{project_id}/restore"), 401, "unauthorized")


# --- Read-only while archived ---


def test_mutations_while_archived_are_refused_and_work_again_after_restore(client, student, db):
    project_id = create_project(client, student["token"])
    token = student["token"]
    _, topic_ids = seed_topics(db, student["id"], project_id, [[0]])
    quiz_id, question_ids, _ = insert_quiz(db, student["id"], project_id)
    ok(archive(client, token, project_id))

    assert_error(upload(client, token, project_id, "photosynthesis-notes.md"), 409,
                 "project_read_only")
    assert_error(client.patch(f"/api/projects/{project_id}", headers=bearer(token), json={"name": "X"}), 409,
                 "project_read_only")
    assert_error(rename_topic(client, token, project_id, topic_ids[0], "Nope"), 409, "project_read_only")
    assert_error(answer(client, token, project_id, quiz_id, question_ids[0], "b"), 409, "project_read_only")

    ok(restore(client, token, project_id))

    assert rename_topic(client, token, project_id, topic_ids[0], "Renamed").status_code == 200
    assert answer(client, token, project_id, quiz_id, question_ids[0], "b").status_code == 200


def test_mistakes_survive_archive_and_restore(client, student, db):
    project_id = create_project(client, student["token"])
    token = student["token"]
    quiz_id, question_ids, _ = insert_quiz(db, student["id"], project_id, correct="b")
    for question_id in question_ids:
        assert answer(client, token, project_id, quiz_id, question_id, "a").status_code == 200
    assert outstanding(client, token, project_id) == 3

    ok(archive(client, token, project_id))
    assert outstanding(client, token, project_id) == 3
    ok(restore(client, token, project_id))

    assert outstanding(client, token, project_id) == 3


# --- Phone links (AD-24) ---


def test_archive_revokes_open_phone_links_and_discards_their_batches(client, student, db):
    project_id = create_project(client, student["token"])
    first = new_link(client, student["token"], project_id)
    second = new_link(client, student["token"], project_id)
    batch_id = send_batch(client, first, [READABLE])
    assert (used(db, student["id"]), staged_photos(db, student["id"], project_id)) == (1, 1)

    ok(archive(client, student["token"], project_id))

    revoked = db.execute(
        "SELECT count(*) FROM phone_upload_links WHERE project_id = %s AND revoked_at IS NOT NULL", (project_id,)
    ).fetchone()[0]
    assert revoked == 2
    assert batches_of(db, project_id) == 0
    assert used(db, student["id"]) == 0
    wait_for(lambda: staged_photos(db, student["id"], project_id) == 0)
    assert_error(send_photo(client, first, batch_id, READABLE), 410, "link_expired")
    # Restore does not bring a link back.
    ok(restore(client, student["token"], project_id))
    assert_error(phone_get(client, second), 410, "link_expired")


def test_archive_leaves_other_projects_links_alone(client, student, db):
    project_id = create_project(client, student["token"])
    other_project = create_project(client, student["token"])
    link = new_link(client, student["token"], other_project)

    ok(archive(client, student["token"], project_id))

    assert phone_get(client, link).status_code == 200


def test_a_failed_archive_rolls_back_and_leaves_the_link_untouched(client, student, db, monkeypatch):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    send_batch(client, link, [READABLE])
    from app.db import projects as repo

    async def boom(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(repo, "set_archived", boom)

    with pytest.raises(RuntimeError):
        archive(client, student["token"], project_id)

    assert project_row(db, project_id)[2] is None
    assert phone_get(client, link).status_code == 200
    assert batches_of(db, project_id) == 1
    assert staged_photos(db, student["id"], project_id) == 1


def test_revoke_for_project_uses_revoke_per_link(client, student, db, monkeypatch):
    project_id = create_project(client, student["token"])
    links = [new_link(client, student["token"], project_id) for _ in range(2)]
    seen = []
    real = phone._revoke

    async def spy(conn, storage, account_id, link_id):
        seen.append(str(link_id))
        return await real(conn, storage, account_id, link_id)

    monkeypatch.setattr(phone, "_revoke", spy)

    ok(archive(client, student["token"], project_id))

    assert sorted(seen) == sorted(link["link_id"] for link in links)


# --- Running generation ---


@pytest.fixture
def slow(settings):
    with TestClient(create_app(settings.model_copy(update={"llm_mock_delay_ms": DELAY_MS})), backend_options=LOOP) as c:
        yield c


def test_a_running_quiz_job_completes_and_saves_after_archive(slow, student, db):
    project_id = create_project(slow, student["token"])
    seed(db, student["id"], project_id, ["text"] * 5)
    job_id = started(make_quiz(slow, student["token"], project_id, ALL, count=5))
    wait_for_step(db, job_id, "writing")

    ok(archive(slow, student["token"], project_id))

    assert wait_for_job(db, job_id) == "completed"
    assert quizzes_in(db, project_id) == 1
