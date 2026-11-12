"""Sign-up, user_auth, after-sign-in, and /api/me against local Supabase (Story 1.3, AD-2, AD-19).

Needs `npx supabase start` and the two local keys in .env (or the environment).
"""

import asyncio
import base64
import json
import sys
import uuid
from collections.abc import Iterator

import httpx2
import psycopg
import pytest
from fastapi.testclient import TestClient

from app.api.deps import Conn
from app.config import Settings
from app.main import create_app

PASSWORD = "correct-horse-1"
# psycopg's async mode cannot use Windows' default ProactorEventLoop.
LOOP = {"loop_factory": asyncio.SelectorEventLoop} if sys.platform == "win32" else {}


@pytest.fixture(scope="module")
def settings() -> Settings:
    # Keys come from .env or the environment; URLs stay on the host defaults (not the container's).
    env = Settings()
    if not env.supabase_publishable_key or env.supabase_secret_key is None:
        pytest.fail("Set SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY from `npx supabase status`")
    return Settings(
        _env_file=None,
        llm_mode="mock",
        supabase_publishable_key=env.supabase_publishable_key,
        supabase_secret_key=env.supabase_secret_key,
    )


@pytest.fixture(scope="module")
def gotrue(settings) -> Iterator[httpx2.Client]:
    with httpx2.Client(
        base_url=f"{settings.supabase_url}/auth/v1",
        headers={"apikey": settings.supabase_publishable_key},
        timeout=10,
    ) as client:
        yield client


@pytest.fixture(scope="module")
def db(settings) -> Iterator[psycopg.Connection]:
    with psycopg.connect(settings.database_url.get_secret_value(), autocommit=True) as conn:
        yield conn


@pytest.fixture
def created(settings, gotrue) -> Iterator[list[str]]:
    """Collects account ids; deletes them through the admin API afterwards."""
    ids: list[str] = []
    yield ids
    secret = settings.supabase_secret_key.get_secret_value()
    for account_id in ids:
        gotrue.delete(f"/admin/users/{account_id}", headers={"apikey": secret, "Authorization": f"Bearer {secret}"})


@pytest.fixture
def client(settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings), backend_options=LOOP) as test_client:
        yield test_client


def new_email() -> str:
    return f"story13-{uuid.uuid4().hex[:12]}@example.com"


def sign_up(gotrue, created, email: str | None = None, password: str = PASSWORD) -> dict:
    response = gotrue.post("/signup", json={"email": email or new_email(), "password": password})
    assert response.status_code == 200, response.text
    body = response.json()
    created.append(body["user"]["id"])
    return body


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def session_id_of(db, account_id: str) -> str:
    return str(db.execute("SELECT id FROM auth.sessions WHERE user_id = %s", (account_id,)).fetchone()[0])


def assert_error(response, status: int, code: str) -> None:
    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code


# --- Supabase sign-up rules (FR-1) ---


def test_seven_character_password_sign_up_fails(gotrue, db):
    email = new_email()
    response = gotrue.post("/signup", json={"email": email, "password": "seven77"})
    assert response.status_code == 422
    assert response.json()["error_code"] == "weak_password"
    assert db.execute("SELECT count(*) FROM auth.users WHERE email = %s", (email,)).fetchone()[0] == 0


def test_duplicate_email_creates_no_second_account(gotrue, db, created):
    email = new_email()
    sign_up(gotrue, created, email)
    response = gotrue.post("/signup", json={"email": email, "password": "another-pass-2"})
    assert response.status_code == 422
    assert response.json()["error_code"] == "user_already_exists"
    assert db.execute("SELECT count(*) FROM auth.users WHERE email = %s", (email,)).fetchone()[0] == 1


# --- after-sign-in and /api/me ---


def test_happy_sign_up_creates_profile_with_name_and_language(client, gotrue, db, created):
    body = sign_up(gotrue, created)
    token, account_id = body["access_token"], body["user"]["id"]

    response = client.post(
        "/api/auth/after-sign-in", headers=bearer(token), json={"first_name": "  Emma ", "language": "nb"}
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"first_name": "Emma", "language": "nb", "email_verified": False}

    assert client.get("/api/me", headers=bearer(token)).json() == {
        "first_name": "Emma",
        "language": "nb",
        "email_verified": False,
    }
    row = db.execute(
        "SELECT first_name, language, ui_prefs, notice_google_takeover FROM profiles WHERE account_id = %s",
        (account_id,),
    ).fetchone()
    assert row == ("Emma", "nb", {}, False)


