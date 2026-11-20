"""Projects: create, list, open, rename, scoping, the read-only guard, and prefs (Story 2.1, FR-4, FR-5,
FR-8, AD-14, AD-22).

Needs `npx supabase start` and the two local keys in .env (or the environment).
"""

import uuid

import pytest

from tests.test_auth import (  # noqa: F401 -- shared fixtures
    PASSWORD,
    assert_error,
    bearer,
    client,
    created,
    db,
    gotrue,
    settings,
    sign_up,
)


@pytest.fixture
def student(gotrue, created) -> dict:
    """A signed-up Account: {"token", "id"}."""
    body = sign_up(gotrue, created)
    return {"token": body["access_token"], "id": body["user"]["id"], "email": body["user"]["email"]}


def create(client, token: str) -> dict:
    response = client.post("/api/projects", headers=bearer(token))
    assert response.status_code == 201, response.text
    return response.json()


def rename(client, token: str, project_id: str, name):
    return client.patch(f"/api/projects/{project_id}", headers=bearer(token), json={"name": name})


def last_project_in_db(db, account_id: str):
    row = db.execute("SELECT last_project_id FROM profiles WHERE account_id = %s", (account_id,)).fetchone()
    return None if row[0] is None else str(row[0])


# --- First sign-in, create, list ---


def test_new_account_has_no_projects_and_no_last_project(client, student):
    assert client.get("/api/projects", headers=bearer(student["token"])).json() == []
    me = client.get("/api/me", headers=bearer(student["token"])).json()
    assert me["last_project_id"] is None
    assert me["ui_prefs"] == {}


def test_create_returns_an_unnamed_project(client, student, db):
    project = create(client, student["token"])

    assert set(project) == {"id", "name", "name_source", "archived_at", "deleted_at", "purge_at", "created_at"}
    assert project["purge_at"] is None
    assert project["name"] is None
    assert project["name_source"] is None
    assert project["archived_at"] is None and project["deleted_at"] is None
    owner = db.execute("SELECT account_id FROM projects WHERE id = %s", (project["id"],)).fetchone()[0]
    assert str(owner) == student["id"]


def test_create_ignores_a_body(client, student):
    # Nothing the client sends can name or place the Project.
    response = client.post(
        "/api/projects", headers=bearer(student["token"]), json={"name": "x", "account_id": str(uuid.uuid4())}
    )
    assert response.status_code == 201
    assert response.json()["name"] is None


def test_list_is_newest_first_and_only_the_accounts_own(client, gotrue, created, student):
    first = create(client, student["token"])
    second = create(client, student["token"])
    other = sign_up(gotrue, created)
    create(client, other["access_token"])

    listed = client.get("/api/projects", headers=bearer(student["token"])).json()
    assert [p["id"] for p in listed] == [second["id"], first["id"]]


def test_create_without_token_is_unauthorized(client):
    assert_error(client.post("/api/projects"), 401, "unauthorized")


# --- Open: records the last Project (FR-8) ---


def test_open_records_the_last_project_and_me_returns_it(client, student, db):
    first = create(client, student["token"])
    second = create(client, student["token"])

    response = client.get(f"/api/projects/{first['id']}", headers=bearer(student["token"]))
    assert response.status_code == 200, response.text
    assert response.json() == first
    assert last_project_in_db(db, student["id"]) == first["id"]
    assert client.get("/api/me", headers=bearer(student["token"])).json()["last_project_id"] == first["id"]

    client.get(f"/api/projects/{second['id']}", headers=bearer(student["token"]))
    assert last_project_in_db(db, student["id"]) == second["id"]


def test_after_sign_in_returns_the_last_project(client, gotrue, student):
    project = create(client, student["token"])
    client.get(f"/api/projects/{project['id']}", headers=bearer(student["token"]))

    login = gotrue.post("/token?grant_type=password", json={"email": student["email"], "password": PASSWORD})
    assert login.status_code == 200, login.text
    response = client.post("/api/auth/after-sign-in", headers=bearer(login.json()["access_token"]), json={})
    assert response.status_code == 200, response.text
    assert response.json()["last_project_id"] == project["id"]


@pytest.mark.parametrize("column", ["archived_at", "deleted_at"])
def test_me_hides_a_last_project_that_is_not_active(client, student, db, column):
    project = create(client, student["token"])
    client.get(f"/api/projects/{project['id']}", headers=bearer(student["token"]))
    db.execute(f"UPDATE projects SET {column} = now() WHERE id = %s", (project["id"],))

    assert client.get("/api/me", headers=bearer(student["token"])).json()["last_project_id"] is None


def test_deleting_the_last_project_nulls_last_project_id(client, student, db):
    project = create(client, student["token"])
    client.get(f"/api/projects/{project['id']}", headers=bearer(student["token"]))
    assert last_project_in_db(db, student["id"]) == project["id"]

    db.execute("DELETE FROM projects WHERE id = %s", (project["id"],))

    assert last_project_in_db(db, student["id"]) is None


