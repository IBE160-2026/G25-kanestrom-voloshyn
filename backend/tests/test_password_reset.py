"""Password reset: the request, the emailed link, and ending other sessions (Story 1.5, FR-3, AD-19).

Needs `npx supabase start` with Mailpit's SMTP port (54325) enabled in supabase/config.toml.
The link is completed here the way the SPA does it: GoTrue `POST /verify` (type recovery, the
token hash), `PUT /user` with the new password, then `POST /api/auth/after-password-reset`.
"""

import logging
import re
import time
import uuid

import httpx2
import pytest
from fastapi.testclient import TestClient

from app.main import _RedactTokens, create_app
from app.services import password_reset
from tests.test_auth import (  # noqa: F401 -- shared fixtures
    LOOP,
    PASSWORD,
    assert_error,
    bearer,
    client,
    created,
    db,
    gotrue,
    new_email,
    settings,
    sign_up,
    stub_auth,
)
from tests.test_verification import mailpit, messages_to  # noqa: F401 -- shared fixture

NEW_PASSWORD = "brand-new-pass-7"
ACCEPTED = {"status": "accepted"}

EN_SUBJECT = "Reset your Study Buddy password"
NB_SUBJECT = "Tilbakestill passordet ditt for Study Buddy"
EN_LINES = [
    "Open this link to choose a new password:",
    "The link works for 1 hour and only once.",
    "If you didn't ask for this, you can ignore this email. Your password stays the same.",
]
NB_LINES = [
    "Åpne denne lenken for å velge et nytt passord:",
    "Lenken virker i 1 time og bare én gang.",
    "Hvis du ikke ba om dette, kan du se bort fra denne e-posten. Passordet ditt er uendret.",
]


@pytest.fixture(autouse=True)
def fresh_cooldown(monkeypatch):
    """A clean cooldown table, and a clock tests can move (`clock[0] += 61`)."""
    clock = [1000.0]
    monkeypatch.setattr(password_reset, "_last_request", {})
    monkeypatch.setattr(password_reset, "_now", lambda: clock[0])
    return clock


def request_reset(client, email: str, language: str | None = None):
    """POST the request, then wait for the detached reset task, so "no email" checks are real."""
    body = {"email": email} if language is None else {"email": email, "language": language}
    response = client.post("/api/auth/password-reset", json=body)
    client.portal.call(password_reset.drain)
    return response


def assert_accepted(response) -> None:
    assert response.status_code == 202, response.text
    assert response.json() == ACCEPTED


def with_profile(client, gotrue, created, mailpit, first_name: str | None = "Emma", language: str | None = "en") -> dict:
    """An email Account with a profile (first name, language); its verification email is removed."""
    body = sign_up(gotrue, created)
    mailpit.addresses.append(body["user"]["email"])
    payload = {k: v for k, v in {"first_name": first_name, "language": language}.items() if v is not None}
    response = client.post("/api/auth/after-sign-in", headers=bearer(body["access_token"]), json=payload)
    assert response.status_code == 200, response.text
    return body


def reset_messages(mailpit, email: str, expect: int = 0, timeout: float = 3.0) -> list[dict]:
    """Reset emails sent to `email` (the sign-up verification email is left out).

    Polls until at least `expect` arrived or `timeout` seconds passed.
    """
    deadline = time.monotonic() + timeout
    while True:
        found = [m for m in messages_to(mailpit, email) if m["Subject"] in (EN_SUBJECT, NB_SUBJECT)]
        if len(found) >= expect or time.monotonic() >= deadline:
            return found
        time.sleep(0.1)


def token_hash_in(message: dict) -> str:
    match = re.search(r"http://\S+/reset-password\?token_hash=([0-9a-f]+)", message["Text"])
    assert match, message["Text"]
    return match.group(1)


def verify_recovery(gotrue, token_hash: str):
    """What supabase-js `verifyOtp({ token_hash, type: 'recovery' })` sends."""
    return gotrue.post("/verify", json={"type": "recovery", "token_hash": token_hash})


def password_login(gotrue, email: str, password: str):
    return gotrue.post("/token?grant_type=password", json={"email": email, "password": password})


