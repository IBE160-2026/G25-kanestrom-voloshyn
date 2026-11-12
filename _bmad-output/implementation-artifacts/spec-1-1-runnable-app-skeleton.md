---
title: 'Story 1.1: Runnable app skeleton the grader can start locally'
type: 'feature'
created: '2026-11-05'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: '6111bce8124ed274d95d87d6a21f3c30f21fa9bb'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-AI-StudyBuddy-2026-10-13/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** There is no application code. The grader must be able to clone the repo and run the app and its tests locally with no paid key (NFR-12), and every later story needs a scaffold that already follows the spine (AD-16, AD-17, AD-29).

**Approach:** Scaffold the Structural Seed: a uv async FastAPI backend, a create-vite React JS frontend, `supabase init` with a pinned CLI, and one multi-stage Docker image. FastAPI serves `/api/*` and the built SPA on one origin. The SPA shows a token-styled placeholder Login screen, and the backend resolves mock mode at startup.

## Boundaries & Constraints

**Always:**
- Follow the spine's Structural Seed, Stack versions, and Consistency Conventions. Python 3.14, Node ≥ 22.22 in `engines`, `supabase@2.122.0` exact as a root devDependency.
- One uvicorn worker. Async routes. One `psycopg_pool.AsyncConnectionPool` opened in the lifespan, with `open(wait=False)` so the app starts while the DB is still coming up.
- All settings in `backend/app/config.py` (Pydantic settings). Every variable name, with no value, in `.env.example`. Names: `APP_ENV`, `LLM_MODE`, `OPENROUTER_API_KEY`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLIC_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `APP_PUBLIC_URL`, `SUPABASE_AUTH_EXTERNAL_GOOGLE_ENABLED`, `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`, `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`.
- Decision (Ihor, 2026-11-05, review pass 1): a non-secret switch may ship a safe default in `.env.example`. `SUPABASE_AUTH_EXTERNAL_GOOGLE_ENABLED=false` is allowed, because Supabase CLI 2.122.0 fails on an empty value. Every other name stays empty.
- `google_enabled` is true only when the switch is on and both Google values are set.
- Errors always use the envelope `{"error": {"code", "params", "message"}}`.
- `tokens.css` holds every DESIGN.md frontmatter token as a CSS custom property. Dark only. Components use only `var(--…)`. Inter comes from `@fontsource-variable/inter`.
- Run instructions go in Norwegian in `README.md`.

**Never:**
- No auth flows, profiles, migrations with tables, i18n catalogues, or LLM gateway tasks (Stories 1.2–1.6, 2.x). `backend/app/llm/` is only a package marker.
- No `VITE_*` variables, and no Supabase values at build time.
- No hard-coded colours. No Tailwind or component library. No translatable UI text in this story: the placeholder shows only the product wordmark.
- Never log secrets.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Config | `GET /api/config` | `200 {supabase_url, supabase_publishable_key, google_enabled}`; `supabase_url` = `SUPABASE_PUBLIC_URL` | N/A |
| Unknown API path | `GET /api/nope` (any method) | `404 {"error": {"code": "not_found", "params": {}, "message": …}}` | N/A |
| SPA deep link | `GET /projects/x` | `200` `index.html` | N/A |
| Dev, no key | `APP_ENV=development`, `LLM_MODE` unset, no key | mode `mock`, one warning logged | N/A |
| Prod, mode unset | `APP_ENV=production`, `LLM_MODE` unset | startup fails | config error naming `LLM_MODE` |
| Prod, live, no key | `APP_ENV=production`, `LLM_MODE=live`, no key | startup fails | config error naming `OPENROUTER_API_KEY` |

</frozen-after-approval>

## Code Map

