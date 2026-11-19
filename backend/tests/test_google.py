"""Google sign-in on the backend (Story 1.6, FR-19, AD-2 step 4, AD-19).

No real Google: a seeded `auth.identities` row makes an Account "have" a Google identity, and an
admin magic link stands in for signing in with Google again. Needs `npx supabase start`.
"""

import asyncio
import base64
import json
import uuid
from concurrent.futures import ThreadPoolExecutor

import httpx2
import pytest
from psycopg.types.json import Jsonb

from tests.test_auth import (  # noqa: F401 -- shared fixtures
    PASSWORD,
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

PICTURE = "https://lh3.googleusercontent.com/a/emma-photo"


def session_of(token: str) -> str:
    payload = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))["session_id"]


def password_login(gotrue, email: str, password: str = PASSWORD):
    return gotrue.post("/token?grant_type=password", json={"email": email, "password": password})


def login(gotrue, email: str) -> dict:
    response = password_login(gotrue, email)
    assert response.status_code == 200, response.text
    return response.json()


def seed_google(db, account_id: str, data: dict | None = None) -> None:
    """Link a Google identity to the Account, as Supabase's automatic linking would."""
    data = data if data is not None else {"name": "Emma Stone", "picture": PICTURE}
    db.execute(
        """
        INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
        VALUES (%s, %s, %s, 'google', now(), now(), now())
        """,
        (f"google-{uuid.uuid4().hex}", account_id, Jsonb({"sub": uuid.uuid4().hex, **data})),
    )


def session_ids(db, account_id: str) -> set[str]:
    rows = db.execute("SELECT id FROM auth.sessions WHERE user_id = %s", (account_id,)).fetchall()
    return {str(row[0]) for row in rows}


# --- Unverified email Account: the takeover ---


def google_sign_in(settings, gotrue, email: str) -> dict:
    """A fresh session for the Account, standing in for signing in with Google again (no password:
    an admin magic link, then verify)."""
    secret = settings.supabase_secret_key.get_secret_value()
    link = gotrue.post(
        "/admin/generate_link",
        headers={"apikey": secret, "Authorization": f"Bearer {secret}"},
        json={"type": "magiclink", "email": email},
    )
    assert link.status_code == 200, link.text
    verified = gotrue.post("/verify", json={"type": "magiclink", "token_hash": link.json()["hashed_token"]})
    assert verified.status_code == 200, verified.text
    return verified.json()


def takeover_row(db, account_id: str):
    return db.execute(
        "SELECT google_takeover_at, notice_google_takeover, email_verified_at, first_name FROM profiles"
        " WHERE account_id = %s",
        (account_id,),
    ).fetchone()


def test_takeover_without_after_sign_in_ends_every_session(settings, client, gotrue, db, created):
    # An unverified email Account (no profile yet: after-sign-in was never called) with another
    # password session, then a Google sign-in linked to it.
    signed_up = sign_up(gotrue, created)
    email, account_id = signed_up["user"]["email"], signed_up["user"]["id"]
    other = login(gotrue, email)
    google = login(gotrue, email)
    seed_google(db, account_id, {"given_name": "Emma", "name": "Emma Stone", "picture": PICTURE})

    assert_error(client.get("/api/me", headers=bearer(google["access_token"])), 401, "google_takeover")

    taken_at, notice, verified_at, first_name = takeover_row(db, account_id)
    assert taken_at is not None and notice is True and verified_at is not None
    assert first_name == "Emma"
    # Every session has ended, the triggering one included, and the old password no longer works.
    assert session_ids(db, account_id) == set()
    for token in (google, other, signed_up):
        assert_error(client.get("/api/me", headers=bearer(token["access_token"])), 401, "unauthorized")
    assert password_login(gotrue, email).status_code == 400

    # Signing in with Google again works and shows the notice; the takeover doesn't repeat.
    again = google_sign_in(settings, gotrue, email)
    response = client.get("/api/me", headers=bearer(again["access_token"]))
    assert response.status_code == 200, response.text
    assert response.json()["notice_google_takeover"] is True
    assert response.json()["email_verified"] is True
    assert takeover_row(db, account_id)[0] == taken_at


def test_after_sign_in_also_enforces_the_takeover_and_replaces_the_name(client, gotrue, db, created):
    signed_up = sign_up(gotrue, created)
    email, account_id = signed_up["user"]["email"], signed_up["user"]["id"]
    client.post("/api/auth/after-sign-in", headers=bearer(signed_up["access_token"]), json={"first_name": "Mallory"})
    google = login(gotrue, email)
    seed_google(db, account_id, {"name": "Emma Stone"})

    response = client.post("/api/auth/after-sign-in", headers=bearer(google["access_token"]), json={})

    assert_error(response, 401, "google_takeover")
    assert takeover_row(db, account_id)[3] == "Emma"
    assert password_login(gotrue, email).status_code == 400


