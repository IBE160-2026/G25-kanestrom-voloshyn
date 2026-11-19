"""Delete a Project forever, and the 30-day purge (Story 7.2b: FR-24, AD-18, AD-20, AD-22).

Runs the real routes in mock mode against local Supabase, like test_delete_project.py. "Delete forever"
removes only a deleted Project: the row and every child row (by cascade, Mistake history included), then
its Storage prefix. A Project deleted more than 30 days ago is gone to every read before the purge task,
which runs at startup and then hourly, removes it.
"""

import time

from fastapi.testclient import TestClient

from app.main import create_app
from app.services import projects
from tests.test_archive import archive, ok, restore
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
from tests.test_delete_project import delete
from tests.test_materials import (  # noqa: F401 -- shared fixtures
    create_project,
    storage_put,
    student,
    upload,
    wait_for,
)
from tests.test_mistakes import outstanding
from tests.test_phone_upload import READABLE, new_link, send_batch
from tests.test_quiz_answers import answer, insert_quiz
from tests.test_quiz_generation import job_row, quizzes_in, started
from tests.test_scope import ALL, make_quiz, seed
from tests.test_topic_edits import seed as seed_topics


def purge(client, token: str, project_id: str):
    return client.post(f"/api/projects/{project_id}/purge", headers=bearer(token))


def gone(response) -> None:
    assert response.status_code == 204, response.text


def project_exists(db, project_id: str) -> bool:
    return db.execute("SELECT count(*) FROM projects WHERE id = %s", (project_id,)).fetchone()[0] == 1


def objects_under(db, account_id: str, project_id: str) -> int:
    return db.execute(
        "SELECT count(*) FROM storage.objects WHERE bucket_id = 'study-materials' AND name LIKE %s",
        (f"{account_id}/{project_id}/%",),
    ).fetchone()[0]


def child_rows(db, project_id: str) -> dict[str, int]:
    """Rows of the Project in every table that has a `project_id` column (non-zero counts only)."""
    tables = [
        row[0]
        for row in db.execute(
            """
            SELECT table_name FROM information_schema.columns
            WHERE table_schema = 'public' AND column_name = 'project_id' AND table_name <> 'projects'
            """
        ).fetchall()
    ]
    counts = {
        table: db.execute(f'SELECT count(*) FROM public."{table}" WHERE project_id = %s', (project_id,)).fetchone()[0]
        for table in tables
    }
    return {table: n for table, n in counts.items() if n}


def set_deleted_days_ago(db, project_id: str, days: int) -> None:
    db.execute(
        "UPDATE projects SET deleted_at = now() - make_interval(days => %s) WHERE id = %s", (days, project_id)
    )


def full_project(client, db, student) -> dict:
    """A Project with a Material, Sections, Topics, a Quiz answered wrong (Mistakes), a phone link and
    batch, a finished job, and stored objects (an original and a staged photo)."""
    token = student["token"]
    project_id = create_project(client, token)
    material_id, section_ids, topic_ids = seed(db, student["id"], project_id, ["text"] * 4)
    quiz_id, question_ids, _ = insert_quiz(db, student["id"], project_id, correct="b")
    for question_id in question_ids:
        assert answer(client, token, project_id, quiz_id, question_id, "a").status_code == 200
    assert outstanding(client, token, project_id) == 3
    link = new_link(client, token, project_id)
    send_batch(client, link, [READABLE])
    db.execute(
        """
        INSERT INTO generation_jobs (account_id, project_id, kind, params, status, finished_at)
        VALUES (%s, %s, 'quiz', '{}'::jsonb, 'completed', now())
        """,
        (student["id"], project_id),
    )
    storage_put(client, f"{student['id']}/{project_id}/{material_id}/original")
    return {
        "id": project_id,
        "material_id": material_id,
        "section_ids": section_ids,
        "topic_ids": topic_ids,
        "question_ids": question_ids,
    }


# --- Delete forever ---


