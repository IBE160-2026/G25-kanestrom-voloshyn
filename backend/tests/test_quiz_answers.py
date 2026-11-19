"""Taking a Quiz: the hidden-answer payload, scoring, idempotent answers, and source labels (Story 3.2,
FR-11, AD-9, AD-22). Quizzes are inserted straight into the database so each test controls the answer
key; one test runs the mock quiz job end to end. Needs local Supabase, like test_quiz_generation.py.
"""

import json
import uuid

import pytest

from app.llm import Gateway
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
from tests.test_materials import (  # noqa: F401 -- shared fixtures
    create_project,
    student,
    wait_for_job,
)
from tests.test_scope import ALL, make_quiz, seed

OPTIONS = [{"id": "a", "text": "Alpha"}, {"id": "b", "text": "Beta"}, {"id": "c", "text": "Gamma"},
           {"id": "d", "text": "Delta"}]


def insert_quiz(db, account_id: str, project_id: str, n: int = 3, correct: str = "b",
                sources: list[list[int]] | None = None, file_name: str = "lecture.pdf") -> tuple[str, list[str], str]:
    """A Quiz of `n` Questions whose correct option is `correct`, citing Sections of one seeded file.
    `sources` lists, per Question, the positions of the Sections it cites (default: its own Page).
    Returns (quiz_id, [question_id, ...], material_id)."""
    material_id, section_ids, _ = seed(db, account_id, project_id, ["text"] * max(n, 4))
    db.execute("UPDATE study_materials SET file_name = %s WHERE id = %s", (file_name, material_id))
    quiz_id = db.execute(
        """
        INSERT INTO quizzes (account_id, project_id, generation_params, requested_count)
        VALUES (%s, %s, %s, %s) RETURNING id
        """,
        (account_id, project_id, json.dumps({"count": n}), n),
    ).fetchone()[0]
    question_ids = []
    for position in range(n):
        cited = [section_ids[p] for p in (sources[position] if sources else [position])]
        question_ids.append(
            str(
                db.execute(
                    """
                    INSERT INTO quiz_questions (quiz_id, position, question, options, correct_option_id, explanation,
                                                source_section_ids, material_ids)
                    VALUES (%s, %s, %s, %s, %s, %s, %s::uuid[], %s::uuid[]) RETURNING id
                    """,
                    (quiz_id, position, f"Question {position + 1}?", json.dumps(OPTIONS), correct,
                     f"Because {position + 1}.", cited, [material_id]),
                ).fetchone()[0]
            )
        )
    return str(quiz_id), question_ids, material_id


def get_quiz(client, token: str, project_id: str, quiz_id: str):
    return client.get(f"/api/projects/{project_id}/quizzes/{quiz_id}", headers=bearer(token))


def answer(client, token: str, project_id: str, quiz_id: str, question_id: str, option_id):
    return client.post(
        f"/api/projects/{project_id}/quizzes/{quiz_id}/questions/{question_id}/answer",
        json={"option_id": option_id},
        headers=bearer(token),
    )


def answers_in(db, question_ids: list[str]) -> int:
    return db.execute("SELECT count(*) FROM quiz_answers WHERE quiz_question_id = ANY(%s::uuid[])",
                      (question_ids,)).fetchone()[0]


@pytest.fixture
def project(client, student) -> str:
    return create_project(client, student["token"])


# --- Open fresh Quiz ---


def test_a_fresh_quiz_hides_every_answer_key(client, student, db, project):
    quiz_id, question_ids, _ = insert_quiz(db, student["id"], project, n=3)

    response = get_quiz(client, student["token"], project, quiz_id)

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["id"], body["requested_count"], body["question_count"]) == (quiz_id, 3, 3)
    assert [q["id"] for q in body["questions"]] == question_ids
    for position, q in enumerate(body["questions"]):
        assert set(q) == {"id", "position", "question", "options", "answer"}
        assert q["position"] == position
        assert q["options"] == OPTIONS
        assert q["answer"] is None
    raw = response.text
    assert "correct_option_id" not in raw and "explanation" not in raw and "Because" not in raw
    assert "sources" not in raw and "lecture.pdf" not in raw