def stubbed_user(account_id: str, email: str) -> dict:
    return {"id": account_id, "email": email, "identities": [{"provider": "email"}, {"provider": "google"}]}


def test_admin_failure_releases_the_claim_and_a_retry_takes_over(client, gotrue, db, created, stub_auth):
    signed_up = sign_up(gotrue, created)
    email, account_id = signed_up["user"]["email"], signed_up["user"]["id"]
    db.execute("INSERT INTO profiles (account_id) VALUES (%s)", (account_id,))
    seed_google(db, account_id)
    session_id = session_of(signed_up["access_token"])
    before = session_ids(db, account_id)
    admin = []

    def handler(request):
        if request.method == "GET" and request.url.path == "/auth/v1/user":
            return httpx2.Response(200, json=stubbed_user(account_id, email))
        admin.append(request)
        return httpx2.Response(500 if len(admin) == 1 else 200, json={"id": account_id})

    stub_auth(handler)
    assert_error(client.get("/api/me", headers=bearer(fake_token(session_id))), 503, "auth_unavailable")

    assert takeover_row(db, account_id)[:3] == (None, False, None)
    assert session_ids(db, account_id) == before
    assert password_login(gotrue, email).status_code == 200

    # The released claim lets the next request take over.
    assert_error(client.get("/api/me", headers=bearer(fake_token(session_id))), 401, "google_takeover")
    assert len(admin) == 2
    assert takeover_row(db, account_id)[0] is not None
    assert session_ids(db, account_id) == set()


def test_two_requests_at_once_take_over_once(client, gotrue, db, created, stub_auth):
    signed_up = sign_up(gotrue, created)
    email, account_id = signed_up["user"]["email"], signed_up["user"]["id"]
    db.execute("INSERT INTO profiles (account_id) VALUES (%s)", (account_id,))
    seed_google(db, account_id)
    session_id = session_of(signed_up["access_token"])
    admin_calls = []

    async def handler(request):
        if request.method == "GET" and request.url.path == "/auth/v1/user":
            return httpx2.Response(200, json=stubbed_user(account_id, email))
        assert request.method == "PUT" and request.url.path == f"/auth/v1/admin/users/{account_id}"
        admin_calls.append(request)
        await asyncio.sleep(0.3)  # long enough for the second request to reach its claim
        return httpx2.Response(200, json={"id": account_id})

    stub_auth(handler)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(client.get, "/api/me", headers=bearer(fake_token(session_id))) for _ in range(2)]
        responses = [future.result() for future in futures]

    assert len(admin_calls) == 1
    codes = ["ok" if r.status_code == 200 else r.json()["error"]["code"] for r in responses]
    assert codes.count("google_takeover") == 1, codes
    assert takeover_row(db, account_id)[1] is True


def test_no_verification_email_after_a_takeover(client, gotrue, db, created):
    signed_up = sign_up(gotrue, created)
    account_id = signed_up["user"]["id"]
    db.execute("INSERT INTO profiles (account_id, google_takeover_at) VALUES (%s, now())", (account_id,))

    response = client.post("/api/auth/after-sign-in", headers=bearer(signed_up["access_token"]), json={})

    assert response.status_code == 200, response.text
    sent = db.execute("SELECT count(*) FROM email_verifications WHERE account_id = %s", (account_id,)).fetchone()
    assert sent == (0,)


def test_notice_shows_until_seen(settings, client, gotrue, db, created):
    signed_up = sign_up(gotrue, created)
    email, account_id = signed_up["user"]["email"], signed_up["user"]["id"]
    seed_google(db, account_id)
    assert_error(client.get("/api/me", headers=bearer(signed_up["access_token"])), 401, "google_takeover")
    headers = bearer(google_sign_in(settings, gotrue, email)["access_token"])

    assert client.get("/api/me", headers=headers).json()["notice_google_takeover"] is True
    seen = client.post("/api/me/notices/google-takeover/seen", headers=headers)
    assert seen.status_code == 200, seen.text
    assert seen.json()["notice_google_takeover"] is False
    assert client.get("/api/me", headers=headers).json()["notice_google_takeover"] is False
    # Seen again is harmless.
    assert client.post("/api/me/notices/google-takeover/seen", headers=headers).status_code == 200
    assert takeover_row(db, account_id)[1] is False


