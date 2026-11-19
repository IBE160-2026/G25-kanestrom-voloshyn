"""Google sign-in on the backend: the takeover in `user_auth`, and the Google name and picture (Story 1.6).

FR-19, FR-27, AD-2 step 4, AD-19. Needs `npx supabase start`. No Google keys are needed: a Google
identity is seeded straight into `auth.identities` for a GoTrue-created user, which GoTrue then
reports from `GET /auth/v1/user` like a real linked identity. No test calls `after-sign-in` unless
it says so, so the takeover is shown to be enforced by `user_auth` alone.
"""

import base64
import json
import logging
import string
import uuid

import httpx2
import pytest
from psycopg.types.json import Jsonb

from app.api.conn import Conn
from app.auth import UserAuth
from app import supabase_auth
from app.db import profiles
from app.errors import AppError
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

PICTURE = "https://lh3.googleusercontent.com/a/photo"
GOOGLE_DATA = {"given_name": "Kari", "full_name": "Kari Nordmann", "avatar_url": PICTURE, "email_verified": True}


def seed_google(db, account_id: str, email: str, data: dict | None = None) -> None:
    """Link a Google identity to the Account the way Supabase's automatic linking stores one."""
    sub = str(uuid.uuid4().int)[:21]
    db.execute(
        """
        INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        VALUES (%s, %s, %s, 'google', now(), now(), now())
        """,
        (sub, account_id, Jsonb({"sub": sub, "email": email, **(GOOGLE_DATA if data is None else data)})),
    )


def password_login(gotrue, email: str, password: str = PASSWORD):
    return gotrue.post("/token?grant_type=password", json={"email": email, "password": password})


def second_session(gotrue, email: str) -> str:
    response = password_login(gotrue, email)
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def password_hash(db, account_id: str) -> str | None:
    return db.execute("SELECT encrypted_password FROM auth.users WHERE id = %s", (account_id,)).fetchone()[0]


def takeover_row(db, account_id: str) -> tuple:
    row = db.execute(
        "SELECT google_takeover_at IS NOT NULL, notice_google_takeover FROM profiles WHERE account_id = %s",
        (account_id,),
    ).fetchone()
    return row if row is not None else (False, False)


def session_count(db, account_id: str) -> int:
    return db.execute("SELECT count(*) FROM auth.sessions WHERE user_id = %s", (account_id,)).fetchone()[0]


def claims_of(token: str) -> dict:
    payload = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))


def with_claims(claims: dict) -> str:
    def part(obj):
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()

    return f"{part({'alg': 'none'})}.{part(claims)}.sig"


def oauth_token(session_id: str) -> str:
    """A token whose session signed in with Google (`amr` oauth), for a stubbed Supabase Auth."""
    return with_claims({"session_id": session_id, "amr": [{"method": "oauth", "timestamp": 1}]})


@pytest.fixture
def as_google(client, settings, stub_auth):
    """Turn a real password session's token into one that reads as a Google sign-in.

    There are no Google keys in tests, so the token's claims are rewritten (`amr` oauth) while every
    Supabase Auth request is forwarded to the real local GoTrue with the real token. Everything the
    takeover does to passwords and sessions is therefore real. Returns `google(real_token) -> token`.
    """
    real: dict[str, str] = {}
    upstream = httpx2.Client(base_url=settings.supabase_url, timeout=10)

    def handler(request):
        headers = {k: v for k, v in request.headers.items() if k.lower() in ("apikey", "authorization", "content-type")}
        scheme, _, token = headers.get("authorization", "").partition(" ")
        if token in real:
            headers["authorization"] = f"{scheme} {real[token]}"
        response = upstream.request(
            request.method, request.url.raw_path.decode(), headers=headers, content=request.content
        )
        return httpx2.Response(
            response.status_code, content=response.content, headers={"content-type": response.headers.get("content-type", "")}
        )

    stub_auth(handler)

    def google(token: str) -> str:
        fake = with_claims({**claims_of(token), "amr": [{"method": "oauth", "timestamp": 1}]})
        real[fake] = token
        return fake

    yield google
    upstream.close()


