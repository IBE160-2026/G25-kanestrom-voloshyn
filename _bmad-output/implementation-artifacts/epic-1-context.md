# Epic 1 Context: Get in: accounts, sign-in, and a runnable app

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Lay the foundation every later epic builds on. The grader can clone the repo and run the whole app locally in mock mode, with no paid key. A student can create an Account with email or Google, log in, stay signed in, log out, reset a forgotten password, and use the interface in English or Norwegian (bokmål) from the first screen. Epic 1 adds the scaffold, the identity backend, the auth dependency that every later data endpoint relies on, the design tokens, and the i18n system. All later epics assume these exist.

## Stories

- Story 1.1: Runnable app skeleton the grader can start locally
- Story 1.2: Switch the interface between English and Norwegian
- Story 1.3: Create an account with email and password
- Story 1.4: Log in, stay signed in, and log out
- Story 1.5: Reset a forgotten password
- Story 1.6: Sign in with Google

## Requirements & Constraints

- **Runnability:** the grader flow is `.env.example` → `.env`, then `npx supabase start` (copy the printed local keys into `.env`), then `npx supabase db reset`, then `docker compose up`. It needs no API key and makes no paid calls. Tests run green with `uv run pytest`, always with `LLM_MODE=mock`, against local Supabase.
- **Accounts:** sign-up takes a first name, an email, and a password of at least 8 characters. Only one Account may exist per email, whichever method created it. A duplicate shows "An account with this email already exists. Log in instead?". An automated test must show that a 7-character password fails. Passwords are never stored or logged in plain text.
- **Email verification:** the backend emails a single-use link valid for 24 h. It can be resent, and a resend invalidates older links. Verification gates **only** Google linking; nothing else is blocked.
- **Login:**
  - A failed login shows one generic message that never reveals whether the email is registered.
  - After login the student lands on the most recently used active Project, or on the Projects page (empty). Until Epic 2 that is always the Projects page.
  - A session lasts 30 days. Logout ends it at once, and the old token is refused.
  - After expiry, the next login returns the student to the same page, with "You've been signed out. Log in to continue." shown first.
- **Password reset:**
  - Every request gets the same reply: "If an account exists, we've sent a link". Only Accounts with an email identity get an email.
  - A link is valid for 1 h and works once, and a newer link replaces older ones. An expired, used, or replaced link shows "This link has expired" with "Send a new link".
  - After a reset, the old password fails and every other session ends.
  - Reset works the same for unverified Accounts.
- **Google:**
  - The button is hidden when Google isn't configured.
  - A new Google email creates an Account with the Google first name and picture.
  - A matching **verified** email Account is signed in and linked at once, with no password step and no message.
  - A matching **unverified** email Account is taken over: its password stops working, all earlier sessions end, and a one-time notice says "Your account now signs in with Google."
  - A Google identity already linked to another Account, or a cancelled consent, changes nothing and shows an error.
- **Language:**
  - With no saved choice, the interface follows the browser language, falling back to English.
  - The student can switch before sign-in, and the choice persists across reloads.
  - After sign-in, the choice is saved to the Account and follows the student to other browsers.
  - Errors and limit messages are translated too.
  - Norwegian strings stay draft. Final wording is accepted in Story 7.5, after team sign-off; that doesn't block this epic.
- **Security:** never log passwords, tokens (including verification tokens), or keys. Secrets live only in `.env`. `.env.example` lists every variable name without a value.

## Technical Decisions

- **Scaffold (Structural Seed):**
  - `frontend/` from `npm create vite@9` (React, JavaScript; Vite 8)
  - `backend/` as a uv project (Python 3.14) running async FastAPI, with one `psycopg_pool.AsyncConnectionPool`, plain SQL in `app/db/`, and no ORM
  - `supabase/` with `config.toml` and `migrations/`
  - the root `package.json` pinning `supabase@2.122.0` **exactly**
  - one multi-stage `Dockerfile` (build the SPA, then the Python runtime), plus a `docker-compose.yml` with one container that adds `extra_hosts: host.docker.internal:host-gateway`
  - one instance, one uvicorn worker
- **Routing:**
  - All API routes live under `/api/`.
  - An `/api/{path}` catch-all returns the JSON error envelope with `404 not_found`.
  - The SPA is served via `app.frontend("/", …, fallback="index.html")`, so deep links work.
  - In development, Vite proxies `/api` to uvicorn.
- **Runtime config:** `GET /api/config` returns only `{supabase_url, supabase_publishable_key, google_enabled}`. Supabase values are never set at build time, and there are no `VITE_*` secrets. All settings come from `backend/app/config.py` (Pydantic settings, read from env). `SUPABASE_URL` is for server-to-server calls; `SUPABASE_PUBLIC_URL` is what the browser uses. Don't use the `SUPABASE_AUTH_*` prefix for app variables, except the Google switch.
- **Mock-mode startup:** with `APP_ENV=development`, no key, and `LLM_MODE` unset, the mode resolves to `mock` and logs a warning. With `APP_ENV=production`, startup fails if `LLM_MODE` is unset, or is `live` without a key. A test asserts that no module outside `app/llm/` imports `openai`.
- **Supabase auth settings** live in `config.toml`:
  - `enable_confirmations = false` (verification is app-level)
  - `minimum_password_length = 8`
  - `enable_manual_linking = true`
  - `otp_expiry = 3600`
  - Google `enabled = env(SUPABASE_AUTH_EXTERNAL_GOOGLE_ENABLED)`, with the client id and secret via `env()`
  - `site_url` and the redirect URLs (`/auth/callback`, the reset route) set per environment
