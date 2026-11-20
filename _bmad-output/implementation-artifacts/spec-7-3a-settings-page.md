---
title: 'Story 7.3a: The Settings page (account, password, language, delete a project)'
type: 'feature'
created: '2026-11-20'
status: 'done'
baseline_commit: '14c92f84306fcc0fe513c91728e2ae41f64f74b6'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** There is no Settings page. A student can't edit their name, change their password while signed in, or delete a project from one place (FR-27, FR-29, UX-DR11). This is Story 7.3 part A. It was split in the unattended run on 2026-11-20 because the whole story was far over the size limit. Link Google account and Resend verification are 7.3b.

**Decisions:**
- Decided by Cristoffer 2026-11-19: Change password asks for the **current password**, checked server-side, and the **new password twice**, which must match before submit.
- Decided in the unattended run, *pending Cristoffer's approval*:
  - **(a) How the password is changed.** The backend only *checks* the current password, and the browser then sets the new one with `updateUser({password})`, as the spine says. An admin password set would end every session, the student's own included (`supabase_auth.set_password`).
  - **(b) New copy**, listed in Approach.
  - **(c) Section lead lines** taken from `mockups/key-settings.html`.

**Approach:**
- **Overlay** (changed by Cristoffer on 2026-11-20, see Amendments; first built as the route `/settings`): Settings opens over the current page, titled "Settings" / "Innstillinger", and a click outside, Esc, or Close returns to that page unchanged. The Account menu gets "Settings" / "Innstillinger" first, before Language (EXPERIENCE.md L71).
- **One page, three stacked section cards** (DESIGN.md › Settings section):
  1. **Account** / **Konto**:
     - The large Avatar; the name; the email; a muted sign-in method, "Signs in with Google" / "Logger inn med Google" when the Account has a Google identity, otherwise "Signs in with email" / "Logger inn med e-post"; and a ghost "Log out".
     - Email accounts: the name is a Text input, saved on Enter or blur (trimmed, 1–100 characters) through `PATCH /api/me {first_name}`. It shows at once in the Top bar greeting.
     - Accounts with a Google identity: the name is plain text, and the server refuses `first_name` with `409 name_from_google`.
     - Lead line, *pending*: email accounts "Your name and how you sign in." / "Navnet ditt og hvordan du logger inn."; Google accounts "Your name, email and picture come from your Google account." / "Navnet, e-postadressen og bildet ditt kommer fra Google-kontoen din."
  2. Inside Account, **Change password** / **Endre passord**: a row for Accounts with an email identity; never disabled, verified or not. It opens a form with three password fields, *pending*: "Current password" / "Nåværende passord", "New password" / "Nytt passord", "Repeat new password" / "Gjenta nytt passord".
     - **Client checks:** the new password is at least 8 characters (the existing too-short copy) and both copies match ("The passwords don't match." / "Passordene er ikke like.", *pending*).
     - **Server check:** `POST /api/me/password/check {current_password}` → `204`, or `400 wrong_password` ("That's not your current password." / "Det er ikke det nåværende passordet ditt.", *pending*).
     - Then `updateUser({password: new})`. Success shows "Your password is changed." / "Passordet er endret." (EXPERIENCE.md L274), clears the fields and closes the form.
  3. Section **Language** / **Språk**: English / Norsk. The same switch and save as the Account menu (FR-29). Lead line, *pending*: "The language of buttons and messages. Your study material stays in the language of your files." / "Språket på knapper og meldinger. Studiematerialet ditt beholder språket i filene dine."
  4. Section **Your data** / **Dataene dine**:
     - Lead line, *pending*: "A deleted project can be restored for 30 days." / "Et slettet prosjekt kan gjenopprettes i 30 dager."
     - "Delete a project" / "Slett et prosjekt" lists the active and archived Projects, each with "Delete" / "Slett", which opens the existing `DeleteProjectDialog` (Story 7.2a).
     - "Delete my account and all my files" is Story 7.4, not shown yet.
- **`GET /api/me`** adds `email` and `sign_in_methods` (`["email"]`, `["google"]`, or both, from `CurrentUser.providers`).

## Boundaries & Constraints

