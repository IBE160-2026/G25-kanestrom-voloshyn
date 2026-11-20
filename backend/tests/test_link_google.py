"""Settings › Link Google account and Resend verification email on the backend (Story 7.3b, FR-1,
FR-19, FR-27, AD-19): the manual-link guard in `user_auth`, `POST /api/me/google-link`, and
`POST /api/me/verification`.

No real Google: a seeded `auth.identities` row stands in for a linked Google identity. Needs
`npx supabase start` (with Mailpit) and the local keys in .env.
"""

import uuid

import httpx2
import pytest
from fastapi.testclient import TestClient

from app.main import create_app

from tests.test_auth import (  # noqa: F401 -- shared fixtures
    LOOP,
    assert_error,
    bearer,
    client,
    created,
    db,
    fake_token,
    gotrue,
    settings,
    sign_up,
    stub_auth,
)
from tests.test_google import (
    PICTURE,
    google_sign_in,
    login,
    make_google_only,
    password_login,
    seed_google,
    session_of,
    takeover_row,
)
from tests.test_verification import (  # noqa: F401
    NB_SUBJECT,
    link_in,
    mailpit,
    messages_to,
    open_link,
    token_count,
)


def other_email() -> str:
    return f"someone-else-{uuid.uuid4().hex[:12]}@example.com"


def google_identities(db, account_id: str) -> int:
    row = db.execute(
        "SELECT count(*) FROM auth.identities WHERE user_id = %s AND provider = 'google'", (account_id,)
    ).fetchone()
    return row[0]


def greet(client, body: dict, first_name: str = "Emma") -> None:
    response = client.post(
        "/api/auth/after-sign-in", headers=bearer(body["access_token"]), json={"first_name": first_name}
    )
    assert response.status_code == 200, response.text


def verify(db, account_id: str) -> None:
    db.execute("UPDATE profiles SET email_verified_at = now() WHERE account_id = %s", (account_id,))


# --- The manual-link guard (AD-19) ---


def test_unverified_manual_link_is_removed_without_a_takeover(client, gotrue, db, created):
    signed_up = sign_up(gotrue, created)
    email, account_id = signed_up["user"]["email"], signed_up["user"]["id"]
    greet(client, signed_up, "Emma")
    session = login(gotrue, email)
    seed_google(db, account_id, {"email": other_email(), "given_name": "Mallory", "picture": PICTURE})

    assert_error(client.get("/api/me", headers=bearer(session["access_token"])), 409, "email_not_verified")

    # The identity is gone, nothing was taken over, and the old password still signs in.
    assert google_identities(db, account_id) == 0
    assert takeover_row(db, account_id) == (None, False, None, "Emma")
    assert password_login(gotrue, email).status_code == 200
    # The session goes on as an email-only Account.
    me = client.get("/api/me", headers=bearer(session["access_token"]))
    assert me.status_code == 200, me.text
    assert me.json()["sign_in_methods"] == ["email"]
    assert me.json()["first_name"] == "Emma"


def test_the_guard_runs_before_the_profile_exists(client, gotrue, db, created):
    # No after-sign-in yet: the profile is missing, which counts as unverified.
    signed_up = sign_up(gotrue, created)
    email, account_id = signed_up["user"]["email"], signed_up["user"]["id"]
    seed_google(db, account_id, {"email": other_email(), "given_name": "Mallory"})

    response = client.post("/api/auth/after-sign-in", headers=bearer(signed_up["access_token"]), json={})

    assert_error(response, 409, "email_not_verified")
    assert google_identities(db, account_id) == 0
    assert password_login(gotrue, email).status_code == 200
    row = db.execute("SELECT google_takeover_at FROM profiles WHERE account_id = %s", (account_id,)).fetchone()
    assert row is None or row[0] is None


def test_the_email_comparison_ignores_case(client, gotrue, db, created):
    signed_up = sign_up(gotrue, created)
    email, account_id = signed_up["user"]["email"], signed_up["user"]["id"]
    seed_google(db, account_id, {"email": email.upper(), "given_name": "Emma"})

    # Same address: a Google sign-in, so the existing takeover runs (unchanged).
    assert_error(client.get("/api/me", headers=bearer(signed_up["access_token"])), 401, "google_takeover")
    assert google_identities(db, account_id) == 1
    assert takeover_row(db, account_id)[0] is not None
    assert password_login(gotrue, email).status_code == 400


