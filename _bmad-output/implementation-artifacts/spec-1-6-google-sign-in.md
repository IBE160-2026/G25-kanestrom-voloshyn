---
title: 'Story 1.6: Sign in with Google'
type: 'feature'
created: '2026-11-19'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: '0a961e57fdb7128c51321275c3f61559853d3c15'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-4-login-logout.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-5-password-reset.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Students can only sign up and log in with email and password. FR-19 (an Extension, third in the PRD §7.1 cut order) adds Google:
- a new Google email creates an Account with the Google first name and picture;
- a matching verified email Account is signed in and linked at once;
- a matching unverified email Account is taken over;
- an identity already linked elsewhere, or a cancelled consent, changes nothing.

**Approach:**
- Show "Sign in with Google" on Login and Create account only when `/api/config` says `google_enabled`.
- The button calls `supabase-js` `signInWithOAuth` (AD-1) with a redirect to the SPA's `/auth/callback`. That page finishes the session, maps any error, and then runs the normal post-sign-in path from Story 1.4.
- Supabase's automatic linking by email is accepted (AD-19). The backend adds AD-2 step 4 to `user_auth`: the takeover, committed in its own transaction before the route handler (AD-18). It also makes `GET /api/me` read the first name and picture from Google identity data when Google is linked.
- The one-time notice "Your account now signs in with Google." uses a new Undo message primitive (UX-DR2), with no action.

## Boundaries & Constraints

**Always:**
- **Takeover rule.** The takeover runs only when **all** of these hold:
  - the Supabase user has **both** an `email` and a `google` identity;
  - `profiles.email_verified_at IS NULL`;
  - `profiles.google_takeover_at IS NULL`.

  It runs once:
  1. Set a random password with the caller's own token (`PUT /auth/v1/user`; Decision, Ihor, 2026-11-19, AD-19 amended: the admin update would also end the caller's session), in `supabase_auth.py`, with no transaction open.
  2. Then, in its own short write transaction, delete every other `auth.sessions` row of the Account and set `google_takeover_at` and `notice_google_takeover = true`.

  The request's own connection is taken only after this. If step 2 fails, the next request retries; steps 1 and 2 are both idempotent. A Google-only Account never gets a password.
- **Enforced by `user_auth`.** The takeover runs whether or not the SPA ever calls `after-sign-in`. A backend test seeds the identities in `auth.identities` to prove it.
- **Profile from Google.** When a `google` identity exists, `GET /api/me` returns the first name from the Google identity data (`given_name`, else the first word of `full_name`/`name`) and `picture_url` (`avatar_url`/`picture`). `after-sign-in` stores that first name in `profiles` if it is unset. The name and picture are read-only (FR-27). Email-only Accounts are unchanged.
- **Callback errors.** `identity_already_exists` (or any "already linked" error) shows "This Google account is already linked to another Study Buddy account." A cancelled consent (`access_denied`) or any other error shows "Sign-in didn't work. Try again.". In both cases no Account changes and the student is back on Login.
- **Button visibility.** No Google button and no `/auth/callback` behaviour change when `google_enabled` is false. The grader runs without keys (AD-2, AGENTS.md mock policy).
- **Notice.** `notice_google_takeover` is shown once as the Undo message: bottom left of the main area, 6 s, staying while hovered or focused, `role="status"`. Showing or dismissing it calls a bookkeeping endpoint that clears the flag.
- **Avatar.** It shows the Google picture when one is present (an `<img>` with empty `alt`, since the name is in the trigger), and falls back to the initials if the image fails.
- Every string comes from the catalogues (EXPERIENCE.md lines 197, 200, 206; already signed off). Styles use only tokens. Admin calls go only through `supabase_auth.py`. The SPA calls Supabase only from `frontend/src/auth/`.

- Decision (Ihor, 2026-11-19): checking is automated (seeded `auth.identities` in the backend, stubbed `supabase-js` in the frontend), plus one manual check by Ihor with real credentials. The README (Norwegian) explains how to create a Google Cloud OAuth client (redirect URI `http://127.0.0.1:54321/auth/v1/callback`) and set `SUPABASE_AUTH_EXTERNAL_GOOGLE_ENABLED=true`, `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` in the local `.env` (never committed), then restart Supabase.