def test_delete_forever_removes_the_project_every_child_row_and_its_storage(client, student, db):
    project = full_project(client, db, student)
    project_id = project["id"]
    assert child_rows(db, project_id)
    assert objects_under(db, student["id"], project_id) >= 2
    ok(delete(client, student["token"], project_id))

    gone(purge(client, student["token"], project_id))

    assert not project_exists(db, project_id)
    assert child_rows(db, project_id) == {}
    assert db.execute("SELECT count(*) FROM sections WHERE id = ANY(%s::uuid[])",
                      (project["section_ids"],)).fetchone()[0] == 0
    assert db.execute("SELECT count(*) FROM quiz_questions WHERE id = ANY(%s::uuid[])",
                      (project["question_ids"],)).fetchone()[0] == 0
    assert db.execute("SELECT count(*) FROM mistakes WHERE quiz_question_id = ANY(%s::uuid[])",
                      (project["question_ids"],)).fetchone()[0] == 0
    wait_for(lambda: objects_under(db, student["id"], project_id) == 0)
    listed = ok(client.get("/api/projects", headers=bearer(student["token"])))
    assert project_id not in [p["id"] for p in listed]


def test_delete_forever_leaves_other_projects_and_accounts_untouched(client, gotrue, created, student, db):
    other_student = sign_up(gotrue, created)
    other_token = other_student["access_token"]
    foreign = create_project(client, other_token)
    seed(db, other_student["user"]["id"], foreign, ["text"])
    storage_put(client, f"{other_student['user']['id']}/{foreign}/x/original")
    sibling = create_project(client, student["token"])
    seed(db, student["id"], sibling, ["text"])
    storage_put(client, f"{student['id']}/{sibling}/y/original")
    project_id = create_project(client, student["token"])
    storage_put(client, f"{student['id']}/{project_id}/z/original")
    ok(delete(client, student["token"], project_id))
    ok(delete(client, other_token, foreign))

    gone(purge(client, student["token"], project_id))

    assert project_exists(db, sibling) and project_exists(db, foreign)
    assert child_rows(db, sibling) and child_rows(db, foreign)
    assert objects_under(db, student["id"], sibling) == 1
    assert objects_under(db, other_student["user"]["id"], foreign) == 1
    # Clean up the other Account's object the way the app does.
    gone(purge(client, other_token, foreign))
    wait_for(lambda: objects_under(db, other_student["user"]["id"], foreign) == 0)


def test_delete_forever_refuses_a_project_that_isnt_deleted(client, student, db):
    active = create_project(client, student["token"])
    archived = create_project(client, student["token"])
    ok(archive(client, student["token"], archived))
    storage_put(client, f"{student['id']}/{active}/a/original")

    assert_error(purge(client, student["token"], active), 409, "project_not_deleted")
    assert_error(purge(client, student["token"], archived), 409, "project_not_deleted")

    assert project_exists(db, active) and project_exists(db, archived)
    assert objects_under(db, student["id"], active) == 1


def test_delete_forever_of_a_foreign_or_missing_project_is_not_found(client, gotrue, created, student, db):
    project_id = create_project(client, student["token"])
    ok(delete(client, student["token"], project_id))
    other = sign_up(gotrue, created)

    assert_error(purge(client, other["access_token"], project_id), 404, "not_found")
    assert_error(purge(client, student["token"], "00000000-0000-0000-0000-000000000000"), 404, "not_found")
    assert project_exists(db, project_id)


def test_delete_forever_twice_is_not_found(client, student, db):
    project_id = create_project(client, student["token"])
    ok(delete(client, student["token"], project_id))
    gone(purge(client, student["token"], project_id))

    assert_error(purge(client, student["token"], project_id), 404, "not_found")


def test_delete_forever_needs_a_session(client, student):
    project_id = create_project(client, student["token"])
    ok(delete(client, student["token"], project_id))
    assert_error(client.post(f"/api/projects/{project_id}/purge"), 401, "unauthorized")


