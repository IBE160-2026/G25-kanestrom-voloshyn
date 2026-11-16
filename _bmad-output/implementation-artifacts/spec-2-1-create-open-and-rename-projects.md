---
title: 'Story 2.1: Create, open, and rename Projects'
type: 'feature'
created: '2026-11-16'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '331f04136ad97d865b26c9877ead02b75ac37fae'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After sign-in a student lands on a static Projects heading and can do nothing. There is no Project, no app shell, and no read-only guard for the content routes every later story adds (FR-4, FR-5, AD-14, AD-22).

**Approach:**
- Add a `projects` table and `services/projects` (create, list, get, rename, `require_active`). Every Project route is scoped by `account_id`.
- Add an app shell for signed-in pages: a Sidebar (with a collapsible strip) and a Top bar with the Project name. Add the empty Projects page with "Create your first project", and a Project home layout (drop zone, empty tools row, Files panel) for later stories to fill.
- Opening a Project records it as `profiles.last_project_id`, and login lands there.

## Boundaries & Constraints

**Always:**
- Rename trims the input, refuses a blank name with `422 invalid_name`, caps it at 100 characters (longer input is cut, not refused), and sets `name_source='student'`. Rename calls `require_active` first.
- `require_active(conn, account_id, project_id)` returns the Project row; it raises `404 not_found` for a missing or foreign id, and `409 project_read_only` when `archived_at` or `deleted_at` is set.
- Project content routes take the `ActiveProject` dependency, which wraps `require_active`. A route test fails when a mutating `/api` route has neither the dependency nor an entry in the explicit allowlist (auth routes, `PATCH /api/me`, `PATCH /api/me/prefs`, `POST /api/projects`).
- The Sidebar collapse state is saved in `profiles.ui_prefs.sidebar_collapsed` through `PATCH /api/me/prefs`. Below 1024 px the Sidebar starts collapsed whatever the preference says.
- Every string comes from `en.json`/`nb.json`, and every style uses only `var(--…)` tokens.
- Decided by Cristoffer on 2026-11-16: the Sidebar lists Projects newest first. New copy is approved and added to EXPERIENCE.md as `[ASSUMPTION: copy, approved 2026-11-16 with Story 2.1]`:
  - Projects page muted sentence: "A project holds the notes for one course." / "Et prosjekt samler notatene for ett emne."
  - `invalid_name`: "Give the project a name." / "Gi prosjektet et navn."
  - `project_read_only`: "This project is read-only." / "Dette prosjektet kan bare leses."

