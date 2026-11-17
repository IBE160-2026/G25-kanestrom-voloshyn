"""Every mutating /api route runs the read-only guard or is on the bookkeeping allowlist (AD-22).

The guard is the `ActiveProject` dependency (`deps.active_project`, which calls
`projects.require_active`). A new mutating route fails this test until it takes the dependency or
is added to the allowlist below on purpose.
"""

from fastapi import APIRouter, FastAPI
from fastapi.routing import APIRoute, iter_route_contexts

from app.api.deps import ActiveProject, active_project
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
    ("POST", "/api/projects"),
    ("POST", "/api/jobs/{job_id}/seen"),
}

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
        if route.path in CATCH_ALL or active_project in _calls(route.dependant):
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


def test_allowlist_names_only_existing_routes():
    # A stale entry would hide a typo or a removed route.
    app = create_app(Settings(_env_file=None, llm_mode="mock"))
    existing = {(method, route.path) for route in api_routes(app) for method in route.methods}
    assert ALLOWLIST <= existing
