""""Do it again" for a Quiz or a Flashcard set, and `source_removed` on their GET (Story 5.2, FR-25, AD-7,
AD-20, AD-22). Runs in mock mode against local Supabase, like test_quiz_generation.py.
"""

import pytest

from app.api.deps import active_project
from app.config import Settings
from app.main import create_app
from tests.test_auth import (  # noqa: F401 -- shared fixtures
    assert_error,
    bearer,
    client,
    created,
    db,
    gotrue,
    settings,
    sign_up,
)
from tests.test_flashcard_generation import make_cards
from tests.test_materials import (  # noqa: F401 -- shared fixtures
    create_project,
    student,
    wait_for_job,
)
from tests.test_routes_guard import _calls, api_routes
from tests.test_scope import ALL, job_params, make_quiz, seed

# kind -> (job kind, artifact path, artifact table, the request that makes one)
KINDS = {
    "quiz": ("quiz", "quizzes", "quizzes", make_quiz),
    "flashcards": ("flashcards", "flashcard-sets", "flashcard_sets", make_cards),
}


@pytest.fixture
def project(client, student) -> str:
    return create_project(client, student["token"])


def made(client, db, token: str, project_id: str, kind: str, scope=ALL, count: int = 5) -> str:
    """Generate one artifact of `kind` through the API and return its id."""
    response = KINDS[kind][3](client, token, project_id, scope, count=count)
    assert response.status_code == 202, response.text
    job_id = response.json()["job_id"]
    assert wait_for_job(db, job_id) == "completed"
    return str(db.execute("SELECT result_ref FROM generation_jobs WHERE id = %s", (job_id,)).fetchone()[0])


def again(client, token: str, project_id: str, kind: str, artifact_id: str):
    return client.post(f"/api/projects/{project_id}/{KINDS[kind][1]}/{artifact_id}/again", headers=bearer(token))


def get(client, token: str, project_id: str, kind: str, artifact_id: str):
    return client.get(f"/api/projects/{project_id}/{KINDS[kind][1]}/{artifact_id}", headers=bearer(token))


def frozen(db, kind: str, artifact_id: str) -> dict:
    return db.execute(f"SELECT generation_params FROM {KINDS[kind][2]} WHERE id = %s", (artifact_id,)).fetchone()[0]


def jobs_of(db, project_id: str, kind: str) -> int:
    return db.execute(
        "SELECT count(*) FROM generation_jobs WHERE project_id = %s AND kind = %s", (project_id, KINDS[kind][0])
    ).fetchone()[0]


def snapshot(db, kind: str, artifact_id: str) -> tuple:
    if kind == "quiz":
        return (
            db.execute("SELECT generation_params, requested_count FROM quizzes WHERE id = %s", (artifact_id,)).fetchone(),
            db.execute("SELECT id, question FROM quiz_questions WHERE quiz_id = %s ORDER BY position",
                       (artifact_id,)).fetchall(),
        )
    return (
        db.execute("SELECT generation_params, requested_count, ended_at FROM flashcard_sets WHERE id = %s",
                   (artifact_id,)).fetchone(),
        db.execute("SELECT id, question FROM flashcards WHERE set_id = %s ORDER BY position", (artifact_id,)).fetchall(),
        db.execute("SELECT id, card_id, mark FROM flashcard_marks WHERE set_id = %s ORDER BY id", (artifact_id,)).fetchall(),
    )


# --- Again (matrix: Quiz again, Set again) ---


@pytest.mark.parametrize("kind", KINDS)
def test_again_queues_a_job_with_the_frozen_params_and_leaves_the_original_unchanged(client, student, db, project, kind):
    _, _, topic_ids = seed(db, student["id"], project, ["text"] * 6, topics=[[0, 1, 2], [3, 4, 5]])
    original = made(client, db, student["token"], project, kind, scope={"topic_ids": [topic_ids[1]]})
    if kind == "flashcards":
        card = db.execute("SELECT id FROM flashcards WHERE set_id = %s ORDER BY position", (original,)).fetchone()[0]
        marked = client.post(f"/api/projects/{project}/flashcard-sets/{original}/cards/{card}/mark",
                             json={"mark": "not_yet"}, headers=bearer(student["token"]))
        assert marked.status_code == 200, marked.text
    # A later scope change must not reach the again job: the params are never resolved again (AD-7).
    seed(db, student["id"], project, ["more text"] * 4)
    before = snapshot(db, kind, original)

    response = again(client, student["token"], project, kind, original)

    assert response.status_code == 202, response.text
    job_id = response.json()["job_id"]
    assert job_params(db, job_id) == frozen(db, kind, original)
    assert db.execute("SELECT kind FROM generation_jobs WHERE id = %s", (job_id,)).fetchone()[0] == KINDS[kind][0]
    assert wait_for_job(db, job_id) == "completed"
    new_id = str(db.execute("SELECT result_ref FROM generation_jobs WHERE id = %s", (job_id,)).fetchone()[0])
    assert new_id != original
    assert frozen(db, kind, new_id) == frozen(db, kind, original)
    assert snapshot(db, kind, original) == before


