---
title: 'Story 7.4: Delete my account'
type: 'feature'
created: '2026-11-20'
status: 'done'
baseline_commit: '06dd572047c31c93cd00f3a3f285fb1ef3332b34'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A student can't delete their Account. Leaving the app should remove everything at once, including Projects waiting in Deleted projects and Mistake history (FR-28, §5.4, AD-16, AD-19).

**Decisions** (made in the unattended run on 2026-11-20, *pending Cristoffer's approval*):
- **(a) Order of the steps:** the epic's order. Cancel the jobs and wait, then delete the Storage prefix, then delete the auth user (the app tables cascade from `profiles`). If the last step fails, the files are already gone but the Account remains and can retry.
- **(b) The typed word:** it must match exactly, after trimming: `DELETE` in English, `SLETT` in Norwegian, following the interface language. Lowercase doesn't count.
- **(c) Button label:** the Settings row's button reads "Delete my account" / "Slett kontoen min" (taken from `mockups/key-settings.html`).

**Approach:**
- **`DELETE /api/me` → `204`**. It is allowlisted Account bookkeeping and uses `ReleasedUserAuth`, so no connection is held during the wait. Through a new `services/account.delete_account(pool, storage, runner, http, settings, account_id)`:
  1. In one transaction, for every Project of the Account (active, archived, deleted, expired): cancel its jobs (`jobs.cancel_for_project`) and revoke its phone links (`phone.revoke_for_project`). Collect the running ids. Commit, then run the after-commit steps.
  2. Interrupt the running jobs and wait for them (`runner.wait_for`, 30 s; after that, go on).
  3. `storage.delete_prefix(f"{account_id}/")`.
  4. Admin `DELETE /auth/v1/admin/users/{account_id}` (new `supabase_auth.delete_user`), so `profiles` and every app table cascade. A failure answers `503 auth_unavailable`.
- **Settings › Your data:** the row "Delete my account and all my files" / "Slett kontoen min og alle filene mine", with the button "Delete my account" / "Slett kontoen min" (*pending*). The button opens the Confirm dialog (delete account), following DESIGN.md (L824) and EXPERIENCE.md (L276, L410):
  - title "Delete your account?" / "Vil du slette kontoen din?";
  - an inset box: "Your projects, including those in Deleted projects, and their files, mistakes, and generated material are deleted now." / "Prosjektene dine, også de i Slettede prosjekter, med filer, feil og generert innhold, slettes nå.";
  - bold "This can't be undone." / "Dette kan ikke angres.";
  - a Text input labelled "Type DELETE to confirm" / "Skriv SLETT for å bekrefte";
  - ghost "Cancel" / "Avbryt", and Button (danger) "Delete account" / "Slett kontoen", disabled until the word matches.
- **After success:** the session is cleared locally (as Log out, with no server call needed), and the student lands on Login with "Your account and files have been deleted." / "Kontoen din og filene dine er slettet." (EXPERIENCE.md L203), shown the way the existing Login notices are.

## Boundaries & Constraints

**Always:**
- Reuse `jobs.cancel_for_project`, `phone.revoke_for_project`, `Runner.wait_for`, `storage.delete_prefix` and the Login notice pattern.
- No connection is held during the wait.
- Never log the token or the response bodies.
- Copy comes through i18n; styles use tokens only (reuse the purge dialog's inset and bold styles).

**Never:**
- No 30-day grace period (the deletion is immediate and permanent).
- No email confirmation step.
- No edits to final docs.
- No push or merge.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Delete | Projects (active, archived, deleted) with files, quizzes, Mistakes | `204`; the auth user, profile and every app row gone; Storage `{account_id}/` empty | N/A |
| Running job | quiz running | interrupted, waited for, nothing saved | outlives 30 s → go on; its save finds no rows |
| Phone link | open link with a staged batch | revoked; photos deleted | N/A |
| Auth delete fails | admin answers 500 | `503 auth_unavailable`; the profile stays; retry works | N/A |
| Other Accounts | a second Account with data | untouched | N/A |
| Register again | the same email after deletion | sign-up works; a fresh, empty Account | N/A |
| Word | "delete", "DELET", " DELETE " | disabled, disabled, enabled | N/A |
| Norwegian | interface nb | label "Skriv SLETT for å bekrefte"; only `SLETT` enables | N/A |
| Cancel | Cancel or Esc | nothing happens; focus back on the button | N/A |
| Success | confirm | Login with "Your account and files have been deleted."; Back doesn't reopen the app | request fails → the dialog stays, with an error line |
| No session | no token | `401` | N/A |

</frozen-after-approval>

## Code Map

- `backend/app/services/account.py` (new) -- `delete_account`, with the steps above. Look at `projects.purge` (L219) for the transaction, wait and Storage pattern. It needs every Project id, including expired ones (`repo.list_for` hides expired ones: add a small `db/projects.ids_for_account`).
- `backend/app/supabase_auth.py` -- `delete_user(client, settings, account_id)`, admin `DELETE`, modelled on `set_password` (L132). It treats a 404 as already deleted.
- `backend/app/api/me.py` -- `DELETE /me` with `ReleasedUserAuth` (from `app.auth`); the app state has the pool, storage, runner, http client and settings.
- `backend/tests/test_routes_guard.py` -- allowlist `DELETE /api/me`.
- `backend/tests/test_delete_account.py` -- the backend matrix rows. Use the helpers in `test_purge.py` and `test_delete_project.py`. For register-again, follow the sign-up helpers in `test_auth.py`.
- `frontend/src/components/DeleteAccountDialog.jsx` (+ css) -- modelled on `PurgeProjectDialog.jsx`.
- `frontend/src/pages/Settings.jsx` -- the Your data row.
- `frontend/src/components/accountActions.js` -- the local sign-out after deletion (as `logOut`, but navigating to `/` with `state: { accountDeleted: true }`).
- `frontend/src/pages/Login.jsx` -- the `accountDeleted` notice, beside `passwordChanged` (L45-50).
- `frontend/src/test/fakeApi.js`, `frontend/src/i18n/en.json`, `nb.json`.
- `frontend/src/pages/DeleteAccount.test.jsx` -- the frontend matrix rows.

## Tasks & Acceptance

**Execution:**
- [x] backend `services/account.py`, `supabase_auth.py`, `api/me.py`, `db/projects.py` -- the account deletion.
- [x] `backend/tests/test_delete_account.py` + `test_routes_guard.py`.
- [x] frontend dialog, Settings row, `accountActions.js`, Login notice, fakeApi, i18n.
- [x] `frontend/src/pages/DeleteAccount.test.jsx`.

**Acceptance Criteria:**
- Given an Account with Projects, files and Mistakes, when the student types DELETE and confirms, then they see Login with "Your account and files have been deleted.", and none of their rows or Storage objects remain.
- Given a deleted Account, when the same email signs up again, then it gets a fresh, empty Account.

## Verification

**Commands:**
- `cd backend; uv run pytest` -- expected: all green with `LLM_MODE=mock`
- `cd frontend; npm test; npm run lint` -- expected: all green (from PowerShell)

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | VG | delete-account sign-out never tested for listener detach and remembered-route clear | medium | only Log out tests check them | patch |
| 2 | EC, BH | uploads or jobs from another tab during the wait leave files after `delete_prefix` | medium | nothing blocks writes; `storage.objects` doesn't cascade | patch — sweep the prefix again after `delete_user` |
| 3 | BH | a client failure after the 204 (signOut/navigate) shows an error for a deleted Account | medium | the whole hook is in the reject path | patch — only the request can fail; the rest is best effort and ends on Login |
| 4 | EC | docstring: a late job "finds no rows" | low | rows exist until `delete_user`; `cancel_requested` stops it | patch — docstring |
| 5 | BH | label hard-codes DELETE/SLETT separately from the word | low | catalogue drift | patch — interpolate `{{word}}` |
| 6 | BH | private `_run_steps` imported across modules | low | shared by three callers | patch — make it public |
| 7 | BH | missing tests: auth 404 = done, timeout → 503, zero Projects; busy-state guards in the dialog; weak `>= 4` precondition; `it.each` title | low | uncovered branches | patch |
| 8 | BH | no info log line for a deletion | low | half-finished runs can't be told apart | patch — start/finish info lines (account id only) |
| 9 | EC, BH | a swallowed Storage failure still deletes the auth user, leaving files | medium | `delete_prefix` logs and swallows | defer — same root as the 7.2b Storage-retry item |
| 10 | BH | re-registering with the same email resets daily quotas | low | FR-28 requires deleting everything; noted for Cristoffer | reject |
| 11 | BH | a stolen session can delete the Account without a password | low | EXPERIENCE.md asks only for the typed word; noted for Cristoffer | reject |
| 12 | BH | a failed auth delete leaves a half-deleted Account with a generic message | low | retry works (tested) | reject |
| 13 | EC | a lost 204 then a retry shows the session-expired notice | low | rare network case | reject |
| 14 | BH | spec missing from the review diff | false | excluded on purpose | reject |