def other_session(gotrue, email: str, password: str = PASSWORD) -> str:
    response = password_login(gotrue, email, password)
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def make_google_only(db, account_id: str) -> None:
    """Turn the Account's only identity into a Google one (no email identity left)."""
    db.execute(
        "UPDATE auth.identities SET provider = 'google', provider_id = %s WHERE user_id = %s",
        (f"google-{uuid.uuid4().hex}", account_id),
    )


# --- The request (matrix rows 1-5, 9) ---


@pytest.mark.parametrize(
    ("language", "subject", "greeting", "lines"),
    [("en", EN_SUBJECT, "Hi Emma,", EN_LINES), ("nb", NB_SUBJECT, "Hei Emma,", NB_LINES)],
)
def test_email_account_gets_one_reset_email_in_its_language(
    client, gotrue, created, mailpit, language, subject, greeting, lines
):
    body = with_profile(client, gotrue, created, mailpit, language=language)
    email = body["user"]["email"]

    # The request's language is the other one: the Account's saved language wins.
    assert_accepted(request_reset(client, email, "nb" if language == "en" else "en"))

    [message] = reset_messages(mailpit, email, expect=1)
    assert message["Subject"] == subject
    assert [to["Address"] for to in message["To"]] == [email]
    assert message["Text"].splitlines()[0] == greeting
    for line in lines:
        assert line in message["Text"]
    link = re.search(r"\S+/reset-password\?token_hash=\S+", message["Text"]).group(0)
    assert link.startswith(f"{client.app.state.settings.app_public_url}/reset-password?token_hash=")


def test_request_email_is_matched_case_insensitively(client, gotrue, created, mailpit):
    body = with_profile(client, gotrue, created, mailpit)
    email = body["user"]["email"]
    assert_accepted(request_reset(client, f"  {email.upper()} "))
    assert len(reset_messages(mailpit, email, expect=1)) == 1


@pytest.mark.parametrize(("language", "subject", "greeting"), [("nb", NB_SUBJECT, "Hei,"), (None, EN_SUBJECT, "Hi,")])
def test_without_a_profile_the_request_language_is_used(client, gotrue, created, mailpit, language, subject, greeting):
    # The Account never called after-sign-in: no profile, no first name, no saved language.
    body = sign_up(gotrue, created)
    email = body["user"]["email"]
    mailpit.addresses.append(email)

    assert_accepted(request_reset(client, email, language))

    [message] = reset_messages(mailpit, email, expect=1)
    assert message["Subject"] == subject
    assert message["Text"].splitlines()[0] == greeting


def test_unverified_account_gets_the_email_too(client, gotrue, db, created, mailpit):
    body = with_profile(client, gotrue, created, mailpit)
    row = db.execute("SELECT email_verified_at FROM profiles WHERE account_id = %s", (body["user"]["id"],)).fetchone()
    assert row == (None,)

    assert_accepted(request_reset(client, body["user"]["email"]))
    assert len(reset_messages(mailpit, body["user"]["email"], expect=1)) == 1


def test_unknown_email_gets_the_identical_reply_and_no_email(client, gotrue, created, mailpit):
    known = with_profile(client, gotrue, created, mailpit)["user"]["email"]
    unknown = new_email()
    mailpit.addresses.append(unknown)

    known_reply = request_reset(client, known)
    unknown_reply = request_reset(client, unknown)

    assert (unknown_reply.status_code, unknown_reply.json()) == (known_reply.status_code, known_reply.json())
    assert unknown_reply.headers["content-type"] == known_reply.headers["content-type"]
    assert unknown_reply.content == known_reply.content
    assert_accepted(unknown_reply)
    assert messages_to(mailpit, unknown) == []


def test_google_only_account_gets_the_identical_reply_and_no_email(client, gotrue, db, created, mailpit):
    body = with_profile(client, gotrue, created, mailpit)
    email, account_id = body["user"]["email"], body["user"]["id"]
    make_google_only(db, account_id)
    before = db.execute("SELECT recovery_sent_at FROM auth.users WHERE id = %s", (account_id,)).fetchone()

    assert_accepted(request_reset(client, email))

    assert reset_messages(mailpit, email) == []
    # No admin call was made either: no recovery token was created.
    after = db.execute("SELECT recovery_sent_at FROM auth.users WHERE id = %s", (account_id,)).fetchone()
    assert after == before