def stubbed(account_id: str, email: str, google_email: str, identity_id: str) -> dict:
    return {
        "id": account_id,
        "email": email,
        "identities": [
            {"provider": "email", "email": email},
            {"provider": "google", "email": google_email, "identity_id": identity_id},
        ],
    }


def test_a_failed_unlink_is_503_and_takes_nothing_over(client, gotrue, db, created, stub_auth):
    signed_up = sign_up(gotrue, created)
    email, account_id = signed_up["user"]["email"], signed_up["user"]["id"]
    db.execute("INSERT INTO profiles (account_id) VALUES (%s)", (account_id,))
    identity_id = str(uuid.uuid4())
    calls = []

    def handler(request):
        if request.method == "GET" and request.url.path == "/auth/v1/user":
            return httpx2.Response(200, json=stubbed(account_id, email, other_email(), identity_id))
        calls.append((request.method, request.url.path, request.headers.get("authorization")))
        return httpx2.Response(500, json={})

    stub_auth(handler)
    token = fake_token(session_of(signed_up["access_token"]))
    assert_error(client.get("/api/me", headers=bearer(token)), 503, "auth_unavailable")

    # Only the unlink was tried, as the student; no admin call, no takeover.
    assert calls == [("DELETE", f"/auth/v1/user/identities/{identity_id}", f"Bearer {token}")]
    assert takeover_row(db, account_id)[:3] == (None, False, None)
    assert password_login(gotrue, email).status_code == 200


def test_an_unlink_that_finds_it_gone_still_answers_email_not_verified(client, gotrue, db, created, stub_auth):
    signed_up = sign_up(gotrue, created)
    email, account_id = signed_up["user"]["email"], signed_up["user"]["id"]
    identity_id = str(uuid.uuid4())

    def handler(request):
        if request.method == "GET":
            return httpx2.Response(200, json=stubbed(account_id, email, other_email(), identity_id))
        return httpx2.Response(404, json={})

    stub_auth(handler)
    token = fake_token(session_of(signed_up["access_token"]))
    assert_error(client.get("/api/me", headers=bearer(token)), 409, "email_not_verified")


def test_a_google_identity_without_an_email_counts_as_a_manual_link(client, gotrue, db, created, stub_auth):
    signed_up = sign_up(gotrue, created)
    email, account_id = signed_up["user"]["email"], signed_up["user"]["id"]
    db.execute("INSERT INTO profiles (account_id) VALUES (%s)", (account_id,))
    identity_id = str(uuid.uuid4())
    deletes = []

    def handler(request):
        if request.method == "GET":
            user = {
                "id": account_id,
                "email": email,
                "identities": [
                    {"provider": "email", "email": email},
                    {"provider": "google", "identity_id": identity_id, "identity_data": {"given_name": "Mallory"}},
                ],
            }
            return httpx2.Response(200, json=user)
        deletes.append(request.url.path)
        return httpx2.Response(204)

    stub_auth(handler)
    token = fake_token(session_of(signed_up["access_token"]))
    assert_error(client.get("/api/me", headers=bearer(token)), 409, "email_not_verified")
    assert deletes == [f"/auth/v1/user/identities/{identity_id}"]
    assert takeover_row(db, account_id)[:3] == (None, False, None)
    assert password_login(gotrue, email).status_code == 200


@pytest.mark.parametrize("identity_id", [None, "", "not-a-uuid"])
def test_an_unusable_identity_id_is_503_with_no_delete(client, gotrue, db, created, stub_auth, identity_id):
    signed_up = sign_up(gotrue, created)
    email, account_id = signed_up["user"]["email"], signed_up["user"]["id"]
    db.execute("INSERT INTO profiles (account_id) VALUES (%s)", (account_id,))
    other = []

    def handler(request):
        if request.method == "GET":
            return httpx2.Response(200, json=stubbed(account_id, email, other_email(), identity_id))
        other.append(request)
        return httpx2.Response(204)

    stub_auth(handler)
    token = fake_token(session_of(signed_up["access_token"]))
    assert_error(client.get("/api/me", headers=bearer(token)), 503, "auth_unavailable")
    assert other == []
    assert takeover_row(db, account_id)[:3] == (None, False, None)
    assert password_login(gotrue, email).status_code == 200


