"""PATCH /api/me, logout ending the session, and the pinned session lookup (Story 1.4, FR-2, FR-29, AD-2).

Needs `npx supabase start` and the two local keys in .env (or the environment).
"""

import httpx2
import pytest

from tests.test_auth import (  # noqa: F401 -- shared fixtures
    PASSWORD,
    assert_error,
    bearer,
    client,
    created,
    db,
    fake_token,
    gotrue,
    session_id_of,
    settings,
    sign_up,
    stub_auth,
)


def signed_up_with_profile(client, gotrue, created, language: str = "en") -> dict:
    body = sign_up(gotrue, created)
    response = client.post(
        "/api/auth/after-sign-in", headers=bearer(body["access_token"]), json={"first_name": "Emma", "language": language}
    )
    assert response.status_code == 200, response.text
    return body


# --- PATCH /api/me (language follows the Account) ---


def test_patch_me_saves_language_and_returns_profile(client, gotrue, db, created):
    body = signed_up_with_profile(client, gotrue, created, "en")
    token = body["access_token"]

    response = client.patch("/api/me", headers=bearer(token), json={"language": "nb"})

    assert response.status_code == 200, response.text
    assert response.json() == {"first_name": "Emma", "language": "nb", "email_verified": False}
    row = db.execute("SELECT language FROM profiles WHERE account_id = %s", (body["user"]["id"],)).fetchone()
    assert row == ("nb",)
    assert client.get("/api/me", headers=bearer(token)).json()["language"] == "nb"


def test_after_sign_in_elsewhere_returns_the_saved_language(client, gotrue, created):
    # Another browser: its local choice is English, but the Account's language is Norwegian.
    body = signed_up_with_profile(client, gotrue, created, "en")
    patched = client.patch("/api/me", headers=bearer(body["access_token"]), json={"language": "nb"})
    assert patched.status_code == 200, patched.text

    login = gotrue.post("/token?grant_type=password", json={"email": body["user"]["email"], "password": PASSWORD})
    assert login.status_code == 200, login.text
    response = client.post("/api/auth/after-sign-in", headers=bearer(login.json()["access_token"]), json={"language": "en"})

    assert response.status_code == 200, response.text
    assert response.json()["language"] == "nb"


@pytest.mark.parametrize(
    "payload",
    [
        {"language": "de"},
        {"language": None},
        {},
        {"language": "nb", "first_name": "Other"},
        {"language": "nb", "last_project_id": None},
    ],
)
def test_patch_me_refuses_anything_but_a_language(client, gotrue, db, created, payload):
    body = signed_up_with_profile(client, gotrue, created, "en")

    response = client.patch("/api/me", headers=bearer(body["access_token"]), json=payload)

    assert_error(response, 422, "invalid_request")
    row = db.execute("SELECT first_name, language FROM profiles WHERE account_id = %s", (body["user"]["id"],))
    assert row.fetchone() == ("Emma", "en")


def test_patch_me_without_token_is_unauthorized(client):
    assert_error(client.patch("/api/me", json={"language": "nb"}), 401, "unauthorized")


# --- Log out ends the session (FR-2) ---


def test_logout_ends_the_session_and_the_old_token_is_refused(client, gotrue, db, created):
    body = sign_up(gotrue, created)
    token, account_id = body["access_token"], body["user"]["id"]
    session_id = session_id_of(db, account_id)
    assert client.get("/api/me", headers=bearer(token)).status_code == 200

    # What supabase-js signOut({scope: 'local'}) sends.
    response = gotrue.post("/logout?scope=local", headers=bearer(token))
    assert response.status_code == 204, response.text

    assert db.execute("SELECT count(*) FROM auth.sessions WHERE id = %s", (session_id,)).fetchone()[0] == 0
    assert_error(client.get("/api/me", headers=bearer(token)), 401, "unauthorized")


def test_logout_leaves_other_sessions_of_the_account_working(client, gotrue, created):
    body = sign_up(gotrue, created)
    other = gotrue.post("/token?grant_type=password", json={"email": body["user"]["email"], "password": PASSWORD})
    assert other.status_code == 200, other.text

    logout = gotrue.post("/logout?scope=local", headers=bearer(body["access_token"]))
    assert logout.status_code == 204, logout.text

    assert_error(client.get("/api/me", headers=bearer(body["access_token"])), 401, "unauthorized")
    assert client.get("/api/me", headers=bearer(other.json()["access_token"])).status_code == 200


# --- The session lookup is pinned to the Account (deferred from Story 1.3, #19) ---


def test_session_of_another_account_is_unauthorized(client, gotrue, db, created, stub_auth):
    account_a = sign_up(gotrue, created)["user"]["id"]
    account_b = sign_up(gotrue, created)["user"]["id"]
    session_of_b = session_id_of(db, account_b)
    # Supabase Auth (stubbed) reports Account A, but the token names B's live session.
    stub_auth(lambda request: httpx2.Response(200, json={"id": account_a}))

    assert_error(client.get("/api/me", headers=bearer(fake_token(session_of_b))), 401, "unauthorized")
    # A's own session passes with the same stub.
    assert client.get("/api/me", headers=bearer(fake_token(session_id_of(db, account_a)))).status_code == 200
