"""Every mutating /api route runs the read-only guard or is on the bookkeeping allowlist (AD-22).

The guard is the `ActiveProject` dependency (`deps.active_project`, which calls
`projects.require_active`). A new mutating route fails this test until it takes the dependency or
is added to the allowlist below on purpose. Phone routes (`/api/phone/{token}...`) authenticate with
the phone link instead (AD-2, AD-24), which accepts only a link whose Project is still active.
"""

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.routing import APIRoute, iter_route_contexts

from app.api.deps import ActiveProject, active_project
from app.auth import phone_link_auth, phone_link_finalize_auth, user_auth
from app.config import Settings
from app.main import create_app

MUTATING = {"POST", "PUT", "PATCH", "DELETE"}

# Account-scoped routes that change no Project content (AD-22 bookkeeping, auth, and creation).
ALLOWLIST = {
    ("POST", "/api/auth/after-sign-in"),
    ("POST", "/api/auth/password-reset"),
    ("POST", "/api/auth/after-password-reset"),
    ("PATCH", "/api/me"),
    ("PATCH", "/api/me/prefs"),
    # Settings › Change password: checks the current password; changes no Project content (FR-27).
    ("POST", "/api/me/password/check"),
    ("POST", "/api/me/privacy-notice"),
    ("POST", "/api/me/notices/google-takeover/seen"),
    ("POST", "/api/projects"),
    ("POST", "/api/jobs/{job_id}/seen"),
    ("POST", "/api/jobs/{job_id}/cancel"),
    # Closing the QR dialog revokes its phone link, also in a read-only Project (AD-24).
    ("DELETE", "/api/projects/{project_id}/phone-links/{link_id}"),
    # Archive, delete, and restore change only `archived_at` / `deleted_at` (and cancel the jobs and
    # phone links); restore must work on a read-only Project (FR-23, FR-24).
    ("POST", "/api/projects/{project_id}/archive"),
    ("POST", "/api/projects/{project_id}/delete"),
    ("POST", "/api/projects/{project_id}/restore"),
    # Delete forever removes a deleted (read-only) Project; it refuses any other (FR-24).
    ("POST", "/api/projects/{project_id}/purge"),
}

PHONE_AUTH = {phone_link_auth, phone_link_finalize_auth}
PHONE_PREFIX = "/api/phone/"

# The /api catch-all only answers 404 not_found (AD-17).
CATCH_ALL = {"/api", "/api/{path:path}"}


def _calls(dependant) -> set:
    found = {dependant.call}
    for sub in dependant.dependencies:
        found |= _calls(sub)
    return found


def api_routes(app: FastAPI):
    """Every API route with its full path, including those of included routers."""
    return [c for c in iter_route_contexts(app.routes) if isinstance(c.original_route, APIRoute)]


def unguarded_mutating_routes(app: FastAPI) -> set[tuple[str, str]]:
    offenders = set()
    for route in api_routes(app):
        calls = _calls(route.dependant)
        if route.path in CATCH_ALL or active_project in calls:
            continue
        if route.path.startswith(PHONE_PREFIX) and calls & PHONE_AUTH:
            continue
        offenders |= {(method, route.path) for method in route.methods & MUTATING}
    return offenders - ALLOWLIST


def test_scanner_finds_an_unguarded_route_and_accepts_a_guarded_one():
    app = FastAPI()
    router = APIRouter()

    @router.post("/api/projects/{project_id}/things")
    async def unguarded(project_id: str):
        return {}

    @router.delete("/api/projects/{project_id}/things")
    async def guarded(project: ActiveProject):
        return {}

    app.include_router(router)
    assert api_routes(app), "the scanner must see routes inside included routers"
    assert unguarded_mutating_routes(app) == {("POST", "/api/projects/{project_id}/things")}


def test_every_mutating_route_is_guarded_or_allowlisted():
    app = create_app(Settings(_env_file=None, llm_mode="mock"))
    assert unguarded_mutating_routes(app) == set()


def test_rename_is_guarded():
    app = create_app(Settings(_env_file=None, llm_mode="mock"))
    rename = next(r for r in api_routes(app) if r.path == "/api/projects/{project_id}" and "PATCH" in r.methods)
    assert active_project in _calls(rename.dependant)


def test_upload_is_guarded():
    app = create_app(Settings(_env_file=None, llm_mode="mock"))
    upload = next(
        r for r in api_routes(app) if r.path == "/api/projects/{project_id}/materials" and "POST" in r.methods
    )
    assert active_project in _calls(upload.dependant)


def test_remove_is_guarded():
    app = create_app(Settings(_env_file=None, llm_mode="mock"))
    remove = next(
        r
        for r in api_routes(app)
        if r.path == "/api/projects/{project_id}/materials/{material_id}" and "DELETE" in r.methods
    )
    assert active_project in _calls(remove.dependant)