def test_a_project_restored_during_the_wait_is_not_purged(client, student, db, monkeypatch):
    # Restore lands between the first transaction and the row delete: the purge refuses and keeps it all.
    token = student["token"]
    project_id = create_project(client, token)
    seed(db, student["id"], project_id, ["text"])
    storage_put(client, f"{student['id']}/{project_id}/r/original")
    ok(delete(client, token, project_id))
    runner = client.app.state.runner

    async def restore_then_return(job_ids, timeout=30.0):
        db.execute("UPDATE projects SET deleted_at = NULL WHERE id = %s", (project_id,))
        return True

    monkeypatch.setattr(runner, "wait_for", restore_then_return)

    assert_error(purge(client, token, project_id), 409, "project_not_deleted")

    assert project_exists(db, project_id)
    assert child_rows(db, project_id)
    assert objects_under(db, student["id"], project_id) == 1


def test_every_foreign_key_chain_to_projects_cascades(db):
    # Every table that reaches `projects`, directly or through other tables, must go with it: a
    # grandchild (quiz answers, phone batch photos, ...) can neither block nor outlive a purge.
    rows = db.execute(
        """
        SELECT c.conrelid::regclass::text, c.confrelid::regclass::text, c.confdeltype
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.contype = 'f' AND n.nspname = 'public'
        """
    ).fetchall()
    reaching = {"projects"}
    changed = True
    while changed:
        changed = False
        for child, parent, _ in rows:
            if parent in reaching and child not in reaching:
                reaching.add(child)
                changed = True
    # A row whose parent goes with the Project must be removed ('c'), or merely unlinked ('n', SET NULL)
    # when it doesn't belong to the Project (a job reference, the profile's last Project).
    blocking = [(child, parent, kind) for child, parent, kind in rows
                if parent in reaching and kind not in ("c", "n")]
    assert blocking == []
    assert len(reaching) > 5
    set_null = {(child, parent) for child, parent, kind in rows if parent in reaching and kind == "n"}
    # Every SET NULL edge points at a row whose own child still goes by cascade some other way, or at
    # the profile, which outlives the Project on purpose.
    for child, _ in set_null:
        assert child == "profiles" or any(c == child and k == "c" and p in reaching for c, p, k in rows), child


# --- A running job (AD-20) ---


def test_purge_interrupts_a_running_quiz_waits_for_it_and_nothing_is_saved(settings, student, db):
    # A long model call: the purge interrupts it and waits for its task, instead of waiting it out.
    with TestClient(create_app(settings.model_copy(update={"llm_mock_delay_ms": 5000})), backend_options=LOOP) as c:
        project_id = create_project(c, student["token"])
        seed(db, student["id"], project_id, ["text"] * 5)
        job_id = started(make_quiz(c, student["token"], project_id, ALL, count=5))
        wait_for(lambda: job_row(db, job_id)[1] == "writing", timeout=15)
        ok(delete(c, student["token"], project_id))

        began = time.monotonic()
        gone(purge(c, student["token"], project_id))
        # Interrupted, not waited out: well below the 5 s mock delay (and the 30 s wait).
        assert time.monotonic() - began < 4
        assert c.app.state.runner.running == 0

    assert not project_exists(db, project_id)
    assert job_row(db, job_id) is None
    assert quizzes_in(db, project_id) == 0


def test_purge_proceeds_when_a_job_outlives_the_wait(settings, student, db, monkeypatch):
    # The job ignores the interrupt and runs past the wait: the purge deletes anyway, and the job's save
    # step then finds no job (and no Project), so nothing is saved.
    monkeypatch.setattr(projects, "PURGE_WAIT_SECONDS", 0.5)
    with TestClient(create_app(settings.model_copy(update={"llm_mock_delay_ms": 3000})), backend_options=LOOP) as c:
        runner = c.app.state.runner
        monkeypatch.setattr(runner, "interrupt", lambda job_id: None)
        project_id = create_project(c, student["token"])
        seed(db, student["id"], project_id, ["text"] * 5)
        job_id = started(make_quiz(c, student["token"], project_id, ALL, count=5))
        wait_for(lambda: job_row(db, job_id)[1] == "writing", timeout=15)
        ok(delete(c, student["token"], project_id))

        gone(purge(c, student["token"], project_id))
        assert runner.running == 1
        assert not project_exists(db, project_id)
        wait_for(lambda: runner.running == 0, timeout=15)

    assert job_row(db, job_id) is None
    assert quizzes_in(db, project_id) == 0