**Never:**
- No upload, Files panel collapse, Archive, Delete, or auto-naming (Stories 2.2, 2.4, and Epic 7).
- No new dependencies. No unscoped lookup by Project id.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First sign-in | no Projects | Projects page (empty) with "Create your first project" | N/A |
| Create | click the button or "+ New project" | `201`, a Project with `name=null`, opens `/projects/{id}` showing "New project" | an API failure shows an Inline error; nothing opens |
| Return login | `last_project_id` is an active Project | lands on `/projects/{id}`; a remembered route still wins | `last_project_id` gone or not active → Projects page |
| Rename | `"  Biology 101  "` | name `Biology 101`, shown at once in the Sidebar and Top bar | N/A |
| Rename blank | `"   "` | `422 invalid_name`; the old name stays | Inline error under the field |
| Rename long | 150 characters | saved as the first 100 | N/A |
| Esc while renaming | edited text | the old name is restored, and no request is sent | N/A |
| Foreign id | another Account's Project id | `404 not_found` on GET and PATCH | SPA goes to `/projects` |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261112140000_profiles.sql` -- `last_project_id uuid` has no FK yet (its comment defers it to Epic 2). `ui_prefs jsonb default '{}'`. Copy its style: `public.` prefix, a comment per column, RLS on, and `revoke all … from anon, authenticated`.
- `backend/app/main.py:_api_router` L49-61 -- include new routers BEFORE the `/api/{path}` catch-all.
- `backend/app/api/deps.py` -- `Conn` (one transaction per request). `backend/app/auth.py` -- `UserAuth` gives `account_id`.
- `backend/app/errors.py` -- `AppError(status, code, message, params)`.
- `backend/app/db/profiles.py` -- repository pattern (`_COLUMNS`, `dict_row`, never commit). Add `ui_prefs` and `last_project_id` here.
- `backend/app/api/me.py` -- `Me`, `MeUpdate` (`extra="forbid"`; `test_me.py` L71 expects `last_project_id` to be refused, so keep that). `after-sign-in` in `api/auth.py` returns `Me` too.
- `backend/tests/test_auth.py` L27-97 -- fixtures (`client`, `created`, `sign_up`, `bearer`, `assert_error`), imported as `test_me.py` does. `tests/test_boundaries.py` -- the model for a structural test.
- `frontend/src/routes.jsx` -- `/projects` sits under `RequireSession`. `pages/Projects.jsx` renders the heading only. `components/TopBar.jsx` -- the comment reserves the left side for the page name.
- `frontend/src/pages/Login.jsx` L13 `HOME = '/projects'`, L52 and L109 `takeRememberedRoute() ?? HOME`.
- `frontend/src/api/client.js` (`apiFetch`, `ApiError`), `i18n/errors.js` (`errors.<code>`), `test/render.jsx` (`renderRoute`), `test/mocks.js` (`clientMock`).
- DESIGN.md L144-147: `sidebar-width` 248, `sidebar-collapsed-width` 56, `files-panel-width` 340, `chat-width` 760. Components: `sidebar`, `sidebar-strip`, `top-bar` (L243-280), drop zone (L764), Projects page (L812). Composition reference: `mockups/key-project-home.html`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<ts>_projects.sql` -- `projects(id uuid pk, account_id → profiles on delete cascade, name text check length ≤ 100, name_source text check in ('auto','student'), archived_at, deleted_at, created_at)`, an index on `account_id`, and the FK `profiles.last_project_id → projects on delete set null`.
- [x] `backend/app/db/projects.py`, `backend/app/services/projects.py` -- `create`, `list_for`, `require_active`, `open` (sets `last_project_id`), `rename`. `ProjectReadOnly` maps to 409.
- [x] `backend/app/api/projects.py` + `deps.py` (`ActiveProject`) -- `GET/POST /api/projects`, `GET/PATCH /api/projects/{project_id}`. Project JSON: `{id, name, name_source, archived_at, deleted_at, created_at}`.
- [x] `backend/app/api/me.py`, `db/profiles.py` -- `Me` gains `ui_prefs` and `last_project_id` (only when that Project is active). New `PATCH /api/me/prefs {sidebar_collapsed: bool}` merges into `ui_prefs`.
- [x] `backend/tests/test_projects.py`, `tests/test_routes_guard.py` -- the matrix rows, scoping, `last_project_id` set on open and nulled when the Project is deleted (cascade check by SQL), prefs, and the allowlist route test.
- [x] `frontend/src/components/AppShell.jsx`, `Sidebar.jsx`, `ProjectName.jsx` (shared inline rename) + CSS modules; `TopBar.jsx` takes a title slot.
- [x] `frontend/src/pages/Projects.jsx` (empty state, redirect to `last_project_id`), `pages/ProjectHome.jsx` (drop zone heading, empty tools row, Files panel "Files · 0 of 10"), `routes.jsx` (`/projects/:projectId` inside the shell).
- [x] `frontend/src/i18n/en.json`, `nb.json` -- the new keys from EXPERIENCE.md plus the approved drafts. Mirror the drafts into EXPERIENCE.md's strings table.
- [x] Frontend tests for each new component and page -- the matrix rows, the strip toggle saving prefs, the 1024 px start state, and keyboard rename (Enter, Esc).

**Acceptance Criteria:**
- Given a signed-in student with no Projects, when Login completes, then the Projects page (empty) shows, and the Sidebar shows "+ New project".
- Given the Sidebar, when "Hide projects" is pressed, then the Sidebar strip (56 px) shows "Show projects" and a "New project" icon button, and a reload keeps the state.
- Given an open Project, then the chat column shows the drop zone "Upload your notes to start", an empty tools row, and the Files panel "Files · 0 of 10" on the right.

## Verification

**Commands:**
- `npx supabase db reset` -- expected: migrations apply cleanly
- `cd backend; uv run pytest` -- expected: all green with `LLM_MODE=mock`
- `cd frontend; npm test; npm run lint; npm run build` -- expected: all green

**Manual checks:**
- In `docker compose up --build`: create two Projects, rename one in the Sidebar and the other in the Top bar, log out and back in (you land on the last opened), collapse the Sidebar and reload, and narrow the window below 1024 px.

## Implementation Notes

- `request_conn`/`Conn` moved to `app/api/conn.py` (re-exported by `deps.py`): `deps.py` now imports `app.auth` for `ActiveProject`, and `app.auth` needs `Conn`, so keeping both in `deps.py` would be a circular import.
- FastAPI 0.162 includes routers lazily (`_IncludedRouter`), so `test_routes_guard.py` walks routes with `fastapi.routing.iter_route_contexts`.
- `GET /api/projects/{id}` is the "open": it records `last_project_id`. `GET /api/me` and `after-sign-in` return `last_project_id` only while that Project is active (checked in `identity.get_profile`).
- Login lands on `/projects/{last_project_id}` from the after-sign-in profile; the Projects page also forwards there (already-signed-in visits). A remembered route still wins. A `not_found` (or malformed id, `invalid_request`) on open goes to `/projects` and forgets that id locally, so a stale last Project can't loop.
- Projects page empty state: muted sentence + Button (primary) "Create your first project" (the only approved copy), so there is no separate heading text. The `projects.empty.heading` key became `projects.empty.create`.
- Sidebar "···" trigger reuses the approved file-menu wording, "More options for {name}" / "Flere valg for {name}", with the Project name.
- Files panel header uses `<Trans>` so " · 0 of 10" is muted (DESIGN.md › Files panel).
- Verification pass (orchestrator): with no usable last Project but active Projects, the Projects page left the main area blank. It now opens the most recent active Project, as EXPERIENCE.md › No Projects says; the empty state still shows only when no active Project exists. New test in `Projects.test.jsx`. Not reachable until Epic 7 (archive/delete).

## Spec Change Log

## Review Triage Log

Pass 1 (blind = Blind Hunter, edge = Edge Case Hunter, gap = Verification Gap):

| # | Source | Finding | Verdict | Evidence / route |
|---|---|---|---|---|
| 1 | gap, blind | A malformed path id (`invalid_request`) going to `/projects` is untested at both ends | medium | `GONE` includes it; every test fakes `not_found`. Patch: frontend + backend tests |
| 2 | gap, edge | The "remembered route wins" Login test asserts a URL that `Projects.jsx` replaces at once | medium | Passes only before the redirect. Patch: remember a non-redirected route and assert the settled page |
| 3 | gap, edge | `markOpened` runs for an archived/deleted Project, so the client's `last_project_id` diverges from the server's | low | Not reachable until Epic 7, but the fix is one condition. Patch |
| 4 | edge | NUL or lone surrogate in a name → 500 | low | Real, but rare, and the fix is a new guard. Rejected |
| 5 | edge, blind | Cut at 100 can leave a trailing space | low | `name[:100]` after `strip()`. Direct correction. Patch |
| 6 | edge, blind | `require_active` doesn't lock, so a concurrent archive can race a rename | low | Archive arrives in Epic 7, but every later mutation inherits the guard; `FOR UPDATE` is a direct change. Patch |
| 7 | blind | Rename runs the guard query twice | low | One extra indexed query; no user harm. Rejected |
| 8 | blind | `PrefsUpdate.sidebar_collapsed` is required, not partial | false | The only pref today; the Files panel story will extend the model. Rejected |
| 9 | blind | `ui_prefs || x` loses data when NULL | false | `ui_prefs jsonb not null default '{}'` (profiles migration). Rejected |
| 10 | blind | `GET /api/projects/{id}` writes `last_project_id` | low | The spec's chosen design (open = GET). Rejected |
| 11 | blind | `get_profile` costs one more query | low | Negligible. Rejected |
| 12 | blind | The `last_project_id` FK doesn't enforce ownership | low | The service only writes the caller's own Project id. Rejected |
| 13 | blind | The DB check allows a blank name | low | Every writer trims (`clean_name`; Story 2.4 validates its own). Rejected |
| 14 | blind | `GET /api/projects` returns archived/deleted Projects | false | AD-22: "`GET /api/projects` returns every state". Rejected |
| 15 | blind | Generic `project_read_only` copy duplicates EXPERIENCE's archived/deleted messages | low | Not shown until Epic 7. Defer: map by state with params there |
| 16 | blind | The Sidebar-order and copy decisions aren't in a `.memlog.md` | low | AGENTS.md requires it. Patch |
| 17 | blind | `sprint-status.yaml` `last_updated` changed format | low | Was `11-16-2026 20:14`. Patch |
| 18 | blind | Focus falls to `<body>` after Enter/Esc in rename | medium | Accessibility Floor (UX-DR15). Patch: return focus to the title button / row trigger |
| 19 | blind | Esc while a save is pending still applies the rename | low | `onKeyDown` ignores `busy`. Direct correction. Patch |
| 20 | blind | Blur leaves the field open; two fields can edit at once | low | The spec defines Enter/Esc only. Rejected |
| 21 | blind, edge | A create before the first list load can be overwritten | low | Needs a click within the first list fetch. Rejected |
| 22 | blind | A failed `/api/me` leaves the Projects page blank | false | AppShell shows the load error line. Rejected |
| 23 | blind | Sidebar "+ New project" has no busy style | low | Cosmetic. Rejected |
| 24 | edge | A create error stays shown after moving to another Project | low | Visible after any failed create; clearing it is a direct correction. Patch |
| 25 | edge | Enter with an unchanged name sends a rename (an untouched unnamed Project shows `invalid_name`) | medium | Pressing Enter on an untouched placeholder shows an error. Patch: close without a request when nothing changed |
| 26 | edge | The Sidebar shows expanded until `/api/me` loads | low | Brief, cosmetic. Rejected |
| 27 | edge | Expanding in a narrow window overwrites the desktop preference | low | Saving the student's last choice is defensible. Rejected |
