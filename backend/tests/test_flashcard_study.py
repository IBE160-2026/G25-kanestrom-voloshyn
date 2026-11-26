"""Studying a flashcard set: cards with Source labels, insert-only marks, the server-owned queue, and the
end rules (Story 4.2, FR-14, AD-8, AD-10, AD-22, AD-27). Sets are inserted straight into the database so
each test controls the cards; the 30-minute end uses a backdated `created_at`. Needs local Supabase, like
test_quiz_answers.py.
"""

import json
import uuid

import pytest

from app.llm import Gateway
from app.services import flashcards
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
)
from tests.test_scope import seed


def insert_set(db, account_id: str, project_id: str, n: int = 3, requested: int | None = None,
               file_name: str = "lecture.pdf") -> tuple[str, list[str]]:
    """A set of `n` cards, card i reading "Question {i+1}?" / "Answer {i+1}." and citing Page i+1 of one
    seeded file. Returns (set_id, [card_id, ...])."""
    material_id, section_ids, _ = seed(db, account_id, project_id, ["text"] * n)
    db.execute("UPDATE study_materials SET file_name = %s WHERE id = %s", (file_name, material_id))
    set_id = str(
        db.execute(
            """
            INSERT INTO flashcard_sets (account_id, project_id, generation_params, requested_count)
            VALUES (%s, %s, %s, %s) RETURNING id
            """,
            (account_id, project_id, json.dumps({"count": requested or n}), requested or n),
        ).fetchone()[0]
    )
    card_ids = [
        str(
            db.execute(
                """
                INSERT INTO flashcards (set_id, position, question, answer, source_section_ids, material_ids)
                VALUES (%s, %s, %s, %s, %s::uuid[], %s::uuid[]) RETURNING id
                """,
                (set_id, position, f"Question {position + 1}?", f"Answer {position + 1}.", [section_ids[position]],
                 [material_id]),
            ).fetchone()[0]
        )
        for position in range(n)
    ]
    return set_id, card_ids


def get_set(client, token: str, project_id: str, set_id: str):
    return client.get(f"/api/projects/{project_id}/flashcard-sets/{set_id}", headers=bearer(token))


def mark(client, token: str, project_id: str, set_id: str, card_id: str, value):
    return client.post(
        f"/api/projects/{project_id}/flashcard-sets/{set_id}/cards/{card_id}/mark",
        json={"mark": value},
        headers=bearer(token),
    )


def marks_of(db, set_id: str) -> list[tuple[str, str]]:
    return [(str(card), value) for card, value in db.execute(
        "SELECT card_id, mark FROM flashcard_marks WHERE set_id = %s ORDER BY id", (set_id,)
    ).fetchall()]


def ended_at(db, set_id: str):
    return db.execute("SELECT ended_at FROM flashcard_sets WHERE id = %s", (set_id,)).fetchone()[0]


def backdate_marks(db, set_id: str, minutes: int) -> None:
    db.execute(
        "UPDATE flashcard_marks SET created_at = created_at - make_interval(mins => %s) WHERE set_id = %s",
        (minutes, set_id),
    )


@pytest.fixture
def project(client, student) -> str:
    return create_project(client, student["token"])


# --- Open a fresh set ---


def test_a_fresh_set_serves_its_cards_with_source_labels_and_the_full_queue(client, student, db, project):
    set_id, card_ids = insert_set(db, student["id"], project, n=3, requested=5)

    response = get_set(client, student["token"], project, set_id)

    assert response.status_code == 200, response.text
    assert response.json() == {
        "id": set_id,
        "requested_count": 5,
        "card_count": 3,
        "ended_at": None,
        "source_removed": False,
        "cards": [
            {
                "id": card_ids[i],
                "position": i,
                "question": f"Question {i + 1}?",
                "answer": f"Answer {i + 1}.",
                "sources": [{"label": f"lecture.pdf · Page {i + 1}"}],
            }
            for i in range(3)
        ],
        "queue": card_ids,
        "done_count": 0,
        "second_try_count": 0,
    }
    assert ended_at(db, set_id) is None


# --- Not yet, Got it, repeat Got it ---


def test_not_yet_saves_a_row_and_moves_the_card_to_the_end_of_the_queue(client, student, db, project):
    set_id, card_ids = insert_set(db, student["id"], project, n=3)

    response = mark(client, student["token"], project, set_id, card_ids[0], "not_yet")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["queue"] == [card_ids[1], card_ids[2], card_ids[0]]
    assert (body["done_count"], body["second_try_count"], body["ended_at"]) == (0, 1, None)
    assert marks_of(db, set_id) == [(card_ids[0], "not_yet")]