@pytest.mark.parametrize(
    "payload",
    [
        {"email": "not-an-email"},
        {"email": ""},
        {"email": "a b@example.com"},
        {"email": "@example.com"},
        {"email": "x" * 250 + "@example.com"},
        {},
        {"email": "emma@example.com", "language": "de"},
    ],
)
def test_malformed_request_is_invalid_request(client, payload):
    assert_error(client.post("/api/auth/password-reset", json=payload), 422, "invalid_request")


def test_smtp_down_still_answers_202_and_logs_without_the_address(settings, client, gotrue, created, mailpit, caplog):
    email = with_profile(client, gotrue, created, mailpit)["user"]["email"]
    # Nothing listens on port 1, so the send fails after the reply.
    app = create_app(settings.model_copy(update={"smtp_port": 1}))
    with caplog.at_level(logging.INFO), TestClient(app, backend_options=LOOP) as test_client:
        response = request_reset(test_client, email)
    assert_accepted(response)
    assert "Password reset email could not be sent" in caplog.text
    assert email not in caplog.text
    assert reset_messages(mailpit, email) == []


def _timeout(request):
    raise httpx2.ConnectTimeout("timed out", request=request)


@pytest.mark.parametrize(
    "handler",
    [
        lambda request: httpx2.Response(500),
        lambda request: httpx2.Response(200, text="not json"),
        lambda request: httpx2.Response(200, json={"id": "x"}),
        _timeout,
    ],
)
def test_supabase_failure_still_answers_202_and_sends_nothing(client, gotrue, created, mailpit, stub_auth, handler, caplog):
    email = with_profile(client, gotrue, created, mailpit)["user"]["email"]
    stub_auth(handler)
    with caplog.at_level(logging.INFO):
        assert_accepted(request_reset(client, email))
    assert "generate_link" in caplog.text
    assert email not in caplog.text
    assert reset_messages(mailpit, email) == []


def test_generate_link_uses_the_secret_key_and_type_recovery(client, gotrue, created, mailpit, settings, stub_auth):
    email = with_profile(client, gotrue, created, mailpit)["user"]["email"]
    seen = {}

    def handler(request):
        seen["path"] = request.url.path
        seen["headers"] = (request.headers.get("apikey"), request.headers.get("authorization"))
        seen["body"] = request.read()
        return httpx2.Response(404, json={"error_code": "user_not_found"})

    stub_auth(handler)
    assert_accepted(request_reset(client, email))
    secret = settings.supabase_secret_key.get_secret_value()
    assert seen["path"] == "/auth/v1/admin/generate_link"
    assert seen["headers"] == (secret, f"Bearer {secret}")
    assert httpx2.Response(200, content=seen["body"]).json() == {"type": "recovery", "email": email}


def test_no_token_link_or_address_in_the_app_logs(client, gotrue, created, mailpit, caplog):
    email = with_profile(client, gotrue, created, mailpit)["user"]["email"]
    with caplog.at_level(logging.DEBUG):
        assert_accepted(request_reset(client, email))
    token_hash = token_hash_in(reset_messages(mailpit, email, expect=1)[0])
    # The test client's own httpx2 request log is not the app's.
    app_logs = [r.getMessage() for r in caplog.records if not r.name.startswith("httpx")]
    assert not any(token_hash in line or email in line for line in app_logs)


@pytest.mark.parametrize(
    ("path", "secret", "redacted"),
    [
        ("/api/auth/verify?token=secret-Token_1", "secret-Token_1", "/api/auth/verify?token=[redacted]"),
        ("/reset-password?token_hash=abc123def&lang=nb", "abc123def", "/reset-password?token_hash=[redacted]&lang=nb"),
        ("/auth/callback?access_token=eyJ.abc&type=x", "eyJ.abc", "/auth/callback?access_token=[redacted]&type=x"),
        ("/auth/callback?a=1&refresh_token=r3fr", "r3fr", "/auth/callback?a=1&refresh_token=[redacted]"),
    ],
)
def test_access_log_redacts_token_parameters(path, secret, redacted):
    record = logging.LogRecord(
        "uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d', ("127.0.0.1:5000", "GET", path, "1.1", 200), None
    )
    _RedactTokens().filter(record)
    assert secret not in record.getMessage()
    assert redacted in record.getMessage()