def verify_email(db, account_id: str) -> None:
    db.execute("INSERT INTO profiles (account_id) VALUES (%s) ON CONFLICT DO NOTHING", (account_id,))
    db.execute("UPDATE profiles SET email_verified_at = now() WHERE account_id = %s", (account_id,))


# --- Unverified email Account: the takeover, enforced by user_auth ---


def admin(settings) -> dict[str, str]:
    secret = settings.supabase_secret_key.get_secret_value()
    return {"apikey": secret, "Authorization": f"Bearer {secret}"}


def fresh_session(settings, gotrue, email: str) -> str:
    """A new session without the password (which the takeover replaced): a magic link, as Google would sign in."""
    link = gotrue.post("/admin/generate_link", json={"type": "magiclink", "email": email}, headers=admin(settings))
    assert link.status_code == 200, link.text
    verified = gotrue.post("/verify", json={"type": "magiclink", "token_hash": link.json()["hashed_token"]})
    assert verified.status_code == 200, verified.text
    return verified.json()["access_token"]


def test_takeover_runs_in_user_auth_without_after_sign_in(client, gotrue, db, created, as_google):
    body = sign_up(gotrue, created)
    account_id, email = body["user"]["id"], body["user"]["email"]
    google = as_google(second_session(gotrue, email))  # the Google sign-in's session
    other = body["access_token"]  # an earlier password session
    seed_google(db, account_id, email)
    old_hash = password_hash(db, account_id)

    # Any /api call with a Google session's token runs it; here the profile read, with no after-sign-in.
    me = client.get("/api/me", headers=bearer(google))

    # The request that ran it succeeds and already carries the notice (AD-19, own-token update).
    assert me.status_code == 200, me.text
    assert (me.json()["notice_google_takeover"], me.json()["first_name"], me.json()["picture_url"]) == (
        True,
        "Kari",
        PICTURE,
    )
    assert takeover_row(db, account_id) == (True, True)
    # Google has proven the address: the takeover marks it verified.
    assert me.json()["email_verified"] is True
    assert db.execute("SELECT email_verified_at IS NOT NULL FROM profiles WHERE account_id = %s", (account_id,)).fetchone()[0]
    # The old password stops working; every other session ends; the caller's keeps working.
    assert password_hash(db, account_id) != old_hash
    assert password_login(gotrue, email).status_code == 400
    assert_error(client.get("/api/me", headers=bearer(other)), 401, "unauthorized")
    assert session_count(db, account_id) == 1
    assert client.get("/api/me", headers=bearer(google)).status_code == 200


def test_takeover_runs_once(client, settings, gotrue, db, created, as_google):
    body = sign_up(gotrue, created)
    account_id, email = body["user"]["id"], body["user"]["email"]
    token = as_google(body["access_token"])
    seed_google(db, account_id, email)
    assert client.get("/api/me", headers=bearer(token)).status_code == 200
    first = db.execute("SELECT google_takeover_at FROM profiles WHERE account_id = %s", (account_id,)).fetchone()[0]
    hash_after = password_hash(db, account_id)
    keep = fresh_session(settings, gotrue, email)  # a later sign-in, after the takeover (not oauth)

    # Clear the notice, then call again: no second password, no second takeover, no notice.
    assert client.post("/api/me/notices/google-takeover", headers=bearer(token)).status_code == 200
    again = client.get("/api/me", headers=bearer(token))

    assert again.status_code == 200, again.text
    assert again.json()["notice_google_takeover"] is False
    assert password_hash(db, account_id) == hash_after
    assert db.execute(
        "SELECT google_takeover_at FROM profiles WHERE account_id = %s", (account_id,)
    ).fetchone()[0] == first
    # Once taken over, a session of another kind is no longer refused.
    assert client.get("/api/me", headers=bearer(keep)).status_code == 200


