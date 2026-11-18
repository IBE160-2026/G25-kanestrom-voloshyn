"""Selection Scope and capacity (Story 3.1a, FR-10, AD-7).

`topics.resolve_scope` is observed through the capacity endpoint and through the frozen params of the
quiz job a request queues. Files are seeded straight into the database, except the one real upload of
`photosynthesis-notes.md`. Needs local Supabase, like test_materials.py.
"""

import json
import uuid

import pytest
from fastapi.testclient import TestClient

from app.extraction.text import count_words
from app.main import create_app
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
    student,
    upload_and_wait,
)

ALL = {"all_topics": True}


def seed(db, account_id: str, project_id: str, texts: list[str], topics: list[list[int]] | None = None,
         status: str = "ready") -> tuple[str, list[str], list[str]]:
    """A Material with one Section per text and Topics linked to the listed Section positions (by default
    one Topic per Section). Returns (material_id, [section_id, ...], [topic_id, ...])."""
    material_id = insert_material(db, account_id, project_id, status)
    section_ids = [
        str(
            db.execute(
                "INSERT INTO sections (material_id, position, label, text) VALUES (%s, %s, %s, %s) RETURNING id",
                (material_id, n, f"Page {n + 1}", text),
            ).fetchone()[0]
        )
        for n, text in enumerate(texts)
    ]
    topic_ids = []
    for position, positions in enumerate(topics if topics is not None else [[n] for n in range(len(texts))]):
        topic_id = str(
            db.execute(
                "INSERT INTO topics (material_id, label, position) VALUES (%s, %s, %s) RETURNING id",
                (material_id, f"Topic {position + 1}", position),
            ).fetchone()[0]
        )
        for p in positions:
            db.execute("INSERT INTO topic_sections (topic_id, section_id) VALUES (%s, %s)", (topic_id, section_ids[p]))
        topic_ids.append(topic_id)
    return material_id, section_ids, topic_ids


def add_student_topic(db, material_id: str, label: str = "Calvin cycle") -> str:
    position = db.execute("SELECT coalesce(max(position), -1) + 1 FROM topics WHERE material_id = %s",
                          (material_id,)).fetchone()[0]
    return str(
        db.execute(
            "INSERT INTO topics (material_id, label, position, origin) VALUES (%s, %s, %s, 'student') RETURNING id",
            (material_id, label, position),
        ).fetchone()[0]
    )


def words(n: int) -> str:
    return " ".join(f"word{i}" for i in range(n))


def capacity(client, token: str, project_id: str, scope) -> object:
    raw = scope if isinstance(scope, str) else json.dumps(scope)
    return client.get(f"/api/projects/{project_id}/capacity", params={"scope": raw}, headers=bearer(token))


def max_questions(client, token: str, project_id: str, scope) -> int:
    response = capacity(client, token, project_id, scope)
    assert response.status_code == 200, response.text
    return response.json()["max_questions"]


def make_quiz(client, token: str, project_id: str, scope, count: int = 10):
    return client.post(f"/api/projects/{project_id}/quizzes", json={"scope": scope, "count": count}, headers=bearer(token))


def job_params(db, job_id: str) -> dict:
    return db.execute("SELECT params FROM generation_jobs WHERE id = %s", (job_id,)).fetchone()[0]


def quiz_jobs(db, project_id: str) -> int:
    return db.execute("SELECT count(*) FROM generation_jobs WHERE project_id = %s AND kind = 'quiz'",
                      (project_id,)).fetchone()[0]


@pytest.fixture
def project(client, student) -> str:
    return create_project(client, student["token"])


# --- Capacity ---