- **Browser and Supabase:**
  - `supabase-js` (only in `frontend/src/auth/`) is used for sign-up, password login, `signInWithOAuth` and `linkIdentity`, logout, reading the session token, completing a reset, and `updateUser({password})`. It never calls `updateUser({email})`.
  - All app data goes through `/api/*` via `frontend/src/api/client.js`.
  - After sign-up and after every sign-in, the SPA calls `POST /api/auth/after-sign-in`; after a completed reset it calls `POST /api/auth/after-password-reset`.
- **`user_auth` (`app/auth.py`)** is the only token parser for user routes, alongside `phone_link_auth`, which comes later. It works in four steps:
  1. It validates the token via `GET {SUPABASE_URL}/auth/v1/user`.
  2. It looks up `session_id` in `auth.sessions`. A missing row gives `unauthorized`. A NULL `created_at`, or one older than `SESSION_MAX_AGE_DAYS` (30), gives `session_expired`.
  3. It creates the `profiles` row idempotently (`ON CONFLICT DO NOTHING`).
  4. It enforces the Google takeover once: when the Account has a Google identity, `email_verified_at IS NULL`, and `google_takeover_at IS NULL`, it sets a random password via the admin API, deletes every other session, and sets `google_takeover_at` and `notice_google_takeover`. This must work even if the SPA never calls `after-sign-in`, and a test must use seeded identities to prove it.

  On `unauthorized` or `session_expired`, the SPA signs out and keeps the intended route in `sessionStorage`.
- **Identity data and services:**
  - `profiles` (keyed by `account_id` → `auth.users`, `ON DELETE CASCADE`) holds `first_name`, `language`, `email_verified_at`, `google_takeover_at`, `notice_google_takeover`, `ui_prefs jsonb`, `last_project_id`, and `privacy_notice_ack_at`.
  - `email_verifications` stores hashed single-use tokens; the link is `GET /api/auth/verify?token=`.
  - `GET/PATCH /api/me` reads and writes the profile; `PATCH` also saves the language.
  - The schema changes only through SQL in `supabase/migrations/`.
- **Password reset:** `POST /api/auth/password-reset` always answers the same way. For an Account with an email identity, it calls admin `generate_link` (type recovery, with no Supabase email) and sends the link itself.
- **Email:** only `mailer.py` sends auth emails, over SMTP (Mailpit locally, `localhost:54324`). Emails use `profiles.language`, falling back to the pre-sign-in language the SPA sends.
- **Error shape:** `{"error": {"code", "params", "message"}}` with a matching HTTP status. The SPA renders errors from `code` and `params` and never shows `message`. Relevant codes: `unauthorized`, `session_expired`, `not_found`, `email_not_verified`, `google_identity_in_use`.
- **Async:** route handlers, repositories, and the mailer are `async`; pure helpers stay synchronous. Each request uses one transaction, and services take `conn` and never commit.
- **Frontend:**
  - `frontend/src/styles/tokens.css` holds every DESIGN.md frontmatter token as a CSS custom property. Components use only `var(--…)`. Dark theme only.
  - One CSS Module per component (`PascalCase.jsx` with `PascalCase.module.css`); no Tailwind and no component library.
  - Radix (`radix-ui`) for focus-managed widgets, such as the Account menu dropdown.
  - `react-router` 8, `@fontsource-variable/inter` (bundled, no Google Fonts request), and `lucide-react`.
  - Strings come from `frontend/src/i18n/en.json` and `nb.json` through `react-i18next` (i18next), with singular and plural forms.

## UX & Interaction Patterns

- **Login screen:** the wordmark; the tagline "Study from your own notes, with sources"; "Sign in with Google"; email and password with "Log in"; "Forgot password?"; "Create account"; the privacy line "Your files are only used to create your study material."; and the EN | NO toggle. Build it from `mockups/key-login.html` for composition, with DESIGN.md winning on any conflict.
- **Error line:** sits above the buttons and is announced to assistive technology. Buttons stay active, the typed email stays, and focus returns to the form. Failures read "Sign-in didn't work. Try again.", and a bad login reads "Wrong email or password."
- **Other auth screens:** the Create account screen (first name, email, password, or Google) and the Password reset screens (a request screen, then a new-password screen). The language toggle appears on Login, Create account, and Password reset.
- **Account menu:** top right on signed-in pages. It shows "Welcome, {first name}" plus the avatar (a Google photo, or initials for email accounts). It holds Language (English / Norsk, each named in its own language) and an immediate Log out, which lands on Login. Settings is added in Story 7.3. Below 1024 px the menu shows the avatar only.
- **Projects page (empty):** "Create your first project". The takeover notice reuses the Undo message component, with no action.
- **Copy:** every string comes from the EXPERIENCE.md Strings by surface table (English plus drafted Norwegian).
- **Every story is done only with:** empty, loading, error, and narrow-window states; keyboard paths; reduced motion; the Accessibility Floor (WCAG AA contrast, 44×44 px targets, live regions); and no hard-coded colours.

## Cross-Story Dependencies

- Story 1.1 comes first: everything else needs the scaffold, `/api/config`, the error envelope, mock-mode tests, `tokens.css`, and `config.toml`.
- Story 1.2's i18n system is used by every later screen. The Norwegian wording is accepted only in Story 7.5.
- Story 1.3 creates `profiles`, `after-sign-in`, verification, and `mailer.py`, which Stories 1.5 and 1.6 reuse. Story 1.4's `user_auth` guards every data endpoint in Epics 2–7, and Story 1.6's takeover check lives inside it.
- Later epics extend this work. Epic 2 adds Projects, real landing on the last Project, and the privacy-notice acknowledgment, using `profiles.privacy_notice_ack_at`. Epic 7 adds Settings, linking Google from Settings, account deletion, and the full bilingual sign-off.
