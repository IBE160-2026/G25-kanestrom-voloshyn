---
title: 'Story 7.1: Archive and restore a Project'
type: 'feature'
created: '2026-11-19'
status: 'done'
baseline_commit: '5abc019b226adadf1487fd83f0a49a44be175526'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A student can't put a finished course aside. The read-only plumbing exists (`archived_at`, `require_active`, a read-only Project home), but nothing sets or clears `archived_at`, and the Sidebar lists only active Projects (FR-23, AD-22).

**Approach:**
- **Backend:**
  - `POST /api/projects/{id}/archive` and `POST /api/projects/{id}/restore` both return the Project. They are idempotent and allowlisted bookkeeping (Restore must work on a read-only Project).
  - Archive locks the row and sets `archived_at = now()`. In the same transaction it revokes the Project's open phone links through a new `phone.revoke_for_project`, whose staged-photo deletes run after commit.
  - Archive on a deleted Project returns `409 project_read_only`. Restore clears `archived_at` only. A deleted Project's restore belongs to Story 7.2, so 7.1 answers `409 project_read_only` for it.
  - Running generation is left alone: job save paths never call `require_active`.
- **Sidebar:**
  - The active row's "···" menu is Rename · Archive. Archive is immediate, with no confirmation, and shows the Undo message "{project} archived · Undo" / "{project} er arkivert · Angre" for 6 s, staying while hovered or focused. Undo restores.
  - Below the list (above "+ New project") is "Archived ({n})" / "Arkivert ({n})": collapsed by default and absent at 0. Each row opens the Project, and its "···" menu is "Restore" / "Gjenopprett".
  - The Sidebar strip doesn't show archived Projects.
- **Archived banner:** at the top of the chat column of an archived Project, "Archived · Restore" / "Arkivert · Gjenopprett", with Restore as the primary button. Archiving the open Project keeps it open, now read-only with the banner. Restore re-enables everything, and the Mistakes card returns when the count is above 0.
- **Login:** an archived last Project already falls back to the most recent active one (`identity.get_profile` and `Projects.jsx`). The SPA also drops `me.last_project_id` locally when that Project is archived.
- Delete project and Deleted projects are Story 7.2.

## Boundaries & Constraints