def test_squatters_session_first_is_ended_and_does_not_count(client, gotrue, db, created, as_google):
    # Someone registered the address with a password; the real owner then signs in with Google.
    body = sign_up(gotrue, created)
    account_id, email = body["user"]["id"], body["user"]["email"]
    squatter = body["access_token"]
    google = as_google(second_session(gotrue, email))
    seed_google(db, account_id, email)
    old_hash = password_hash(db, account_id)

    assert_error(client.get("/api/me", headers=bearer(squatter)), 401, "google_sign_in_required")

    assert takeover_row(db, account_id) == (False, False)
    assert password_hash(db, account_id) == old_hash
    assert session_count(db, account_id) == 1  # only the Google session is left

    response = client.get("/api/me", headers=bearer(google))
    assert response.status_code == 200, response.text
    assert response.json()["notice_google_takeover"] is True
    assert takeover_row(db, account_id) == (True, True)
    assert password_login(gotrue, email).status_code == 400
    assert_error(client.get("/api/me", headers=bearer(squatter)), 401, "unauthorized")


def test_password_sign_in_never_triggers_the_takeover(client, gotrue, db, created):
    # Real password tokens (`amr` password) only: each such session is ended, the takeover never runs.
    body = sign_up(gotrue, created)
    account_id, email = body["user"]["id"], body["user"]["email"]
    seed_google(db, account_id, email)
    old_hash = password_hash(db, account_id)
    assert claims_of(body["access_token"])["amr"][0]["method"] == "password"

    for token in (body["access_token"], second_session(gotrue, email)):
        assert_error(client.get("/api/me", headers=bearer(token)), 401, "google_sign_in_required")

    assert takeover_row(db, account_id) == (False, False)
    assert password_hash(db, account_id) == old_hash
    assert session_count(db, account_id) == 0


def test_foreign_google_identity_is_unlinked_without_takeover(client, gotrue, db, created):
    body = sign_up(gotrue, created)
    account_id, email, token = body["user"]["id"], body["user"]["email"], body["access_token"]
    other = second_session(gotrue, email)
    seed_google(db, account_id, "someone-else@example.com")
    old_hash = password_hash(db, account_id)

    me = client.get("/api/me", headers=bearer(token))

    assert me.status_code == 200, me.text
    assert (me.json()["first_name"], me.json()["picture_url"], me.json()["notice_google_takeover"]) == (None, None, False)
    providers = db.execute("SELECT provider FROM auth.identities WHERE user_id = %s", (account_id,)).fetchall()
    assert providers == [("email",)]
    assert takeover_row(db, account_id) == (False, False)
    assert password_hash(db, account_id) == old_hash
    assert password_login(gotrue, email).status_code == 200
    assert client.get("/api/me", headers=bearer(other)).status_code == 200


def test_foreign_identity_is_unlinked_but_the_matching_one_takes_over(client, gotrue, db, created, as_google):
    body = sign_up(gotrue, created)
    account_id, email = body["user"]["id"], body["user"]["email"]
    google = as_google(body["access_token"])
    seed_google(db, account_id, "someone-else@example.com", {"given_name": "Mallory"})
    seed_google(db, account_id, email.upper())  # case-insensitive match

    me = client.get("/api/me", headers=bearer(google))

    assert me.status_code == 200, me.text
    assert (me.json()["first_name"], me.json()["notice_google_takeover"]) == ("Kari", True)
    emails = db.execute(
        "SELECT identity_data->>'email' FROM auth.identities WHERE user_id = %s AND provider = 'google'", (account_id,)
    ).fetchall()
    assert emails == [(email.upper(),)]


def session_id_of_first(db, account_id: str) -> str:
    row = db.execute(
        "SELECT id FROM auth.sessions WHERE user_id = %s ORDER BY created_at LIMIT 1", (account_id,)
    ).fetchone()
    return str(row[0])


class _Calls(list):
    """The Supabase Auth calls a stub saw (method, path, authorization), with their JSON bodies, and
    the user object the stub reports (`user`, editable by a test)."""

    def __init__(self):
        super().__init__()
        self.bodies: list = []
        self.user: dict = {}