**Always:**
- The password check never stores or logs passwords. The temporary session it creates is ended at once.
- Every string comes through i18n, and styles use tokens only.
- Reuse `Avatar`, the language save from `AccountMenu`, and `DeleteProjectDialog` / `AppShell.deleteProject`.
- The *pending* strings are listed in this spec only; Cristoffer approves them and moves them into EXPERIENCE.md himself.

**Never:**
- No Link Google or Resend verification (7.3b); no account deletion (7.4).
- No email change (`updateUser({email})` is never used).
- No admin password set for this flow.
- No edits to EXPERIENCE.md or DESIGN.md (final docs).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open | Account menu › Settings | `/settings` with Account, Language, Your data | profile load fails → error line |
| Rename (email) | "Ana" + Enter | saved; greeting "Welcome, Ana" | blank → reverts, no request; save fails → error line, value kept |
| Rename (Google) | `PATCH first_name` | `409 name_from_google`; UI shows plain text, no input | N/A |
| Password ok | current right, new 8+ chars, both match | check `204`, then `updateUser`; "Your password is changed."; the old password then fails at login | N/A |
| Wrong current | wrong current | `400 wrong_password` shown; `updateUser` not called | N/A |
| Mismatch / short | repeat differs, or under 8 characters | client message; no request | N/A |
| Google-only | no email identity | no Change password row; `POST …/check` → `409 no_password` | N/A |
| Auth down | GoTrue unreachable | `503 auth_unavailable` (existing copy) | N/A |
| Language | Norsk | interface switches at once; saved | save fails → error line, switch kept |
| Delete a project | Delete next to "Biology" | `DeleteProjectDialog`; confirm → it leaves the list and moves to Deleted projects | N/A |
| Norwegian | nb | every Settings string in Norwegian | N/A |

</frozen-after-approval>

## Amendments