# --- Expiry and the purge task ---


def test_an_expired_project_is_gone_to_every_read(client, student, db):
    token = student["token"]
    project_id = create_project(client, token)
    ok(delete(client, token, project_id))
    set_deleted_days_ago(db, project_id, 31)

    listed = ok(client.get("/api/projects", headers=bearer(token)))
    assert project_id not in [p["id"] for p in listed]
    assert_error(client.get(f"/api/projects/{project_id}", headers=bearer(token)), 404, "not_found")
    assert_error(restore(client, token, project_id), 404, "not_found")
    assert_error(purge(client, token, project_id), 404, "not_found")
    assert_error(delete(client, token, project_id), 404, "not_found")
    assert_error(upload(client, token, project_id, "photosynthesis-notes.md"), 404, "not_found")
    assert project_exists(db, project_id)


def test_the_task_purges_expired_projects_and_leaves_the_rest(client, student, db):
    token = student["token"]
    expired = create_project(client, token)
    young = create_project(client, token)
    active = create_project(client, token)
    seed_topics(db, student["id"], expired, [[0]])
    storage_put(client, f"{student['id']}/{expired}/e/original")
    for project_id in (expired, young):
        ok(delete(client, token, project_id))
    set_deleted_days_ago(db, expired, 31)
    set_deleted_days_ago(db, young, 29)
    state = client.app.state

    client.portal.call(projects.purge_expired, state.pool, state.storage, state.runner)

    assert not project_exists(db, expired)
    assert child_rows(db, expired) == {}
    wait_for(lambda: objects_under(db, student["id"], expired) == 0)
    assert project_exists(db, young) and project_exists(db, active)
    assert db.execute("SELECT deleted_at IS NOT NULL FROM projects WHERE id = %s", (young,)).fetchone()[0]
    listed = ok(client.get("/api/projects", headers=bearer(token)))
    assert young in [p["id"] for p in listed]
    assert expired not in [p["id"] for p in listed]


def test_the_task_runs_at_startup(settings, client, student, db):
    project_id = create_project(client, student["token"])
    ok(delete(client, student["token"], project_id))
    # Deleted 31 days ago while the app was stopped.
    set_deleted_days_ago(db, project_id, 31)

    with TestClient(create_app(settings), backend_options=LOOP):
        wait_for(lambda: not project_exists(db, project_id))


def test_a_failing_purge_is_logged_and_the_next_project_still_goes(client, student, db, monkeypatch):
    token = student["token"]
    first = create_project(client, token)
    second = create_project(client, token)
    for project_id in (first, second):
        ok(delete(client, token, project_id))
    set_deleted_days_ago(db, first, 40)
    set_deleted_days_ago(db, second, 35)
    real_purge = projects.purge

    async def flaky(pool, storage, runner, account_id, project_id, **kwargs):
        if str(project_id) == first:
            raise RuntimeError("boom")
        await real_purge(pool, storage, runner, account_id, project_id, **kwargs)

    monkeypatch.setattr(projects, "purge", flaky)
    state = client.app.state

    client.portal.call(projects.purge_expired, state.pool, state.storage, state.runner)

    assert project_exists(db, first)
    assert not project_exists(db, second)

    # Retried on the next round.
    monkeypatch.setattr(projects, "purge", real_purge)
    client.portal.call(projects.purge_expired, state.pool, state.storage, state.runner)
    assert not project_exists(db, first)