@pytest.fixture
def stubbed_takeover(client, gotrue, db, created, stub_auth):
    """An unverified Account with two real sessions, and Supabase Auth stubbed.

    The stub reports the email and google identities and answers the own-token password update
    without ending any session, so what `user_auth` itself does (and in which order) shows on its own.
    Yields (account_id, caller token, the other session id, password updates seen, their status list).
    """
    body = sign_up(gotrue, created)
    account_id, email = body["user"]["id"], body["user"]["email"]
    second_session(gotrue, email)
    caller = session_id_of_first(db, account_id)
    other = db.execute(
        "SELECT id FROM auth.sessions WHERE user_id = %s AND id <> %s", (account_id, caller)
    ).fetchone()[0]
    user = {
        "id": account_id,
        "email": email,
        "identities": [
            {"provider": "email", "identity_id": str(uuid.uuid4())},
            {"provider": "google", "identity_id": str(uuid.uuid4()), "identity_data": {**GOOGLE_DATA, "email": email}},
        ],
    }
    calls = _Calls()
    calls.user = user
    # The answer to the password update: a status, or (status, body).
    admin_status: list = [200]

    def handler(request):
        if request.method == "GET" and request.url.path == "/auth/v1/user":
            return httpx2.Response(200, json=user)
        calls.append((request.method, request.url.path, request.headers.get("authorization")))
        calls.bodies.append(json.loads(request.content) if request.content else None)
        answer = admin_status[0]
        status, body = answer if isinstance(answer, tuple) else (answer, user)
        return httpx2.Response(status, json=body)

    stub_auth(handler)
    return account_id, oauth_token(caller), str(other), calls, admin_status


def session_exists(db, session_id: str) -> bool:
    return db.execute("SELECT count(*) FROM auth.sessions WHERE id = %s", (session_id,)).fetchone()[0] == 1


def test_takeover_runs_before_the_handler(client, db, stubbed_takeover):
    account_id, token, other, calls, _ = stubbed_takeover

    response = client.patch("/api/me", headers=bearer(token), json={"language": "nb"})

    assert response.status_code == 200, response.text
    assert response.json()["notice_google_takeover"] is True
    assert takeover_row(db, account_id) == (True, True)
    assert not session_exists(db, other)
    # The caller's own token, never the admin update (AD-19).
    assert calls == [("PUT", "/auth/v1/user", f"Bearer {token}")]


def test_takeover_survives_a_handler_that_rolls_back(client, db, stubbed_takeover):
    # The handler's own transaction rolls back; the takeover committed before it (AD-18).
    account_id, token, other, _, _ = stubbed_takeover

    @client.app.post("/_test/rolls-back")
    async def rolls_back(user: UserAuth, conn: Conn):
        await conn.execute("UPDATE profiles SET language = 'nb' WHERE account_id = %s", (user.account_id,))
        raise AppError(409, "conflict", "roll back")

    assert client.post("/_test/rolls-back", headers=bearer(token)).status_code == 409
    assert takeover_row(db, account_id) == (True, True)
    assert not session_exists(db, other)
    assert db.execute("SELECT language FROM profiles WHERE account_id = %s", (account_id,)).fetchone()[0] is None


def test_takeover_is_retried_when_the_password_cannot_be_set(client, db, stubbed_takeover):
    # Step 1 (the password update) failing stops the request with auth_unavailable; the next one retries.
    account_id, token, other, calls, admin_status = stubbed_takeover
    admin_status[0] = 500

    assert_error(client.get("/api/me", headers=bearer(token)), 503, "auth_unavailable")
    assert takeover_row(db, account_id) == (False, False)
    assert session_exists(db, other)

    admin_status[0] = 200
    assert client.get("/api/me", headers=bearer(token)).status_code == 200
    assert takeover_row(db, account_id) == (True, True)
    assert not session_exists(db, other)
    assert len(calls) == 2


def test_takeover_is_retried_when_its_transaction_fails(client, db, stubbed_takeover, monkeypatch):
    account_id, token, other, calls, _ = stubbed_takeover
    real_mark = profiles.mark_takeover

    async def failing_mark(conn, account_id):
        raise RuntimeError("database went away")

    monkeypatch.setattr(profiles, "mark_takeover", failing_mark)
    with pytest.raises(RuntimeError):
        client.get("/api/me", headers=bearer(token))
    # Nothing of step 2 was kept: the other session still exists, no takeover is recorded.
    assert session_exists(db, other)
    assert takeover_row(db, account_id) == (False, False)

    monkeypatch.setattr(profiles, "mark_takeover", real_mark)
    response = client.get("/api/me", headers=bearer(token))
    assert response.status_code == 200, response.text
    assert takeover_row(db, account_id) == (True, True)
    assert not session_exists(db, other)
    assert len(calls) == 2  # the password was set again: idempotent