- Decision (Ihor, 2026-11-19, spine review of the AD-19 amendment, all five approved):
  - **(1)** The takeover runs only on a request whose token comes from a Google sign-in (`amr` includes `oauth`). Any other session of an Account whose takeover is due gets its own session deleted and `401 unauthorized`, and doesn't count as the takeover.
  - **(2)** On an unverified email Account, `user_auth` first removes (admin identity unlink) any Google identity whose email differs from the Account's email. Only a matching Google identity can cause a takeover.
  - **(3)** No Supabase Auth call, admin or user-token, inside an open write (AD-18).
  - **(4)** `supabase/config.toml` pins `secure_password_change = false`. The README notes the dashboard-only "Require current password" setting as a manual Cloud check. The adapter logs `reauthentication_needed`/`current_password_required` as a configuration error.
  - **(5)** The backend never sets a password on a Google-only Account, and the app never offers one.
- Decision (Ihor, 2026-11-19, code review): only a Google identity with `identity_data.email_verified = true` and the Account's email can match. The takeover transaction also sets `email_verified_at`. A refused non-Google session on a due Account gets the code `google_sign_in_required`, and Login shows the signed-off string "Your account now signs in with Google.".

**Never:**
- No "Link Google account" in Settings (Story 7.3); no `linkIdentity` call in this story.
- No takeover for a Google-only Account, and no password on one.
- No admin call or session deletion inside the request's transaction or any other open write.
- No Google button when it isn't configured.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Not configured | `google_enabled: false` | no Google button on Login or Create account; everything else unchanged | N/A |
| Configured | `google_enabled: true` | "Sign in with Google" on both screens; it starts `signInWithOAuth` with redirect `/auth/callback` | N/A |
| New Google email | callback with a new Google-only user | `after-sign-in` stores the Google first name; lands on `/projects`; the avatar shows the Google picture | N/A |
| Verified email Account | Google identity linked to an Account with `email_verified_at` set | signed in to that Account at once; no notice; email and password still work | N/A |
| Unverified email Account | Google identity linked to an Account with `email_verified_at` NULL | the takeover runs once: the old password fails, other sessions get `401`, the notice shows once | idempotent on retry |
| Takeover without the SPA | seeded email and google identities, unverified; any `/api` call with a valid token | the takeover runs inside `user_auth` before the handler | N/A |
| Google-only Account | only a `google` identity, `email_verified_at` NULL | no takeover; no password set | N/A |
| Squatter's session first | an unverified Account with a matching Google identity; the old password session calls `/api` before the Google session | that session is deleted and gets `401`; no takeover; the next Google-session request runs it | the squatter keeps nothing |
| Foreign Google identity | an unverified Account gains a Google identity whose email differs (e.g. through `linkIdentity`) | that identity is unlinked before any takeover; no takeover; the Account keeps its password | N/A |
| Already linked | callback error `identity_already_exists` | Login shows "This Google account is already linked to another Study Buddy account." | no change |
| Cancelled consent | callback error `access_denied` or another error | Login shows "Sign-in didn't work. Try again." | no change |
| Notice dismissed | the notice was shown once | the flag is cleared; later loads show no notice | N/A |

</frozen-after-approval>

## Code Map

