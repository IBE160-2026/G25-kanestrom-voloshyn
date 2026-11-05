"""Routing and error envelope (AD-17, spine: API shape)."""

import asyncio
import sys
import time

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def make_settings(**overrides) -> Settings:
    values = {
        "llm_mode": "mock",
        "supabase_url": "http://host.docker.internal:54321",
        "supabase_public_url": "http://127.0.0.1:54321",
        "supabase_publishable_key": "sb_publishable_test",
        "supabase_secret_key": "sb_secret_test",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def test_config_shape_uses_public_url():
    # No lifespan here: these routes need no database.
    client = TestClient(create_app(make_settings()))
    response = client.get("/api/config")
    assert response.status_code == 200
    assert response.json() == {
        "supabase_url": "http://127.0.0.1:54321",
        "supabase_publishable_key": "sb_publishable_test",
        "google_enabled": False,
    }


@pytest.mark.parametrize(
    ("enabled", "client_id", "secret", "expected"),
    [
        (True, "id", "secret", True),
        (True, "id", None, False),
        (True, "", "secret", False),
        (False, "id", "secret", False),
    ],
)
def test_google_enabled_needs_switch_and_both_values(enabled, client_id, secret, expected):
    settings = make_settings(
        supabase_auth_external_google_enabled=enabled,
        supabase_auth_external_google_client_id=client_id,
        supabase_auth_external_google_secret=secret,
    )
    assert TestClient(create_app(settings)).get("/api/config").json()["google_enabled"] is expected


@pytest.mark.parametrize("method", ["GET", "POST", "PUT", "PATCH", "DELETE"])
@pytest.mark.parametrize("path", ["/api/nope", "/api/nope/deeper", "/api"])
def test_unknown_api_path_returns_json_404(method, path):
    client = TestClient(create_app(make_settings()))
    response = client.request(method, path)
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")
    body = response.json()
    assert body["error"]["code"] == "not_found"
    assert body["error"]["params"] == {}
    assert isinstance(body["error"]["message"], str)


def test_spa_deep_link_returns_index_html(tmp_path):
    (tmp_path / "index.html").write_text("<!doctype html><title>spa</title>", encoding="utf-8")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
    client = TestClient(create_app(make_settings(frontend_dist=tmp_path)))

    # Browsers send Accept: text/html on navigation; app.frontend falls back only for those.
    html = {"accept": "text/html,application/xhtml+xml,*/*;q=0.8"}
    deep = client.get("/projects/x", headers=html)
    assert deep.status_code == 200
    assert "<title>spa</title>" in deep.text
    assert client.get("/u/some-token", headers=html).status_code == 200
    assert client.get("/").status_code == 200
    # A missing asset is a 404, not index.html.
    assert client.get("/assets/missing.js").status_code == 404
    assert client.get("/assets/app.js").text == "console.log(1)"
    # The SPA fallback never swallows API paths.
    assert client.get("/api/nope").json()["error"]["code"] == "not_found"
    assert client.get("/api/config").status_code == 200


def test_no_spa_served_when_dist_is_missing(tmp_path):
    client = TestClient(create_app(make_settings(frontend_dist=tmp_path / "missing")))
    assert client.get("/projects/x", headers={"accept": "text/html"}).status_code == 404
    assert client.get("/api/config").status_code == 200


def assert_envelope(response, status: int, code: str) -> dict:
    assert response.status_code == status
    assert response.headers["content-type"].startswith("application/json")
    error = response.json()["error"]
    assert error["code"] == code
    assert isinstance(error["params"], dict)
    assert isinstance(error["message"], str)
    return error


def test_non_api_404_uses_envelope(tmp_path):
    (tmp_path / "index.html").write_text("<!doctype html>", encoding="utf-8")
    client = TestClient(create_app(make_settings(frontend_dist=tmp_path)))
    error = assert_envelope(client.get("/assets/missing.js"), 404, "not_found")
    assert error["params"] == {}


def test_validation_failure_uses_envelope():
    app = create_app(make_settings())

    @app.get("/_test/typed")
    async def typed(n: int):
        return {"n": n}

    error = assert_envelope(TestClient(app).get("/_test/typed?n=abc"), 422, "invalid_request")
    assert error["params"]["fields"] == ["query.n"]


def test_unhandled_error_uses_envelope():
    app = create_app(make_settings())

    @app.get("/_test/boom")
    async def boom():
        raise RuntimeError("boom")

    client = TestClient(app, raise_server_exceptions=False)
    error = assert_envelope(client.get("/_test/boom"), 500, "internal_error")
    assert error["params"] == {}


def test_docs_live_under_api():
    client = TestClient(create_app(make_settings()))
    assert client.get("/api/docs").status_code == 200
    assert client.get("/api/openapi.json").json()["info"]["title"] == "AI Study Buddy"
    assert client.get("/docs").status_code == 404


def test_lifespan_starts_without_a_reachable_database():
    app = create_app(make_settings(database_url="postgresql://postgres:postgres@127.0.0.1:1/x"))
    # psycopg's async mode cannot use Windows' default ProactorEventLoop.
    options = {"loop_factory": asyncio.SelectorEventLoop} if sys.platform == "win32" else {}
    started = time.monotonic()
    with TestClient(app, backend_options=options) as client:
        assert time.monotonic() - started < 5
        assert client.get("/api/config").status_code == 200
        assert app.state.pool is not None
        assert app.state.llm_mode == "mock"