**Always:**
- Only `services/projects` writes `archived_at`.
- Archive and restore change nothing else on the Project (name, files, Mistakes, jobs, History).
- Copy comes from EXPERIENCE.md L171–175 through i18n; styles use tokens only. Reuse `UndoMessage` (the AppShell's live region) and the Sidebar's Radix menu.
- Phone revoke reuses `_revoke` for each open link.

**Never:**
- No Delete project, Deleted group, or purge (Story 7.2).
- No cancelling of jobs on archive.
- No confirmation dialog for Archive.
- No saved collapse state for the Archived group.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Archive | active Project, "···" › Archive | `archived_at` set; it moves into "Archived (1)"; Undo message shows | request fails → the row stays active, error line |
| Undo | within 6 s | restored; back in the active list where it was (sorted by `created_at`) | fails → error line, stays archived |
| Archive twice | already archived | 200, unchanged | N/A |
| Restore | archived Project, banner or menu | `archived_at` NULL; editing re-enabled; Mistakes card returns if > 0 | N/A |
| Deleted | `deleted_at` set | archive and restore → `409 project_read_only` | N/A |
| Open phone link | link open, batch staged | link revoked, open batch discarded, photos deleted after commit | rollback → link untouched |
| Generating | quiz job running, then archive | job completes and saves to History | N/A |
| Mutation while archived | upload, topic edit, rename, quiz answer | `409 project_read_only` (existing guard) | N/A |
| Foreign or missing id | another Account's Project | `404 not_found` | N/A |
| Open Project archived | archived from the Sidebar while open | stays open, read-only, Archived banner | N/A |

</frozen-after-approval>

## Code Map

- `backend/app/db/projects.py` -- add `set_archived(conn, account_id, project_id, archived: bool)` returning `_COLUMNS`.
- `backend/app/services/projects.py` -- add `archive` and `restore`. Lock with `repo.get_for_update`, then 404 when missing and `ProjectReadOnly` when `deleted_at` is set. `archive` calls `phone.revoke_for_project` and returns `(project, after_commit)`. Watch for an import cycle: `phone.py` imports `projects`, so import inside the function or pass the call in from the route.
- `backend/app/services/phone.py` -- new `revoke_for_project(conn, storage, account_id, project_id)` built from `_revoke` (L132). `backend/app/db/phone.py` needs a query for a Project's unrevoked link ids.
- `backend/app/api/projects.py` -- the two routes. After-commit cleanup follows the pattern the phone revoke route uses in `backend/app/api/phone.py`.
- `backend/tests/test_routes_guard.py` -- add both routes to `ALLOWLIST` with a comment.
- `backend/tests/test_projects.py` (or a new `test_archive.py`) -- every backend matrix row, plus a running-job-saves test (pattern in `test_quiz_generation.py`) and a phone revoke test (pattern in `test_phone_upload.py`).
- `frontend/src/components/Sidebar.jsx` -- the Archive item; the Archived group (`archivedProjects` prop, toggle button with `aria-expanded`); the archived row menu with Restore. The strip stays active-only.
- `frontend/src/components/AppShell.jsx` -- `archiveProject` and `restoreProject` (they `upsertProject` the result), the archive Undo message in the existing `styles.undo` live region (alongside the takeover notice), and `archivedProjects` from `projects`. Both go into the outlet context.
- `frontend/src/pages/ProjectHome.jsx` -- the Archived banner at the top of the chat column when `project.archived_at` (and not deleted). Restore uses the context's `restoreProject`, which updates the page's `loaded` project too. `readOnly` already gates everything else.
- `frontend/src/test/fakeApi.js` -- archive and restore, with 409 for deleted.
- `frontend/src/i18n/en.json`, `nb.json` -- `projects.archive`, `projects.restore`, `projects.archivedGroup` (count), `projects.archivedUndo`, `projects.undo`, `project.archivedBanner`.

## Tasks & Acceptance

**Execution:**
- [x] `backend/app/db/projects.py`, `db/phone.py`, `services/projects.py`, `services/phone.py`, `api/projects.py` -- archive, restore, and per-Project phone revoke.
- [x] `backend/tests/test_archive.py` + `test_routes_guard.py` -- the matrix rows above.
- [x] `frontend` Sidebar, AppShell, ProjectHome, fakeApi, i18n -- menu items, Archived group, Undo, banner.
- [x] `frontend/src/components/Archive.test.jsx` -- archive moves the row and shows Undo; Undo restores; message closes after 6 s and stays on hover; group absent at 0, collapsed by default, expands; Restore from menu and from banner; archiving the open Project shows the banner and disables uploads; Mistakes card back after restore; strip shows no archived rows; failed archive shows an error; Norwegian.

**Acceptance Criteria:**
- Given an archived Project with 3 Mistakes, when the student restores it from the banner, then the composer tools and uploads re-enable and the card reads "3 mistakes to review" without a reload.
- Given the last-opened Project is archived, when the student signs in, then they land on the most recent active Project.

## Verification

**Commands:**
- `cd backend; uv run pytest` -- expected: all green with `LLM_MODE=mock`
- `cd frontend; npm test; npm run lint` -- expected: all green (from PowerShell)

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | VG, BH | a failed restore (Undo, menu, banner) is untested | medium | no test fails `POST …/restore`; matrix row "Undo fails" unpinned | patch |
| 2 | VG, EC, BH | focus after Archive untested; lost when the only active Project is archived | medium | `querySelector('a')` is null with an empty list | patch — fall back to "+ New project"; test |
| 3 | EC, BH | focus lost after Restore (menu row, banner) and Undo | medium | the focused control unmounts | patch — focus the restored Project's Sidebar link |
| 4 | EC, BH | banner `restoring` not tied to the Project; stays busy after navigating | low | `restoring` is never reset on `projectId` change | patch |
| 5 | BH | Archived group's scroll area includes its toggle | low | `max-height`/`overflow` on `.group` | patch — move to the `<ul>` |
| 6 | BH | `archivedOpen` survives the group disappearing | low | never reset; group returns expanded | patch |
| 7 | BH | error state still named `createError` | low | now covers archive and restore | patch — rename |
| 8 | BH | banner Restore has no hover state | low | `.groupToggle`/`.undoAction` have one | patch |
| 9 | BH | Undo when the open Project is archived — banner disappearance untested | low | no test | patch |
| 10 | EC | re-archive skips revoking leftover links | false | links can only be created on an active Project (`create_link` → `require_active`), and archive revokes all under the row lock | reject |
| 11 | BH | `delete_all` stops after the first failed storage delete | low | same pattern as the existing `_revoke`; storage errors are rare | reject |
| 12 | BH | Undo leaves local `last_project_id` null | low | server keeps the value; only `/projects` in the same session differs | reject |
| 13 | BH | ProjectHome takes every field from the shell list | false | ProjectHome `upsertProject`s the GET result, so both copies are the same row | reject |
| 14 | BH | fakeApi archive doesn't discard batches or return image units | low | test double only; backend covers it | reject |
| 15 | BH | extra backend tests (me after archive, finalize race, DB `archived_at` check) | low | `test_me_hides_a_last_project_that_is_not_active` covers the first; lock order is the existing one | reject |
| 16 | BH | two archives in a row replace the first Undo | low | one Undo message at a time is the component's design | reject |
| 17 | BH | open archived row loses the open highlight | false | `.item.open` background still applies; only text colour is muted | reject |
| 18 | BH | spec and planning files missing from the diff | false | excluded on purpose | reject |
