# Epic 1 Context: Get in: accounts, sign-in, and a runnable app

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Lay the foundation every later epic builds on. The grader can clone the repo and run the whole app locally in mock mode, with no paid key. A student can create an Account with email or Google, log in, stay signed in, log out, reset a forgotten password, and use the interface in English or Norwegian (bokmål) from the first screen. Epic 1 delivers the scaffold, the identity backend, the auth dependency that guards every later data endpoint, the design tokens, the i18n system, and the backend and frontend test setups that all later epics assume.

## Stories

- Story 1.1: Runnable app skeleton the grader can start locally
- Story 1.2: Switch the interface between English and Norwegian
- Story 1.3: Create an account with email and password
- Story 1.4: Log in, stay signed in, and log out
- Story 1.5: Reset a forgotten password
- Story 1.6: Sign in with Google

## Requirements & Constraints

- **Runnability:** `.env.example` → `.env`, `npx supabase start` (copy the printed local keys into `.env`), `npx supabase db reset`, `docker compose up`. No API key, no paid calls. Backend tests: `uv run pytest`, always `LLM_MODE=mock`, against local Supabase. Frontend tests: `npm test` in `frontend/`, no backend needed.
- **Accounts:** sign-up takes first name, email, and a password of at least 8 characters. One Account per email, whichever method created it; a duplicate shows "An account with this email already exists. Log in instead?". An automated test shows a 7-character password fails. Passwords are never stored or logged in plain text.
- **Email verification:** single-use link valid 24 h, resendable; a resend invalidates older links. Verification gates **only** Google linking; nothing else is blocked.
- **Login:** one generic failure message that never reveals whether the email exists. After login: the most recent active Project, else the Projects page (always the empty Projects page until Epic 2). Sessions last 30 days; logout ends the session at once and the old token is refused. After expiry, the next login returns to the same page, with "You've been signed out. Log in to continue." shown first.
- **Password reset:** every request gets "If an account exists, we've sent a link"; only Accounts with an email identity get mail. Links last 1 h, work once, and a newer link replaces older ones; expired/used/replaced links show "This link has expired" with "Send a new link". After a reset the old password fails and every other session ends. Unverified Accounts reset the same way.
- **Google:** button hidden when Google isn't configured. New Google email → new Account with Google first name and picture. Matching **verified** email Account → signed in and linked at once, no password step, no message. Matching **unverified** email Account → taken over: password stops working, all earlier sessions end, one-time notice "Your account now signs in with Google." An identity already linked elsewhere, or cancelled consent, changes nothing and shows an error.
- **Language:** no saved choice → browser language, fallback English. Switchable before sign-in and persists across reloads; after sign-in it is saved to the Account and follows the student to other browsers. Errors and limit messages are translated too. Norwegian stays draft; final wording is accepted in Story 7.5 after team sign-off, which doesn't block this epic.
- **Security:** never log passwords, tokens (including verification tokens), or keys. Secrets only in `.env`; `.env.example` lists every variable name without a value.

## Technical Decisions