def test_access_log_keeps_other_parameters():
    record = logging.LogRecord(
        "uvicorn.access", logging.INFO, "", 0, "%s", ("/x?tokens=keep&status=expired",), None
    )
    _RedactTokens().filter(record)
    assert record.getMessage() == "/x?tokens=keep&status=expired"


# --- The link (matrix rows 6, 8) ---


def test_full_reset_changes_the_password_and_ends_other_sessions(client, gotrue, db, created, mailpit):
    body = with_profile(client, gotrue, created, mailpit)
    email, account_id = body["user"]["email"], body["user"]["id"]
    elsewhere = other_session(gotrue, email)
    assert client.get("/api/me", headers=bearer(elsewhere)).status_code == 200

    assert_accepted(request_reset(client, email))
    token_hash = token_hash_in(reset_messages(mailpit, email, expect=1)[0])

    verified = verify_recovery(gotrue, token_hash)
    assert verified.status_code == 200, verified.text
    recovery_token = verified.json()["access_token"]
    updated = gotrue.put("/user", headers=bearer(recovery_token), json={"password": NEW_PASSWORD})
    assert updated.status_code == 200, updated.text
    done = client.post("/api/auth/after-password-reset", headers=bearer(recovery_token))
    assert done.status_code == 204, done.text

    assert password_login(gotrue, email, PASSWORD).status_code == 400
    assert password_login(gotrue, email, NEW_PASSWORD).status_code == 200
    assert_error(client.get("/api/me", headers=bearer(body["access_token"])), 401, "unauthorized")
    assert_error(client.get("/api/me", headers=bearer(elsewhere)), 401, "unauthorized")
    # The same link again is refused.
    assert verify_recovery(gotrue, token_hash).status_code == 403


def test_after_password_reset_ends_every_other_session_but_the_callers(client, gotrue, db, created):
    # On its own, without GoTrue's password change (which may also end sessions): this endpoint
    # must end them whatever Supabase does.
    body = sign_up(gotrue, created)
    email, account_id = body["user"]["email"], body["user"]["id"]
    second, third = other_session(gotrue, email), other_session(gotrue, email)
    other_account = sign_up(gotrue, created)

    response = client.post("/api/auth/after-password-reset", headers=bearer(body["access_token"]))
    assert response.status_code == 204, response.text

    assert client.get("/api/me", headers=bearer(body["access_token"])).status_code == 200
    for token in (second, third):
        assert_error(client.get("/api/me", headers=bearer(token)), 401, "unauthorized")
    assert db.execute("SELECT count(*) FROM auth.sessions WHERE user_id = %s", (account_id,)).fetchone()[0] == 1
    # Another Account's sessions are untouched.
    assert client.get("/api/me", headers=bearer(other_account["access_token"])).status_code == 200


def test_after_password_reset_needs_a_session(client):
    assert_error(client.post("/api/auth/after-password-reset"), 401, "unauthorized")


def test_newer_link_replaces_the_older_one(client, gotrue, created, mailpit, fresh_cooldown):
    email = with_profile(client, gotrue, created, mailpit)["user"]["email"]
    assert_accepted(request_reset(client, email))
    [first] = reset_messages(mailpit, email, expect=1)
    fresh_cooldown[0] += 61  # past the 60 s cooldown
    assert_accepted(request_reset(client, email))
    second = [m for m in reset_messages(mailpit, email, expect=2) if m["ID"] != first["ID"]]
    assert len(second) == 1

    assert verify_recovery(gotrue, token_hash_in(first)).status_code == 403
    assert verify_recovery(gotrue, token_hash_in(second[0])).status_code == 200


@pytest.mark.parametrize(("age", "works"), [("59 minutes", True), ("61 minutes", False)])
def test_link_works_for_one_hour(client, gotrue, db, created, mailpit, age, works):
    body = with_profile(client, gotrue, created, mailpit)
    assert_accepted(request_reset(client, body["user"]["email"]))
    token_hash = token_hash_in(reset_messages(mailpit, body["user"]["email"], expect=1)[0])
    # Supabase times the token from recovery_sent_at (otp_expiry = 3600 in config.toml).
    db.execute(
        "UPDATE auth.users SET recovery_sent_at = now() - %s::interval WHERE id = %s", (age, body["user"]["id"])
    )
    assert (verify_recovery(gotrue, token_hash).status_code == 200) is works