def test_every_google_identity_is_checked_and_each_mismatch_removed(client, gotrue, db, created):
    signed_up = sign_up(gotrue, created)
    email, account_id = signed_up["user"]["email"], signed_up["user"]["id"]
    greet(client, signed_up, "Emma")
    session = login(gotrue, email)
    seed_google(db, account_id, {"given_name": "Emma"})  # same email first
    seed_google(db, account_id, {"email": other_email(), "given_name": "Mallory"})

    assert_error(client.get("/api/me", headers=bearer(session["access_token"])), 409, "email_not_verified")

    # Only the other-email identity is gone; nothing was taken over yet.
    rows = db.execute(
        "SELECT email FROM auth.identities WHERE user_id = %s AND provider = 'google'", (account_id,)
    ).fetchall()
    assert [row[0] for row in rows] == [email]
    assert takeover_row(db, account_id)[:3] == (None, False, None)
    assert password_login(gotrue, email).status_code == 200


def test_a_verified_account_keeps_a_manual_link(client, gotrue, db, created):
    signed_up = sign_up(gotrue, created)
    account_id = signed_up["user"]["id"]
    greet(client, signed_up)
    verify(db, account_id)
    seed_google(db, account_id, {"email": other_email(), "given_name": "Emmeline"})

    me = client.get("/api/me", headers=bearer(signed_up["access_token"]))

    assert me.status_code == 200, me.text
    assert me.json()["sign_in_methods"] == ["email", "google"]
    assert google_identities(db, account_id) == 1


# --- POST /api/me/google-link ---


def test_google_link_takes_the_google_name_and_both_sign_ins_reach_the_account(
    settings, client, gotrue, db, created
):
    signed_up = sign_up(gotrue, created)
    email, account_id = signed_up["user"]["email"], signed_up["user"]["id"]
    greet(client, signed_up, "Emma")
    verify(db, account_id)
    seed_google(db, account_id, {"given_name": "Emmeline", "picture": PICTURE})

    response = client.post("/api/me/google-link", headers=bearer(signed_up["access_token"]))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["first_name"] == "Emmeline"  # a linked name follows Google, replacing the old one
    assert body["sign_in_methods"] == ["email", "google"]
    assert body["picture_url"] == PICTURE
    assert body["notice_google_takeover"] is False
    assert takeover_row(db, account_id)[0] is None
    # Email and Google sign-in reach the same Account.
    assert password_login(gotrue, email).status_code == 200
    again = google_sign_in(settings, gotrue, email)
    assert again["user"]["id"] == account_id
    assert client.get("/api/me", headers=bearer(again["access_token"])).json()["first_name"] == "Emmeline"


def test_google_link_keeps_the_name_when_google_gives_none(client, gotrue, db, created):
    signed_up = sign_up(gotrue, created)
    account_id = signed_up["user"]["id"]
    greet(client, signed_up, "Emma")
    verify(db, account_id)
    seed_google(db, account_id, {"picture": PICTURE})

    response = client.post("/api/me/google-link", headers=bearer(signed_up["access_token"]))

    assert response.status_code == 200, response.text
    assert response.json()["first_name"] == "Emma"


def test_google_link_on_an_unverified_account_is_refused_by_the_guard(client, gotrue, db, created):
    signed_up = sign_up(gotrue, created)
    email, account_id = signed_up["user"]["email"], signed_up["user"]["id"]
    greet(client, signed_up, "Emma")
    seed_google(db, account_id, {"email": other_email(), "given_name": "Mallory"})

    response = client.post("/api/me/google-link", headers=bearer(signed_up["access_token"]))

    assert_error(response, 409, "email_not_verified")
    assert google_identities(db, account_id) == 0
    assert takeover_row(db, account_id)[3] == "Emma"
    assert password_login(gotrue, email).status_code == 200


def test_google_link_without_a_google_identity_is_409(client, gotrue, db, created):
    signed_up = sign_up(gotrue, created)
    account_id = signed_up["user"]["id"]
    greet(client, signed_up, "Emma")
    verify(db, account_id)

    response = client.post("/api/me/google-link", headers=bearer(signed_up["access_token"]))

    assert_error(response, 409, "link_failed")
    assert takeover_row(db, account_id)[3] == "Emma"


def test_google_link_needs_a_session(client):
    assert_error(client.post("/api/me/google-link"), 401, "unauthorized")


# --- POST /api/me/verification ---