def test_got_it_takes_the_card_out_of_the_queue_and_counts_it_done(client, student, db, project):
    set_id, card_ids = insert_set(db, student["id"], project, n=3)

    body = mark(client, student["token"], project, set_id, card_ids[0], "got_it").json()

    assert body["queue"] == card_ids[1:]
    assert (body["done_count"], body["second_try_count"], body["ended_at"]) == (1, 0, None)
    assert marks_of(db, set_id) == [(card_ids[0], "got_it")]


@pytest.mark.parametrize("again", ["got_it", "not_yet"])
def test_a_mark_on_a_card_already_got_saves_nothing_and_returns_the_state(client, student, db, project, again):
    set_id, card_ids = insert_set(db, student["id"], project, n=3)
    first = mark(client, student["token"], project, set_id, card_ids[0], "got_it").json()

    second = mark(client, student["token"], project, set_id, card_ids[0], again)

    assert second.status_code == 200, second.text
    assert second.json() == first
    assert marks_of(db, set_id) == [(card_ids[0], "got_it")]


def test_a_second_got_it_row_is_refused_by_the_database(student, db, project):
    set_id, card_ids = insert_set(db, student["id"], project, n=1)
    db.execute("INSERT INTO flashcard_marks (set_id, card_id, mark) VALUES (%s, %s, 'got_it')", (set_id, card_ids[0]))

    with pytest.raises(Exception, match="flashcard_marks_got_it_once"):
        db.execute("INSERT INTO flashcard_marks (set_id, card_id, mark) VALUES (%s, %s, 'got_it')", (set_id, card_ids[0]))


def test_a_reload_resumes_the_same_state(client, student, db, project):
    set_id, card_ids = insert_set(db, student["id"], project, n=4)
    mark(client, student["token"], project, set_id, card_ids[0], "not_yet")
    mark(client, student["token"], project, set_id, card_ids[1], "got_it")
    after_marks = mark(client, student["token"], project, set_id, card_ids[2], "not_yet").json()

    reloaded = get_set(client, student["token"], project, set_id).json()

    assert reloaded == after_marks
    assert reloaded["queue"] == [card_ids[3], card_ids[0], card_ids[2]]
    assert (reloaded["done_count"], reloaded["second_try_count"]) == (1, 2)


# --- Last card known ---


def test_the_final_got_it_ends_the_set_with_an_empty_queue(client, student, db, project):
    set_id, card_ids = insert_set(db, student["id"], project, n=2)
    token = student["token"]
    mark(client, token, project, set_id, card_ids[0], "not_yet")
    mark(client, token, project, set_id, card_ids[1], "got_it")
    assert ended_at(db, set_id) is None

    body = mark(client, token, project, set_id, card_ids[0], "got_it").json()

    assert body["queue"] == []
    assert body["ended_at"] is not None
    assert (body["done_count"], body["second_try_count"]) == (2, 1)
    assert ended_at(db, set_id) is not None
    assert_error(mark(client, token, project, set_id, card_ids[0], "not_yet"), 409, "flashcard_set_ended")


# --- Idle 30 minutes ---


def test_a_read_after_30_idle_minutes_ends_the_set(client, student, db, project):
    set_id, card_ids = insert_set(db, student["id"], project, n=3)
    mark(client, student["token"], project, set_id, card_ids[0], "got_it")
    backdate_marks(db, set_id, 31)

    body = get_set(client, student["token"], project, set_id).json()

    assert body["ended_at"] is not None
    assert ended_at(db, set_id) is not None
    assert (body["done_count"], body["second_try_count"]) == (1, 0)
    assert_error(mark(client, student["token"], project, set_id, card_ids[1], "got_it"), 409, "flashcard_set_ended")
    assert len(marks_of(db, set_id)) == 1


def test_a_mark_after_30_idle_minutes_ends_the_set_and_is_refused(client, student, db, project):
    set_id, card_ids = insert_set(db, student["id"], project, n=3)
    mark(client, student["token"], project, set_id, card_ids[0], "got_it")
    backdate_marks(db, set_id, 31)

    assert_error(mark(client, student["token"], project, set_id, card_ids[1], "got_it"), 409, "flashcard_set_ended")

    # The end found by the refused mark is saved; the mark is not.
    assert ended_at(db, set_id) is not None
    assert marks_of(db, set_id) == [(card_ids[0], "got_it")]