def test_a_mock_quiz_opens_with_its_questions_and_no_answer_key(client, student, db, project):
    seed(db, student["id"], project, ["text"] * 5)
    job_id = make_quiz(client, student["token"], project, ALL, count=5).json()["job_id"]
    assert wait_for_job(db, job_id) == "completed"
    quiz_id = str(db.execute("SELECT result_ref FROM generation_jobs WHERE id = %s", (job_id,)).fetchone()[0])

    body = get_quiz(client, student["token"], project, quiz_id).json()

    assert body["question_count"] == len(body["questions"]) == 5
    assert all(q["answer"] is None and len(q["options"]) == 4 for q in body["questions"])


# --- Right answer, wrong answer ---


def test_a_right_answer_is_correct_with_explanation_and_source_label(client, student, db, project):
    quiz_id, question_ids, _ = insert_quiz(db, student["id"], project, correct="b")

    response = answer(client, student["token"], project, quiz_id, question_ids[0], "b")

    assert response.status_code == 200, response.text
    assert response.json() == {
        "id": question_ids[0],
        "position": 0,
        "question": "Question 1?",
        "options": OPTIONS,
        "answer": {
            "submitted_option_id": "b",
            "is_correct": True,
            "correct_option_id": "b",
            "explanation": "Because 1.",
            "sources": [{"label": "lecture.pdf · Page 1"}],
        },
    }
    row = db.execute("SELECT account_id, submitted_option_id, is_correct FROM quiz_answers WHERE quiz_question_id = %s",
                     (question_ids[0],)).fetchone()
    assert (str(row[0]), row[1], row[2]) == (student["id"], "b", True)


def test_a_wrong_answer_is_not_correct_and_names_the_correct_option(client, student, db, project):
    quiz_id, question_ids, _ = insert_quiz(db, student["id"], project, correct="b")

    response = answer(client, student["token"], project, quiz_id, question_ids[1], "d")

    assert response.status_code == 200, response.text
    result = response.json()["answer"]
    assert (result["submitted_option_id"], result["is_correct"], result["correct_option_id"]) == ("d", False, "b")
    assert result["explanation"] == "Because 2."
    assert result["sources"] == [{"label": "lecture.pdf · Page 2"}]


def test_an_answered_question_shows_its_answer_on_reopen_and_others_stay_hidden(client, student, db, project):
    quiz_id, question_ids, _ = insert_quiz(db, student["id"], project, n=3, correct="a")
    answer(client, student["token"], project, quiz_id, question_ids[0], "c")

    questions = get_quiz(client, student["token"], project, quiz_id).json()["questions"]

    assert questions[0]["answer"]["submitted_option_id"] == "c"
    assert questions[0]["answer"]["is_correct"] is False
    assert questions[0]["answer"]["correct_option_id"] == "a"
    assert questions[0]["answer"]["explanation"] == "Because 1."
    assert questions[0]["answer"]["sources"] == [{"label": "lecture.pdf · Page 1"}]
    assert questions[1]["answer"] is None and questions[2]["answer"] is None


def test_source_labels_are_deduplicated_and_kept_in_order(client, student, db, project):
    quiz_id, question_ids, material_id = insert_quiz(db, student["id"], project, n=1, sources=[[2, 0, 2]])

    result = answer(client, student["token"], project, quiz_id, question_ids[0], "b").json()["answer"]

    assert result["sources"] == [{"label": "lecture.pdf · Page 3"}, {"label": "lecture.pdf · Page 1"}]


# --- Double submit ---


def test_a_second_submit_returns_the_first_stored_result_and_saves_one_row(client, student, db, project):
    quiz_id, question_ids, _ = insert_quiz(db, student["id"], project, correct="b")

    first = answer(client, student["token"], project, quiz_id, question_ids[0], "a")
    second = answer(client, student["token"], project, quiz_id, question_ids[0], "b")

    assert first.status_code == second.status_code == 200
    assert second.json() == first.json()
    assert second.json()["answer"]["submitted_option_id"] == "a"
    assert second.json()["answer"]["is_correct"] is False
    assert answers_in(db, question_ids) == 1


# --- Foreign ids ---


