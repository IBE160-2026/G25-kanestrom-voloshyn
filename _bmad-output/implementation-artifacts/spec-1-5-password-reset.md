---
title: 'Story 1.5: Reset a forgotten password'
type: 'feature'
created: '2026-11-16'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: '2c15f2225417a7ac513ae06db410f4b60834cb58'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-3b-email-verification.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-4-login-logout.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A student who forgets their password can't get back in. FR-3 needs an emailed reset link that is valid for 1 hour and single use, where a newer link replaces older ones. The request must give the same reply whether or not the email has an Account, and after a reset the old password must fail and every other session must end.

**Approach:**
- `POST /api/auth/password-reset` always answers the same. In the background, for an Account with an email identity, it calls Supabase admin `generate_link` (recovery; Supabase sends nothing) through `supabase_auth.py`, then emails our own link through `mailer.py`. The link is `{APP_PUBLIC_URL}/reset-password?token_hash=…`.
- The SPA's `/reset-password` page completes the reset with `supabase-js` (`verifyOtp` for recovery, then `updateUser({password})`) and calls `POST /api/auth/after-password-reset`. That call ends every other session. The page then signs out and shows Login with "Your password is changed. Log in with the new one."
- The "Forgot password?" link appears on Login now that it leads somewhere.

Decisions (Ihor, 2026-11-16):
- **Wording.** The reset email is drafted here and added to EXPERIENCE.md › Strings by surface and the sign-off checklist (approved with this spec).
- **Cooldown (2026-11-16).** At most one reset email per address every 60 s: within that window, requests still get the identical `202` but send nothing. This is abuse protection held in-process, not a daily quota.
- **Network errors (2026-11-16).** A transport failure while checking the link shows the retryable "Sign-in didn't work. Try again.", and the link stays usable. Only real link failures show the expired state.
- **Scanner safety.** The link opens our page, which verifies only from JavaScript, so mail scanners that just fetch the URL can't use it up.

Email text (English, then Norwegian, proposed; `{name}` is the first name, with "Hi," / "Hei," when there is none; `{link}` is the reset URL):
- Subject: "Reset your Study Buddy password" / "Tilbakestill passordet ditt for Study Buddy"
- Body:
  - "Hi {name},"
  - "Open this link to choose a new password:"
  - "{link}"
  - "The link works for 1 hour and only once."
  - "If you didn't ask for this, you can ignore this email. Your password stays the same."
- Norwegian body:
  - "Hei {name},"
  - "Åpne denne lenken for å velge et nytt passord:"
  - "{link}"
  - "Lenken virker i 1 time og bare én gang."
  - "Hvis du ikke ba om dette, kan du se bort fra denne e-posten. Passordet ditt er uendret."

## Boundaries & Constraints

**Always:**
- **No enumeration (FR-3, AD-2).** The request endpoint returns `202` with the same body and status for every well-formed email, whether the Account exists, is Google-only, or is unverified. All lookups, `generate_link`, and sending happen in a background task after the response, so response time doesn't depend on the Account. A malformed email gives `422 invalid_request`, which reveals nothing either.
- **Admin calls** go only through `supabase_auth.py` with `SUPABASE_SECRET_KEY`, never inside an open write transaction (AD-18). An unknown email is a silent no-op. Only an Account with an `email` identity gets the email; unverified Accounts are treated the same as verified ones.
- **Link rules** come from Supabase: recovery tokens last `otp_expiry = 3600` s (1 h), work once, and a newer one replaces the older. The SPA treats any `verifyOtp` failure (expired, used, replaced, malformed) as one state: "This link has expired" with "Send a new link" (to `/forgot-password`).
- **Email language:** `profiles.language` when the Account exists, otherwise the `language` sent by the SPA, otherwise English. Sending follows Story 1.3b's mailer rules: it logs no address, token or link, and a failed send is logged only.
- **`after-password-reset`** runs through `user_auth` and deletes every `auth.sessions` row of the Account except the caller's own (AD-19).
- **The new password** must be at least 8 characters, checked in the SPA and by Supabase. It is never logged or stored by the app. The SPA follows the Create-account form patterns (shared `AuthForm` styles, `noValidate`, Error line, busy guard).
- **Tokens stay out of logs:** the access-log redaction (Story 1.3b) also covers `token_hash=`.
- Every string comes from the catalogues (EXPERIENCE.md lines 186, 187, 198, 206–208). Styles use only tokens. Backend tests run against local GoTrue and Mailpit; frontend tests stub `supabase-js` and `fetch`.