def test_a_non_oauth_token_never_runs_the_takeover(client, db, stubbed_takeover):
    account_id, token, other, calls, _ = stubbed_takeover
    caller = claims_of(token)["session_id"]
    password = with_claims({"session_id": caller, "amr": [{"method": "password", "timestamp": 1}]})

    assert_error(client.get("/api/me", headers=bearer(password)), 401, "google_sign_in_required")

    assert calls == []
    assert not session_exists(db, caller)
    assert session_exists(db, other)
    assert takeover_row(db, account_id) == (False, False)


@pytest.mark.parametrize("status", [401, 403])
def test_a_refused_password_update_is_unauthorized(client, db, stubbed_takeover, status):
    account_id, token, other, _, admin_status = stubbed_takeover
    admin_status[0] = status

    assert_error(client.get("/api/me", headers=bearer(token)), 401, "unauthorized")
    assert takeover_row(db, account_id) == (False, False)
    assert session_exists(db, other)


@pytest.mark.parametrize(
    ("status", "code"),
    [(400, "reauthentication_needed"), (400, "current_password_required"), (422, "weak_password")],
)
def test_a_configuration_error_is_logged_and_unavailable(client, db, stubbed_takeover, caplog, status, code):
    account_id, token, other, calls, admin_status = stubbed_takeover
    admin_status[0] = (status, {"error_code": code, "msg": "x"})

    with caplog.at_level(logging.ERROR, logger="app.supabase_auth"):
        assert_error(client.get("/api/me", headers=bearer(token)), 503, "auth_unavailable")

    assert [r.getMessage() for r in caplog.records if r.levelno >= logging.ERROR] == [
        f"Supabase Auth configuration error on the takeover password update: {code}"
    ]
    assert calls.bodies[-1]["password"] not in caplog.text
    assert takeover_row(db, account_id) == (False, False)
    assert session_exists(db, other)


def test_the_random_password_has_every_character_class(client, stubbed_takeover):
    _, token, _, calls, _ = stubbed_takeover
    assert client.get("/api/me", headers=bearer(token)).status_code == 200
    (password,) = [body["password"] for body in calls.bodies]
    assert 8 <= len(password) <= 72
    for chars in (string.ascii_lowercase, string.ascii_uppercase, string.digits, string.punctuation):
        assert any(c in chars for c in password)


def test_no_takeover_while_the_session_is_expired(client, db, stubbed_takeover):
    account_id, token, other, calls, _ = stubbed_takeover
    db.execute(
        "UPDATE auth.sessions SET created_at = now() - interval '31 days' WHERE user_id = %s AND id <> %s",
        (account_id, other),
    )

    assert_error(client.get("/api/me", headers=bearer(token)), 401, "session_expired")
    assert calls == []
    assert takeover_row(db, account_id) == (False, False)
    assert session_exists(db, other)


def test_no_takeover_for_an_ended_session(client, gotrue, db, created):
    body = sign_up(gotrue, created)
    account_id, email = body["user"]["id"], body["user"]["email"]
    other = second_session(gotrue, email)
    seed_google(db, account_id, email)
    db.execute("DELETE FROM auth.sessions WHERE id = %s", (session_id_of_first(db, account_id),))
    old_hash = password_hash(db, account_id)

    # The first sign-up session is gone; GoTrue still accepts its JWT, but user_auth refuses it.
    response = client.get("/api/me", headers=bearer(body["access_token"]))

    assert response.status_code == 401
    assert password_hash(db, account_id) == old_hash
    assert takeover_row(db, account_id) == (False, False)
    assert session_count(db, account_id) == 1  # the other session goes on
    assert other


# --- Verified email Account and Google-only Account: no takeover ---