def test_after_sign_in_twice_leaves_profile_unchanged(client, gotrue, created):
    token = sign_up(gotrue, created)["access_token"]
    first = client.post("/api/auth/after-sign-in", headers=bearer(token), json={"first_name": "Emma", "language": "en"})
    assert first.status_code == 200
    again = client.post("/api/auth/after-sign-in", headers=bearer(token), json={"first_name": "Other", "language": "nb"})
    assert again.status_code == 200
    assert again.json() == first.json() == {"first_name": "Emma", "language": "en", "email_verified": False}


@pytest.mark.parametrize("payload", [{}, {"language": "nb"}])
def test_later_after_sign_in_without_name_leaves_profile_unchanged(client, gotrue, created, payload):
    token = sign_up(gotrue, created)["access_token"]
    first = client.post("/api/auth/after-sign-in", headers=bearer(token), json={"first_name": "Emma", "language": "en"})
    again = client.post("/api/auth/after-sign-in", headers=bearer(token), json=payload)
    assert again.status_code == 200, again.text
    assert again.json() == first.json() == {"first_name": "Emma", "language": "en", "email_verified": False}


def test_after_sign_in_without_token_is_unauthorized(client):
    response = client.post("/api/auth/after-sign-in", json={"first_name": "Emma", "language": "en"})
    assert_error(response, 401, "unauthorized")


def test_data_api_cannot_read_profiles(client, settings, gotrue, created):
    # AD-1: the browser's Supabase keys never reach app data; profiles is only read through FastAPI.
    token = sign_up(gotrue, created)["access_token"]
    client.post("/api/auth/after-sign-in", headers=bearer(token), json={"first_name": "Emma", "language": "en"})
    response = httpx2.get(
        f"{settings.supabase_url}/rest/v1/profiles",
        headers={"apikey": settings.supabase_publishable_key, **bearer(token)},
        timeout=10,
    )
    assert response.status_code in (401, 403, 404) or response.json() == [], response.text


def test_me_creates_profile_without_after_sign_in(client, gotrue, db, created):
    body = sign_up(gotrue, created)
    response = client.get("/api/me", headers=bearer(body["access_token"]))
    assert response.json() == {"first_name": None, "language": None, "email_verified": False}
    count = db.execute("SELECT count(*) FROM profiles WHERE account_id = %s", (body["user"]["id"],))
    assert count.fetchone()[0] == 1


@pytest.mark.parametrize(
    "payload",
    [
        {"first_name": "   ", "language": "en"},
        {"first_name": "", "language": "en"},
        {"first_name": "x" * 101, "language": "en"},
        {"first_name": "Emma", "language": "de"},
    ],
)
def test_after_sign_in_refuses_invalid_body(client, gotrue, db, created, payload):
    body = sign_up(gotrue, created)
    response = client.post("/api/auth/after-sign-in", headers=bearer(body["access_token"]), json=payload)
    assert_error(response, 422, "invalid_request")
    row = db.execute("SELECT count(*) FROM profiles WHERE account_id = %s", (body["user"]["id"],)).fetchone()
    assert row[0] == 0  # the request's transaction rolled back


# --- user_auth (AD-2 steps 1-3) ---


@pytest.mark.parametrize(
    "headers",
    [{}, {"Authorization": "Bearer"}, {"Authorization": "Basic abc"}, {"Authorization": "Bearer not-a-token"}],
)
def test_me_without_valid_bearer_is_unauthorized(client, headers):
    assert_error(client.get("/api/me", headers=headers), 401, "unauthorized")


def test_me_after_session_row_deleted_is_unauthorized(client, gotrue, db, created):
    body = sign_up(gotrue, created)
    db.execute("DELETE FROM auth.sessions WHERE user_id = %s", (body["user"]["id"],))
    assert_error(client.get("/api/me", headers=bearer(body["access_token"])), 401, "unauthorized")


def test_me_with_session_older_than_30_days_is_expired(client, gotrue, db, created):
    body = sign_up(gotrue, created)
    db.execute("UPDATE auth.sessions SET created_at = now() - interval '31 days' WHERE user_id = %s", (body["user"]["id"],))
    assert_error(client.get("/api/me", headers=bearer(body["access_token"])), 401, "session_expired")


def test_session_just_inside_max_age_still_works(client, gotrue, db, created):
    body = sign_up(gotrue, created)
    db.execute("UPDATE auth.sessions SET created_at = now() - interval '29 days' WHERE user_id = %s", (body["user"]["id"],))
    assert client.get("/api/me", headers=bearer(body["access_token"])).status_code == 200


# --- user_auth with a stubbed Supabase Auth: step 2 on its own, and outages ---


def fake_token(session_id: str) -> str:
    def part(obj):
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()

    return f"{part({'alg': 'none'})}.{part({'session_id': session_id})}.sig"


