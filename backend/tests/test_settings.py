"""Settings on the backend (Story 7.3a, FR-27): the /api/me email and sign-in methods, the first-name
edit, and the current-password check behind Change password.

No real Google: a seeded `auth.identities` row makes an Account "have" a Google identity (as in
test_google). Needs `npx supabase start`.
"""

import logging
import uuid

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
from tests.test_google import make_google_only, password_login, seed_google, session_ids

NEW_PASSWORD = "brand-new-pass-9"


def email_account(client, gotrue, created, first_name: str = "Emma") -> dict:
    body = sign_up(gotrue, created)
    response = client.post(
        "/api/auth/after-sign-in", headers=bearer(body["access_token"]), json={"first_name": first_name, "language": "en"}
    )
    assert response.status_code == 200, response.text
    return body


def google_linked_account(client, gotrue, db, created) -> dict:
    """A verified email Account that has also linked Google (no takeover), as the session that has both."""
    body = email_account(client, gotrue, created)
    db.execute("UPDATE profiles SET email_verified_at = now() WHERE account_id = %s", (body["user"]["id"],))
    seed_google(db, body["user"]["id"])
    return body


def first_name_of(db, account_id: str):
    return db.execute("SELECT first_name FROM profiles WHERE account_id = %s", (account_id,)).fetchone()[0]


# --- GET /api/me: email and sign-in methods ---


def test_me_has_the_email_and_signs_in_with_email(client, gotrue, created):
    body = email_account(client, gotrue, created)

    me = client.get("/api/me", headers=bearer(body["access_token"])).json()

    assert me["email"] == body["user"]["email"]
    assert me["sign_in_methods"] == ["email"]


def test_google_linked_account_signs_in_both_ways(client, gotrue, db, created):
    body = google_linked_account(client, gotrue, db, created)

    me = client.get("/api/me", headers=bearer(body["access_token"])).json()

    assert me["sign_in_methods"] == ["email", "google"]
    assert me["email"] == body["user"]["email"]


def test_google_only_account_signs_in_with_google(client, gotrue, db, created):
    body = sign_up(gotrue, created)
    make_google_only(db, body["user"]["id"], {"given_name": "Emma"})

    me = client.get("/api/me", headers=bearer(body["access_token"])).json()

    assert me["sign_in_methods"] == ["google"]


# --- PATCH /api/me {first_name} ---


def test_first_name_is_saved_trimmed(client, gotrue, db, created):
    body = email_account(client, gotrue, created)
    token = body["access_token"]

    response = client.patch("/api/me", headers=bearer(token), json={"first_name": "  Ana "})

    assert response.status_code == 200, response.text
    assert response.json()["first_name"] == "Ana"
    assert client.get("/api/me", headers=bearer(token)).json()["first_name"] == "Ana"
    assert first_name_of(db, body["user"]["id"]) == "Ana"


def test_a_long_first_name_is_cut_to_100_characters(client, gotrue, created):
    body = email_account(client, gotrue, created)

    response = client.patch("/api/me", headers=bearer(body["access_token"]), json={"first_name": "A" * 150})

    assert response.status_code == 200, response.text
    assert response.json()["first_name"] == "A" * 100


@pytest.mark.parametrize("name", ["", "   ", "Ana\u0000", "A\nna", "\u0007Ana"])
def test_a_blank_or_control_character_first_name_is_refused(client, gotrue, db, created, name):
    body = email_account(client, gotrue, created)

    response = client.patch("/api/me", headers=bearer(body["access_token"]), json={"first_name": name})

    assert_error(response, 422, "invalid_name")
    assert first_name_of(db, body["user"]["id"]) == "Emma"


def test_name_and_language_can_be_saved_together(client, gotrue, created):
    body = email_account(client, gotrue, created)

    response = client.patch("/api/me", headers=bearer(body["access_token"]), json={"first_name": "Ana", "language": "nb"})

    assert response.status_code == 200, response.text
    assert (response.json()["first_name"], response.json()["language"]) == ("Ana", "nb")


def test_a_google_linked_name_is_refused(client, gotrue, db, created):
    body = google_linked_account(client, gotrue, db, created)
    token = body["access_token"]

    response = client.patch("/api/me", headers=bearer(token), json={"first_name": "Ana", "language": "nb"})

    assert_error(response, 409, "name_from_google")
    assert first_name_of(db, body["user"]["id"]) == "Emma"
    # Nothing in the refused request was saved, the language included.
    assert client.get("/api/me", headers=bearer(token)).json()["language"] == "en"
    # The language alone still saves.
    assert client.patch("/api/me", headers=bearer(token), json={"language": "nb"}).status_code == 200


def test_a_google_only_name_is_refused(client, gotrue, db, created):
    body = sign_up(gotrue, created)
    make_google_only(db, body["user"]["id"], {"given_name": "Emma"})

    response = client.patch("/api/me", headers=bearer(body["access_token"]), json={"first_name": "Ana"})

    assert_error(response, 409, "name_from_google")


# --- POST /api/me/password/check ---


def test_the_right_password_passes_and_its_session_is_ended(client, gotrue, db, created):
    body = email_account(client, gotrue, created)
    account_id = body["user"]["id"]
    before = session_ids(db, account_id)

    response = client.post("/api/me/password/check", headers=bearer(body["access_token"]), json={"current_password": PASSWORD})

    assert response.status_code == 204, response.text
    # The sign-in the check made is already gone; the student's own session goes on.
    assert session_ids(db, account_id) == before
    assert client.get("/api/me", headers=bearer(body["access_token"])).status_code == 200