def test_verified_account_is_linked_without_takeover(client, gotrue, db, created):
    body = sign_up(gotrue, created)
    account_id, email = body["user"]["id"], body["user"]["email"]
    other = second_session(gotrue, email)
    verify_email(db, account_id)
    seed_google(db, account_id, email)
    old_hash = password_hash(db, account_id)

    me = client.get("/api/me", headers=bearer(body["access_token"]))

    assert me.status_code == 200, me.text
    assert me.json()["notice_google_takeover"] is False
    assert me.json()["first_name"] == "Kari"
    assert takeover_row(db, account_id) == (False, False)
    # Both methods reach the same Account: the password still works, other sessions go on.
    assert password_hash(db, account_id) == old_hash
    assert password_login(gotrue, email).status_code == 200
    assert client.get("/api/me", headers=bearer(other)).status_code == 200


def test_google_only_account_gets_no_takeover_and_no_password(client, gotrue, db, created):
    body = sign_up(gotrue, created)
    account_id, email = body["user"]["id"], body["user"]["email"]
    # Make it Google-only: no email identity, no password.
    db.execute("DELETE FROM auth.identities WHERE user_id = %s AND provider = 'email'", (account_id,))
    db.execute("UPDATE auth.users SET encrypted_password = '' WHERE id = %s", (account_id,))
    seed_google(db, account_id, email)

    me = client.get("/api/me", headers=bearer(body["access_token"]))

    assert me.status_code == 200, me.text
    assert me.json()["notice_google_takeover"] is False
    assert me.json()["picture_url"] == PICTURE
    assert takeover_row(db, account_id) == (False, False)
    assert password_hash(db, account_id) == ""


# --- The Google first name and picture (FR-19, FR-27) ---


def test_after_sign_in_stores_the_google_first_name(client, gotrue, db, created):
    body = sign_up(gotrue, created)
    account_id = body["user"]["id"]
    verify_email(db, account_id)
    seed_google(db, account_id, body["user"]["email"])

    response = client.post("/api/auth/after-sign-in", headers=bearer(body["access_token"]), json={"language": "en"})

    assert response.status_code == 200, response.text
    assert response.json()["first_name"] == "Kari"
    assert db.execute("SELECT first_name FROM profiles WHERE account_id = %s", (account_id,)).fetchone()[0] == "Kari"


def test_google_name_wins_over_the_stored_name_and_is_read_only(client, gotrue, db, created):
    body = sign_up(gotrue, created)
    account_id, token = body["user"]["id"], body["access_token"]
    client.post("/api/auth/after-sign-in", headers=bearer(token), json={"first_name": "Emma", "language": "en"})
    verify_email(db, account_id)
    seed_google(db, account_id, body["user"]["email"])

    assert client.get("/api/me", headers=bearer(token)).json()["first_name"] == "Kari"
    # The stored name is kept (an unset name only is filled), and no route edits the Google one.
    again = client.post("/api/auth/after-sign-in", headers=bearer(token), json={"first_name": "Other"})
    assert again.json()["first_name"] == "Kari"
    assert db.execute("SELECT first_name FROM profiles WHERE account_id = %s", (account_id,)).fetchone()[0] == "Emma"
    assert_error(client.patch("/api/me", headers=bearer(token), json={"first_name": "X", "language": "en"}), 422, "invalid_request")


@pytest.mark.parametrize(
    ("data", "first_name", "picture_url"),
    [
        ({"full_name": "Ola Nordmann", "picture": PICTURE}, "Ola", PICTURE),
        ({"name": "  Per  Hansen "}, "Per", None),
        ({"given_name": "Kari", "avatar_url": "javascript:alert(1)"}, "Kari", None),
        ({}, None, None),
    ],
)
def test_google_identity_data_fallbacks(client, gotrue, db, created, data, first_name, picture_url):
    body = sign_up(gotrue, created)
    account_id = body["user"]["id"]
    verify_email(db, account_id)
    seed_google(db, account_id, body["user"]["email"], data)

    me = client.get("/api/me", headers=bearer(body["access_token"])).json()

    assert (me["first_name"], me["picture_url"]) == (first_name, picture_url)