- `backend/app/auth.py` -- `user_auth`: `_validated_token` (step 1, no connection), then `Conn` for steps 2–3; `CurrentUser.providers` comes from Supabase identities. Add step 4 as a sub-dependency between `_validated_token` and `Conn`, with its own pool connection (the `app.state.pool` pattern from `password_reset`/`verification`).
- `backend/app/supabase_auth.py` -- the only Supabase Auth HTTP caller (`get_user`, `generate_recovery_link`). Add `set_random_password(client, settings, token)` via the caller's own `PUT /auth/v1/user` (amended AD-19) with a `secrets.token_urlsafe` password. The user object `get_user` returns already carries `identities[].identity_data`.
- `backend/app/db/sessions.py` (`delete_others`), `db/profiles.py` -- reuse them. Add `profiles.mark_takeover` and the notice clear.
- `backend/app/api/me.py` -- the `Me` model; add `picture_url` and `notice_google_takeover`, plus `POST /api/me/notices/google-takeover` (clear, bookkeeping).
- `backend/tests/test_auth.py` / `test_me.py` -- the `gotrue`, `db` and `stub_auth` fixtures. Seed a Google identity with SQL into `auth.identities` (provider `google`, `identity_data` JSON) for a GoTrue-created user.
- `frontend/src/auth/index.js` -- add `signInWithGoogle()` and `completeOAuth()` (read the session after the redirect; map URL `error`/`error_code`).
- `frontend/src/pages/Login.jsx`, `CreateAccount.jsx` -- they say "The Google button arrives with Story 1.6"; add it behind `google_enabled` (from `/api/config`, already loaded in `auth/`). New `pages/AuthCallback.jsx` at `/auth/callback`; `supabase/config.toml` already allows that redirect.
- `frontend/src/components/Avatar.jsx`, `AccountMenu.jsx`, `TopBar.jsx` -- the avatar takes `pictureUrl`. New `components/UndoMessage.jsx`, mounted where the signed-in shell (`AppShell.jsx`) can show it.

## Tasks & Acceptance

**Execution:**
- [x] `backend/app/supabase_auth.py` -- `set_random_password`.
- [x] `backend/app/auth.py` + `db/profiles.py` + `db/sessions.py` -- step 4 (the takeover) in its own transaction before the request's connection.
- [x] `backend/app/api/me.py`, `services/identity.py`, `api/auth.py` -- the Google name and picture in `GET /api/me`; `after-sign-in` stores the Google first name; the notice flag and its clear endpoint.
- [x] `backend/tests/test_google.py` -- every backend matrix row with seeded identities (the takeover without the SPA; Google-only gets no password; idempotency; other sessions get 401; the old password fails).
- [x] `frontend/src/auth/index.js`, `pages/AuthCallback.jsx`, routes, the Login and Create account buttons -- behind `google_enabled`.
- [x] `frontend/src/components/UndoMessage.jsx` (+ CSS) and its use for the takeover notice; the Avatar picture with initials fallback.
- [x] Frontend tests -- every SPA matrix row with `supabase-js` and `fetch` stubbed.
- [x] `README.md` (Norwegian) -- Google stays hidden without keys; how to create the OAuth client and turn it on (frozen decision).

**Acceptance Criteria:**
- Given no Google keys, when the grader runs the app, then no Google button appears and every earlier flow and test still passes.
- Given the source, when it is searched, then admin calls are only in `supabase_auth.py`, Supabase in the SPA only in `frontend/src/auth/`, and the boundary tests pass.

## Implementation Notes