@pytest.fixture
def stub_auth(client) -> Iterator:
    """Replace Supabase Auth with a handler. The replaced lifespan client and the stub are both closed."""
    stubs: list[httpx2.AsyncClient] = []

    def install(handler) -> None:
        client.portal.call(client.app.state.http.aclose)
        stub = httpx2.AsyncClient(base_url="http://supabase.test", transport=httpx2.MockTransport(handler))
        stubs.append(stub)
        client.app.state.http = stub

    yield install
    for stub in stubs:
        client.portal.call(stub.aclose)


def test_step_two_refuses_a_session_supabase_still_accepts(client, gotrue, db, created, stub_auth):
    body = sign_up(gotrue, created)
    account_id = body["user"]["id"]
    stub_auth(lambda request: httpx2.Response(200, json={"id": account_id}))

    # A session id that never existed, for a user Supabase reports as valid.
    assert_error(client.get("/api/me", headers=bearer(fake_token(str(uuid.uuid4())))), 401, "unauthorized")
    # The real session id passes.
    assert client.get("/api/me", headers=bearer(fake_token(session_id_of(db, account_id)))).status_code == 200


def test_session_with_null_created_at_is_expired(client, gotrue, db, created, stub_auth):
    # Real Supabase Auth answers 500 for such a row, so the token check is stubbed here.
    account_id = sign_up(gotrue, created)["user"]["id"]
    session_id = session_id_of(db, account_id)
    db.execute("UPDATE auth.sessions SET created_at = NULL WHERE id = %s", (session_id,))
    stub_auth(lambda request: httpx2.Response(200, json={"id": account_id}))
    assert_error(client.get("/api/me", headers=bearer(fake_token(session_id))), 401, "session_expired")


def test_token_without_session_claim_is_unauthorized(client, gotrue, created, stub_auth):
    account_id = sign_up(gotrue, created)["user"]["id"]
    stub_auth(lambda request: httpx2.Response(200, json={"id": account_id}))
    assert_error(client.get("/api/me", headers=bearer("a.b.c")), 401, "unauthorized")


def _timeout(request):
    raise httpx2.ConnectTimeout("timed out", request=request)


def _connect_error(request):
    raise httpx2.ConnectError("refused", request=request)


@pytest.mark.parametrize(
    "handler",
    [
        _timeout,
        _connect_error,
        lambda request: httpx2.Response(500),
        lambda request: httpx2.Response(503),
        lambda request: httpx2.Response(200, text="not json"),
        lambda request: httpx2.Response(200, json={}),
        lambda request: httpx2.Response(200, json=[]),
    ],
)
def test_supabase_auth_outage_is_auth_unavailable(client, handler, stub_auth):
    stub_auth(handler)
    assert_error(client.get("/api/me", headers=bearer(fake_token(str(uuid.uuid4())))), 503, "auth_unavailable")


@pytest.mark.parametrize("status", [401, 403])
def test_supabase_auth_refusal_is_unauthorized(client, status, stub_auth):
    stub_auth(lambda request: httpx2.Response(status, json={"msg": "bad"}))
    assert_error(client.get("/api/me", headers=bearer(fake_token(str(uuid.uuid4())))), 401, "unauthorized")


def test_commit_failure_is_an_error_response(settings):
    # The request transaction must end before the response starts (AD-18). A deferred constraint
    # fails only at COMMIT, so a request-scoped dependency would already have sent 200.
    app = create_app(settings)

    @app.post("/_test/commit-fails")
    async def commit_fails(conn: Conn):
        await conn.execute("CREATE TEMP TABLE t (id int PRIMARY KEY DEFERRABLE INITIALLY DEFERRED) ON COMMIT DROP")
        await conn.execute("INSERT INTO t VALUES (1), (1)")
        return {"ok": True}

    with TestClient(app, backend_options=LOOP, raise_server_exceptions=False) as test_client:
        response = test_client.post("/_test/commit-fails")
    assert_error(response, 500, "internal_error")


def test_unreachable_supabase_is_auth_unavailable(settings):
    app = create_app(settings.model_copy(update={"supabase_url": "http://127.0.0.1:1"}))
    with TestClient(app, backend_options=LOOP) as test_client:
        response = test_client.get("/api/me", headers=bearer(fake_token(str(uuid.uuid4()))))
    assert_error(response, 503, "auth_unavailable")


def test_token_check_sends_publishable_key_and_bearer(client, settings, stub_auth):
    seen = {}

    def handler(request):
        seen["path"] = request.url.path
        seen["apikey"] = request.headers.get("apikey")
        seen["authorization"] = request.headers.get("authorization")
        return httpx2.Response(401)

    stub_auth(handler)
    token = fake_token(str(uuid.uuid4()))
    client.get("/api/me", headers=bearer(token))
    assert seen == {"path": "/auth/v1/user", "apikey": settings.supabase_publishable_key, "authorization": f"Bearer {token}"}