def test_29_idle_minutes_keep_the_set_open(client, student, db, project):
    set_id, card_ids = insert_set(db, student["id"], project, n=3)
    mark(client, student["token"], project, set_id, card_ids[0], "got_it")
    backdate_marks(db, set_id, 29)

    assert get_set(client, student["token"], project, set_id).json()["ended_at"] is None
    assert mark(client, student["token"], project, set_id, card_ids[1], "got_it").status_code == 200
    assert ended_at(db, set_id) is None


def test_a_set_with_no_marks_is_never_ended(client, student, db, project):
    set_id, _ = insert_set(db, student["id"], project, n=2)
    db.execute("UPDATE flashcard_sets SET created_at = created_at - interval '2 days' WHERE id = %s", (set_id,))
    other_id, _ = insert_set(db, student["id"], project, n=2)

    assert get_set(client, student["token"], project, set_id).json()["ended_at"] is None
    get_set(client, student["token"], project, other_id)

    assert ended_at(db, set_id) is None


# --- Open another set ---


def test_opening_another_set_ends_an_open_set_with_marks(client, student, db, project):
    x_id, x_cards = insert_set(db, student["id"], project, n=3)
    y_id, _ = insert_set(db, student["id"], project, n=3)
    mark(client, student["token"], project, x_id, x_cards[0], "got_it")

    body = get_set(client, student["token"], project, y_id).json()

    assert ended_at(db, x_id) is not None
    assert body["ended_at"] is None and ended_at(db, y_id) is None


def test_opening_a_set_ends_a_marked_set_in_another_project(client, student, db, project):
    second_project = create_project(client, student["token"])
    z_id, z_cards = insert_set(db, student["id"], second_project, n=2)
    mark(client, student["token"], second_project, z_id, z_cards[0], "not_yet")
    y_id, _ = insert_set(db, student["id"], project, n=2)

    get_set(client, student["token"], project, y_id)

    assert ended_at(db, z_id) is not None


def test_a_read_of_an_ended_set_keeps_its_ended_at(client, student, db, project):
    set_id, card_ids = insert_set(db, student["id"], project, n=2)
    mark(client, student["token"], project, set_id, card_ids[0], "got_it")
    backdate_marks(db, set_id, 31)
    get_set(client, student["token"], project, set_id)
    first = ended_at(db, set_id)
    assert first is not None

    other_id, _ = insert_set(db, student["id"], project, n=2)
    get_set(client, student["token"], project, other_id)
    get_set(client, student["token"], project, set_id)

    assert ended_at(db, set_id) == first


def test_opening_a_set_does_not_end_another_accounts_set(client, gotrue, created, student, db, project):
    x_id, x_cards = insert_set(db, student["id"], project, n=2)
    mark(client, student["token"], project, x_id, x_cards[0], "got_it")
    other = sign_up(gotrue, created)
    other_project = create_project(client, other["access_token"])
    y_id, _ = insert_set(db, other["user"]["id"], other_project, n=2)

    get_set(client, other["access_token"], other_project, y_id)

    assert ended_at(db, x_id) is None


# --- Ended set opened ---


def test_an_ended_set_opens_with_what_was_done(client, student, db, project):
    set_id, card_ids = insert_set(db, student["id"], project, n=4)
    token = student["token"]
    mark(client, token, project, set_id, card_ids[0], "got_it")
    mark(client, token, project, set_id, card_ids[1], "not_yet")
    mark(client, token, project, set_id, card_ids[1], "got_it")
    mark(client, token, project, set_id, card_ids[2], "not_yet")
    other_id, _ = insert_set(db, student["id"], project, n=2)
    get_set(client, token, project, other_id)  # ends the first set

    body = get_set(client, token, project, set_id).json()

    assert body["ended_at"] is not None
    assert (body["done_count"], body["second_try_count"]) == (2, 2)
    assert_error(mark(client, token, project, set_id, card_ids[3], "got_it"), 409, "flashcard_set_ended")


# --- Read-only Project ---


@pytest.mark.parametrize("column", ["archived_at", "deleted_at"])
def test_a_read_only_project_refuses_marks_and_still_opens_the_set(client, student, db, project, column):
    set_id, card_ids = insert_set(db, student["id"], project, n=2)
    db.execute(f"UPDATE projects SET {column} = now() WHERE id = %s", (project,))

    assert_error(mark(client, student["token"], project, set_id, card_ids[0], "got_it"), 409, "project_read_only")
    assert marks_of(db, set_id) == []
    response = get_set(client, student["token"], project, set_id)
    assert response.status_code == 200, response.text
    assert len(response.json()["cards"]) == 2