**Never:**
- No Supabase-sent emails. No reset for Google-only Accounts. No change-password-in-Settings (Story 7.3).
- No admin call or SMTP send inside an open write. No difference in reply between existing and unknown emails.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Request, email Account | a registered email | `202`, same body; one reset email in Mailpit in the Account's language with a `/reset-password?token_hash=` link | N/A |
| Request, unknown email | an unregistered email | `202`, identical body; no email | N/A |
| Request, Google-only Account | an Account without an email identity | `202`, identical body; no email | N/A |
| Request, unverified Account | an email Account never verified | the same as a verified one: email sent | N/A |
| Request, malformed | `"not-an-email"` | `422 invalid_request` | envelope |
| Valid link | an unused, newest link within 1 h | the new-password screen; saving an 8+ character password changes it; the old password then fails at login; other sessions get `401`; Login shows "Your password is changed. Log in with the new one." | N/A |
| Short new password | 7 characters | Error line "Use at least 8 characters."; nothing changes | stays on the form |
| Expired, used, or replaced link | `verifyOtp` refuses the token | "This link has expired" + "Send a new link" → `/forgot-password` | same state for all |
| Network failure while checking | `verifyOtp` can't reach Supabase | "Sign-in didn't work. Try again."; retrying the same link works | not cached as expired |
| Repeat request within 60 s | a second request for the same address | identical `202`; no second email | silent |
| Abandoned reset | the link is verified, then the student leaves `/reset-password` without saving | the recovery session is signed out; Login shows the form, not `/projects` | N/A |
| SMTP down | Mailpit unreachable | still `202`; failure logged without the address | logged |

</frozen-after-approval>

## Code Map

- `backend/app/supabase_auth.py` -- the one `httpx2` client (`app.state.http`) and `get_user`. Add `generate_recovery_link(client, settings, email)`: `POST /auth/v1/admin/generate_link` `{type: "recovery", email}` with the secret key as `apikey` and bearer. Return `None` for an unknown user, otherwise the `hashed_token` and the user's id and `identities`. 5xx and timeouts are logged and swallowed (the background task).
- `backend/app/mailer.py` -- `send()` and the verification template pattern; add the reset template (the frozen text).
- `backend/app/services/verification.py` -- the pattern for background sending (`send_verification_email`, the pool, safe logging). Add `services/password_reset.py` alongside it.
- `backend/app/api/auth.py` -- `after-sign-in`, `verify`, `BackgroundTasks`, the `Conn` alias. Add `password-reset` (no auth; body `{email, language?}`) and `after-password-reset` (`UserAuth` + `Conn`).
- `backend/app/db/sessions.py` -- add `delete_others(conn, account_id, keep_session_id)`.
- `backend/app/main.py` -- `_RedactTokens` for the access log; extend it to `token_hash=`.
- `frontend/src/auth/index.js` -- the only `supabase-js` user. Add `completeRecovery(tokenHash)` (`verifyOtp({ token_hash, type: 'recovery' })`) and `setNewPassword(password)` (`updateUser({ password })`), then reuse `signOut()`.
- `frontend/src/pages/Login.jsx` -- add "Forgot password?" (now live) and the password-changed notice, the same mechanism as the session-expired notice. `components/AuthForm.module.css` holds the shared form styles.
- New pages: `ForgotPassword.jsx` (`/forgot-password`) and `ResetPassword.jsx` (`/reset-password`). The redirect URLs in `supabase/config.toml` already allow `/reset-password` on 8000 and 5173.
- `backend/tests/test_verification.py`, `test_auth.py` -- the Mailpit polling helper, `gotrue`/`sign_up`, `stub_auth`.

## Tasks & Acceptance

**Execution:**
- [x] `backend/app/supabase_auth.py` -- `generate_recovery_link`.
- [x] `backend/app/mailer.py` -- the reset email template in English and Norwegian.
- [x] `backend/app/services/password_reset.py` -- the background request flow (lookup → identity check → link → language → send).
- [x] `backend/app/api/auth.py` + `db/sessions.py` -- `POST /api/auth/password-reset` and `POST /api/auth/after-password-reset`.
- [x] `backend/app/main.py` -- redact `token_hash=` too.
- [x] `backend/tests/test_password_reset.py` -- every backend matrix row; that the identical reply has the same body and status; after-reset other-session revocation against GoTrue; the old password fails after a reset done through GoTrue.
- [x] `frontend/src/auth/index.js`, `pages/ForgotPassword.jsx`, `pages/ResetPassword.jsx`, routes, Login link and notice, catalogues -- with tests for every SPA matrix row.
- [x] EXPERIENCE.md + `norwegian-strings-signoff.md` + the UX memlog -- the reset email rows.
- [x] `README.md` (Norwegian) -- reset emails also land in Mailpit.

