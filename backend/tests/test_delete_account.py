"""Delete my account (Story 7.4: FR-28, AD-16, AD-18, AD-19, AD-20).

Runs the real routes in mock mode against local Supabase, like test_purge.py. `DELETE /api/me` cancels
every job of every Project (active, archived, deleted, expired) and revokes its phone links, waits for
the running jobs, deletes the Storage prefix `{account_id}/`, then deletes the auth user, so `profiles`
and every app table go by cascade. The same email can register again.
"""

import time

import httpx2
from fastapi.testclient import TestClient

from app.main import create_app
from app.services import account
from tests.test_archive import archive, ok
from tests.test_auth import (  # noqa: F401 -- shared fixtures
    LOOP,
    PASSWORD,
    assert_error,
    bearer,
    client,
    created,
    db,
    gotrue,
    new_email,
    settings,
    sign_up,
)
from tests.test_delete_project import delete
from tests.test_materials import (  # noqa: F401 -- shared fixtures
    create_project,
    storage_put,
    student,
    wait_for,
)
from tests.test_phone_upload import READABLE, new_link, phone_get, send_batch
from tests.test_purge import full_project, set_deleted_days_ago
from tests.test_quiz_generation import job_row, quizzes_in, started
from tests.test_scope import ALL, make_quiz, seed


def delete_me(client, token: str):
    return client.delete("/api/me", headers=bearer(token))


def gone(response) -> None:
    assert response.status_code == 204, response.text


def account_rows(db, account_id: str) -> dict[str, int]:
    """Rows of the Account in every public table with an `account_id` column (non-zero counts only)."""
    tables = [
        row[0]
        for row in db.execute(
            """
            SELECT table_name FROM information_schema.columns
            WHERE table_schema = 'public' AND column_name = 'account_id'
            """
        ).fetchall()
    ]
    counts = {
        table: db.execute(f'SELECT count(*) FROM public."{table}" WHERE account_id = %s', (account_id,)).fetchone()[0]
        for table in tables
    }
    return {table: n for table, n in counts.items() if n}


def auth_user_exists(db, account_id: str) -> bool:
    return db.execute("SELECT count(*) FROM auth.users WHERE id = %s", (account_id,)).fetchone()[0] == 1


def objects_of(db, account_id: str) -> int:
    return db.execute(
        "SELECT count(*) FROM storage.objects WHERE bucket_id = 'study-materials' AND name LIKE %s",
        (f"{account_id}/%",),
    ).fetchone()[0]


# --- Delete ---


def test_delete_removes_the_auth_user_profile_every_row_and_all_storage(client, student, db):
    token, account_id = student["token"], student["id"]
    active = full_project(client, db, student)
    archived = full_project(client, db, student)
    ok(archive(client, token, archived["id"]))
    deleted = full_project(client, db, student)
    ok(delete(client, token, deleted["id"]))
    expired = create_project(client, token)
    storage_put(client, f"{account_id}/{expired}/e/original")
    ok(delete(client, token, expired))
    set_deleted_days_ago(db, expired, 31)
    assert account_rows(db, account_id)
    # The active Project's original and staged photo; one original each for the others (archive and
    # delete revoked their phone links, which deleted their staged photos).
    wait_for(lambda: objects_of(db, account_id) == 5)

    gone(delete_me(client, token))

    assert not auth_user_exists(db, account_id)
    assert account_rows(db, account_id) == {}
    assert db.execute("SELECT count(*) FROM profiles WHERE account_id = %s", (account_id,)).fetchone()[0] == 0
    for project_id in (active["id"], archived["id"], deleted["id"], expired):
        assert db.execute("SELECT count(*) FROM projects WHERE id = %s", (project_id,)).fetchone()[0] == 0
    assert db.execute("SELECT count(*) FROM sections WHERE id = ANY(%s::uuid[])",
                      (active["section_ids"],)).fetchone()[0] == 0
    assert db.execute("SELECT count(*) FROM mistakes WHERE quiz_question_id = ANY(%s::uuid[])",
                      (deleted["question_ids"],)).fetchone()[0] == 0
    assert objects_of(db, account_id) == 0


def test_the_session_ends_with_the_account(client, student):
    gone(delete_me(client, student["token"]))

    assert_error(client.get("/api/me", headers=bearer(student["token"])), 401, "unauthorized")


def test_an_open_phone_link_is_revoked_and_its_photos_deleted(client, student, db):
    token, account_id = student["token"], student["id"]
    project_id = create_project(client, token)
    link = new_link(client, token, project_id)
    send_batch(client, link, [READABLE])
    assert objects_of(db, account_id) == 1

    gone(delete_me(client, token))

    assert phone_get(client, link).status_code == 410
    assert objects_of(db, account_id) == 0


def test_other_accounts_are_untouched(client, gotrue, created, student, db):
    other = sign_up(gotrue, created)
    other_token, other_id = other["access_token"], other["user"]["id"]
    foreign = create_project(client, other_token)
    seed(db, other_id, foreign, ["text"])
    storage_put(client, f"{other_id}/{foreign}/x/original")
    full_project(client, db, student)

    gone(delete_me(client, student["token"]))

    assert auth_user_exists(db, other_id)
    assert account_rows(db, other_id)
    assert objects_of(db, other_id) == 1
    assert ok(client.get("/api/projects", headers=bearer(other_token)))[0]["id"] == foreign
    # Clean up the other Account the way the app does.
    gone(delete_me(client, other_token))
    assert objects_of(db, other_id) == 0