def test_allowlist_names_only_existing_routes():
    # A stale entry would hide a typo or a removed route.
    app = create_app(Settings(_env_file=None, llm_mode="mock"))
    existing = {(method, route.path) for route in api_routes(app) for method in route.methods}
    assert ALLOWLIST <= existing


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("PATCH", "/api/projects/{project_id}/topics/{topic_id}"),
        ("DELETE", "/api/projects/{project_id}/topics/{topic_id}"),
        ("POST", "/api/projects/{project_id}/topics/merge"),
        ("POST", "/api/projects/{project_id}/materials/{material_id}/topics"),
    ],
)
def test_topic_edits_are_guarded(method, path):
    app = create_app(Settings(_env_file=None, llm_mode="mock"))
    route = next(r for r in api_routes(app) if r.path == path and method in r.methods)
    assert active_project in _calls(route.dependant)


def test_quiz_generation_is_guarded():
    app = create_app(Settings(_env_file=None, llm_mode="mock"))
    route = next(r for r in api_routes(app) if r.path == "/api/projects/{project_id}/quizzes" and "POST" in r.methods)
    assert active_project in _calls(route.dependant)


def test_job_cancel_is_allowlisted_bookkeeping():
    app = create_app(Settings(_env_file=None, llm_mode="mock"))
    route = next(r for r in api_routes(app) if r.path == "/api/jobs/{job_id}/cancel" and "POST" in r.methods)
    assert active_project not in _calls(route.dependant)
    assert ("POST", "/api/jobs/{job_id}/cancel") in ALLOWLIST


def test_quiz_answers_are_guarded():
    app = create_app(Settings(_env_file=None, llm_mode="mock"))
    route = next(
        r
        for r in api_routes(app)
        if r.path == "/api/projects/{project_id}/quizzes/{quiz_id}/questions/{question_id}/answer"
        and "POST" in r.methods
    )
    assert active_project in _calls(route.dependant)


def test_mistakes_summary_is_an_unguarded_read():
    # Story 3.3: a read, so an archived or deleted Project still answers; the SPA hides the card there.
    app = create_app(Settings(_env_file=None, llm_mode="mock"))
    route = next(r for r in api_routes(app) if r.path == "/api/projects/{project_id}/mistakes/summary")
    assert route.methods == {"GET"}
    assert active_project not in _calls(route.dependant)


@pytest.mark.parametrize(
    "path",
    [
        "/api/projects/{project_id}/review-rounds",
        "/api/projects/{project_id}/review-rounds/{round_id}/items/{practice_question_id}/answer",
    ],
)
def test_review_start_and_answers_are_guarded(path):
    # Stories 3.4 + 3.5: starting a round and answering are content mutations (AD-22).
    app = create_app(Settings(_env_file=None, llm_mode="mock"))
    route = next(r for r in api_routes(app) if r.path == path and "POST" in r.methods)
    assert active_project in _calls(route.dependant)


def test_a_review_round_is_an_unguarded_read():
    app = create_app(Settings(_env_file=None, llm_mode="mock"))
    route = next(r for r in api_routes(app) if r.path == "/api/projects/{project_id}/review-rounds/{round_id}")
    assert route.methods == {"GET"}
    assert active_project not in _calls(route.dependant)


def test_phone_routes_use_only_the_phone_link_and_no_other_route_does():
    # AD-2: `phone_link_auth` serves only /api/phone/..., which never takes a user token.
    app = create_app(Settings(_env_file=None, llm_mode="mock"))
    phone_routes = [r for r in api_routes(app) if r.path.startswith(PHONE_PREFIX)]
    assert {(m, r.path) for r in phone_routes for m in r.methods} == {
        ("GET", "/api/phone/{token}"),
        ("POST", "/api/phone/{token}/revoke"),
        ("POST", "/api/phone/{token}/batches"),
        ("POST", "/api/phone/{token}/batches/{batch_id}/photos"),
        ("POST", "/api/phone/{token}/batches/{batch_id}/finalize"),
    }
    for route in phone_routes:
        calls = _calls(route.dependant)
        assert calls & PHONE_AUTH, route.path
        assert user_auth not in calls, route.path
    finalize = next(r for r in phone_routes if r.path.endswith("/finalize"))
    assert phone_link_finalize_auth in _calls(finalize.dependant)
    for route in api_routes(app):
        if not route.path.startswith(PHONE_PREFIX):
            assert not _calls(route.dependant) & PHONE_AUTH, route.path


def test_creating_a_phone_link_is_guarded():
    app = create_app(Settings(_env_file=None, llm_mode="mock"))
    route = next(
        r for r in api_routes(app) if r.path == "/api/projects/{project_id}/phone-links" and "POST" in r.methods
    )
    assert active_project in _calls(route.dependant)