def test_deleting_the_account_deletes_its_projects(gotrue, created, client, settings, db):
    body = sign_up(gotrue, created)
    project = create(client, body["access_token"])
    secret = settings.supabase_secret_key.get_secret_value()

    response = gotrue.delete(
        f"/admin/users/{body['user']['id']}", headers={"apikey": secret, "Authorization": f"Bearer {secret}"}
    )

    assert response.status_code == 200, response.text
    assert db.execute("SELECT count(*) FROM projects WHERE id = %s", (project["id"],)).fetchone()[0] == 0


# --- Rename (FR-5, AD-14) ---


def test_rename_trims_and_marks_the_student_as_source(client, student):
    project = create(client, student["token"])

    response = rename(client, student["token"], project["id"], "  Biology 101  ")

    assert response.status_code == 200, response.text
    assert response.json()["name"] == "Biology 101"
    assert response.json()["name_source"] == "student"
    listed = client.get("/api/projects", headers=bearer(student["token"])).json()
    assert listed[0]["name"] == "Biology 101"


@pytest.mark.parametrize("blank", ["   ", "", "\t\n"])
def test_rename_blank_is_invalid_name_and_keeps_the_old_name(client, student, blank):
    project = create(client, student["token"])
    rename(client, student["token"], project["id"], "Biology 101")

    assert_error(rename(client, student["token"], project["id"], blank), 422, "invalid_name")

    reopened = client.get(f"/api/projects/{project['id']}", headers=bearer(student["token"])).json()
    assert reopened["name"] == "Biology 101"


def test_rename_long_input_is_cut_to_100_characters(client, student):
    project = create(client, student["token"])
    long_name = "".join(chr(ord("a") + i % 26) for i in range(150))

    response = rename(client, student["token"], project["id"], long_name)

    assert response.status_code == 200, response.text
    assert response.json()["name"] == long_name[:100]


def test_rename_cut_at_a_space_is_trimmed_again(client, student):
    project = create(client, student["token"])
    name = "a" * 99 + " " + "b" * 20  # the 100th character is a space

    response = rename(client, student["token"], project["id"], name)

    assert response.status_code == 200, response.text
    assert response.json()["name"] == "a" * 99


@pytest.mark.parametrize(
    "payload", [{}, {"name": None}, {"name": 5}, {"name": "Biology", "name_source": "auto"}]
)
def test_rename_refuses_a_malformed_body(client, student, payload):
    project = create(client, student["token"])
    response = client.patch(f"/api/projects/{project['id']}", headers=bearer(student["token"]), json=payload)
    assert_error(response, 422, "invalid_request")


@pytest.mark.parametrize("column", ["archived_at", "deleted_at"])
def test_rename_a_read_only_project_is_refused(client, student, db, column):
    project = create(client, student["token"])
    db.execute(f"UPDATE projects SET {column} = now() WHERE id = %s", (project["id"],))

    assert_error(rename(client, student["token"], project["id"], "Biology"), 409, "project_read_only")
    # The guard runs first: even a blank name gets the read-only answer.
    assert_error(rename(client, student["token"], project["id"], "   "), 409, "project_read_only")
    name = db.execute("SELECT name FROM projects WHERE id = %s", (project["id"],)).fetchone()[0]
    assert name is None


def test_open_a_read_only_project_still_works(client, student, db):
    project = create(client, student["token"])
    db.execute("UPDATE projects SET archived_at = now() WHERE id = %s", (project["id"],))

    response = client.get(f"/api/projects/{project['id']}", headers=bearer(student["token"]))

    assert response.status_code == 200
    assert response.json()["archived_at"] is not None


def test_rename_without_token_is_unauthorized(client, student):
    project = create(client, student["token"])
    response = client.patch(f"/api/projects/{project['id']}", json={"name": "Biology"})
    assert_error(response, 401, "unauthorized")


# --- Scoping: another Account's Project id is not_found (AD-2) ---


def test_foreign_project_is_not_found_on_get_and_patch(client, gotrue, created, student, db):
    other = sign_up(gotrue, created)
    foreign = create(client, other["access_token"])
    client.get("/api/me", headers=bearer(student["token"]))  # creates the profile

    assert_error(client.get(f"/api/projects/{foreign['id']}", headers=bearer(student["token"])), 404, "not_found")
    assert_error(rename(client, student["token"], foreign["id"], "Mine now"), 404, "not_found")

    # Nothing changed: not the other Account's Project, nor this Account's last Project.
    row = db.execute("SELECT name FROM projects WHERE id = %s", (foreign["id"],)).fetchone()
    assert row == (None,)
    assert last_project_in_db(db, student["id"]) is None


def test_unknown_project_id_is_not_found(client, student):
    missing = str(uuid.uuid4())
    assert_error(client.get(f"/api/projects/{missing}", headers=bearer(student["token"])), 404, "not_found")
    assert_error(rename(client, student["token"], missing, "Biology"), 404, "not_found")