- **Scaffold:** `frontend/` from `npm create vite@9` (React, JavaScript, Vite 8); `backend/` as a uv project (Python 3.14), async FastAPI, one `psycopg_pool.AsyncConnectionPool`, plain SQL in `app/db/`, no ORM; `supabase/` with `config.toml` and `migrations/`; root `package.json` pins `supabase@2.122.0` exactly; Node ≥ 22.22.2 (24 ≥ 24.15 or 26) in `engines`. One multi-stage `Dockerfile` (SPA build, then Python runtime) and a one-container `docker-compose.yml` with `extra_hosts: host.docker.internal:host-gateway`. One instance, one uvicorn worker.
- **Routing:** all API routes under `/api/`; an `/api/{path}` catch-all returns the JSON envelope with `404 not_found`; the SPA is served via `app.frontend("/", …, fallback="index.html")` so deep links work; in dev, Vite proxies `/api`.
- **Runtime config:** `GET /api/config` returns only `{supabase_url, supabase_publishable_key, google_enabled}`; no build-time Supabase values, no `VITE_*` secrets. Settings live in `backend/app/config.py` (Pydantic settings). `SUPABASE_URL` is server-to-server; `SUPABASE_PUBLIC_URL` is for the browser. App variables avoid the `SUPABASE_AUTH_*` prefix except the Google switch.
- **Mock-mode startup:** `APP_ENV=development`, no key, `LLM_MODE` unset → `mock` with a logged warning. `APP_ENV=production` fails if `LLM_MODE` is unset or `live` without a key. A test asserts no module outside `app/llm/` imports `openai`.
- **Supabase auth (`config.toml`):** `enable_confirmations = false` (verification is app-level), `minimum_password_length = 8`, `enable_manual_linking = true`, `otp_expiry = 3600`, Google `enabled = env(SUPABASE_AUTH_EXTERNAL_GOOGLE_ENABLED)` with client id/secret via `env()`, per-environment `site_url` and redirect URLs (`/auth/callback`, the reset route).
- **Browser and Supabase:** `supabase-js` only in `frontend/src/auth/`, for sign-up, password login, `signInWithOAuth`/`linkIdentity`, logout, reading the token, completing a reset, and `updateUser({password})`; never `updateUser({email})`. All app data goes through `frontend/src/api/client.js`. After sign-up and every sign-in the SPA calls `POST /api/auth/after-sign-in`; after a completed reset, `POST /api/auth/after-password-reset`.
- **`user_auth` (`app/auth.py`)** is the only token parser for user routes (`phone_link_auth` comes later). It (1) validates the token via `GET {SUPABASE_URL}/auth/v1/user`; (2) looks up `session_id` in `auth.sessions`: missing → `unauthorized`, NULL or older than `SESSION_MAX_AGE_DAYS` (30) `created_at` → `session_expired`; (3) creates the `profiles` row idempotently; (4) enforces the Google takeover once: Google identity + `email_verified_at IS NULL` + `google_takeover_at IS NULL` → random password via admin API, delete every other session, set `google_takeover_at` and `notice_google_takeover`. This must work even if the SPA never calls `after-sign-in`; a test with seeded identities proves it. On `unauthorized`/`session_expired` the SPA signs out and keeps the intended route in `sessionStorage`.
- **Identity data:** `profiles` (`account_id` → `auth.users`, `ON DELETE CASCADE`) with `first_name`, `language`, `email_verified_at`, `google_takeover_at`, `notice_google_takeover`, `ui_prefs jsonb`, `last_project_id`, `privacy_notice_ack_at`. `email_verifications` stores hashed single-use tokens; link is `GET /api/auth/verify?token=`. `GET/PATCH /api/me` reads/writes the profile, including language. Schema changes only via SQL in `supabase/migrations/`.
- **Password reset:** `POST /api/auth/password-reset` always answers identically; for an email identity it calls admin `generate_link` (type recovery, no Supabase email) and sends the link itself.
- **Email:** only `mailer.py` sends auth mail, over SMTP with `aiosmtplib` (Mailpit locally: SMTP on port 54325, enabled in `config.toml` and reached from the container via `host.docker.internal`; web UI at `localhost:54324`). Mail goes out after the commit (AD-18), in `profiles.language`, falling back to the pre-sign-in language the SPA sends.
- **Errors:** `{"error": {"code", "params", "message"}}` with a matching HTTP status. The SPA renders from `code` + `params` via the i18n catalogues and never shows `message`. Epic 1 codes: `unauthorized`, `session_expired`, `not_found`, `email_not_verified`, `google_identity_in_use`, plus generic HTTP codes `bad_request`, `forbidden`, `method_not_allowed`, `conflict`, `invalid_request`, which now have catalogue strings.
- **Async and transactions:** routes, repositories, and the mailer are `async`; pure helpers sync. One transaction per request; services take `conn` and never commit.
- **Frontend:** `frontend/src/styles/tokens.css` holds every DESIGN.md token as a custom property; components use only `var(--…)`; dark theme only. One CSS Module per component (`PascalCase.jsx` + `PascalCase.module.css`); no Tailwind or component library. Radix (`radix-ui`) for focus-managed widgets (e.g. Account menu), `react-router` 8, bundled `@fontsource-variable/inter`, `lucide-react`. Strings come from `frontend/src/i18n/en.json` / `nb.json` via `react-i18next`, with plural forms.
- **Frontend tests:** Vitest 5.1 + `@testing-library/react` (+ `/dom`), `@testing-library/jest-dom`, `@testing-library/user-event`, jsdom 31, all devDependencies in `frontend/`. `npm test` = `vitest run`, configured in `vite.config.js`, `globals: false` (import from `vitest`), one setup file `src/test/setup.js`. Tests need no backend, Supabase, or network: `api/client.js` and `auth/` are tested by stubbing `fetch` and `supabase-js`; every other test mocks those two modules. Use the real i18n catalogues through a shared render helper; never mock `react-i18next`. Use user-event for keyboard paths. If jsdom 31 breaks the first render test, pin jsdom 30.1.

## UX & Interaction Patterns

- **Login screen:** wordmark; tagline "Study from your own notes, with sources"; "Sign in with Google"; email + password with "Log in"; "Forgot password?"; "Create account"; privacy line "Your files are only used to create your study material."; EN | NO toggle. Compose from `mockups/key-login.html`; DESIGN.md wins on conflict.
- **Error line:** above the buttons, announced to assistive tech. Buttons stay active, the typed email stays, focus returns to the form. Bad login: "Wrong email or password."; failure or cancel: "Sign-in didn't work. Try again."; short password: "Use at least 8 characters."
- **Other auth screens:** Create account (first name, email, password, or Google); Password reset request ("Reset your password" · "Send link") and new-password ("Choose a new password" · "Save password") screens, then "Your password is changed. Log in with the new one." The language toggle appears on Login, Create account, and Password reset.
- **Account menu:** top right on signed-in pages: "Welcome, {first name}" plus avatar (Google photo, or initials). Holds Language (English / Norsk, each in its own language) and an immediate Log out landing on Login; Settings arrives in Story 7.3. Below 1024 px it shows the avatar only.
- **Projects page (empty):** "Create your first project". The takeover notice reuses the Undo message component, with no action.
- **Copy:** every string, including API error messages, comes from the EXPERIENCE.md strings table (English plus draft Norwegian). Failures are stated briefly and calmly, never as technical codes.
- **Done for every story:** empty, loading, error, and narrow-window states; keyboard paths; reduced motion; the Accessibility Floor (WCAG AA contrast, 44×44 px targets, live regions); no hard-coded colours.

## Cross-Story Dependencies

- Story 1.1 comes first: the scaffold, `/api/config`, the error envelope, mock-mode tests, `tokens.css`, and `config.toml` underpin everything.
- Story 1.2 sets up i18n, the API-error rendering from `code`/`params`, and the frontend test conventions that every later screen reuses. Norwegian wording is accepted only in Story 7.5.
- Story 1.3 creates `profiles`, `after-sign-in`, verification, and `mailer.py`, reused by Stories 1.5 and 1.6. Story 1.4's `user_auth` guards every data endpoint in Epics 2–7, and Story 1.6's takeover check lives inside it.
- Later epics extend this: Epic 2 adds Projects, landing on the last Project, and the privacy-notice acknowledgment (`profiles.privacy_notice_ack_at`); Epic 7 adds Settings, linking Google from Settings, account deletion, and the bilingual sign-off.