def test_seven_character_new_password_is_refused(client, gotrue, created, mailpit):
    body = with_profile(client, gotrue, created, mailpit)
    email = body["user"]["email"]
    assert_accepted(request_reset(client, email))
    recovery_token = verify_recovery(gotrue, token_hash_in(reset_messages(mailpit, email, expect=1)[0])).json()[
        "access_token"
    ]
    response = gotrue.put("/user", headers=bearer(recovery_token), json={"password": "seven77"})
    assert response.status_code == 422
    assert response.json()["error_code"] == "weak_password"
    assert password_login(gotrue, email, PASSWORD).status_code == 200


# --- Cooldown: at most one reset email per address every 60 s (Ihor, 2026-11-16) ---


def test_second_request_within_60_seconds_sends_nothing_more(client, gotrue, created, mailpit, fresh_cooldown):
    email = with_profile(client, gotrue, created, mailpit)["user"]["email"]
    first = request_reset(client, email)
    fresh_cooldown[0] += 59
    # The same address in other letter case counts as the same address.
    second = request_reset(client, email.upper())

    assert_accepted(first)
    assert_accepted(second)
    assert second.content == first.content
    assert len(reset_messages(mailpit, email, expect=2, timeout=1)) == 1


def test_after_60_seconds_a_new_request_sends_again(client, gotrue, created, mailpit, fresh_cooldown):
    email = with_profile(client, gotrue, created, mailpit)["user"]["email"]
    assert_accepted(request_reset(client, email))
    assert len(reset_messages(mailpit, email, expect=1)) == 1

    fresh_cooldown[0] += 60
    assert_accepted(request_reset(client, email))
    assert len(reset_messages(mailpit, email, expect=2)) == 2


def test_cooldown_keeps_no_address_and_prunes_old_entries(fresh_cooldown):
    assert password_reset._cooling_down("a@example.com") is False
    assert password_reset._cooling_down("a@example.com") is True
    assert "a@example.com" not in password_reset._last_request
    fresh_cooldown[0] += 61
    assert password_reset._cooling_down("b@example.com") is False
    assert len(password_reset._last_request) == 1  # the old entry was pruned


def test_generate_link_gets_the_lower_cased_address(client, gotrue, created, mailpit, stub_auth):
    email = with_profile(client, gotrue, created, mailpit)["user"]["email"]
    seen = {}

    def handler(request):
        seen["body"] = httpx2.Response(200, content=request.read()).json()
        return httpx2.Response(404, json={"error_code": "user_not_found"})

    stub_auth(handler)
    assert_accepted(request_reset(client, email.upper()))
    assert seen["body"] == {"type": "recovery", "email": email.lower()}


# --- Cross-checks on Supabase's answer ---


def _link_answer(account_id: str, email: str, providers: list[str]) -> dict:
    return {
        "id": account_id,
        "email": email,
        "hashed_token": "a" * 56,
        "identities": [{"provider": provider} for provider in providers],
    }


def test_link_for_another_user_id_sends_nothing(client, gotrue, created, mailpit, stub_auth):
    email = with_profile(client, gotrue, created, mailpit)["user"]["email"]
    stub_auth(lambda request: httpx2.Response(200, json=_link_answer(str(uuid.uuid4()), email, ["email"])))
    assert_accepted(request_reset(client, email))
    assert reset_messages(mailpit, email) == []


def test_link_for_a_google_only_user_sends_nothing(client, gotrue, created, mailpit, stub_auth):
    body = with_profile(client, gotrue, created, mailpit)
    email, account_id = body["user"]["email"], body["user"]["id"]
    stub_auth(lambda request: httpx2.Response(200, json=_link_answer(account_id, email, ["google"])))
    assert_accepted(request_reset(client, email))
    assert reset_messages(mailpit, email) == []


def test_an_unexpected_error_in_the_task_is_logged_by_type_only(client, gotrue, created, mailpit, monkeypatch, caplog):
    email = with_profile(client, gotrue, created, mailpit)["user"]["email"]

    async def boom(*args):
        raise RuntimeError(email)

    monkeypatch.setattr(password_reset.supabase_auth, "generate_recovery_link", boom)
    with caplog.at_level(logging.INFO):
        assert_accepted(request_reset(client, email))
    assert "Password reset failed: RuntimeError" in caplog.text
    assert email not in caplog.text
    assert reset_messages(mailpit, email) == []
