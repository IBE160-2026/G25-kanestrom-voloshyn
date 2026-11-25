"""Several chats in a Project (Story 4.5, FR-16, AD-25): "New chat", the chat last opened, and per-chat
order. Runs in mock mode against local Supabase, like test_chat.py."""

import uuid

from app.services import chat as chat_service

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
from tests.test_chat import (  # noqa: F401 -- shared fixtures
    COVERED,
    ask,
    chat_of,
    notes,
    project,
    set_scope,
    stored,
)
from tests.test_materials import student  # noqa: F401 -- shared fixture


def new_chat(client, token: str, project_id: str):
    return client.post(f"/api/projects/{project_id}/chats", headers=bearer(token))


def open_by_id(client, token: str, chat_id: str):
    return client.get(f"/api/chats/{chat_id}", headers=bearer(token))


def chat_count(db, project_id: str) -> int:
    return db.execute("SELECT count(*) FROM chats WHERE project_id = %s", (project_id,)).fetchone()[0]


def test_new_chat_opens_an_empty_chat_on_all_materials_and_keeps_the_old_one(client, student, db, project, notes):
    token = student["token"]
    old = chat_of(client, token, project)
    ask(client, token, old["id"], COVERED)
    assert set_scope(client, token, old["id"], {"material_id": notes["id"]}).status_code == 200
    before = stored(db, old["id"])

    response = new_chat(client, token, project)
    assert response.status_code == 201, response.text
    fresh = response.json()
    assert fresh["id"] != old["id"]
    assert fresh["messages"] == [] and fresh["current_scope"] == {"all_materials": True}

    # The previous chat is unchanged: its messages, their order, and its scope.
    assert stored(db, old["id"]) == before
    reopened = open_by_id(client, token, old["id"]).json()
    assert [m["role"] for m in reopened["messages"]] == ["user", "assistant"]
    assert reopened["current_scope"] == {"material_id": notes["id"]}


def test_the_project_opens_the_chat_last_opened(client, student, db, project, notes):
    token = student["token"]
    first = chat_of(client, token, project)
    ask(client, token, first["id"], COVERED)
    second = new_chat(client, token, project).json()
    assert chat_of(client, token, project)["id"] == second["id"]

    # Opening the earlier chat makes it the one the Project returns to, and it can be continued.
    assert open_by_id(client, token, first["id"]).status_code == 200
    assert chat_of(client, token, project)["id"] == first["id"]
    found = ask(client, token, first["id"], COVERED)
    assert found[-1][0] == "done"
    assert [row[0] for row in stored(db, first["id"])] == [1, 2, 3, 4]


def test_new_chat_on_an_empty_chat_reuses_it_reset_to_all_materials(client, student, db, project, notes):
    token = student["token"]
    empty = chat_of(client, token, project)
    assert set_scope(client, token, empty["id"], {"material_id": notes["id"]}).status_code == 200

    again = new_chat(client, token, project).json()
    assert again["id"] == empty["id"] and again["current_scope"] == {"all_materials": True}
    assert chat_count(db, project) == 1


def test_each_chat_keeps_its_own_strict_order(client, student, db, project, notes):
    token = student["token"]
    a = chat_of(client, token, project)["id"]
    ask(client, token, a, COVERED)
    b = new_chat(client, token, project).json()["id"]
    ask(client, token, b, COVERED)
    ask(client, token, a, COVERED)

    assert [(row[0], row[1]) for row in stored(db, a)] == [(1, "user"), (2, "assistant"), (3, "user"), (4, "assistant")]
    assert [(row[0], row[1]) for row in stored(db, b)] == [(1, "user"), (2, "assistant")]


def test_an_empty_chat_with_an_answer_streaming_is_not_reused(client, student, db, project, notes, monkeypatch):
    token = student["token"]
    busy = chat_of(client, token, project)["id"]
    monkeypatch.setattr(chat_service, "is_busy", lambda chat_id: str(chat_id) == busy)

    fresh = new_chat(client, token, project).json()
    assert fresh["id"] != busy and chat_count(db, project) == 2


def test_a_deleted_project_refuses_a_new_chat(client, student, db, project):
    chat_of(client, student["token"], project)
    db.execute("UPDATE projects SET deleted_at = now() WHERE id = %s", (project,))
    assert_error(new_chat(client, student["token"], project), 409, "project_read_only")
    assert chat_count(db, project) == 1


def test_opening_an_earlier_chat_whose_file_is_gone_falls_back_to_all_materials(client, student, db, project, notes):
    token = student["token"]
    first = chat_of(client, token, project)
    ask(client, token, first["id"], COVERED)
    assert set_scope(client, token, first["id"], {"material_id": notes["id"]}).status_code == 200
    new_chat(client, token, project)
    db.execute("UPDATE study_materials SET removed_at = now() WHERE id = %s", (notes["id"],))

    assert open_by_id(client, token, first["id"]).json()["current_scope"] == {"all_materials": True}


def test_a_read_only_project_refuses_a_new_chat_but_its_chats_still_open(client, student, db, project, notes):
    token = student["token"]
    chat_id = chat_of(client, token, project)["id"]
    ask(client, token, chat_id, COVERED)
    assert archive(client, token, project).status_code == 200

    assert_error(new_chat(client, token, project), 409, "project_read_only")
    assert open_by_id(client, token, chat_id).status_code == 200
    assert chat_count(db, project) == 1


def test_another_accounts_chat_or_project_is_not_found(client, gotrue, created, student, db, project):
    chat_id = chat_of(client, student["token"], project)["id"]
    other = sign_up(gotrue, created)["access_token"]

    assert_error(new_chat(client, other, project), 404, "not_found")
    assert_error(open_by_id(client, other, chat_id), 404, "not_found")
    assert_error(open_by_id(client, student["token"], str(uuid.uuid4())), 404, "not_found")
    assert chat_count(db, project) == 1
