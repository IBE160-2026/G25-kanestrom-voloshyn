"""History (Story 5.1: FR-25, FR-8, AD-27): one read-only list of a Project's chats, Quizzes, Flashcard
sets, and Summaries, newest first, with keyset pagination. Runs in mock mode against local Supabase.

Items are inserted with SQL so their `created_at` can be set exactly; the read is through the API."""

import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest

from tests.test_archive import archive
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
from tests.test_chat import notes, project  # noqa: F401 -- shared fixtures
from tests.test_materials import create_project, student  # noqa: F401 -- shared fixtures

BASE = datetime(2026, 11, 20, 12, 0, tzinfo=UTC)
OPTIONS = json.dumps([{"id": k, "text": k.upper()} for k in "abcd"])


def at(minutes: int) -> datetime:
    return BASE + timedelta(minutes=minutes)


def history(client, token: str, project_id: str, **query):
    return client.get(f"/api/projects/{project_id}/history", params=query, headers=bearer(token))


def ok(response) -> dict:
    assert response.status_code == 200, response.text
    return response.json()


def section_of(db, material_id: str) -> str:
    return str(db.execute("SELECT id FROM sections WHERE material_id = %s LIMIT 1", (material_id,)).fetchone()[0])


def insert_quiz(db, account_id, project_id, created_at, *, labels=(), questions=0, answered=0, correct=0, material=None):
    quiz_id = db.execute(
        """
        INSERT INTO quizzes (account_id, project_id, generation_params, requested_count, created_at)
        VALUES (%s, %s, %s, %s, %s) RETURNING id
        """,
        (account_id, project_id, json.dumps({"count": 5, "topic_labels": list(labels)}), 5, created_at),
    ).fetchone()[0]
    for position in range(questions):
        question_id = db.execute(
            """
            INSERT INTO quiz_questions (quiz_id, position, question, options, correct_option_id, explanation,
                source_section_ids, material_ids)
            VALUES (%s, %s, 'Q', %s, 'a', 'E', %s, %s) RETURNING id
            """,
            (quiz_id, position, OPTIONS, [material["section"]], [material["id"]]),
        ).fetchone()[0]
        if position < answered:
            is_correct = position < correct
            db.execute(
                """
                INSERT INTO quiz_answers (quiz_question_id, account_id, submitted_option_id, is_correct)
                VALUES (%s, %s, %s, %s)
                """,
                (question_id, account_id, "a" if is_correct else "b", is_correct),
            )
    return str(quiz_id)


def insert_set(db, account_id, project_id, created_at, *, labels=(), cards=0, material=None):
    set_id = db.execute(
        """
        INSERT INTO flashcard_sets (account_id, project_id, generation_params, requested_count, created_at)
        VALUES (%s, %s, %s, 5, %s) RETURNING id
        """,
        (account_id, project_id, json.dumps({"count": 5, "topic_labels": list(labels)}), created_at),
    ).fetchone()[0]
    for position in range(cards):
        db.execute(
            """
            INSERT INTO flashcards (set_id, position, question, answer, source_section_ids, material_ids)
            VALUES (%s, %s, 'Q', 'A', %s, %s)
            """,
            (set_id, position, [material["section"]], [material["id"]]),
        )
    return str(set_id)


def insert_summary(db, account_id, project_id, created_at, *, title="Photosynthesis", file_name="notes.md"):
    params = {"file_name": file_name, "topic_labels": [], "section_ids": []}
    return str(
        db.execute(
            """
            INSERT INTO summaries (account_id, project_id, generation_params, title, created_at)
            VALUES (%s, %s, %s, %s, %s) RETURNING id
            """,
            (account_id, project_id, json.dumps(params), title, created_at),
        ).fetchone()[0]
    )


def insert_chat(db, account_id, project_id, created_at, *, questions=("What is ATP?",), scope=None):
    chat_id = db.execute(
        """
        INSERT INTO chats (account_id, project_id, current_scope, created_at, last_opened_at)
        VALUES (%s, %s, %s, %s, %s) RETURNING id
        """,
        (account_id, project_id, json.dumps(scope or {"all_materials": True}), created_at, created_at),
    ).fetchone()[0]
    seq = 0
    for question in questions:
        for role, text in (("user", question), ("assistant", "An answer.")):
            seq += 1
            db.execute(
                "INSERT INTO chat_messages (chat_id, seq, role, scope, text) VALUES (%s, %s, %s, %s, %s)",
                (chat_id, seq, role, json.dumps(scope or {"all_materials": True}), text),
            )
    return str(chat_id)


def last_opened(db, chat_id: str):
    return db.execute("SELECT last_opened_at FROM chats WHERE id = %s", (chat_id,)).fetchone()[0]


@pytest.fixture
def material(db, notes) -> dict:
    return {"id": notes["id"], "section": section_of(db, notes["id"]), "file_name": notes["file_name"]}


# --- The list ---