def test_foreign_or_mismatched_ids_are_not_found_and_save_nothing(client, gotrue, created, student, db, project):
    quiz_id, question_ids, _ = insert_quiz(db, student["id"], project)
    other_quiz, other_questions, _ = insert_quiz(db, student["id"], project)
    second_project = create_project(client, student["token"])
    other = sign_up(gotrue, created)
    other_project = create_project(client, other["access_token"])
    token = student["token"]

    # A question of another Quiz, a Quiz of another Project, a made-up id, and another Account.
    assert_error(answer(client, token, project, quiz_id, other_questions[0], "a"), 404, "not_found")
    assert_error(answer(client, token, second_project, quiz_id, question_ids[0], "a"), 404, "not_found")
    assert_error(answer(client, token, project, quiz_id, str(uuid.uuid4()), "a"), 404, "not_found")
    assert_error(answer(client, token, project, str(uuid.uuid4()), question_ids[0], "a"), 404, "not_found")
    assert_error(answer(client, other["access_token"], project, quiz_id, question_ids[0], "a"), 404, "not_found")
    assert_error(answer(client, other["access_token"], other_project, quiz_id, question_ids[0], "a"), 404,
                 "not_found")
    assert_error(get_quiz(client, other["access_token"], other_project, quiz_id), 404, "not_found")
    assert answers_in(db, question_ids + other_questions) == 0


# --- Bad option ---


@pytest.mark.parametrize("option_id", ["e", "A", "", None, 1])
def test_an_option_outside_a_to_d_is_invalid_and_saves_nothing(client, student, db, project, option_id):
    quiz_id, question_ids, _ = insert_quiz(db, student["id"], project)

    assert_error(answer(client, student["token"], project, quiz_id, question_ids[0], option_id), 422,
                 "invalid_request")
    assert answers_in(db, question_ids) == 0


# --- Read-only ---


@pytest.mark.parametrize("column", ["archived_at", "deleted_at"])
def test_a_read_only_project_refuses_answers(client, student, db, project, column):
    quiz_id, question_ids, _ = insert_quiz(db, student["id"], project)
    db.execute(f"UPDATE projects SET {column} = now() WHERE id = %s", (project,))

    assert_error(answer(client, student["token"], project, quiz_id, question_ids[0], "b"), 409, "project_read_only")
    assert answers_in(db, question_ids) == 0


@pytest.mark.parametrize("column", ["archived_at", "deleted_at"])
def test_a_read_only_projects_quiz_is_still_readable(client, student, db, project, column):
    quiz_id, question_ids, _ = insert_quiz(db, student["id"], project)
    answer(client, student["token"], project, quiz_id, question_ids[0], "b")
    db.execute(f"UPDATE projects SET {column} = now() WHERE id = %s", (project,))

    response = get_quiz(client, student["token"], project, quiz_id)

    assert response.status_code == 200, response.text
    assert response.json()["questions"][0]["answer"]["is_correct"] is True


# --- Removed file ---


def test_a_removed_file_keeps_its_quiz_answerable_and_its_label(client, student, db, project):
    quiz_id, question_ids, material_id = insert_quiz(db, student["id"], project, file_name="biology.pdf")
    db.execute("UPDATE study_materials SET removed_at = now() WHERE id = %s", (material_id,))
    db.execute("UPDATE sections SET text = '' WHERE material_id = %s", (material_id,))

    response = answer(client, student["token"], project, quiz_id, question_ids[0], "b")

    assert response.status_code == 200, response.text
    assert response.json()["answer"]["sources"] == [{"label": "biology.pdf · Page 1"}]


# --- No AI ---


def test_answering_calls_no_model(client, student, db, project, monkeypatch):
    quiz_id, question_ids, _ = insert_quiz(db, student["id"], project)

    def refuse(*_args, **_kwargs):
        raise AssertionError("answering must not call the model")

    for name in ("generate_quiz", "name_project", "detect_topics", "extract_image_text"):
        monkeypatch.setattr(Gateway, name, refuse)

    assert answer(client, student["token"], project, quiz_id, question_ids[0], "b").status_code == 200


def test_the_answers_table_is_closed_to_the_browser_keys(db):
    for role in ("anon", "authenticated"):
        assert not db.execute(
            "SELECT has_table_privilege(%s, 'public.quiz_answers', 'SELECT, INSERT, UPDATE, DELETE')", (role,)
        ).fetchone()[0]
    assert db.execute(
        "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.quiz_answers'::regclass"
    ).fetchone()[0]