def test_email_only_account_has_no_picture(client, gotrue, created):
    body = sign_up(gotrue, created)
    me = client.get("/api/me", headers=bearer(body["access_token"])).json()
    assert me["picture_url"] is None
    assert me["notice_google_takeover"] is False


# --- The one-time notice ---


def test_notice_is_cleared_once_shown(client, gotrue, db, created, as_google):
    body = sign_up(gotrue, created)
    account_id, token = body["user"]["id"], as_google(body["access_token"])
    seed_google(db, account_id, body["user"]["email"])
    assert client.get("/api/me", headers=bearer(token)).json()["notice_google_takeover"] is True

    cleared = client.post("/api/me/notices/google-takeover", headers=bearer(token))

    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["notice_google_takeover"] is False
    assert client.get("/api/me", headers=bearer(token)).json()["notice_google_takeover"] is False
    assert takeover_row(db, account_id) == (True, False)
    # Idempotent.
    assert client.post("/api/me/notices/google-takeover", headers=bearer(token)).status_code == 200


def test_notice_clear_needs_a_session(client):
    assert_error(client.post("/api/me/notices/google-takeover"), 401, "unauthorized")


# --- Code review follow-ups (AD-19) ---


def test_a_matching_identity_without_verified_email_never_takes_over(client, gotrue, db, created, as_google):
    body = sign_up(gotrue, created)
    account_id, email = body["user"]["id"], body["user"]["email"]
    google = as_google(body["access_token"])
    seed_google(db, account_id, email, {**GOOGLE_DATA, "email_verified": False})
    old_hash = password_hash(db, account_id)

    assert client.get("/api/me", headers=bearer(google)).status_code == 200

    assert takeover_row(db, account_id) == (False, False)
    assert password_hash(db, account_id) == old_hash
    assert password_login(gotrue, email).status_code == 200
    # Same email: not foreign, so it stays linked.
    assert db.execute(
        "SELECT count(*) FROM auth.identities WHERE user_id = %s AND provider = 'google'", (account_id,)
    ).fetchone()[0] == 1


def _foreign_google(calls) -> None:
    calls.user["identities"][1]["identity_data"] = {**GOOGLE_DATA, "email": "someone-else@example.com"}


def test_without_an_account_email_nothing_is_unlinked_or_taken_over(client, db, stubbed_takeover):
    account_id, token, other, calls, _ = stubbed_takeover
    _foreign_google(calls)
    del calls.user["email"]  # and the email identity carries no identity_data either

    assert client.get("/api/me", headers=bearer(token)).status_code == 200

    assert calls == []
    assert takeover_row(db, account_id) == (False, False)
    assert session_exists(db, other)


def test_the_email_identity_supplies_a_missing_account_email(client, db, stubbed_takeover):
    account_id, token, other, calls, _ = stubbed_takeover
    email = calls.user.pop("email")
    calls.user["identities"][0]["identity_data"] = {"email": email}

    assert client.get("/api/me", headers=bearer(token)).status_code == 200

    assert [call[:2] for call in calls] == [("PUT", "/auth/v1/user")]
    assert takeover_row(db, account_id) == (True, True)


@pytest.mark.parametrize(("status", "code"), [(500, "auth_unavailable"), (401, "unauthorized"), (403, "unauthorized")])
def test_a_failed_unlink_stops_before_any_password_call(client, db, stubbed_takeover, status, code):
    account_id, token, other, calls, admin_status = stubbed_takeover
    _foreign_google(calls)
    admin_status[0] = (status, {"msg": "x"})

    assert_error(client.get("/api/me", headers=bearer(token)), 503 if status == 500 else 401, code)

    identity_id = calls.user["identities"][1]["identity_id"]
    assert [call[:2] for call in calls] == [("DELETE", f"/auth/v1/user/identities/{identity_id}")]
    assert takeover_row(db, account_id) == (False, False)
    assert session_exists(db, other)