def test_malformed_project_id_is_invalid_request(client, student):
    assert_error(client.get("/api/projects/not-a-uuid", headers=bearer(student["token"])), 422, "invalid_request")
    assert_error(rename(client, student["token"], "not-a-uuid", "Biology"), 422, "invalid_request")


# --- PATCH /api/me/prefs ---


def test_prefs_save_the_sidebar_collapse(client, student, db):
    response = client.patch("/api/me/prefs", headers=bearer(student["token"]), json={"sidebar_collapsed": True})

    assert response.status_code == 200, response.text
    assert response.json()["ui_prefs"] == {"sidebar_collapsed": True}
    assert client.get("/api/me", headers=bearer(student["token"])).json()["ui_prefs"] == {"sidebar_collapsed": True}

    client.patch("/api/me/prefs", headers=bearer(student["token"]), json={"sidebar_collapsed": False})
    assert client.get("/api/me", headers=bearer(student["token"])).json()["ui_prefs"] == {"sidebar_collapsed": False}


def test_prefs_merge_keeps_other_keys(client, student, db):
    client.get("/api/me", headers=bearer(student["token"]))  # creates the profile
    db.execute(
        """UPDATE profiles SET ui_prefs = '{"files_collapsed": {"p1": true}}'::jsonb WHERE account_id = %s""",
        (student["id"],),
    )

    response = client.patch("/api/me/prefs", headers=bearer(student["token"]), json={"sidebar_collapsed": True})

    assert response.json()["ui_prefs"] == {"files_collapsed": {"p1": True}, "sidebar_collapsed": True}


def test_prefs_files_collapsed_merge_per_project(client, student, db):
    # Story 2.2b: one Project's Files panel choice keeps the others and the Sidebar's.
    a, b = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
    headers = bearer(student["token"])
    client.patch("/api/me/prefs", headers=headers, json={"sidebar_collapsed": True})
    client.patch("/api/me/prefs", headers=headers, json={"files_collapsed": {a: True}})

    response = client.patch("/api/me/prefs", headers=headers, json={"files_collapsed": {b: False}})

    assert response.status_code == 200, response.text
    expected = {"sidebar_collapsed": True, "files_collapsed": {a: True, b: False}}
    assert response.json()["ui_prefs"] == expected
    client.patch("/api/me/prefs", headers=headers, json={"files_collapsed": {a: False}})
    assert client.get("/api/me", headers=headers).json()["ui_prefs"]["files_collapsed"] == {a: False, b: False}


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"sidebar_collapsed": None},
        {"sidebar_collapsed": True, "theme": "x"},
        {"theme": "pink"},
        {"theme": None, "accent": None},
        {"accent": "green"},
        {"accent": 1},
        {"theme": "Light"},
        {"files_collapsed": {}},
        {"files_collapsed": {"not-a-uuid": True}},
        {"files_collapsed": {"11111111-1111-1111-1111-111111111111": "yes"}},
        {"sidebar_collapsed": "yes"},
        {"files_collapsed": {f"{i:08d}-1111-1111-1111-111111111111": True for i in range(21)}},
    ],
)
def test_prefs_refuse_a_malformed_body(client, student, payload):
    response = client.patch("/api/me/prefs", headers=bearer(student["token"]), json=payload)
    assert_error(response, 422, "invalid_request")


def test_prefs_save_the_theme_and_accent(client, student):
    headers = bearer(student["token"])
    client.patch("/api/me/prefs", headers=headers, json={"sidebar_collapsed": True})

    response = client.patch("/api/me/prefs", headers=headers, json={"theme": "light", "accent": "violet"})
    assert response.status_code == 200, response.text
    assert response.json()["ui_prefs"] == {"sidebar_collapsed": True, "theme": "light", "accent": "violet"}

    response = client.patch("/api/me/prefs", headers=headers, json={"theme": "system"})
    assert response.json()["ui_prefs"] == {"sidebar_collapsed": True, "theme": "system", "accent": "violet"}
    assert client.get("/api/me", headers=headers).json()["ui_prefs"]["theme"] == "system"


def test_prefs_without_token_is_unauthorized(client):
    assert_error(client.patch("/api/me/prefs", json={"sidebar_collapsed": True}), 401, "unauthorized")

def test_prefs_both_keys_in_one_request(client, student):
    a = "11111111-1111-1111-1111-111111111111"
    response = client.patch(
        "/api/me/prefs",
        headers=bearer(student["token"]),
        json={"sidebar_collapsed": None, "files_collapsed": {a: True}},
    )
    assert response.status_code == 200, response.text
    assert response.json()["ui_prefs"] == {"files_collapsed": {a: True}}

    response = client.patch(
        "/api/me/prefs", headers=bearer(student["token"]), json={"sidebar_collapsed": True, "files_collapsed": {a: False}}
    )
    assert response.json()["ui_prefs"] == {"sidebar_collapsed": True, "files_collapsed": {a: False}}