def test_resend_sends_a_new_link_and_invalidates_the_older_one(client, gotrue, db, created, mailpit):
    signed_up = sign_up(gotrue, created)
    email, account_id = signed_up["user"]["email"], signed_up["user"]["id"]
    mailpit.addresses.append(email)
    greet(client, signed_up, "Emma")  # the first email
    [first] = messages_to(mailpit, email, expect=1)

    response = client.post("/api/me/verification", headers=bearer(signed_up["access_token"]))

    assert response.status_code == 204, response.text
    messages = messages_to(mailpit, email, expect=2)
    assert len(messages) == 2
    newest = next(m for m in messages if m["ID"] != first["ID"])
    assert "Hi Emma," in newest["Text"]
    assert token_count(db, account_id) == 2
    # The older link no longer works; the new one verifies.
    assert open_link(client, link_in(first)).headers["location"].endswith("status=expired")
    assert open_link(client, link_in(newest)).headers["location"] == "/email-verified"
    assert client.get("/api/me", headers=bearer(signed_up["access_token"])).json()["email_verified"] is True


def test_a_resend_whose_send_fails_leaves_the_older_link_working(settings, client, gotrue, db, created, mailpit):
    signed_up = sign_up(gotrue, created)
    email, account_id = signed_up["user"]["email"], signed_up["user"]["id"]
    mailpit.addresses.append(email)
    greet(client, signed_up, "Emma")
    [first] = messages_to(mailpit, email, expect=1)

    # Nothing listens on port 1, so the resend's send fails after the commit.
    down = create_app(settings.model_copy(update={"smtp_port": 1}))
    with TestClient(down, backend_options=LOOP) as down_client:
        response = down_client.post("/api/me/verification", headers=bearer(signed_up["access_token"]))
    assert response.status_code == 204, response.text

    assert len(messages_to(mailpit, email, expect=2, timeout=1)) == 1
    assert token_count(db, account_id) == 1  # the unsent link is gone
    assert open_link(client, link_in(first)).headers["location"] == "/email-verified"


def test_a_resend_arrives_in_the_account_language(client, gotrue, db, created, mailpit):
    signed_up = sign_up(gotrue, created)
    email = signed_up["user"]["email"]
    mailpit.addresses.append(email)
    client.post(
        "/api/auth/after-sign-in",
        headers=bearer(signed_up["access_token"]),
        json={"first_name": "Emma", "language": "nb"},
    )
    messages_to(mailpit, email, expect=1)

    assert client.post("/api/me/verification", headers=bearer(signed_up["access_token"])).status_code == 204

    messages = messages_to(mailpit, email, expect=2)
    assert len(messages) == 2
    for message in messages:
        assert message["Subject"] == NB_SUBJECT
        assert "Hei Emma," in message["Text"]


def test_resend_is_not_rate_limited(client, gotrue, db, created, mailpit):
    signed_up = sign_up(gotrue, created)
    email, account_id = signed_up["user"]["email"], signed_up["user"]["id"]
    mailpit.addresses.append(email)
    for _ in range(4):
        assert client.post("/api/me/verification", headers=bearer(signed_up["access_token"])).status_code == 204
    assert len(messages_to(mailpit, email, expect=4)) == 4
    unused = db.execute(
        "SELECT count(*) FROM email_verifications WHERE account_id = %s AND used_at IS NULL AND invalidated_at IS NULL",
        (account_id,),
    ).fetchone()[0]
    assert unused == 1


def test_resend_for_a_verified_account_is_409(client, gotrue, db, created, mailpit):
    signed_up = sign_up(gotrue, created)
    email, account_id = signed_up["user"]["email"], signed_up["user"]["id"]
    mailpit.addresses.append(email)
    client.get("/api/me", headers=bearer(signed_up["access_token"]))  # creates the profile
    verify(db, account_id)

    response = client.post("/api/me/verification", headers=bearer(signed_up["access_token"]))

    assert_error(response, 409, "already_verified")
    assert token_count(db, account_id) == 0
    assert messages_to(mailpit, email) == []


def test_resend_without_an_email_identity_is_409(client, gotrue, db, created):
    signed_up = sign_up(gotrue, created)
    account_id = signed_up["user"]["id"]
    make_google_only(db, account_id, {"given_name": "Emma"})

    response = client.post("/api/me/verification", headers=bearer(signed_up["access_token"]))

    assert_error(response, 409, "no_password")
    assert token_count(db, account_id) == 0


def test_resend_needs_a_session(client):
    assert_error(client.post("/api/me/verification"), 401, "unauthorized")
