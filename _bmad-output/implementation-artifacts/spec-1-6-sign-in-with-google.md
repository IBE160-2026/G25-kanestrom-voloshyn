---
title: 'Story 1.6: Sign in with Google'
type: 'feature'
created: '2026-11-19'
status: 'done'
baseline_commit: '785f99b819cc39338776ec420a399b1fada86dfa'
route: 'dispatch'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-5-password-reset.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Students can only use email and password. FR-19 and AD-19 add Google sign-in. A Google sign-in links into a verified email Account. It takes over an unverified one, so that someone who registered another person's address can't keep access. Cristoffer took this story over on 2026-11-19 and has set up a real Google OAuth client locally.

**Approach:**
- **Google button.** Login and Create account show a ghost "Sign in with Google" / "Logg inn med Google" button above an "or" divider (DESIGN.md › Auth panel, EXPERIENCE.md L206), but only when `GET /api/config` returns `google_enabled`.
  - It calls `supabase.auth.signInWithOAuth({provider: 'google', redirectTo: <origin>/auth/callback})`.
  - The browser uses Supabase only for auth (AD-1).
- **New `/auth/callback` page.**
  - supabase-js finishes the PKCE exchange. The page then calls `POST /api/auth/after-sign-in` and goes to `/projects`, or to the last Project as Login does today.
  - An `error` in the URL (cancelled consent, `access_denied`) or a failed exchange → Login with "Sign-in didn't work. Try again." (`login.errors.failed`).
  - A Google identity already linked to another Account (`identity_already_exists` or `google_identity_in_use`) → Login with "This Google account is already linked to another Study Buddy account." (EXPERIENCE.md L197).
  - Either way, no Account changes.
