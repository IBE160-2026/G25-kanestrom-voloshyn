---
title: 'Story 1.3: Create an account with email and password'
type: 'feature'
created: '2026-11-12'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: '78e923caec4e11379cc49e9133800a3131ebc439'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-2-switch-language.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A visitor can't create an Account yet. FR-1 needs sign-up with first name, email, and a password of at least 8 characters, and only one Account per email. The backend also has no way to know who is calling.

**Approach:** Add a Create account screen that signs up through `supabase-js` (AD-1). On the backend, add `user_auth` (AD-2 steps 1–3), the `profiles` table, `POST /api/auth/after-sign-in` (sets the first name and language), and `GET /api/me`. Success lands on the Projects page (empty).

Decisions (Ihor, 2026-11-12):
- **Split.** The verification email and link (FR-1's 24 h link, `mailer.py`, `email_verifications`, `GET /api/auth/verify`) are the next spec, recorded in `deferred-work.md`.
- **Projects page.** It shows "Welcome, {first name}" and the empty-state heading "Create your first project", with no button. Story 2.1 adds the action.
- **Libraries.** The spine names `httpx2` and `aiosmtplib`; this spec uses only `httpx2`.

## Boundaries & Constraints

**Always:**
- The browser uses Supabase only for `signUp` and reading the session (AD-1). All app data goes through `/api/*` via `frontend/src/api/client.js`, the only HTTP caller. It attaches the bearer token and renders errors with `errorText`. `frontend/src/auth/` is the only `supabase-js` user, and it builds its client from `GET /api/config`.
- `user_auth` in `backend/app/auth.py` is the only token parser. It follows AD-2 steps 1–3:
  1. Validate the token with `GET {SUPABASE_URL}/auth/v1/user` through `app/supabase_auth.py`, the only Supabase Auth HTTP caller (spine AD-2, amended 2026-11-12). It uses one `httpx2` client created in the lifespan, and there is no `supabase` Python SDK. Only a 401 or 403 from Supabase means `unauthorized`. A timeout, connection error or 5xx gives `auth_unavailable` (503).
  2. Look up the session in `auth.sessions`. A missing row gives `unauthorized`. A NULL `created_at`, or one older than `SESSION_MAX_AGE_DAYS` (30), gives `session_expired`.
  3. Create the profile idempotently.

  Step 4, the Google takeover, is Story 1.6.
- The schema changes only through `supabase/migrations/` (AD-16). `profiles` has every AD-19 column, keyed by `account_id` → `auth.users` with `ON DELETE CASCADE`. `first_name` and `language` are set from `after-sign-in` only while still unset.
- Services take `conn` and never commit; one transaction per request (AD-18); I/O is async (AD-29). Passwords and tokens are never logged.
- Every string comes from the catalogues (AD-26), and styles use only tokens (AD-28). The Create account screen follows the Login layout (DESIGN.md line 683), with the Error line from EXPERIENCE.md.
- Backend tests run against local Supabase in mock mode. One test confirms a 7-character sign-up fails (spine › Tests). Frontend tests stub `supabase-js` and `fetch` (spine › Tests).

**Never:**
- No verification email, verify link, or mailer (the next spec).
- No login form, logout, or session-expiry handling in the SPA (Story 1.4). No reset (1.5). No Google (1.6). No Settings (7.3).
- No `updateUser({email})`. No Supabase-sent emails; confirmations stay off.
- No Projects and no `last_project_id` logic (Epic 2).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy sign-up | first name, new email, 8+ character password | Account created and signed in. `after-sign-in` creates the profile with that first name and the active language. The SPA shows the Projects page: "Welcome, {first name}" and "Create your first project". | N/A |
| Duplicate email | an email already registered | Error line: "An account with this email already exists. Log in instead?"; "Log in" goes to `/`; no second Account | stays on the form; email kept |
| Short password | 7 characters | Error line: "Use at least 8 characters."; no Account (checked in the SPA and by Supabase) | stays on the form |
| Blank first name | whitespace only | refused before sign-up; the API returns `invalid_request` if it gets that far | stays on the form |
| `after-sign-in` twice | a repeated call | profile unchanged | idempotent |
| No or bad token | `GET /api/me` without a valid bearer | `401 unauthorized` | envelope |
| Session row gone | a token whose `auth.sessions` row was deleted | `401 unauthorized` | envelope |
| Old session | session `created_at` > 30 days ago, or NULL | `401 session_expired` | envelope |
| Supabase Auth down | `/auth/v1/user` times out or returns 5xx | `503 auth_unavailable`; the SPA keeps the session and shows the generic error | envelope |

</frozen-after-approval>

## Code Map

- `backend/app/main.py` -- `_api_router()` includes routers before the `/api` catch-all; add `api/auth.py` and `api/me.py` there. The lifespan already opens `app.state.pool`; add a request-scoped connection-and-transaction dependency (AD-18).
- `backend/app/errors.py` -- `AppError(status, code, message, params)`; use it for `unauthorized` and `session_expired`.
- `backend/app/config.py` -- add `SESSION_MAX_AGE_DAYS` (30). List any new name in `.env.example`.
- `backend/app/db/pool.py` -- the pool. Add `db/profiles.py` and `db/sessions.py` (plain SQL, taking `conn`).
- `backend/tests/test_api.py` -- `make_settings()` and Story 1.1's selector-loop pattern; reuse them. Get test users from local GoTrue (`/auth/v1/signup`, and `/auth/v1/admin/users` with `SUPABASE_SECRET_KEY`).
- `frontend/src/i18n/{en,nb}.json` -- add `signup.*`, `projects.*`, and the EXPERIENCE.md strings: lines 185 (duplicate), 198 ("Create account", "Log in"), 199 (fields), 202 (too short), 207 (Projects page), and 210 (greeting).
- `frontend/src/test/render.jsx` -- `renderWithI18n`; extend it with a memory router.
- `frontend/src/pages/Login.jsx` -- add the "Create account" link to `/signup`.
- New: `frontend/src/auth/`, `frontend/src/api/client.js`, and `react-router` 8 (imports from `react-router` and `react-router/dom`).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<timestamp>_profiles.sql` -- `profiles` with every AD-19 column (AD-16, AD-19).
- [x] `backend/pyproject.toml` -- replace the dev `httpx` with `httpx2` 2.16 as a runtime dependency (spine Stack). Starlette's TestClient then uses it, and its deprecation warning goes away.
- [x] `backend/app/supabase_auth.py` + `main.py` lifespan -- one `httpx2.AsyncClient` (with a timeout) created and closed in the lifespan; `get_user(token)` maps 401/403 to `unauthorized` and everything else to `auth_unavailable` (spine AD-2).
- [x] `backend/app/auth.py` -- the `user_auth` dependency (AD-2 steps 1–3).
- [x] `backend/app/services/identity.py` + `backend/app/db/` -- `after_sign_in(conn, account_id, first_name, language)` and `get_profile`.
- [x] `backend/app/api/auth.py`, `api/me.py` -- `POST /api/auth/after-sign-in` (body `first_name`, `language`; trimmed, non-blank, at most 100 characters) and `GET /api/me` (`first_name`, `language`, `email_verified`).
- [x] `backend/tests/` -- every backend matrix row, including the 7-character sign-up against local GoTrue.
- [x] `frontend/package.json` -- `@supabase/supabase-js` 2.118, `react-router` 8.5.
- [x] `frontend/src/auth/`, `frontend/src/api/client.js` -- the Supabase client built from `/api/config`, `signUp`, and `apiFetch` with the bearer token and the error envelope.
- [x] `frontend/src/App.jsx` + `pages/CreateAccount.jsx`, `pages/Projects.jsx` -- routes `/` (Login), `/signup`, and `/projects`.
- [x] `frontend/src/**/*.test.jsx` -- the SPA matrix rows, with `supabase-js` and `fetch` stubbed.
- [x] `README.md` (Norwegian) -- add a line on creating an account.

**Acceptance Criteria:**
- Given the grader flow (`npx supabase start`, `db reset`, `docker compose up --build`), when a visitor signs up at `http://localhost:8000/signup`, then they reach the Projects page greeted by first name, and `profiles` holds their row.
- Given the source, when it is searched, then only `frontend/src/auth/` imports `@supabase/supabase-js`, and only `frontend/src/api/client.js` calls `fetch` for `/api`.

## Implementation Notes

- Installed versions: `httpx2` 2.16.0 (runtime; the dev `httpx` is gone and TestClient uses httpx2 without a warning), `@supabase/supabase-js` 2.118.0, `react-router` 8.5.1.
- Migration `supabase/migrations/20261112140000_profiles.sql`: every AD-19 column, plus `created_at`. `first_name` is checked at 1–100 characters and `language` at `en`/`nb`. `last_project_id` has no foreign key yet; Epic 2 adds it with `projects`. RLS is on with no policies and `anon`/`authenticated` are revoked, so the Data API can't read profiles (AD-1). The backend connects as `postgres`, the table owner.
- `user_auth` reads `session_id` from the token's payload only after `GET /auth/v1/user` has accepted the token. It takes the request connection (`api/deps.py::request_conn`, one connection and one transaction per request). Nothing is written before the Supabase call. The connection is held during that call, though.
- `SESSION_MAX_AGE_DAYS` is in `config.py` and `.env.example`. The Supabase Auth timeout (5 s) is a constant in `supabase_auth.py`, because app variables may not use the `SUPABASE_AUTH_*` prefix (spine › Config).
- `POST /api/auth/after-sign-in`: `first_name` and `language` are both optional, so Story 1.4's sign-ins can call it without a name. When given, `first_name` is trimmed and must be 1–100 characters, and `language` must be `en` or `nb`. Anything else gives `422 invalid_request`. It returns the same shape as `GET /api/me`.
- Real GoTrue (CLI 2.122.0) answers **500** for a token whose `auth.sessions.created_at` is NULL, and 403 for a deleted session row. With the real stack, a NULL `created_at` therefore gives `auth_unavailable`, and a deleted row gives `unauthorized` from step 1. The tests prove step 2 on its own with a stubbed Supabase Auth: NULL gives `session_expired`, and an unknown session gives `unauthorized`.
- SPA: `auth/` builds the client from `/api/config` through `apiFetch(..., {auth: false})`. `api/client.js` gets the token from `auth/`. The two modules import each other, but only inside functions. A failed config load is retried on the next call.
- The duplicate-email line uses `<Trans>` with a `<login>` tag, so "Log in" is a link to `/` and the full sentence matches EXPERIENCE.md. A `<link>` tag doesn't work, because the parser treats `link` as a void HTML element.
- New strings that EXPERIENCE.md doesn't have: `signup.errors.firstNameRequired` ("Enter your first name." / "Skriv inn fornavnet ditt.", both drafts) for the blank-first-name row. `errors.session_expired` reuses the Session expired string, and `errors.auth_unavailable` reuses the generic text.
- If `after-sign-in` fails after the Account was created, the form remembers this, so a retry only repeats `after-sign-in`.
- `Login.module.css` became `components/AuthLayout.module.css`. Login and Create account share `AuthLayout` (with a `switchTo` link). The setup file now imports `test/reset.js` instead of `render.jsx`. Otherwise it would load the routes, and through them the real `api/client.js` and `auth/`, before a test's `vi.mock` applies.
- `docker compose up --build` failed locally with the bake entitlement prompt (`--allow=fs.read=Dockerfile`), a Docker Desktop/buildx quirk. The image was built with `docker build -t g25-kanestrom-voloshyn-app .` and started with `docker compose up -d --no-build`.
- The SPA bundle now exceeds Vite's 500 kB warning, mostly because of supabase-js. The build still passes.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-11-12). Layers: blind (B), edge-case (E), verification-gap (V).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | E: `request_conn` commits after the response is sent | high | Reproduced with FastAPI 0.162: the yield dependency's exit runs after `http.response.start` under the default `request` scope, so a failed commit still returns 200. | patch |
| 2 | B/E: `user_auth` holds a pooled connection during the 5 s Supabase call | medium | `request_conn` opens before `get_user`, so a Supabase outage can drain the pool. Fix: validate the token in a sub-dependency declared before the connection. | patch |
| 3 | B/E: retrying after a successful `signUp` ignores edited email or password | medium | `signedUp` stays true; the edits are silently dropped. Direct fix: lock those fields once the Account exists. | patch |
| 4 | E: a first name over 100 characters passes the SPA, then `after-sign-in` returns 422 | medium | The Account exists without a name. Direct fix: `maxLength` 100 on the input. | patch |
| 5 | B: native email validation shows the browser's own bubble in the browser's language | medium | `required`/`type=email` without `noValidate`; this bypasses the Error line and AD-26. Fix: `noValidate` plus catalogue messages. | patch |
| 6 | B: the Projects page has no loading or signed-out state | medium | It renders the empty state before `/api/me` returns; signed out it shows a bare error with no way to Login. | patch |
| 7 | V: `after-sign-in` without a name or language is untested | medium | Pre-verified; Story 1.4 depends on it. | patch |
| 8 | V: `profiles` RLS and revoke untested | medium | Pre-verified; the AD-1 boundary can regress silently. | patch |
| 9 | V: a Supabase 200 with no user id is untested | medium | Pre-verified. | patch |
| 10 | B: the SPA import and fetch boundaries aren't enforced by a test; no unauthenticated `after-sign-in` test | medium | The AC exists; only a grep checked it. | patch |
| 11 | B: Mailpit port in `epic-1-context.md` is the UI port (54324), not SMTP (54325) | medium | The part-2 spec builds from it. | patch (doc) |
| 12 | B: `deferred-work.md` says "httpx"; the spine says `httpx2` | low | My entry; direct correction. | patch (doc) |
| 13 | B/E: the sign-up button has no visible busy state, and double submit races before re-render | low | Direct fix: disable the button while busy, plus a `useRef` guard. | patch |
| 14 | B: a repeated identical error isn't re-announced | low | Same element and text under `role="alert"`. Direct fix: re-key it per attempt. | patch |
| 15 | B: first name copied into Supabase `user_metadata` | low | Not asked by the spec or AD-19. Direct fix: delete the option. | patch |
| 16 | B/E: `SESSION_MAX_AGE_DAYS` has no bounds | low | Direct fix: `Field(ge=1, le=3650)`. | patch |
| 17 | E/B/V: the test `stub_auth` leaks an `httpx2` client | low | Direct fix in the test. | patch |
| 18 | E: a 2xx with a non-JSON body escapes as `SyntaxError` | low | Direct try/catch in `client.js`. | patch |
| 19 | V: the session lookup's `user_id` filter isn't pinned by a test | medium | Pre-verified; real GoTrue already binds session and user in step 1. | defer |
| 20 | B/E: NULL `created_at` gives 503 in the real stack, not 401 | low | GoTrue answers 500 before step 2 runs; the code path is proven with a stub. Fixing it would mean editing the spec. | reject |
| 21 | B: an empty publishable key makes every token look invalid | low | A config error; sign-up fails first in the browser. Startup validation adds branches. | reject |
| 22 | E: a reload after `signUp` succeeded but `after-sign-in` failed | low | Rare; session handling is Story 1.4. | reject |
| 23 | E: greeting with a NULL first name | low | Only when `after-sign-in` failed; it adds a new string. | reject |
| 24 | E: `signUp` with no session (confirmations on) | low | Confirmations are off by AD-2. | reject |
| 25 | B: bundle over Vite's 500 kB warning | low | The build passes; it's performance work for later. | reject |
| 26 | B: README lacks a `docker compose` workaround | false | `docker compose up -d --build` succeeds on this machine (exit 0). | reject |
| 27 | B: sprint status differs from the spec | false | Step 5 syncs it. | reject |

## Verification

**Commands:**
- `cd backend && uv run pytest` -- expected: all pass with local Supabase up.
- `cd frontend && npm test && npm run lint && npm run build` -- expected: all pass; only `tokens.css` has hex colours.

**Manual checks:**
- In a browser: sign up in Norwegian and land on "Velkommen, {first name}"; try a duplicate email and a 7-character password.