def test_a_mixed_list_comes_newest_first_with_each_types_fields(client, student, db, project, material):
    me = student["id"]
    chat = insert_chat(db, me, project, at(1), questions=("What is ATP?", "And NADPH?"))
    quiz_a = insert_quiz(db, me, project, at(2), labels=("Light", "Calvin"), questions=4, answered=4, correct=3, material=material)
    cards = insert_set(db, me, project, at(3), cards=6, material=material)
    summary = insert_summary(db, me, project, at(4), title="Plant energy", file_name="notes.md")
    quiz_b = insert_quiz(db, me, project, at(5), questions=2, material=material)
    before = last_opened(db, chat)

    body = ok(history(client, student["token"], project))

    assert body["next_cursor"] is None
    assert [item["id"] for item in body["items"]] == [quiz_b, summary, cards, quiz_a, chat]
    by_id = {item["id"]: item for item in body["items"]}
    assert by_id[quiz_a] | {"created_at": None} == {
        "type": "quiz", "id": quiz_a, "created_at": None, "title": "Light, Calvin",
        "question_count": 4, "answered_count": 4, "correct_count": 3,
    }
    assert by_id[quiz_b]["title"] is None
    assert by_id[cards] | {"created_at": None} == {
        "type": "flashcards", "id": cards, "created_at": None, "title": None, "card_count": 6,
    }
    assert by_id[summary] | {"created_at": None} == {
        "type": "summary", "id": summary, "created_at": None, "title": "Plant energy", "file_name": "notes.md",
    }
    assert by_id[chat] | {"created_at": None} == {
        "type": "chat", "id": chat, "created_at": None, "title": "What is ATP?",
        "message_count": 4, "scope_file_name": None,
    }
    assert datetime.fromisoformat(by_id[chat]["created_at"]) == at(1)
    # History writes nothing: listing doesn't touch a chat's last_opened_at.
    assert last_opened(db, chat) == before


def test_the_filter_returns_one_type_and_refuses_an_unknown_one(client, student, db, project, material):
    me = student["id"]
    insert_chat(db, me, project, at(1))
    quizzes = [insert_quiz(db, me, project, at(n), questions=1, material=material) for n in (2, 3)]
    insert_set(db, me, project, at(4), cards=1, material=material)
    insert_summary(db, me, project, at(5))

    body = ok(history(client, student["token"], project, type="quiz"))
    assert [item["id"] for item in body["items"]] == quizzes[::-1]
    for kind in ("chat", "flashcards", "summary"):
        assert [item["type"] for item in ok(history(client, student["token"], project, type=kind))["items"]] == [kind]

    assert_error(history(client, student["token"], project, type="mistakes"), 422, "invalid_request")


def test_pages_of_thirty_neither_repeat_nor_skip_rows_with_equal_timestamps(client, student, db, project):
    me = student["id"]
    # 65 summaries over 5 distinct timestamps: 13 rows share each `created_at`.
    made = {insert_summary(db, me, project, at(n % 5)) for n in range(65)}

    seen, sizes, cursor = [], [], None
    while True:
        query = {"cursor": cursor} if cursor else {}
        body = ok(history(client, student["token"], project, **query))
        sizes.append(len(body["items"]))
        seen += [item["id"] for item in body["items"]]
        cursor = body["next_cursor"]
        if cursor is None:
            break

    assert sizes == [30, 30, 5]
    assert len(seen) == len(set(seen)) == 65 and set(seen) == made
    rows = db.execute(
        "SELECT id FROM summaries WHERE project_id = %s ORDER BY created_at DESC, id DESC", (project,)
    ).fetchall()
    assert seen == [str(row[0]) for row in rows]


def test_an_unfinished_quiz_carries_its_answered_and_total_counts(client, student, db, project, material):
    insert_quiz(db, student["id"], project, at(1), questions=10, answered=3, correct=2, material=material)

    (item,) = ok(history(client, student["token"], project))["items"]
    assert (item["question_count"], item["answered_count"], item["correct_count"]) == (10, 3, 2)


def test_a_chat_shows_its_ready_scoped_file_and_none_once_the_file_is_removed(client, student, db, project, material):
    chat = insert_chat(db, student["id"], project, at(1), scope={"material_id": material["id"]})

    (item,) = ok(history(client, student["token"], project))["items"]
    assert item["id"] == chat and item["scope_file_name"] == material["file_name"]

    db.execute("UPDATE study_materials SET removed_at = now() WHERE id = %s", (material["id"],))
    (item,) = ok(history(client, student["token"], project))["items"]
    assert item["scope_file_name"] is None


def test_an_empty_chat_is_not_listed(client, student, db, project):
    insert_chat(db, student["id"], project, at(1), questions=())
    listed = insert_chat(db, student["id"], project, at(2))

    assert [item["id"] for item in ok(history(client, student["token"], project))["items"]] == [listed]
    assert [item["id"] for item in ok(history(client, student["token"], project, type="chat"))["items"]] == [listed]


@pytest.mark.parametrize("state", ["archived", "deleted"])
def test_a_read_only_project_still_lists_its_history(client, student, db, project, state):
    summary = insert_summary(db, student["id"], project, at(1))
    if state == "archived":
        assert archive(client, student["token"], project).status_code == 200
    else:
        db.execute("UPDATE projects SET deleted_at = now() WHERE id = %s", (project,))

    assert [item["id"] for item in ok(history(client, student["token"], project))["items"]] == [summary]


def test_another_accounts_or_a_missing_project_is_not_found(client, gotrue, created, student, db, project):
    insert_summary(db, student["id"], project, at(1))
    other = sign_up(gotrue, created)["access_token"]

    assert_error(history(client, other, project), 404, "not_found")
    assert_error(history(client, student["token"], str(uuid.uuid4())), 404, "not_found")


@pytest.mark.parametrize("cursor", ["not-a-cursor!", "e30", "eyJhdCI6ICJ4IiwgImlkIjogInkifQ"])
def test_a_bad_cursor_is_refused(client, student, project, cursor):
    assert_error(history(client, student["token"], project, cursor=cursor), 422, "invalid_request")


def test_history_needs_a_session(client, project):
    response = client.get(f"/api/projects/{project}/history")
    assert response.status_code == 401, response.text