- **Google proves the email** (decided by Cristoffer 2026-11-19): a Google-created Account gets `email_verified_at` on its first `after-sign-in`.
- **"or" divider:** "or" / "eller" (decided by Cristoffer 2026-11-19).
- **New Account.** `after-sign-in` on a Google Account fills an empty `first_name` from the Google identity data (`given_name`, else the first word of `name`). The Avatar uses the Google picture (FR-27, which is read-only).
- **Verified email Account.** Supabase's automatic identity linking is accepted. The student is signed in and linked, with no password step and no message. Both sign-in methods then work.
- **Unverified email Account: takeover.** This is enforced in `user_auth`, step 4, so it holds even if the SPA never calls `after-sign-in`. On any request where the Account has a `google` identity, `email_verified_at IS NULL` and `google_takeover_at IS NULL`, the following runs exactly once:
  1. A conditional `UPDATE … WHERE google_takeover_at IS NULL RETURNING` claims it.
  2. A random password is set through the admin API (`supabase_auth.py` only).
  3. Every session of the Account ends, the current one included (GoTrue's admin password change ends them all; decided by Cristoffer 2026-11-19, no session restore).
  4. `google_takeover_at`, `notice_google_takeover`, and `email_verified_at` (Google proved the address) are set, and `first_name` is replaced from Google.

  The claim commits before the admin call (AD-18: no external call in an open write); if the admin call fails, the claim is released and the request answers `503 auth_unavailable`. A request that triggers the takeover answers `401 google_takeover`; `/auth/callback` then shows Login with "Your account now signs in with Google." and the student signs in with Google once more.
- **One-time notice.** `GET /api/me` returns `notice_google_takeover`. The shell then shows "Your account now signs in with Google." / "Kontoen din logger nå inn med Google." once (EXPERIENCE.md L200, L316), in the Undo-message box with no action, and calls a new `POST /api/me/notices/google-takeover/seen` to clear the flag.
- **`after-sign-in` checks the takeover too,** as a fast path. The rule itself lives in `user_auth`.

## Boundaries & Constraints

**Always:**
- Only `supabase_auth.py` calls the Supabase admin API.
- Only `user_auth` parses bearer tokens.
- Secrets live only in `.env`, and nothing logs tokens or codes. Story 1.5 already redacts `code=`.
- With Google not configured, no button shows and everything else works.
- Copy comes from EXPERIENCE.md through i18n. Styles use tokens only.
- Tests need no real Google. Seeded `auth.identities` rows stand in for it.

**Never:**
- No Settings "Link Google" or "Signs in with Google" (Settings is Epic 7).
- No Google picture upload or storage.
- No new copy beyond "or" / "eller" (approved).
- No change to Supabase's linking settings beyond `supabase/config.toml` env values.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Not configured | `google_enabled=false` | no button on Login or Create account | N/A |
| New Google user | email unknown | Account created; `first_name` from Google; lands on Projects | N/A |
| Verified email Account | `email_verified_at` set | signed in, Google linked, no message; password still works | N/A |
| Unverified email Account | `email_verified_at` null, Google identity seeded | first request: random password set, every session ended, `google_takeover_at` + `email_verified_at` set, `401 google_takeover`; next Google sign-in shows the notice once | admin fails → `503 auth_unavailable`, claim released |
| Takeover without after-sign-in | seeded identity, the SPA never calls it | any authenticated request enforces it | N/A |
| Runs once | two requests at once | one takeover (conditional UPDATE) | N/A |
| Notice | `notice_google_takeover=true` | shown once; seen clears it | N/A |
| Cancelled | `/auth/callback?error=access_denied` | Login, "Sign-in didn't work. Try again." | N/A |
| Already linked | identity linked elsewhere | Login, "This Google account is already linked…" | N/A |

</frozen-after-approval>

## Code Map

- `backend/app/auth.py` `user_auth` (L74-100) -- steps 1-3 exist. Add step 4 after `profiles.ensure`. `CurrentUser.providers` already lists `google`.
- `backend/app/supabase_auth.py` -- the admin client. Add `set_password(account_id, password)`. Reuse the `providers(user)` and error mapping used by `generate_recovery_link`.
- `backend/app/db/profiles.py`, `db/sessions.py` -- `sessions.delete_others` exists from 1.5. Add `claim_google_takeover`, `clear_takeover_notice`, and a `first_name` fill when empty.
- `backend/app/api/auth.py` `after-sign-in`, `backend/app/api/me.py` -- `/api/me` gains `notice_google_takeover` and the seen route.
- `backend/app/api/config.py` -- `google_enabled` exists (`config.py` L115).
- `supabase/migrations/20261112140000_profiles.sql` -- `google_takeover_at` and `notice_google_takeover` exist. No migration expected.
- `supabase/config.toml` -- `[auth.external.google]` reads the env values. `additional_redirect_urls` already has `/auth/callback` for :8000 and :5173.
- `frontend/src/auth/index.js` -- the supabase-js wrapper. Add `signInWithGoogle()` and the callback exchange.
- `frontend/src/pages/Login.jsx` (L21), `CreateAccount.jsx` (L17) -- comments mark where the button goes. `frontend/src/routes.jsx` -- `/auth/callback`.
- `frontend/src/components/Avatar.jsx` -- already reads the Google picture. Check it uses the identity data.
- `frontend/src/components/AppShell.jsx` -- the one-time notice.
- `backend/tests/` -- seed a `google` identity with SQL into `auth.identities` for a test user. Follow the patterns in `test_password_reset.py` and `test_auth.py`.

## Tasks & Acceptance

**Execution:**
- [x] Backend -- step 4 takeover, `set_password`, profile helpers, the `after-sign-in` fill and fast path, `/api/me` notice and its seen route.
- [x] `backend/tests/test_google.py` -- every backend matrix row with seeded identities, including takeover without `after-sign-in`, the concurrent run-once case, and an admin failure.
- [x] Frontend -- the button (when enabled), `/auth/callback`, error mapping, and the notice.
- [x] `frontend/src/pages/GoogleSignIn.test.jsx` -- button hidden or shown, the OAuth call's redirect, callback success, cancelled, already linked, notice once, Norwegian.

**Acceptance Criteria:**
- Given the real local Google client, when Cristoffer signs in with Google for the first time with a new Gmail address, then he lands on Projects with his Google first name and picture.
- Given an unverified email Account seeded with a Google identity, when any API request is made with a new Google session, then the old password no longer signs in.

## Verification

**Commands:**
- `cd backend; uv run pytest` -- expected: all green with `LLM_MODE=mock`
- `cd frontend; npm test; npm run lint` -- expected: all green (from PowerShell)

**Manual checks:**
- Sign in with Google at http://localhost:8000 using a Google test user.

## Implementation Notes

- **GoTrue checked first (v2.197, local, 2026-11-19).** Admin `PUT /admin/users/{id}` with `password` ends *every* session of the user, the caller's included; `password_hash` is ignored on update. A seeded `auth.identities` row (needs `created_at`, `updated_at`, `last_sign_in_at`; `email` is generated) shows up in `GET /user` with its `identity_data`.
- **Step 4 in `user_auth` (`app/auth.py`).** After step 2, and only for an Account with both an `email` and a `google` identity, one plain read on the request connection (`profiles.takeover_state`) decides it: a missing profile, or `email_verified_at IS NULL AND google_takeover_at IS NULL`. Settled Accounts (verified, or already taken over) pay only that read; Accounts without both identities pay nothing. The read takes no lock, so the takeover's own transactions never wait on the request transaction. Step 3 (`profiles.ensure`) runs after it.
- **`_google_takeover` (AD-18 order).** Each write runs in its own short transaction on its own pooled connection; the admin call runs with none open:
  1. `profiles.ensure` + `profiles.claim_google_takeover` (conditional `UPDATE … SET google_takeover_at = now() WHERE email_verified_at IS NULL AND google_takeover_at IS NULL RETURNING google_takeover_at`), committed. A concurrent request waits for that commit, finds the claim taken, and goes on (run once).
  2. `supabase_auth.set_password` with a random 48-byte password. GoTrue ends every session, the caller's included. On any failure `profiles.release_google_takeover` sets `google_takeover_at` back to NULL where it still equals the claimed value, and the `503 auth_unavailable` propagates, so a later request can take over.
  3. `sessions.delete_all` (so the rule doesn't depend on GoTrue's logout) and `profiles.finish_google_takeover`: `notice_google_takeover = true`, `email_verified_at = COALESCE(…, now())` (Google proved the address), `first_name` replaced from Google (kept when Google gives none).
  4. The request answers `401 google_takeover`.
  No writes to `auth.refresh_tokens` or `auth.mfa_amr_claims`; the only `auth.sessions` writes are deletes (`delete_others` from Story 1.5, and `delete_all`).
- **Google-created Accounts.** `after-sign-in` passes `google_created` (a `google` identity and no `email` identity) to `identity.after_sign_in`, which marks the email verified, so such an Account is never taken over later, even if it gains an email identity. `profiles.lock_email_verified_at` treats a set `google_takeover_at` as verified, so no verification email goes out after a takeover.
- **`after-sign-in`.** `first_name = body.first_name or user.google_first_name`, filled only while NULL. `supabase_auth.google_profile(user)` reads the Google identity's `given_name`, else the first word of `name`/`full_name` (capped at 100), and `picture`/`avatar_url` only when it is `https://`. The takeover itself already ran in `user_auth`.
- **`/api/me`.** `Me` gains `notice_google_takeover` and `picture_url` (the Google picture, linked from the identity data on each request, never stored); `to_me(profile, user)`. `POST /api/me/notices/google-takeover/seen` clears the flag, returns `Me`, and is on the AD-22 route-guard allowlist.
- **SPA auth.** supabase-js is created with `flowType: 'pkce'` and `detectSessionInUrl: false`. `auth.completeGoogleSignIn(search, hash)` reads OAuth errors from the query or fragment (`error_code` `identity_already_exists`/`google_identity_in_use` → `identity_in_use`, any other `error` → `failed`), otherwise runs `exchangeCodeForSession(code)` once per code (shared in flight for StrictMode). `auth.isGoogleEnabled()` reads the shared `/api/config` load.
- **`/auth/callback` (`pages/AuthCallback.jsx`).** Success → `after-sign-in` with the language → last Project / remembered route / `/projects` (replace). An OAuth failure → Login with `state.googleError` in the Error line (`login.errors.failed` or `login.errors.identityInUse`). If `after-sign-in` fails, the new session is signed out; `401 google_takeover` → Login with `state.googleTakeover`, shown as the muted notice line "Your account now signs in with Google." (`account.googleTakeover`, not the error colour); anything else → "Sign-in didn't work. Try again." After the student signs in with Google again, `notice_google_takeover` is still true, so the shell shows the one-time notice.
- **Mid-app takeover.** `google_takeover` is in `SIGNED_OUT_CODES`; `api/client.js` passes the code to the signed-out listener, and `RequireSession` sends the student to Login with the takeover line instead of the session-expired notice.
- **Button.** `components/GoogleButton.jsx` (ghost, full width, 44 px, then the "or" / "eller" divider) renders only when `isGoogleEnabled()`; on Login it sits above the email fields, on Create account at the top of the form. A start failure shows the page's Error line. A `pageshow` with `event.persisted` (Back from Google out of the bfcache) clears the busy state.
- **Notice.** `components/UndoMessage.jsx` (6 s, stays while hovered or focused, optional action) carries the takeover notice in a live region at the bottom left of the main area. `AppShell` latches the flag into state the first time `me` has it, so a later `me` without it doesn't unmount the message early. It mounts the region empty and adds the text a tick later so it is announced, and POSTs `seen` once. A failed save is ignored: the notice may show once more next time. `Avatar` shows `me.picture_url` (`referrerPolicy="no-referrer"`), falling back to initials when the image fails.
- **Catalogue keys.** `login.google`, `login.or` ("or" / "eller", approved), `login.errors.identityInUse`, `account.googleTakeover`. No API error key for `google_identity_in_use`: no backend code returns it.
- **Not verified here:** a real Google round trip (the spec's manual check, for Cristoffer with the local OAuth client), and that GoTrue's PKCE callback puts `error_code` in the query for an already-linked identity (both query and fragment are handled).

## Spec Change Log

### 2026-11-19 — takeover without session restore (human renegotiation)
- Trigger: all three reviewers found the session snapshot/restore in GoTrue's `auth.*` tables fragile (half-failure lockout, concurrent 401s, coupling to GoTrue internals). GoTrue's admin password change ends every session, the caller's included.
- Amended (decided by Cristoffer): the takeover ends every session; the student signs in with Google once more. Google proof marks the email verified. "or" / "eller" approved.
- KEEP: the button, callback, error mapping, first-name fill, picture, notice component, seeded-identity tests.

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | BH, EC | session snapshot/restore writes GoTrue's internal `auth.*` tables | high | layout-dependent `jsonb_populate_record`; `ON CONFLICT DO NOTHING` hides breakage | intent_gap → Cristoffer: no restore, sign in again |
| 2 | BH, EC | half-failure after the admin call locks the student out | high | password changed, sessions gone, claim rolled back | resolved by #1 + release-on-failure |
| 3 | EC | a concurrent request between logout and restore gets 401 | medium | gap between GoTrue logout and restore commit | resolved by #1 |
| 4 | BH | admin HTTP call inside the open claim transaction (AD-18) | medium | lock and connection held through the call | patch — claim commits first |
| 5 | BH, EC | Google proof never marks the email verified; reminders keep going; a Google-created Account can later be taken over | medium | `email_verified_at` untouched | intent_gap → Cristoffer: mark verified; patch |
| 6 | BH | the pre-registrant's first name stays | medium | test asserts "Mallory" | patch — replaced from Google |
| 7 | BH | every linked-Account request pays a second transaction | low | the takeover check runs on every request | patch — cheap gate |
| 8 | EC | notice can unmount early on a `me` refresh | low | derived from live `me` | patch — latch |
| 9 | EC | Google button stays busy after bfcache Back | low | no `pageshow` reset | patch |
| 10 | BH | unused `errors.google_identity_in_use`; "or" is new copy | low | no backend code returns it | patch; "or" approved by Cristoffer |
| 11 | BH, EC | spec says the current session stays, code ends password sessions | high | spec vs code | resolved by #1 (spec amended) |
| 12 | EC | takeover requires an `email` provider | low | a Google-only Account has no password to take over (AD-19) | reject |
| 13 | BH | content made by the pre-registrant stays with the owner | low | product decision; rare | defer to Cristoffer/Ihor |
| 14 | BH | typed first name lost when choosing Google on Create account | low | Google supplies the name | reject |
| 15 | BH | callback error codes unverified against real GoTrue | maybe-false | needs a real Google round trip | manual check by Cristoffer |
| 16 | BH | tests seed identities by SQL; real auto-linking untested | low | real linking needs Google; covered by the manual check | reject |
| 17 | BH | missing frontend edge tests (seen failure, focus hold, Create account errors, unmount) | low | partly covered with #8/#9 | patch where touched |
| 18 | VG | no verification gaps | — | — | — |