def test_manual_linking_disabled_is_logged_as_a_configuration_error(client, stubbed_takeover, caplog):
    _, token, _, calls, admin_status = stubbed_takeover
    _foreign_google(calls)
    admin_status[0] = (404, {"error_code": "manual_linking_disabled", "msg": "x"})

    with caplog.at_level(logging.ERROR, logger="app.supabase_auth"):
        assert_error(client.get("/api/me", headers=bearer(token)), 503, "auth_unavailable")

    assert [r.getMessage() for r in caplog.records if r.levelno >= logging.ERROR] == [
        "Supabase Auth configuration error on the identity unlink: manual_linking_disabled"
    ]


def _complete_takeover(client, gotrue, db, created, as_google):
    body = sign_up(gotrue, created)
    account_id, email = body["user"]["id"], body["user"]["email"]
    first = as_google(body["access_token"])
    seed_google(db, account_id, email)
    assert client.get("/api/me", headers=bearer(first)).status_code == 200
    taken_at = db.execute("SELECT google_takeover_at FROM profiles WHERE account_id = %s", (account_id,)).fetchone()[0]
    return account_id, email, first, taken_at


def test_a_takeover_seen_as_due_again_is_not_repeated(client, settings, gotrue, db, created, as_google, monkeypatch):
    # A stale read says "due" after the takeover finished: the re-read before the password call stops it.
    account_id, email, first, taken_at = _complete_takeover(client, gotrue, db, created, as_google)
    second = as_google(fresh_session(settings, gotrue, email))
    hash_after = password_hash(db, account_id)

    async def stale(conn, account_id):
        return True, False

    monkeypatch.setattr(profiles, "google_state", stale)
    assert client.get("/api/me", headers=bearer(second)).status_code == 200

    assert password_hash(db, account_id) == hash_after
    assert client.get("/api/me", headers=bearer(first)).status_code == 200  # not ended by a second takeover
    assert db.execute(
        "SELECT google_takeover_at FROM profiles WHERE account_id = %s", (account_id,)
    ).fetchone()[0] == taken_at


def test_the_locked_recheck_loses_the_race_quietly(client, gotrue, db, stubbed_takeover, monkeypatch, caplog):
    # Both reads before the password call say "due"; the locked re-check in the transaction doesn't.
    # Stubbed Supabase Auth: real GoTrue's own password update would end the other sessions itself.
    account_id, token, _, calls, _ = stubbed_takeover
    assert client.get("/api/me", headers=bearer(token)).status_code == 200  # the takeover
    taken_at = db.execute("SELECT google_takeover_at FROM profiles WHERE account_id = %s", (account_id,)).fetchone()[0]
    second_session(gotrue, calls.user["email"])  # a later Google session of the Account
    later = db.execute(
        "SELECT id FROM auth.sessions WHERE user_id = %s AND id <> %s", (account_id, claims_of(token)["session_id"])
    ).fetchone()[0]
    real_due = profiles.takeover_due

    async def stale(conn, account_id):
        return True, False

    async def due_unless_locked(conn, account_id, lock=False):
        return await real_due(conn, account_id, lock=True) if lock else True

    monkeypatch.setattr(profiles, "google_state", stale)
    monkeypatch.setattr(profiles, "takeover_due", due_unless_locked)
    with caplog.at_level(logging.WARNING, logger="app.auth"):
        assert client.get("/api/me", headers=bearer(token)).status_code == 200

    assert "Google takeover lost a race: already recorded" in caplog.text
    assert session_exists(db, str(later))  # not ended by a second takeover
    assert db.execute(
        "SELECT google_takeover_at FROM profiles WHERE account_id = %s", (account_id,)
    ).fetchone()[0] == taken_at


def test_google_profile_prefers_the_identity_with_the_account_email():
    user = {
        "identities": [
            {"provider": "email", "identity_data": {"email": "kari@example.com"}},
            {"provider": "google", "identity_data": {"email": "other@example.com", "given_name": "Mallory"}},
            {"provider": "google", "identity_data": {"email": "KARI@example.com", "given_name": "Kari"}},
        ]
    }
    assert supabase_auth.google_profile(user, "kari@example.com").first_name == "Kari"
    assert supabase_auth.google_profile(user, "nobody@example.com").first_name == "Mallory"
    assert supabase_auth.google_profile(user).first_name == "Mallory"