- `supabase_auth.py`: `set_random_password` (the caller's own `PUT /auth/v1/user`, per the amended AD-19; GoTrue's admin update would also end the caller's session; never logged; the next request retries after any failure), `unlink_identity`, `google_identities` and the pure `google_profile(user)` (first name from `given_name`, else the first word of `full_name`/`name`, max 100; picture from `avatar_url`/`picture`, http(s) only).
- `auth.py`: step 4 is the `_google_takeover` sub-dependency between `_validated_token` and `Conn`. Only for providers ⊇ {email, google}: a short pool connection checks the session (same step-2 verdict) and `profiles.google_state`; verified Accounts stop there. Then, with no connection held: every Google identity whose `identity_data.email` differs (case-insensitive) from the Account's email is unlinked, and the request continues without it. While the takeover is due and a matching Google identity remains, a token whose `amr` lacks `oauth` gets its own session deleted (`sessions.delete_one`, own short transaction) and `401 unauthorized`, which doesn't count as the takeover. A Google session sets the random password with its own token and then, in its own transaction, re-checks with a row lock, deletes the other sessions and records the takeover. `CurrentUser.google` carries the Google profile.
- Identity unlink: GoTrue has no admin identity delete (`DELETE /auth/v1/admin/users/{id}/identities/{identity_id}` answers 404 on local GoTrue). `supabase_auth.unlink_identity` uses the documented `DELETE /auth/v1/user/identities/{identity_id}` with the caller's own token (needs `enable_manual_linking = true`, already set; checked: 200, the identity row is gone, the session stays).
- The random password is 40 characters with at least one lowercase letter, uppercase letter, digit and punctuation character. The password update maps 401/403 to `unauthorized`; `reauthentication_needed`, `current_password_required` and `weak_password` are logged as a configuration error (code only) and answer `503 auth_unavailable`, like any other failure. `supabase/config.toml` pins `secure_password_change = false` under `[auth.email]` with a comment.
- `GET /api/me` (and every `Me` reply) has `picture_url` and `notice_google_takeover`; with Google linked, `first_name` is the Google one (falls back to the stored one when Google gives none). `after-sign-in` fills an unset `profiles.first_name` with the Google first name. `POST /api/me/notices/google-takeover` clears the flag (on the AD-22 allowlist).
- SPA: `auth.googleEnabled()` (config loaded once, false on failure), `signInWithGoogle()` (redirect `origin + /auth/callback`), `completeOAuth()` (reads `error`/`error_code`/`error_description` from query or fragment first; `identity_already_exists`/`identity_already_linked` or an "already linked/exists" description → `in_use`, else `failed`; otherwise `getSession()`, which waits for supabase-js to read the URL; shared while in flight). `components/GoogleSignIn.jsx` renders the button and the "or" divider only when enabled. `/auth/callback` renders Login when Google is off; otherwise it finishes the session, runs `after-sign-in`, applies the language, and lands on the remembered route, the last Project, or `/projects`. Errors go to Login via `state.googleError`, shown as the Error line, then cleared from history. A failed `after-sign-in` signs out (unless `api/client.js` already did).
- `components/UndoMessage.jsx` (UX-DR2): polite `role="status"` region mounted empty, text added after mount; 6 s, paused while hovered or focused; optional action. Placed last in `<main>` as a zero-height sticky region, so the box sits at the main area's bottom left. `AppShell` shows the takeover notice once per flag and POSTs the clear when it is shown.
- `Avatar` takes `pictureUrl`: `<img alt="" referrerPolicy="no-referrer">`, initials when it fails.
- Catalogue keys: `login.google`, `login.or`, `login.errors.googleInUse`, `account.googleTakeover`, `errors.google_identity_in_use`. `login.or` ("or" / "eller") has no EXPERIENCE.md row (the Auth panel's divider in DESIGN.md) and needs both reviewers' approval.
- Code review follow-ups: a Google identity matches only with `identity_data.email_verified` true and the Account's email (`supabase_auth.account_email`: `user.email`, else the email identity's `identity_data.email`; without either, nothing is unlinked or taken over). `google_profile` prefers the identity with the Account's email. The takeover re-reads `takeover_due` before the password call, sets `email_verified_at` (COALESCE) in its transaction, and logs a lost locked re-check at warning. A refused non-Google session gets `401 google_sign_in_required`, which the SPA treats as signed out and Login shows as "Your account now signs in with Google.". `manual_linking_disabled` on unlink is logged as a configuration error. SPA: `auth.googleSetting()` ('on' | 'off' | 'unknown'); `/auth/callback` sends 'unknown' to Login with the failure line; the Google button resets on `pageshow` with `persisted`; the notice clear retries once and a module-level flag (`components/takeoverNotice.js`) keeps a shell remount from showing it again; the no-action Undo message is not a Tab stop and Escape dismisses it while hovered or focused. `errors.google_identity_in_use` was removed from the catalogues. `config.toml` also allows `http://127.0.0.1:8000/auth/callback` and `/reset-password`.
- Tests: `backend/tests/test_google.py` (real GoTrue with seeded `auth.identities`; Google sessions are real password sessions whose token claims are rewritten to `amr` oauth while every Supabase Auth call is forwarded to GoTrue; plus a stubbed Supabase Auth for ordering, rollback, retries and the error mappings). `frontend/src/auth/google.test.jsx` and `pages/GoogleSignIn.test.jsx`. Mutations checked: removing the hover/focus pause or the image fallback makes a test fail.
- `docker compose up -d --build` replaced, as before, by `docker build -t g25-kanestrom-voloshyn-app .` and `docker compose up -d --no-build`; `/api/config` reports `google_enabled: false` and `/auth/callback` serves the SPA.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-11-19). Layers: blind (B), edge-case (E), verification-gap (V).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | B: Google's `email_verified` claim is never checked | high | The takeover relies on Google proving the address; `identity_data.email_verified` is unread. | patch (frozen decision added) |
| 2 | B: a takeover leaves `email_verified_at` NULL | medium | Google proved the address, yet `/api/me` still says unverified. | intent_gap → resolved (Ihor: mark verified) |
| 3 | E: `user.email` missing makes every Google identity "foreign", so the legitimate one is unlinked | medium | `_same_email(g.email, valid.email)` with None. Direct guard. | patch |
| 4 | B/E: `google_profile` takes the first Google identity in any order | medium | It can show another identity's name and picture. Prefer the one matching the Account's email. | patch |
| 5 | B/E: `/auth/callback` treats a failed `/api/config` as "Google off" and silently shows Login | medium | The sign-in is lost with no error. | patch |
| 6 | B: Google sign-in from `127.0.0.1` or the LAN address falls back to `site_url` | medium | The redirect allowlist has only `localhost`. Add `127.0.0.1:8000`, and say so in the README. | patch |
| 7 | B: a refused password session gets a generic 401 with no hint | medium | The real owner is thrown out without guidance. Use a distinct code plus the existing signed-off string. | patch |
| 8 | V/B: unlink failures, the locked re-check race, supabase-js's top-level `error.code`, and the callback's remembered route are untested | medium | Pre-verified gaps. | patch |
| 9 | E: email verified between the first read and the password update | low | A verified Account's password could be replaced. Narrow it: re-check just before the password call, and log a lost race. | patch |
| 10 | E: manual linking off in Cloud makes the unlink fail with 503 forever | low | Log it as a configuration error, plus a README note. | patch |
| 11 | B/E: the notice can show twice (remount, or a failed clear) | low | Direct fix: retry the clear and use a module-level guard. | patch |
| 12 | B/E: the Google button stays disabled after Back from consent (bfcache) | low | Direct `pageshow` reset. | patch |
| 13 | B: the Undo message isn't focusable and has a misleading comment | low | With no action it's a status line; fix the comment and add Escape to dismiss. | patch |
| 14 | B: dead `errors.google_identity_in_use` key | low | Unused; delete it. | patch |
| 15 | B: an extra pool connection on every verified Google request | low | A performance optimisation; adds branches. | reject |
| 16 | E: a recovery session is refused while a takeover is due | low | Rare (the takeover runs on the first Google request); allowing it needs `amr` rules for recovery. | reject |
| 17 | B: GoTrue auto-linking only checked manually | low | Covered by Ihor's manual check (frozen decision). | reject |
| 18 | B: spec and tracking disagree; Code Map mentions TopBar | false | Step 5 syncs; `docker compose up -d --build` works here; the Code Map is guidance. | reject |

## Verification

**Commands:**
- `cd backend && uv run pytest` -- expected: all pass against local Supabase.
- `cd frontend && npm test && npm run lint && npm run build` -- expected: all pass; only `tokens.css` has hex colours.
- `docker compose up -d --build` -- expected: with no Google keys, the Login screen has no Google button.

**Manual checks:**
- Without keys: Login and Create account show no Google button. With keys (Ihor's manual check): sign in with a new Google account, with a verified email Account's address, and with an unverified one; see the takeover notice once.