def test_notice_seen_needs_a_session(client):
    assert_error(client.post("/api/me/notices/google-takeover/seen"), 401, "unauthorized")


# --- Verified email Account: linked, nothing taken over ---


def test_verified_account_is_linked_without_a_takeover(client, gotrue, db, created):
    signed_up = sign_up(gotrue, created)
    email, account_id = signed_up["user"]["email"], signed_up["user"]["id"]
    client.post("/api/auth/after-sign-in", headers=bearer(signed_up["access_token"]), json={"first_name": "Emma"})
    db.execute("UPDATE profiles SET email_verified_at = now() WHERE account_id = %s", (account_id,))
    google = login(gotrue, email)
    seed_google(db, account_id, {"given_name": "Emmeline", "picture": PICTURE})
    before = session_ids(db, account_id)

    response = client.post("/api/auth/after-sign-in", headers=bearer(google["access_token"]), json={})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["notice_google_takeover"] is False
    assert body["first_name"] == "Emma"  # an existing name is kept
    assert body["picture_url"] == PICTURE
    assert takeover_row(db, account_id)[0] is None
    assert session_ids(db, account_id) == before
    # Both sign-in methods work.
    assert password_login(gotrue, email).status_code == 200
    assert client.get("/api/me", headers=bearer(signed_up["access_token"])).status_code == 200


# --- New Google Account ---


def make_google_only(db, account_id: str, data: dict) -> None:
    """Turn the Account's only identity into a Google one, as a Google sign-up creates it."""
    db.execute(
        "UPDATE auth.identities SET provider = 'google', provider_id = %s, identity_data = %s WHERE user_id = %s",
        (f"google-{uuid.uuid4().hex}", Jsonb({"sub": uuid.uuid4().hex, **data}), account_id),
    )


@pytest.mark.parametrize(
    ("data", "first_name", "picture"),
    [
        ({"given_name": "Emma", "name": "Emma Stone", "picture": PICTURE}, "Emma", PICTURE),
        ({"name": "  Ola Nordmann ", "avatar_url": PICTURE}, "Ola", PICTURE),
        ({"full_name": "Kari Nordmann", "picture": "http://insecure.example/p.png"}, "Kari", None),
        ({}, None, None),
    ],
)
def test_new_google_account_takes_its_first_name_and_picture(client, gotrue, db, created, data, first_name, picture):
    signed_up = sign_up(gotrue, created)
    account_id = signed_up["user"]["id"]
    make_google_only(db, account_id, data)

    response = client.post("/api/auth/after-sign-in", headers=bearer(signed_up["access_token"]), json={"language": "nb"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["first_name"], body["language"], body["picture_url"]) == (first_name, "nb", picture)
    assert body["notice_google_takeover"] is False
    # Google proved the address: the email counts as verified, and no verification email is issued.
    assert body["email_verified"] is True
    sent = db.execute("SELECT count(*) FROM email_verifications WHERE account_id = %s", (account_id,)).fetchone()
    assert sent == (0,)
    # No takeover for a Google-only Account: no password set, the session goes on.
    assert takeover_row(db, account_id)[0] is None
    assert client.get("/api/me", headers=bearer(signed_up["access_token"])).status_code == 200


def test_google_created_account_is_never_taken_over_later(client, gotrue, db, created):
    signed_up = sign_up(gotrue, created)
    account_id = signed_up["user"]["id"]
    make_google_only(db, account_id, {"given_name": "Emma"})
    assert client.post("/api/auth/after-sign-in", headers=bearer(signed_up["access_token"]), json={}).status_code == 200
    # Later the Account also gets an email identity (as a linked password would give it).
    db.execute(
        """
        INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
        VALUES (%s, %s, %s, 'email', now(), now(), now())
        """,
        (account_id, account_id, Jsonb({"sub": account_id, "email": signed_up["user"]["email"]})),
    )

    response = client.get("/api/me", headers=bearer(signed_up["access_token"]))

    assert response.status_code == 200, response.text
    assert takeover_row(db, account_id)[:2] == (None, False)


def test_sign_up_name_wins_over_the_google_name(client, gotrue, db, created):
    signed_up = sign_up(gotrue, created)
    make_google_only(db, signed_up["user"]["id"], {"given_name": "Emma"})
    response = client.post(
        "/api/auth/after-sign-in", headers=bearer(signed_up["access_token"]), json={"first_name": "Em"}
    )
    assert response.json()["first_name"] == "Em"


def test_google_is_hidden_when_not_configured(client):
    assert client.get("/api/config").json()["google_enabled"] is False