- No app code exists yet. The root holds `AGENTS.md`, `CLAUDE.md`, `README.md` (Norwegian), `.gitignore` (already ignores `.env`, `node_modules/`, `dist/`, `.venv/`, `__pycache__/`), and `_bmad*/`, `.claude/`, `.agents/`, `.logs/` (don't touch).
- Spine sections: Structural Seed (layout), Stack (versions), Consistency Conventions (error shape, config, logging, tests), AD-4 (mode rules), AD-17 (routing, URLs, compose `extra_hosts`), AD-29 (async, one worker).
- `DESIGN.md` frontmatter (`_bmad-output/planning-artifacts/ux-designs/ux-AI-StudyBuddy-2026-10-13/DESIGN.md`) is the token source. `mockups/key-login.html` is the composition reference.
- Mock mode belongs to AD-4's gateway, but in this story only the resolution of `LLM_MODE` in `config.py` is built.
- `app.frontend("/", directory=…, fallback="index.html")` was verified in FastAPI docs on 2026-11-02 (tech-currency review). If the installed FastAPI lacks it, use a `StaticFiles` mount plus a fallback route, and log it in Implementation Notes.

## Tasks & Acceptance

**Execution:**
- [x] `package.json` (root) -- private, `supabase@2.122.0` exact devDependency, `engines.node ">=22.22"` -- pinned CLI (AD-16).
- [x] `supabase/config.toml`, `supabase/migrations/.gitkeep` -- run `npx supabase init`, then set `[auth]` `enable_confirmations = false`, `minimum_password_length = 8`, `enable_manual_linking = true`, `[auth.email] otp_expiry = 3600`, `[auth.external.google]` `enabled`, `client_id`, `secret` via `env(...)`, and `site_url` and `additional_redirect_urls` for `http://localhost:8000` and `http://localhost:5173` (`/auth/callback`, `/reset-password`) -- AD-2.
- [x] `backend/` -- `uv init` app on Python 3.14. Deps: fastapi, uvicorn, pydantic-settings, psycopg[binary], psycopg_pool. Dev deps: pytest, httpx. Layout: `app/main.py`, `config.py`, `errors.py`, `db/pool.py`, `api/config.py`, and empty packages `services/`, `llm/`, `extraction/` -- seed layout.
- [x] `backend/app/config.py` -- settings plus `resolve_llm_mode()` per the matrix -- AD-4.
- [x] `backend/app/main.py` -- lifespan (resolve mode, open and close the pool), `/api` router, `/api/{path:path}` catch-all for all methods → `not_found`, SPA served from `FRONTEND_DIST` (default `frontend/dist`) only when it exists -- AD-17.
- [x] `backend/tests/` -- `conftest.py` sets `LLM_MODE=mock`. Tests: `/api/config` shape, the JSON 404, SPA fallback (temp dist dir), the three mode-resolution rows, no `openai` import outside `app/llm/` (AST scan), and the pool runs `SELECT 1` against local Supabase -- AD-3, AD-4.
- [x] `frontend/` -- `npm create vite@9 frontend -- --template react`. Add `@fontsource-variable/inter`. Vite proxies `/api` → `http://localhost:8000`. Remove the template's demo CSS and assets.
- [x] `frontend/src/styles/tokens.css` -- every DESIGN.md frontmatter token as `--…`; `global.css` sets body background and text from tokens, plus Inter -- AD-28.
- [x] `frontend/src/pages/Login.jsx` + `Login.module.css` -- placeholder: centred wordmark "Study Buddy" on the app background, composed per `key-login.html`; `App.jsx` routes every path to it.
- [x] `Dockerfile` -- stage 1 `node:24` builds the SPA; stage 2 `python:3.14-slim` with uv installs the backend from `uv.lock` and copies `dist`; `CMD uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1` -- AD-17.
- [x] `docker-compose.yml` -- one `app` service, `env_file: .env`, port `8000:8000`, `extra_hosts: host.docker.internal:host-gateway`.
- [x] `.env.example` -- every name above, empty, with a comment line per group and the local hints (`SUPABASE_URL=http://host.docker.internal:54321` goes in the comment only).
- [x] `.dockerignore` -- exclude `node_modules`, `.venv`, `.env`, `_bmad*`, `.claude`, `.logs`, `.git`.
- [x] `README.md` -- add a Norwegian "Kjør lokalt" section: the grader flow, plus the dev commands (`uv run uvicorn app.main:app --reload`, `npm run dev`) and `uv run pytest`.

**Acceptance Criteria:**
- Given a fresh clone with Docker running, when the grader follows README's steps (`.env.example` → `.env`, `npx supabase start` copying the printed keys, `npx supabase db reset`, `docker compose up`), then `http://localhost:8000` shows the placeholder Login screen on the token background in Inter.
- Given the repo, when it is inspected, then it matches the Structural Seed for every path this story creates.
- Given local Supabase running, when `uv run pytest` runs in `backend/` with no key, then every test passes.

## Implementation Notes

- `app.frontend("/", directory=..., fallback="index.html")` exists in the installed FastAPI 0.162.0 and is used as written. It falls back to `index.html` only for navigation requests (`Accept: text/html`, as browsers send), so a missing asset stays a 404. A plain `curl -i localhost:8000/projects/x` (Accept `*/*`) therefore gets the JSON 404; `curl -i -H "Accept: text/html" localhost:8000/projects/x` gets `index.html`. Tests send the browser header.
- Supabase CLI 2.122.0 rejects `enabled = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_ENABLED)"` when the variable is unset or empty ("Expected boolean"), and it reads the root `.env`. `.env.example` therefore ships `SUPABASE_AUTH_EXTERNAL_GOOGLE_ENABLED=false` (a non-secret default) instead of an empty value; every other name is empty.
- `LLM_MODE` resolution: in development, unset with no key gives `mock` plus one warning; unset with a key gives `live`. `LLM_MODE=live` without a key fails in every environment. Empty env values count as unset (`env_ignore_empty`).
- `FRONTEND_DIST` is a setting in `config.py` (default `<repo>/frontend/dist`, `/app/frontend/dist` in the image) and is listed in `.env.example`.
- `docker-compose.yml` overrides `SUPABASE_URL` and `DATABASE_URL` with the `host.docker.internal` values, so one `.env` (host values or empty) serves both Docker and host runs. The pool test still reads `Settings(_env_file=None)` so tests always target `127.0.0.1:54322`.
- FastAPI docs are served at `/api/docs` and `/api/openapi.json` (ReDoc off), keeping the root for the SPA (AD-17).
- Windows dev: psycopg async cannot use the Proactor loop. `uvicorn --reload` (the documented dev command) uses the selector loop, so it works; the pool test uses `asyncio.Runner(loop_factory=SelectorEventLoop)` on Windows.
- `tokens.css` was generated from DESIGN.md's frontmatter (colors, typography, rounded, spacing → `--color-*`, `--type-*-*`, `--radius-*`, `--space-*`, plus `--font-family` with the DESIGN.md fallback stack). Component specs are compositions of these and were not duplicated.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-11-05). Layers: blind (B), edge-case (E), verification-gap (V).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | V: handler-produced envelopes (HTTPException, 422, 500) untested | medium | Pre-verified; only the catch-all's direct `error_response` is asserted. | patch |
| 2 | V/B: dev + key → `live`, and dev + `live` without key, untested | medium | Pre-verified; every test has no key or is production. | patch |
| 3 | V/E: no test runs a successful lifespan; `open(wait=False)` unverified | medium | Pre-verified; all `TestClient`s skip the lifespan. | patch |
| 4 | V: default `frontend_dist` and image layout unverified | medium | Pre-verified; no CI or container harness yet. | defer |
| 5 | B/E: one `.env` can't serve Docker and host runs; empty URLs in the container hit loopback | medium | README step 4 makes the grader write `host.docker.internal` URLs; dev and tests need `127.0.0.1`. A compose `environment:` override for `SUPABASE_URL` and `DATABASE_URL` removes both. | patch |
| 6 | E: FastAPI `/docs`, `/redoc`, `/openapi.json` sit at the root, outside `/api` | low | `GET /docs` → 200 HTML on the running app; AD-17 puts all API routes under `/api/`. Direct fix: move the URLs under `/api`. | patch |
| 7 | E/B: `_http_error` drops `exc.headers` | low | `errors.py` builds a new response without `exc.headers`. One-line fix. | patch |
| 8 | E: `test_db_pool` opens the pool outside `try`, so a failed open leaks workers | low | `pool.open` precedes `try`. Direct fix: move it inside. | patch |
| 9 | B: Vite proxy targets `localhost`, which can resolve to `::1` | low | uvicorn binds 127.0.0.1. It works here, but it depends on the resolver. Direct fix: `127.0.0.1`. | patch |
| 10 | B: no favicon, so every load requests `/favicon.ico` (JSON 404) | low | Browsers request it without `Accept: text/html` and get the 404, which can break the "no console errors" check. Direct fix: an empty icon link. | patch |
| 11 | E: `.env.example` ships `SUPABASE_AUTH_EXTERNAL_GOOGLE_ENABLED=false`; the frozen intent says names have no value | medium | CLI 2.122.0 fails on an empty value (implementer-verified). No code fix satisfies the intent as written. Resolved: Ihor approved the `false` default (recorded in Boundaries). Code unchanged. | intent_gap → resolved |
| 12 | E/B: wrong method on a real route returns 404, not 405 | low | Confirmed (`POST /api/config` → 404). No client depends on 405; the fix needs route introspection. | reject |
| 13 | E: TRACE/CONNECT on unknown `/api` paths get 405 | low | Unlikely in use; adds methods for no consumer. | reject |
| 14 | E/B/V: module-level `create_app()` reads the real `.env` on test import | low | A malformed `.env` breaks the app too, loudly. The fix (factory app) changes the CMD and README. | reject |
| 15 | E: whitespace-only key counts as a key | low | Unlikely; it adds a guard. | reject |
| 16 | E: bad-case `LLM_MODE`/`APP_ENV` raise ValidationError, not ConfigError | low | Still fails loudly at startup, naming the field. | reject |
| 17 | E: tests read Google vars from the OS environment | low | Needs OS-level Google vars; unlikely. | reject |
| 18 | E: boundary test misses `importlib`/`__import__` | low | Unlikely; adds scanner branches. | reject |
| 19 | E: Google switch on with empty values enables the provider in Supabase | low | The README says to set all three; the app hides the button. No harm. | reject |
| 20 | E: relative `FRONTEND_DIST` resolves against cwd | low | It's optional with a working default; adds a validator. | reject |
| 21 | E: unreachable DB is invisible until the first request | false | `open(wait=False)` is the frozen intent. | reject |
| 22 | E: Windows dev without `--reload` can't use psycopg async | low | The documented dev command uses `--reload`; the grader runs Linux in Docker. Added to the AGENTS.md deferral (#26). | reject |
| 23 | B: catch-all ordering enforced only by a comment | low | A shadowed route fails its own tests at once with 404. | reject |
| 24 | B: no production validation of the Supabase/DB settings | low | Release work is deferred (spine › Deferred); it adds branches. | reject |
| 25 | B: `config.toml` env refs (Studio OpenAI, Twilio, Apple, S3) missing from `.env.example`; services left on; `seed.sql` missing | low | These are `supabase init` defaults for the CLI, not app variables. `db reset` passed. | reject |
| 26 | B: AGENTS.md "Running and verifying" is still TODO | medium | The fix edits agent-context files. | defer |
| 27 | B: story status differs between spec and sprint-status | false | Step 5 syncs sprint-status. | reject |
| 28 | B: `test-data/` not created | low | No 1.1 test needs samples; Story 2.2 creates them. | reject |
| 29 | B: `node:24` floating tag, no HEALTHCHECK | low | Builds work; it adds infra. | reject |
| 30 | B: `100vh`, no `Cache-Control` on `index.html`, no secret-leak test | low | Cosmetic, or for later deploys; the config response model has no secret field. | reject |

## Design Notes

`DATABASE_URL` is the direct Postgres URL. Locally it is `postgresql://postgres:postgres@127.0.0.1:54322/postgres` for dev and tests, and `host.docker.internal:54322` from the container. The two values differ only by host, as `SUPABASE_URL` does. The README states both.

## Verification

**Commands:**
- `cd backend && uv run pytest` -- expected: all pass, with local Supabase up.
- `cd frontend && npm run build` -- expected: builds; `grep -rE "#[0-9a-fA-F]{3,8}\b" src --include=*.css --include=*.jsx` matches only `tokens.css`.
- `docker compose build && docker compose up -d`, then `curl localhost:8000/api/config`, `curl -i localhost:8000/api/nope`, `curl -i -H "Accept: text/html" localhost:8000/projects/x` (browser navigation; `app.frontend` falls back only for HTML requests) -- expected: config JSON, JSON 404, `index.html`.

**Manual checks:**
- Open `http://localhost:8000`: dark background, Inter wordmark, no console errors.