**Acceptance Criteria:**
- Given the grader flow, when a student requests a reset at `/forgot-password`, opens the Mailpit email's link, and saves a new password, then logging in with the old password fails, logging in with the new one works, and other sessions of the Account get `401`.
- Given the source, when it is searched, then admin calls appear only in `supabase_auth.py` and the boundary test still passes.

## Implementation Notes

- Supabase behaviour checked against local GoTrue before coding: admin `generate_link` (recovery) returns the user plus `hashed_token` and sends no email (Mailpit stays empty); an unknown email gives `404 user_not_found`; a second link makes the first answer `403 otp_expired`; a used link answers `403`. GoTrue's own `PUT /user` with a new password already ends the Account's other sessions; `after-password-reset` still deletes them itself, and a test proves it does so without GoTrue's help.
- `supabase_auth.generate_recovery_link` returns a `RecoveryLink(hashed_token, account_id, email, providers)` or `None` (unknown user, non-200, timeout, unusable JSON), logging only the status or exception type. `providers(user)` moved from `auth.py` into `supabase_auth.py` so both callers share it.
- Lookup is SQL, not an admin call: `db/accounts.find_for_reset` reads `auth.users` (case-insensitive email, not SSO, not soft-deleted), whether an `email` identity exists in `auth.identities`, and the profile's `first_name`/`language`. Only an Account with an email identity reaches `generate_link`, so Google-only Accounts get no recovery token at all; the link's own user id and providers are checked again before sending. The email is sent to the address Supabase returns.
- `POST /api/auth/after-password-reset` (`UserAuth` + `Conn`) returns `204`; `db/sessions.delete_others` deletes every `auth.sessions` row of the Account except the caller's (refresh tokens cascade).
- New boundary test: no module but `supabase_auth.py` (and `config.py`, which declares it) contains `/auth/v1`, `/admin/`, or `supabase_secret_key`.
- Login: "Forgot password?" sits after the password input in the DOM (Tab goes email → password → link) and a CSS grid puts it on the label's line, as in the mock. Its target is padded (`--space-1`) but below 44 px, like the existing "Create account" switch link.
- `docker compose up -d --build` was replaced, as before, by `docker build -t g25-kanestrom-voloshyn-app .` and `docker compose up -d --no-build`. Against the container: `/forgot-password` and `/reset-password` serve the SPA (for `Accept: text/html`); a Norwegian request produced the Norwegian email in Mailpit; verify → new password → `after-password-reset` 204 → another session's `/api/me` 401, old password 400, new 200, reused link 403.
- `POST /api/auth/password-reset` takes `{email, language?}` (shared light `x@y` pattern, max 254, stripped; `language` `en`|`nb`) and returns `202 {"status": "accepted"}` without touching the database. `password_reset.start_reset` lower-cases the address, applies the in-process cooldown (one request per address every 60 s; a dict of sha256(address) → monotonic time, pruned on each call; within the window nothing is started), and starts the work with `asyncio.create_task`, held in a module-level set until done. No `BackgroundTasks`, so the response cycle is the same for every email. The whole task body is wrapped: any exception logs "Password reset failed: <type>" only. The lifespan drains running reset tasks before closing the pool and HTTP client. Tests wait for the task (`password_reset.drain`) after each request and move a patched clock for the cooldown.
- Access-log redaction blanks every query parameter whose name ends in `token` or is `token_hash` (`token=`, `token_hash=`, `access_token=`, `refresh_token=`), e.g. `GET /reset-password?token_hash=[redacted]`.
- SPA: `auth.completeRecovery(tokenHash)` shares only a check in flight (React StrictMode) and forgets it once settled. Supabase refusing the token (a 4xx other than 429, or no session) is `expired`; no status, 429, 5xx, a throw, or a failed `/api/config` load is `failed`. `ResetPassword` is keyed by the token hash (a new link resets everything). While checking it shows the "Choose a new password" heading in a busy panel; `failed` shows the form with "Sign-in didn't work. Try again." and saving checks the same link again first. Leaving the page (any navigation, including "Log in") while holding a verified, unsaved recovery session calls `signOut()`; a check that succeeds after the page is gone signs out at once. `auth.setNewPassword` maps `weak_password` to `password_too_short` and everything else (including `same_password`) to `failed` (`errors.generic`). After saving: `after-password-reset` (retry repeats only it on `auth_unavailable`/network; carries on when the session is refused), then `signOut()` and Login with `state.passwordChanged`.
- `ForgotPassword` sends `auth: false` with the active language and replaces the form with the "sent" text in an always-mounted `role="status"`. `src/auth/email.js` (`isEmail`, ≤ 254 characters) is shared with Create account.
- Catalogue keys added: `login.forgotPassword`, `reset.request.{title,submit,sent}`, `reset.newPassword.{title,submit}`, `reset.saved`, `reset.expired`, `reset.sendNewLink`. Field labels, "Log in", and validation errors reuse `login.*` and `signup.errors.*`.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-11-16). Layers: blind (B), edge-case (E), verification-gap (V).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | B/E/V: abandoning `/reset-password` after `verifyOtp` leaves a full session; Login redirects into the app without a password change | high | `completeRecovery` stores a session; Login's `hasSession` redirect and `RequireSession` accept it. | patch (matrix row added) |
| 2 | B/E: unlimited reset emails to any address | medium | Admin `generate_link` skips GoTrue's `/recover` rate limit. | intent_gap → resolved (Ihor: 60 s per-email cooldown) |
| 3 | B/E: a network failure is shown, and cached, as "expired" | medium | The module-level cache keeps failures; the frozen row mapped every failure to expired. | intent_gap → resolved (Ihor: retryable error) + patch (cache) |
| 4 | E: `BackgroundTasks` delays the next keep-alive request on the same connection only for existing Accounts | medium | Starlette runs background tasks in the same ASGI call, which is a timing oracle against the no-enumeration rule. Fix: an `asyncio` task with a kept reference. | patch |
| 5 | E: the success cache lets the form show again after sign-out; state carries over when the token hash changes | medium | `recoveries` keeps `{ok: true}`; the effect doesn't reset `step`/`changed`/`password`. | patch |
| 6 | B: the `checking` state renders an empty panel | medium | No heading or text; `aria-labelledby` unset. | patch |
| 7 | V: the `generate_link` account and identity cross-check is untested | medium | Pre-verified. | patch |
| 8 | E: a non-`HTTPError` exception escapes the background task | low | Only the lookup and SMTP send are wrapped. Direct `try/except`. | patch |
| 9 | E: the redaction regex no longer covers `access_token=`/`refresh_token=` | low | The old suffix match was narrowed. Direct fix plus a `?token=` regression case. | patch |
| 10 | B/E: the SPA email check has no 254-character limit and is duplicated | low | An over-long address gets the generic API error. Share one constant. | patch |
| 11 | B: catalogue duplicates existing strings under new keys | low | The sign-off would have to keep two copies in step. Reuse `login.*` and the `signup.errors.*` keys. | patch |
| 12 | B: `lower(email)` lookup vs `generate_link`'s matching | low | Pass the lower-cased email to `generate_link` too. | patch |
| 13 | B: the README doesn't mention Google-only Accounts | low | One sentence. | patch |
| 14 | V: the lookup-failure branch is untested | low | Pre-verified; needs a failing-pool fixture. | defer |
| 15 | B: `after-password-reset` isn't tied to a recovery session | low | It only ends the caller's own other sessions; harmless. | reject |
| 16 | E: a reload after a successful verify shows expired | low | Needs a check on the session's `amr`; the student can request a new link. | reject |
| 17 | B: the boundary test is a loose substring scan | low | It works today; an AST check is later hardening. | reject |
| 18 | B: the "sent" screen has no retry or typo fix | low | EXPERIENCE.md ends the flow there. | reject |
| 19 | E: an unset secret key fails silently | low | A config error; logged as a 401 warning. | reject |
| 20 | (implementer) reusing the old password shows the generic error | low | Needs a new string; rare. | reject |
| 21 | B: spec Verification vs `--no-build`; tracking files disagree | false | `docker compose up -d --build` works here; step 5 syncs sprint-status. | reject |

## Verification

**Commands:**
- `cd backend && uv run pytest` -- expected: all pass against local Supabase and Mailpit.
- `cd frontend && npm test && npm run lint && npm run build` -- expected: all pass; only `tokens.css` has hex colours.
- `docker compose up -d --build` -- expected: the app serves `/forgot-password` and `/reset-password`.

**Manual checks:**
- In a browser: Login → "Forgot password?" → request → open the Mailpit link → save a new password → log in with it; open the same link again → expired state.