- **2026-11-20, Cristoffer (browser test):** Settings is an overlay instead of a page. It is a Radix modal dialog over the page the student is on, with no `/settings` route. A click outside, Esc, or Close (×) shuts it, the page behind stays as it was, and focus returns to the Account menu trigger. Esc in an edited name field reverts the edit and leaves Settings open. A failed profile load shows its error line inside the overlay. The delete dialogs open on top of it (z-index 50/51, above the overlay's 40/41).
  - *Conflict with a final doc, pending approval:* EXPERIENCE.md L75 says "Settings: one page, three sections", and DESIGN.md L657 puts "Settings" in the Top bar title. The proposed wording, for Cristoffer or Ihor to move into EXPERIENCE.md: "Settings: an overlay over the current page, three sections; a click outside, Esc, or Close returns to that page."

## Code Map

- `backend/app/api/me.py` -- `Me` gains `email` and `sign_in_methods`. `MeUpdate` takes `language` and/or `first_name` (at least one). New `POST /me/password/check`.
- `backend/app/services/identity.py` -- `set_first_name`, which refuses with `name_from_google` when `"google" in user.providers`; `clean` as in `projects.clean_name` (100 characters). `backend/app/db/profiles.py` `set_first_name`.
- `backend/app/supabase_auth.py` -- `check_password(client, settings, email, password) -> bool`: `POST /auth/v1/token?grant_type=password` with the publishable key. On 200, end that session (`POST /auth/v1/logout?scope=local` with the returned access token) and return True. 400 `invalid_credentials` → False. Anything else → `auth_unavailable`. Never log the body.
- `backend/tests/test_routes_guard.py` -- allowlist `POST /api/me/password/check` (account bookkeeping). `PATCH /api/me` is already listed.
- `backend/tests/test_settings.py` -- me fields, name save and limits, `name_from_google`, password check right / wrong / Google-only / auth-down (monkeypatch the client for the last one), no password in logs.
- `frontend/src/routes.jsx` -- `/settings` inside the AppShell route.
- `frontend/src/components/AccountMenu.jsx` -- the Settings item. Move the language save into a small shared helper used by both the menu and the page.
- `frontend/src/pages/Settings.jsx` (+ `.module.css`) -- the sections. `ChangePassword.jsx` for the form. The Top bar title on `/settings` comes from `AppShell` (today it shows only the Project name).
- `frontend/src/auth/index.js` -- reuse `setNewPassword` (L234) for the update.
- `frontend/src/test/fakeApi.js` -- the me fields, the `first_name` patch, the check route.
- `frontend/src/i18n/en.json`, `nb.json`, `i18n/errors.js` -- strings and the error codes `wrong_password`, `name_from_google`, `no_password`.
- `frontend/src/pages/Settings.test.jsx` -- every frontend matrix row.

## Tasks & Acceptance

**Execution:**
- [x] backend `me.py`, `identity.py`, `db/profiles.py`, `supabase_auth.py` -- fields, name, password check.
- [x] `backend/tests/test_settings.py` + `test_routes_guard.py` -- the backend rows.
- [x] frontend routes, AccountMenu, Settings page, ChangePassword, AppShell title, fakeApi, i18n.
- [x] `frontend/src/pages/Settings.test.jsx` -- the frontend rows and Norwegian.

**Acceptance Criteria:**
- Given an email Account, when the student changes the password with the right current password and a matching new one, then they stay signed in and the next login works only with the new password.
- Given a Google-linked Account, when Settings opens, then the name, email and picture are read-only and "Signs in with Google" shows.

## Verification

**Commands:**
- `cd backend; uv run pytest` -- expected: all green with `LLM_MODE=mock`
- `cd frontend; npm test; npm run lint` -- expected: all green (from PowerShell)

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | BH, VG | the current-password check guards only the UI: a session can call `updateUser` directly; other devices stay signed in | medium | `secure_password_change = false`; two separate calls | intent_gap — decision (a) is pending Cristoffer; not reverted (unattended run). Option: backend check → admin `set_password` → new session returned (enforced, signs out other devices) |
| 2 | BH, VG, EC | all checks share one sign-in rate limit (backend IP); a 429 shows as "auth unavailable" | medium | `sign_in_sign_ups = 30` per IP | patch — map 429 to `429 too_many_attempts` (copy *pending*); the shared bucket itself → defer |
| 3 | BH, VG, EC | a failed logout after a correct password answers 503 and leaves the session | medium | `_end_session` raises | patch — log, still return True; test |
| 4 | VG | a non-`invalid_credentials` 400 is untested | low | only `invalid_credentials` and 429/ConnectError tested | patch — test |
| 5 | BH, VG | empty current password shows "That's not your current password" and is untested | medium | wrong message for an empty field | patch — "Enter your current password." (*pending*); test |
| 6 | BH | new password equal to the current one gives a generic error | low | no client compare; `same_password` unmapped | patch — client check + map `same_password` (*pending* copy) |
| 7 | BH | an Account with both methods shows only "Signs in with Google" | medium | `["email","google"]` renders one line | patch — show both method lines |
| 8 | BH, EC | an edit (or Esc) during a name save is lost or undone | medium | `inFlight` early return; response overwrites | patch — save the latest value after the flight; ignore a stale response |
| 9 | BH, EC | "Delete a project" heading with nothing under it while loading or when empty | low | no state | patch — hide it until loaded and when empty |
| 10 | EC | NUL / lone surrogate in a name → 500; `slice` can split a surrogate pair | low | Postgres refuses NUL | patch — refuse control characters (`invalid_name`); slice by code points |
| 11 | BH | a linked Account's read-only name may not be Google's name | low | linking arrives with 7.3b | defer to 7.3b |
| 12 | BH | Settings hides Log out when the profile fails to load | low | the Account menu still has Log out; the shell shows the error | reject |
| 13 | BH | limits defined in several places | low | style | reject |
| 14 | EC | empty `sign_in_methods` | false | every Account has an email or Google identity | reject |
| 15 | EC | passwords over 72 bytes get a generic error | low | rare | reject |
| 16 | EC | language save counter not shared between menu and page | low | needs two switches within one request | reject |
| 17 | BH | missing tests: double submit, arrow keys, title swap | low | covered by behaviour elsewhere | reject |
| 18 | BH | `test_auth.py` blank lines; `document.title` unchanged | low | cosmetic; no route sets titles today | reject |
| 19 | BH | spec missing from the review diff | false | excluded on purpose | reject |