# --- Foreign or missing ---


def test_foreign_or_mismatched_ids_are_not_found_and_save_nothing(client, gotrue, created, student, db, project):
    set_id, card_ids = insert_set(db, student["id"], project, n=2)
    other_set, other_cards = insert_set(db, student["id"], project, n=2)
    second_project = create_project(client, student["token"])
    other = sign_up(gotrue, created)
    other_project = create_project(client, other["access_token"])
    token = student["token"]

    # A card of another set, a set of another Project, made-up ids, and another Account.
    assert_error(mark(client, token, project, set_id, other_cards[0], "got_it"), 404, "not_found")
    assert_error(mark(client, token, second_project, set_id, card_ids[0], "got_it"), 404, "not_found")
    assert_error(mark(client, token, project, set_id, str(uuid.uuid4()), "got_it"), 404, "not_found")
    assert_error(mark(client, token, project, str(uuid.uuid4()), card_ids[0], "got_it"), 404, "not_found")
    assert_error(mark(client, other["access_token"], project, set_id, card_ids[0], "got_it"), 404, "not_found")
    assert_error(mark(client, other["access_token"], other_project, set_id, card_ids[0], "got_it"), 404, "not_found")
    assert_error(get_set(client, other["access_token"], other_project, set_id), 404, "not_found")
    assert marks_of(db, set_id) == marks_of(db, other_set) == []


@pytest.mark.parametrize("value", ["know", "GOT_IT", "", None, 1])
def test_a_mark_outside_got_it_or_not_yet_is_invalid(client, student, db, project, value):
    set_id, card_ids = insert_set(db, student["id"], project, n=1)

    assert_error(mark(client, student["token"], project, set_id, card_ids[0], value), 422, "invalid_request")
    assert marks_of(db, set_id) == []


# --- No Mistakes, no model ---


def test_marks_never_create_mistakes_and_call_no_model(client, student, db, project, monkeypatch):
    set_id, card_ids = insert_set(db, student["id"], project, n=2)

    def refuse(*_args, **_kwargs):
        raise AssertionError("studying must not call the model")

    for name in ("generate_flashcards", "generate_quiz", "name_project", "detect_topics", "extract_image_text"):
        monkeypatch.setattr(Gateway, name, refuse)

    token = student["token"]
    for card_id, value in [(card_ids[0], "not_yet"), (card_ids[1], "got_it"), (card_ids[0], "not_yet"),
                           (card_ids[0], "got_it")]:
        assert mark(client, token, project, set_id, card_id, value).status_code == 200
    assert db.execute("SELECT count(*) FROM mistakes WHERE project_id = %s", (project,)).fetchone()[0] == 0


def test_the_marks_table_is_closed_to_the_browser_keys(db):
    for role in ("anon", "authenticated"):
        assert not db.execute(
            "SELECT has_table_privilege(%s, 'public.flashcard_marks', 'SELECT, INSERT, UPDATE, DELETE')", (role,)
        ).fetchone()[0]
    assert db.execute(
        "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.flashcard_marks'::regclass"
    ).fetchone()[0]


# --- session() (pure) ---


def card_rows(n: int) -> list[dict]:
    return [{"id": f"c{i}", "position": i} for i in range(n)]


def marks_list(*pairs) -> list[dict]:
    return [{"card_id": card, "mark": value} for card, value in pairs]


def test_session_with_no_marks_queues_every_card_by_position():
    rows = list(reversed(card_rows(3)))

    state = flashcards.session(rows, [])

    assert (state.queue, state.done, state.second_try) == (["c0", "c1", "c2"], set(), set())


def test_session_puts_unmarked_cards_first_then_not_yet_cards_by_latest_not_yet_oldest_first():
    state = flashcards.session(
        card_rows(5),
        marks_list(("c0", "not_yet"), ("c1", "not_yet"), ("c2", "got_it"), ("c0", "not_yet")),
    )

    # c3, c4 unmarked; then c1 (its "Not yet" is older than c0's latest one).
    assert state.queue == ["c3", "c4", "c1", "c0"]
    assert state.done == {"c2"}
    assert state.second_try == {"c0", "c1"}


def test_session_a_not_yet_card_later_got_counts_done_and_second_try():
    state = flashcards.session(card_rows(2), marks_list(("c0", "not_yet"), ("c1", "got_it"), ("c0", "got_it")))

    assert state.queue == []
    assert state.done == {"c0", "c1"}
    assert state.second_try == {"c0"}