# --- Removed source (matrix: Source removed) ---


@pytest.mark.parametrize("kind", KINDS)
def test_a_removed_source_shows_on_get_and_refuses_again_with_no_job(client, student, db, project, kind):
    material_id, _, _ = seed(db, student["id"], project, ["text"] * 5)
    original = made(client, db, student["token"], project, kind)
    assert get(client, student["token"], project, kind, original).json()["source_removed"] is False

    db.execute("UPDATE study_materials SET removed_at = now() WHERE id = %s", (material_id,))
    db.execute("UPDATE sections SET text = '' WHERE material_id = %s", (material_id,))
    jobs_before = jobs_of(db, project, kind)

    response = get(client, student["token"], project, kind, original)
    assert response.status_code == 200, response.text
    assert response.json()["source_removed"] is True
    assert_error(again(client, student["token"], project, kind, original), 409, "material_removed")
    assert jobs_of(db, project, kind) == jobs_before


@pytest.mark.parametrize("kind", KINDS)
def test_one_removed_file_of_several_counts_as_removed(client, student, db, project, kind):
    kept, _, _ = seed(db, student["id"], project, ["text"] * 3)
    removed, _, _ = seed(db, student["id"], project, ["text"] * 3)
    original = made(client, db, student["token"], project, kind)

    db.execute("UPDATE study_materials SET removed_at = now() WHERE id = %s", (removed,))

    assert get(client, student["token"], project, kind, original).json()["source_removed"] is True
    assert_error(again(client, student["token"], project, kind, original), 409, "material_removed")


# --- Read-only (matrix: Read-only) ---


@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("column", ["archived_at", "deleted_at"])
def test_a_read_only_project_opens_the_result_but_refuses_again(client, student, db, project, kind, column):
    seed(db, student["id"], project, ["text"] * 5)
    original = made(client, db, student["token"], project, kind)
    db.execute(f"UPDATE projects SET {column} = now() WHERE id = %s", (project,))
    jobs_before = jobs_of(db, project, kind)

    assert get(client, student["token"], project, kind, original).status_code == 200
    assert_error(again(client, student["token"], project, kind, original), 409, "project_read_only")
    assert jobs_of(db, project, kind) == jobs_before


# --- Foreign or missing (matrix: Foreign or missing) ---


@pytest.mark.parametrize("kind", KINDS)
def test_a_foreign_or_missing_artifact_is_not_found(client, gotrue, created, student, db, project, kind):
    seed(db, student["id"], project, ["text"] * 5)
    original = made(client, db, student["token"], project, kind)
    other = sign_up(gotrue, created)
    other_project = create_project(client, other["access_token"])
    own_other_project = create_project(client, student["token"])

    assert_error(again(client, other["access_token"], other_project, kind, original), 404, "not_found")
    assert_error(again(client, other["access_token"], project, kind, original), 404, "not_found")
    assert_error(again(client, student["token"], own_other_project, kind, original), 404, "not_found")
    assert_error(again(client, student["token"], project, kind, "00000000-0000-0000-0000-000000000000"), 404,
                 "not_found")
    assert jobs_of(db, project, kind) == 1


# --- Removed mid-run (matrix: Removed mid-run) ---


@pytest.mark.parametrize("kind", KINDS)
def test_a_file_removed_while_the_again_job_runs_ends_it_cancelled(settings, student, db, kind):
    from fastapi.testclient import TestClient

    from tests.test_auth import LOOP

    slow_settings = settings.model_copy(update={"llm_mock_delay_ms": 600})
    with TestClient(create_app(slow_settings), backend_options=LOOP) as slow:
        project = create_project(slow, student["token"])
        material_id, _, _ = seed(db, student["id"], project, ["text"] * 5)
        original = made(slow, db, student["token"], project, kind)
        response = again(slow, student["token"], project, kind, original)
        assert response.status_code == 202, response.text
        job_id = response.json()["job_id"]

        removed = slow.delete(f"/api/projects/{project}/materials/{material_id}", headers=bearer(student["token"]))
        assert removed.status_code == 204, removed.text

        assert wait_for_job(db, job_id) == "cancelled"


# --- The guard (AD-22) ---


@pytest.mark.parametrize(
    "path",
    ["/api/projects/{project_id}/quizzes/{quiz_id}/again", "/api/projects/{project_id}/flashcard-sets/{set_id}/again"],
)
def test_again_routes_are_guarded(path):
    app = create_app(Settings(_env_file=None, llm_mode="mock"))
    route = next(r for r in api_routes(app) if r.path == path and "POST" in r.methods)
    assert active_project in _calls(route.dependant)