def test_the_same_email_can_register_again_with_a_fresh_empty_account(client, gotrue, created, db):
    email = new_email()
    first = sign_up(gotrue, created, email)
    token, old_id = first["access_token"], first["user"]["id"]
    project_id = create_project(client, token)
    seed(db, old_id, project_id, ["text"])

    gone(delete_me(client, token))

    again = sign_up(gotrue, created, email, PASSWORD)
    new_token, new_id = again["access_token"], again["user"]["id"]
    assert new_id != old_id
    me = client.post("/api/auth/after-sign-in", headers=bearer(new_token), json={"first_name": "Emma", "language": "en"})
    assert me.status_code == 200, me.text
    assert me.json()["last_project_id"] is None
    assert ok(client.get("/api/projects", headers=bearer(new_token))) == []
    # Only what a new sign-up makes: the profile and its verification email.
    assert set(account_rows(db, new_id)) <= {"profiles", "email_verifications"}
    assert account_rows(db, old_id) == {}


def test_an_account_with_no_projects_is_deleted(client, student, db):
    gone(delete_me(client, student["token"]))

    assert not auth_user_exists(db, student["id"])
    assert account_rows(db, student["id"]) == {}


def test_delete_needs_a_session(client):
    assert_error(client.delete("/api/me"), 401, "unauthorized")


# --- The auth delete fails ---


def test_a_failing_auth_delete_is_unavailable_keeps_the_profile_and_a_retry_works(client, student, db, monkeypatch):
    token, account_id = student["token"], student["id"]
    project_id = create_project(client, token)
    storage_put(client, f"{account_id}/{project_id}/f/original")
    http = client.app.state.http
    real_delete = http.delete

    async def failing_delete(url, *args, **kwargs):
        if str(url).startswith("/auth/v1/admin/users/"):
            return httpx2.Response(500)
        return await real_delete(url, *args, **kwargs)

    monkeypatch.setattr(http, "delete", failing_delete)

    assert_error(delete_me(client, token), 503, "auth_unavailable")

    assert auth_user_exists(db, account_id)
    assert db.execute("SELECT count(*) FROM profiles WHERE account_id = %s", (account_id,)).fetchone()[0] == 1
    # The files are already gone; the Account remains and can retry.
    assert objects_of(db, account_id) == 0

    monkeypatch.setattr(http, "delete", real_delete)
    gone(delete_me(client, token))
    assert not auth_user_exists(db, account_id)
    assert account_rows(db, account_id) == {}


def stub_admin_delete(monkeypatch, http, answer):
    """Make the admin delete-user call answer with `answer(url)` (a response, or it raises)."""
    real_delete = http.delete

    async def stubbed(url, *args, **kwargs):
        if str(url).startswith("/auth/v1/admin/users/"):
            return answer(url)
        return await real_delete(url, *args, **kwargs)

    monkeypatch.setattr(http, "delete", stubbed)


def test_an_auth_user_already_gone_counts_as_deleted(client, student, db, monkeypatch):
    stub_admin_delete(monkeypatch, client.app.state.http, lambda url: httpx2.Response(404))

    gone(delete_me(client, student["token"]))


def test_an_unreachable_auth_service_is_unavailable(client, student, db, monkeypatch):
    def unreachable(url):
        raise httpx2.ConnectError("unreachable")

    stub_admin_delete(monkeypatch, client.app.state.http, unreachable)

    assert_error(delete_me(client, student["token"]), 503, "auth_unavailable")
    assert auth_user_exists(db, student["id"])


# --- A running job (AD-20) ---


def test_a_running_quiz_is_interrupted_waited_for_and_nothing_is_saved(settings, student, db):
    with TestClient(create_app(settings.model_copy(update={"llm_mock_delay_ms": 5000})), backend_options=LOOP) as c:
        project_id = create_project(c, student["token"])
        seed(db, student["id"], project_id, ["text"] * 5)
        job_id = started(make_quiz(c, student["token"], project_id, ALL, count=5))
        wait_for(lambda: job_row(db, job_id)[1] == "writing", timeout=15)

        began = time.monotonic()
        gone(delete_me(c, student["token"]))
        # Interrupted, not waited out: well below the 5 s mock delay.
        assert time.monotonic() - began < 4
        assert c.app.state.runner.running == 0

    assert job_row(db, job_id) is None
    assert quizzes_in(db, project_id) == 0
    assert account_rows(db, student["id"]) == {}


def test_the_deletion_goes_on_when_a_job_outlives_the_wait(settings, student, db, monkeypatch):
    monkeypatch.setattr(account, "DELETE_WAIT_SECONDS", 0.5)
    with TestClient(create_app(settings.model_copy(update={"llm_mock_delay_ms": 3000})), backend_options=LOOP) as c:
        runner = c.app.state.runner
        monkeypatch.setattr(runner, "interrupt", lambda job_id: None)
        project_id = create_project(c, student["token"])
        seed(db, student["id"], project_id, ["text"] * 5)
        job_id = started(make_quiz(c, student["token"], project_id, ALL, count=5))
        wait_for(lambda: job_row(db, job_id)[1] == "writing", timeout=15)

        gone(delete_me(c, student["token"]))
        assert runner.running == 1
        assert not auth_user_exists(db, student["id"])
        wait_for(lambda: runner.running == 0, timeout=15)

    assert job_row(db, job_id) is None
    assert quizzes_in(db, project_id) == 0
    assert account_rows(db, student["id"]) == {}
