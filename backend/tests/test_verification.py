"""Email verification: the first email after sign-up and the verify link (Story 1.3 part 2, FR-1, AD-19).

Needs `npx supabase start` with Mailpit's SMTP port (54325) enabled in supabase/config.toml.
Emails are read through the Mailpit API and deleted afterwards.
"""

import ast
import asyncio
import hashlib
import logging
import re
import time
import uuid
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import urlsplit

import httpx2
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.main import create_app
from app.services import verification
from tests.test_auth import (  # noqa: F401 -- shared fixtures
    LOOP,
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

MAILPIT = "http://127.0.0.1:54324/api/v1"
APP_DIR = Path(__file__).resolve().parents[1] / "app"

EN_SUBJECT = "Confirm your email for Study Buddy"
NB_SUBJECT = "Bekreft e-postadressen din for Study Buddy"


@pytest.fixture
def mailpit() -> Iterator[httpx2.Client]:
    """The Mailpit API. Deletes every message sent to the test's addresses afterwards."""
    with httpx2.Client(base_url=MAILPIT, timeout=10) as api:
        api.addresses = []
        yield api
        for address in api.addresses:
            ids = [m["ID"] for m in _search(api, address)]
            if ids:
                api.request("DELETE", "/messages", json={"IDs": ids})


def _search(api: httpx2.Client, address: str) -> list[dict]:
    response = api.get("/search", params={"query": f'to:"{address}"'})
    assert response.status_code == 200, response.text
    return response.json()["messages"]


def messages_to(mailpit, address: str, expect: int = 0, timeout: float = 3.0) -> list[dict]:
    """Full messages (subject, text body, recipients) sent to `address`.

    Polls the search until at least `expect` messages arrived or `timeout` seconds passed.
    """
    deadline = time.monotonic() + timeout
    found = _search(mailpit, address)
    while len(found) < expect and time.monotonic() < deadline:
        time.sleep(0.1)
        found = _search(mailpit, address)
    return [mailpit.get(f"/message/{m['ID']}").json() for m in found]


def sign_up_and_greet(client, gotrue, created, mailpit, language: str = "en", first_name: str = "Emma") -> dict:
    """Sign up through GoTrue and make the SPA's first `after-sign-in` call."""
    body = sign_up(gotrue, created)
    mailpit.addresses.append(body["user"]["email"])
    response = client.post(
        "/api/auth/after-sign-in",
        headers=bearer(body["access_token"]),
        json={"first_name": first_name, "language": language},
    )
    assert response.status_code == 200, response.text
    return body


def link_in(message: dict) -> str:
    match = re.search(r"http://\S+/api/auth/verify\?token=[A-Za-z0-9_-]+", message["Text"])
    assert match, message["Text"]
    return match.group(0)


def open_link(client, link: str):
    """Open the link's path on the test app, without following the redirect."""
    parts = urlsplit(link)
    return client.get(f"{parts.path}?{parts.query}", follow_redirects=False)


def verified_at(db, account_id: str):
    return db.execute("SELECT email_verified_at FROM profiles WHERE account_id = %s", (account_id,)).fetchone()[0]


def token_count(db, account_id: str) -> int:
    return db.execute("SELECT count(*) FROM email_verifications WHERE account_id = %s", (account_id,)).fetchone()[0]


def issue_new_token(client, account_id: str) -> str:
    """Issue a newer token in its own committed transaction, as Story 7.3's resend will."""

    async def run() -> str:
        async with client.app.state.pool.connection() as conn:
            async with conn.transaction():
                return await verification.issue(conn, uuid.UUID(account_id))

    return client.portal.call(run)


# --- The first email (matrix rows 1-4) ---


@pytest.mark.parametrize(
    ("language", "subject", "lines"),
    [
        (
            "nb",
            NB_SUBJECT,
            [
                "Hei Emma,",
                "Bekreft e-postadressen din ved å åpne denne lenken:",
                "Lenken virker i 24 timer. Du kan bruke Study Buddy uten å bekrefte; "
                "du trenger det bare for å koble til en Google-konto.",
                "Hvis du ikke har opprettet en konto, kan du se bort fra denne e-posten.",
            ],
        ),
        (
            "en",
            EN_SUBJECT,
            [
                "Hi Emma,",
                "Confirm your email address by opening this link:",
                "The link works for 24 hours. You can use Study Buddy without confirming; "
                "you only need it to link a Google account.",
                "If you didn't create an account, you can ignore this email.",
            ],
        ),
    ],
)
def test_sign_up_sends_one_email_in_the_chosen_language(client, gotrue, db, created, mailpit, language, subject, lines):
    body = sign_up_and_greet(client, gotrue, created, mailpit, language=language)
    email, account_id = body["user"]["email"], body["user"]["id"]

    [message] = messages_to(mailpit, email, expect=1)
    assert message["Subject"] == subject
    assert [to["Address"] for to in message["To"]] == [email]
    assert message["From"]["Address"] == "no-reply@studybuddy.local"
    for line in lines:
        assert line in message["Text"]

    link = link_in(message)
    assert link.startswith(f"{client.app.state.settings.app_public_url}/api/auth/verify?token=")
    # The link works.
    response = open_link(client, link)
    assert response.status_code == 303
    assert response.headers["location"] == "/email-verified"
    assert verified_at(db, account_id) is not None


def test_repeated_after_sign_in_sends_nothing_more(client, gotrue, db, created, mailpit):
    body = sign_up_and_greet(client, gotrue, created, mailpit)
    again = client.post("/api/auth/after-sign-in", headers=bearer(body["access_token"]), json={})
    assert again.status_code == 200
    assert len(messages_to(mailpit, body["user"]["email"], expect=2, timeout=1)) == 1
    assert token_count(db, body["user"]["id"]) == 1


def test_smtp_down_answers_200_and_the_next_sign_in_sends_a_fresh_link(
    settings, client, gotrue, db, created, mailpit, caplog
):
    # Nothing listens on port 1, so the send fails after the commit.
    app = create_app(settings.model_copy(update={"smtp_port": 1}))
    body = sign_up(gotrue, created)
    email, account_id = body["user"]["email"], body["user"]["id"]
    mailpit.addresses.append(email)
    with caplog.at_level(logging.INFO), TestClient(app, backend_options=LOOP) as test_client:
        response = test_client.post(
            "/api/auth/after-sign-in", headers=bearer(body["access_token"]), json={"first_name": "Emma", "language": "en"}
        )
    assert response.status_code == 200, response.text
    assert response.json()["first_name"] == "Emma"
    assert "Verification email could not be sent" in caplog.text
    assert email not in caplog.text
    assert messages_to(mailpit, email) == []
    # The unsent token was invalidated in its own transaction.
    live = db.execute(
        "SELECT count(*) FROM email_verifications WHERE account_id = %s AND invalidated_at IS NULL", (account_id,)
    ).fetchone()[0]
    assert (token_count(db, account_id), live) == (1, 0)

    # The next sign-in, with Mailpit up, sends exactly one fresh, working link.
    again = client.post("/api/auth/after-sign-in", headers=bearer(body["access_token"]), json={})
    assert again.status_code == 200
    [message] = messages_to(mailpit, email, expect=1)
    assert open_link(client, link_in(message)).headers["location"] == "/email-verified"
    assert verified_at(db, account_id) is not None


def test_no_first_email_without_an_email_identity(client, gotrue, db, created, mailpit, stub_auth):
    body = sign_up(gotrue, created)
    email, account_id = body["user"]["email"], body["user"]["id"]
    mailpit.addresses.append(email)
    # Supabase reports a user with only a Google identity.
    stub_auth(
        lambda request: httpx2.Response(
            200, json={"id": account_id, "email": email, "identities": [{"provider": "google"}]}
        )
    )
    token = fake_token(session_id_of(db, account_id))
    response = client.post("/api/auth/after-sign-in", headers=bearer(token), json={"language": "en"})
    assert response.status_code == 200, response.text
    assert messages_to(mailpit, email) == []
    assert token_count(db, account_id) == 0


def test_no_first_email_when_already_verified(client, gotrue, db, created, mailpit):
    body = sign_up(gotrue, created)
    email, account_id = body["user"]["email"], body["user"]["id"]
    mailpit.addresses.append(email)
    client.get("/api/me", headers=bearer(body["access_token"]))  # creates the profile
    db.execute("UPDATE profiles SET email_verified_at = now() WHERE account_id = %s", (account_id,))
    client.post("/api/auth/after-sign-in", headers=bearer(body["access_token"]), json={"first_name": "Emma"})
    assert messages_to(mailpit, email) == []
    assert token_count(db, account_id) == 0


# --- The verify link (matrix rows 5-9) ---


def test_valid_link_verifies_and_stores_only_a_hash(client, gotrue, db, created, mailpit, caplog):
    body = sign_up_and_greet(client, gotrue, created, mailpit)
    account_id = body["user"]["id"]
    link = link_in(messages_to(mailpit, body["user"]["email"], expect=1)[0])
    token = link.split("token=", 1)[1]

    stored = db.execute("SELECT token_hash FROM email_verifications WHERE account_id = %s", (account_id,)).fetchone()[0]
    assert stored == hashlib.sha256(token.encode()).hexdigest()
    assert len(token) >= 43  # 32 random bytes, URL-safe

    with caplog.at_level(logging.DEBUG):
        response = open_link(client, link)
    assert response.status_code == 303
    assert response.headers["location"] == "/email-verified"
    # The test client's own httpx2 request log is not the app's.
    app_logs = [r.getMessage() for r in caplog.records if not r.name.startswith("httpx")]
    assert not any(token in line for line in app_logs)
    assert client.get("/api/me", headers=bearer(body["access_token"])).json()["email_verified"] is True


def test_used_link_of_a_verified_account_shows_success(client, gotrue, db, created, mailpit):
    # A second click, or a mail scanner that opened the link first.
    body = sign_up_and_greet(client, gotrue, created, mailpit)
    account_id = body["user"]["id"]
    link = link_in(messages_to(mailpit, body["user"]["email"], expect=1)[0])
    assert open_link(client, link).headers["location"] == "/email-verified"
    first = verified_at(db, account_id)

    again = open_link(client, link)
    assert again.status_code == 303
    assert again.headers["location"] == "/email-verified"
    assert verified_at(db, account_id) == first


def test_used_link_of_an_unverified_account_is_expired(client, gotrue, db, created, mailpit):
    body = sign_up_and_greet(client, gotrue, created, mailpit)
    account_id = body["user"]["id"]
    link = link_in(messages_to(mailpit, body["user"]["email"], expect=1)[0])
    assert open_link(client, link).headers["location"] == "/email-verified"
    db.execute("UPDATE profiles SET email_verified_at = NULL WHERE account_id = %s", (account_id,))

    again = open_link(client, link)
    assert again.status_code == 303
    assert again.headers["location"] == "/email-verified?status=expired"
    assert verified_at(db, account_id) is None


def test_expired_link_does_not_verify(client, gotrue, db, created, mailpit):
    body = sign_up_and_greet(client, gotrue, created, mailpit)
    account_id = body["user"]["id"]
    link = link_in(messages_to(mailpit, body["user"]["email"], expect=1)[0])
    db.execute(
        "UPDATE email_verifications SET expires_at = now() - interval '1 second' WHERE account_id = %s", (account_id,)
    )
    response = open_link(client, link)
    assert response.status_code == 303
    assert response.headers["location"] == "/email-verified?status=expired"
    assert verified_at(db, account_id) is None


def test_link_expires_24_hours_after_issue(client, gotrue, db, created, mailpit):
    body = sign_up_and_greet(client, gotrue, created, mailpit)
    lifetime = db.execute(
        "SELECT expires_at - created_at FROM email_verifications WHERE account_id = %s", (body["user"]["id"],)
    ).fetchone()[0]
    assert lifetime.total_seconds() == pytest.approx(24 * 3600, abs=1)


def test_replaced_link_is_expired_and_the_newest_works(client, gotrue, db, created, mailpit):
    body = sign_up_and_greet(client, gotrue, created, mailpit)
    account_id = body["user"]["id"]
    old_link = link_in(messages_to(mailpit, body["user"]["email"], expect=1)[0])
    new_token = issue_new_token(client, account_id)

    assert open_link(client, old_link).headers["location"] == "/email-verified?status=expired"
    assert verified_at(db, account_id) is None
    response = client.get("/api/auth/verify", params={"token": new_token}, follow_redirects=False)
    assert response.headers["location"] == "/email-verified"
    assert verified_at(db, account_id) is not None


@pytest.mark.parametrize(
    "query",
    ["", "?token=", "?token=abc", "?token=" + "x" * 43, "?token=" + "y" * 5000, "?token=%00%ff%2F", "?other=1"],
)
def test_garbage_token_is_expired_not_an_error(client, query):
    response = client.get(f"/api/auth/verify{query}", follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"] == "/email-verified?status=expired"


def test_verify_needs_no_bearer_token(client, gotrue, created, mailpit):
    body = sign_up_and_greet(client, gotrue, created, mailpit)
    link = link_in(messages_to(mailpit, body["user"]["email"], expect=1)[0])
    # A bad bearer is ignored: the link itself is the credential.
    parts = urlsplit(link)
    response = client.get(
        f"{parts.path}?{parts.query}", headers={"Authorization": "Bearer nonsense"}, follow_redirects=False
    )
    assert response.headers["location"] == "/email-verified"


def test_data_api_cannot_read_email_verifications(client, settings, gotrue, created, mailpit):
    body = sign_up_and_greet(client, gotrue, created, mailpit)
    response = httpx2.get(
        f"{settings.supabase_url}/rest/v1/email_verifications",
        headers={"apikey": settings.supabase_publishable_key, **bearer(body["access_token"])},
        timeout=10,
    )
    # Permission denied (RLS on, grants revoked), not an empty list.
    assert response.status_code in (401, 403), response.text
    assert response.json()["code"] == "42501"


# --- Source rules (acceptance criterion 2) ---


def test_only_the_mailer_imports_aiosmtplib():
    offenders = []
    for path in APP_DIR.rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            names = (
                [alias.name for alias in node.names]
                if isinstance(node, ast.Import)
                else [node.module or ""]
                if isinstance(node, ast.ImportFrom) and node.level == 0
                else []
            )
            if any(name.split(".")[0] == "aiosmtplib" for name in names):
                offenders.append(str(path.relative_to(APP_DIR)))
    assert offenders == ["mailer.py"]


def test_access_log_redacts_the_token():
    from app.main import _RedactTokens

    record = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        "",
        0,
        '%s - "%s %s HTTP/%s" %d',
        ("127.0.0.1:5000", "GET", "/api/auth/verify?token=secret-Token_1", "1.1", 303),
        None,
    )
    _RedactTokens().filter(record)
    assert "secret-Token_1" not in record.getMessage()
    assert "/api/auth/verify?token=[redacted]" in record.getMessage()


def test_access_log_filter_is_attached_by_the_lifespan(settings):
    from app.main import _RedactTokens

    access = logging.getLogger("uvicorn.access")
    for existing in [f for f in access.filters if isinstance(f, _RedactTokens)]:
        access.removeFilter(existing)
    with TestClient(create_app(settings), backend_options=LOOP):
        assert any(isinstance(f, _RedactTokens) for f in access.filters)


# --- Language and greeting ---


def test_profile_language_wins_over_the_request(client, gotrue, db, created, mailpit):
    body = sign_up(gotrue, created)
    email, account_id = body["user"]["email"], body["user"]["id"]
    mailpit.addresses.append(email)
    client.get("/api/me", headers=bearer(body["access_token"]))  # creates the profile
    db.execute("UPDATE profiles SET language = 'nb' WHERE account_id = %s", (account_id,))
    client.post(
        "/api/auth/after-sign-in", headers=bearer(body["access_token"]), json={"first_name": "Emma", "language": "en"}
    )
    [message] = messages_to(mailpit, email, expect=1)
    assert message["Subject"] == NB_SUBJECT


def test_no_language_at_all_sends_english(client, gotrue, created, mailpit):
    body = sign_up(gotrue, created)
    mailpit.addresses.append(body["user"]["email"])
    client.post("/api/auth/after-sign-in", headers=bearer(body["access_token"]), json={"first_name": "Emma"})
    [message] = messages_to(mailpit, body["user"]["email"], expect=1)
    assert message["Subject"] == EN_SUBJECT


@pytest.mark.parametrize(("language", "greeting"), [("en", "Hi,"), ("nb", "Hei,")])
def test_no_name_greeting(client, gotrue, created, mailpit, language, greeting):
    body = sign_up(gotrue, created)
    mailpit.addresses.append(body["user"]["email"])
    client.post("/api/auth/after-sign-in", headers=bearer(body["access_token"]), json={"language": language})
    [message] = messages_to(mailpit, body["user"]["email"], expect=1)
    assert message["Text"].splitlines()[0] == greeting


# --- SMTP settings onto aiosmtplib (mocked) ---


@pytest.fixture
def fake_smtp(monkeypatch):
    from unittest.mock import AsyncMock

    from app import mailer

    fake = AsyncMock()
    monkeypatch.setattr(mailer.aiosmtplib, "send", fake)
    return fake


def run_send(settings) -> None:
    from app import mailer

    asyncio.run(mailer.send(settings, "to@example.com", "Subject", "Body"), **LOOP)


@pytest.mark.parametrize(
    ("tls", "use_tls", "start_tls"), [("none", False, False), ("starttls", False, True), ("tls", True, False)]
)
def test_smtp_settings_map_onto_aiosmtplib(settings, fake_smtp, tls, use_tls, start_tls):
    run_send(
        settings.model_copy(
            update={
                "smtp_host": "smtp.example.test",
                "smtp_port": 2525,
                "smtp_tls": tls,
                "smtp_username": "mailer-user",
                "smtp_password": SecretStr("mailer-pass"),
            }
        )
    )
    kwargs = fake_smtp.await_args.kwargs
    assert (kwargs["hostname"], kwargs["port"]) == ("smtp.example.test", 2525)
    assert (kwargs["use_tls"], kwargs["start_tls"]) == (use_tls, start_tls)
    assert (kwargs["username"], kwargs["password"]) == ("mailer-user", "mailer-pass")
    message = fake_smtp.await_args.args[0]
    assert message["To"] == "to@example.com"
    assert message["From"] == "Study Buddy <no-reply@studybuddy.local>"


def test_no_smtp_credentials_by_default(settings, fake_smtp):
    run_send(settings)
    kwargs = fake_smtp.await_args.kwargs
    assert (kwargs["username"], kwargs["password"], kwargs["use_tls"], kwargs["start_tls"]) == (None, None, False, False)