def test_capacity_of_the_notes_is_words_over_80_with_one_per_section(client, student, db, project):
    material = upload_and_wait(client, student["token"], project, "photosynthesis-notes.md")
    assert material["status"] == "ready"
    texts = [row[0] for row in db.execute("SELECT text FROM sections WHERE material_id = %s", (material["id"],))]
    expected = min(20, max(len(texts), sum(count_words(t) for t in texts) // 80))

    assert max_questions(client, student["token"], project, ALL) == expected
    assert 8 <= expected <= 20


def test_capacity_is_at_least_one_per_section_and_at_most_20(client, student, db, project):
    seed(db, student["id"], project, ["short"] * 6)
    assert max_questions(client, student["token"], project, ALL) == 6

    seed(db, student["id"], project, ["short"] * 30)
    assert max_questions(client, student["token"], project, ALL) == 20


def test_capacity_counts_only_the_chosen_topics(client, student, db, project):
    _, _, topic_ids = seed(db, student["id"], project, [words(800), words(80), words(80)])

    assert max_questions(client, student["token"], project, {"topic_ids": [topic_ids[0]]}) == 10
    assert max_questions(client, student["token"], project, {"topic_ids": topic_ids[1:]}) == 2


def test_capacity_follows_the_words_per_item_setting(settings, student, db, project):
    seed(db, student["id"], project, [words(400)])
    with TestClient(create_app(settings.model_copy(update={"capacity_words_per_item": 40})), backend_options=LOOP) as c:
        assert max_questions(c, student["token"], project, ALL) == 10


def test_capacity_of_a_foreign_topic_is_not_found(client, gotrue, created, student, db, project):
    other = sign_up(gotrue, created)
    other_project = create_project(client, other["access_token"])
    _, _, foreign = seed(db, other["user"]["id"], other_project, ["text"])

    assert_error(capacity(client, student["token"], project, {"topic_ids": foreign}), 404, "not_found")
    assert_error(capacity(client, student["token"], project, {"topic_ids": [str(uuid.uuid4())]}), 404, "not_found")


def test_capacity_of_a_foreign_project_is_not_found(client, gotrue, created, student, db):
    other = sign_up(gotrue, created)
    other_project = create_project(client, other["access_token"])
    seed(db, other["user"]["id"], other_project, ["text"])

    assert_error(capacity(client, student["token"], other_project, ALL), 404, "not_found")


@pytest.mark.parametrize(
    "scope", ["not json", "{}", '{"all_topics": false}', '{"topic_ids": []}', '{"all_topics": true, "topic_ids": []}']
)
def test_capacity_refuses_a_malformed_scope(client, student, project, scope):
    assert_error(capacity(client, student["token"], project, scope), 422, "invalid_request")


def test_capacity_with_no_ready_file_is_insufficient_material(client, student, db, project):
    insert_material(db, student["id"], project, "processing")
    assert_error(capacity(client, student["token"], project, ALL), 422, "insufficient_material")


def test_capacity_works_in_an_archived_project(client, student, db, project):
    seed(db, student["id"], project, ["text"] * 3)
    db.execute("UPDATE projects SET archived_at = now() WHERE id = %s", (project,))
    assert max_questions(client, student["token"], project, ALL) == 3


# --- resolve_scope, through the frozen job params ---


def test_all_topics_takes_every_section_of_every_ready_file_but_no_removed_or_unready_one(client, student, db, project):
    _, first, _ = seed(db, student["id"], project, ["one", "two"])
    _, second, _ = seed(db, student["id"], project, ["three"])
    removed, _, _ = seed(db, student["id"], project, ["gone"])
    db.execute("UPDATE study_materials SET removed_at = now() WHERE id = %s", (removed,))
    seed(db, student["id"], project, ["reading"], status="processing")

    response = make_quiz(client, student["token"], project, ALL)

    assert response.status_code == 202, response.text
    params = job_params(db, response.json()["job_id"])
    # Three one-word Sections support 3 questions: the frozen count is cut to that.
    assert params == {"count": 3, "section_ids": first + second, "topic_labels": []}


def test_topic_ids_take_their_sections_and_labels(client, student, db, project):
    _, sections, topic_ids = seed(db, student["id"], project, ["a", "b", "c", "d"], topics=[[0, 1], [2], [3]])

    response = make_quiz(client, student["token"], project, {"topic_ids": [topic_ids[2], topic_ids[0]]}, count=5)

    assert response.status_code == 202, response.text
    params = job_params(db, response.json()["job_id"])
    assert params["section_ids"] == [sections[0], sections[1], sections[3]]
    assert params["topic_labels"] == ["Topic 3", "Topic 1"]
    assert params["count"] == 3  # 5 asked for, 3 Sections in scope


def test_a_student_topic_with_no_sections_resolves_to_its_whole_file_with_its_label_as_focus(client, student, db, project):
    material_id, sections, _ = seed(db, student["id"], project, ["a", "b", "c"])
    seed(db, student["id"], project, ["other file"])
    topic_id = add_student_topic(db, material_id, "Calvin cycle")

    response = make_quiz(client, student["token"], project, {"topic_ids": [topic_id]})

    assert response.status_code == 202, response.text
    params = job_params(db, response.json()["job_id"])
    assert params["section_ids"] == sections
    assert params["topic_labels"] == ["Calvin cycle"]


def test_a_topic_of_a_file_that_is_not_ready_is_not_found(client, student, db, project):
    material_id, _, topic_ids = seed(db, student["id"], project, ["a"], status="processing")

    assert_error(make_quiz(client, student["token"], project, {"topic_ids": topic_ids}), 404, "not_found")
    assert_error(capacity(client, student["token"], project, {"topic_ids": topic_ids}), 404, "not_found")
    assert quiz_jobs(db, project) == 0


def test_the_frozen_count_is_the_asked_count_cut_to_capacity(client, student, db, project):
    seed(db, student["id"], project, [words(800)])  # capacity 10

    small = make_quiz(client, student["token"], project, ALL, count=5)
    large = make_quiz(client, student["token"], project, ALL, count=20)

    assert job_params(db, small.json()["job_id"])["count"] == 5
    assert job_params(db, large.json()["job_id"])["count"] == 10


def test_a_topic_of_a_removed_file_is_not_found(client, student, db, project):
    material_id, _, topic_ids = seed(db, student["id"], project, ["a"])
    db.execute("UPDATE study_materials SET removed_at = now() WHERE id = %s", (material_id,))

    assert_error(make_quiz(client, student["token"], project, {"topic_ids": topic_ids}), 404, "not_found")
    assert quiz_jobs(db, project) == 0


def test_a_scope_over_the_budget_is_refused_and_nothing_is_queued(settings, student, db, project):
    # 1000 tokens is 4000 characters (characters // 4); this is 1001.
    seed(db, student["id"], project, ["x" * 4004])
    with TestClient(create_app(settings.model_copy(update={"llm_context_budget_tokens": 1000})), backend_options=LOOP) as c:
        assert_error(make_quiz(c, student["token"], project, ALL), 422, "scope_too_large")
    assert quiz_jobs(db, project) == 0


def test_no_ready_file_refuses_the_quiz(client, student, db, project):
    insert_material(db, student["id"], project, "processing")

    assert_error(make_quiz(client, student["token"], project, ALL), 422, "insufficient_material")
    assert quiz_jobs(db, project) == 0


@pytest.mark.parametrize("count", [0, 3, 15, 21, 100])
def test_only_5_10_or_20_questions_can_be_asked_for(client, student, db, project, count):
    seed(db, student["id"], project, ["text"])
    assert_error(make_quiz(client, student["token"], project, ALL, count=count), 422, "invalid_request")