def test_a_wrong_password_is_refused(client, gotrue, db, created):
    body = email_account(client, gotrue, created)
    before = session_ids(db, body["user"]["id"])

    response = client.post(
        "/api/me/password/check", headers=bearer(body["access_token"]), json={"current_password": "not-the-one-1"}
    )

    assert_error(response, 400, "wrong_password")
    assert session_ids(db, body["user"]["id"]) == before


@pytest.mark.parametrize("payload", [{}, {"current_password": ""}, {"current_password": 5}, {"password": PASSWORD}])
def test_a_malformed_check_is_refused(client, gotrue, created, payload):
    body = email_account(client, gotrue, created)

    response = client.post("/api/me/password/check", headers=bearer(body["access_token"]), json=payload)

    assert_error(response, 422, "invalid_request")


def test_a_google_only_account_has_no_password(client, gotrue, db, created):
    body = sign_up(gotrue, created)
    make_google_only(db, body["user"]["id"], {"given_name": "Emma"})

    response = client.post("/api/me/password/check", headers=bearer(body["access_token"]), json={"current_password": PASSWORD})

    assert_error(response, 409, "no_password")


def test_the_check_needs_a_session(client):
    assert_error(client.post("/api/me/password/check", json={"current_password": PASSWORD}), 401, "unauthorized")


def stub_password_check(client, db, created, gotrue, stub_auth, answer) -> dict:
    """An email Account whose Supabase Auth is stubbed: /user reports it, and `answer(request)` answers
    the sign-in and the logout."""
    body = email_account(client, gotrue, created)
    user = {"id": body["user"]["id"], "email": body["user"]["email"], "identities": [{"provider": "email"}]}

    def handler(request):
        if request.url.path == "/auth/v1/user":
            return httpx2.Response(200, json=user)
        return answer(request)

    stub_auth(handler)
    return bearer(fake_token(session_id_of(db, body["user"]["id"])))


def check(client, headers):
    return client.post("/api/me/password/check", headers=headers, json={"current_password": PASSWORD})


def test_auth_down_during_the_check_is_auth_unavailable(client, gotrue, db, created, stub_auth):
    def answer(request):
        raise httpx2.ConnectError("GoTrue is down", request=request)

    headers = stub_password_check(client, db, created, gotrue, stub_auth, answer)

    assert_error(check(client, headers), 503, "auth_unavailable")


def test_a_rate_limited_check_is_too_many_attempts(client, gotrue, db, created, stub_auth):
    def answer(request):
        return httpx2.Response(429, json={"error_code": "over_request_rate_limit"})

    headers = stub_password_check(client, db, created, gotrue, stub_auth, answer)

    assert_error(check(client, headers), 429, "too_many_attempts")


@pytest.mark.parametrize(
    "response",
    [
        httpx2.Response(400, json={"error_code": "something_else"}),
        httpx2.Response(400, text="not json"),
        httpx2.Response(500, json={}),
    ],
)
def test_an_unexpected_auth_answer_is_auth_unavailable(client, gotrue, db, created, stub_auth, response):
    # Never wrong_password: only a 400 invalid_credentials means the password is wrong.
    headers = stub_password_check(client, db, created, gotrue, stub_auth, lambda request: response)

    assert_error(check(client, headers), 503, "auth_unavailable")


@pytest.mark.parametrize("logout", ["http_500", "connect_error"])
def test_a_failed_logout_after_the_right_password_still_passes(client, gotrue, db, created, stub_auth, logout):
    def answer(request):
        if request.url.path == "/auth/v1/token":
            return httpx2.Response(200, json={"access_token": "temporary-token"})
        if logout == "http_500":
            return httpx2.Response(500, json={})
        raise httpx2.ConnectError("GoTrue is down", request=request)

    headers = stub_password_check(client, db, created, gotrue, stub_auth, answer)

    assert check(client, headers).status_code == 204


def test_passwords_are_never_logged(client, gotrue, created, caplog):
    body = email_account(client, gotrue, created)
    wrong = f"wrong-{uuid.uuid4().hex}"

    with caplog.at_level(logging.DEBUG):
        client.post("/api/me/password/check", headers=bearer(body["access_token"]), json={"current_password": PASSWORD})
        client.post("/api/me/password/check", headers=bearer(body["access_token"]), json={"current_password": wrong})

    assert PASSWORD not in caplog.text
    assert wrong not in caplog.text


# --- The whole Change password flow (acceptance) ---


def test_change_password_keeps_the_student_signed_in_and_only_the_new_one_works(client, gotrue, created):
    body = email_account(client, gotrue, created)
    token, email = body["access_token"], body["user"]["email"]

    check_response = client.post("/api/me/password/check", headers=bearer(token), json={"current_password": PASSWORD})
    assert check_response.status_code == 204, check_response.text
    # What supabase-js updateUser({password}) sends with the student's own session.
    updated = gotrue.put("/user", headers=bearer(token), json={"password": NEW_PASSWORD})
    assert updated.status_code == 200, updated.text

    assert client.get("/api/me", headers=bearer(token)).status_code == 200
    assert password_login(gotrue, email, PASSWORD).status_code == 400
    assert password_login(gotrue, email, NEW_PASSWORD).status_code == 200
