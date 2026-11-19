---
title: 'Story 7.2a: Delete a Project and restore it'
type: 'feature'
created: '2026-11-19'
status: 'done'
baseline_commit: '6fa54303e12988eadc3c84973c19ae159f87de89'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A student can't delete a Project. The read-only plumbing and the job save guard (`project_deleted`) already understand `deleted_at`, but nothing sets it, and no deleted Project can be found again (FR-24, AD-22). This is Story 7.2 part A, split off by Cristoffer on 2026-11-19. "Delete forever" and the 30-day purge are 7.2b.

**Approach:**
- **Backend:**
  - `POST /api/projects/{id}/delete`, allowlisted bookkeeping and idempotent. It locks the row and sets `deleted_at = now()`, keeping `archived_at`. In the same transaction it:
    - revokes the phone links (`phone.revoke_for_project`, photo deletes after commit);
    - cancels the Project's jobs through a new `jobs.cancel_for_project`. Queued jobs end `cancelled` and their image units come back, as in `materials.remove`. Running jobs get `cancel_requested` and are interrupted after commit (`Runner.interrupt`).
  - `restore` now clears both `deleted_at` and `archived_at`, so a deleted Project returns to the active list even if it was archived before.
  - `Project` gains `purge_at` (`deleted_at + 30 days`, else null).
- **Delete project dialog** (Radix dialog, as `RemoveFileDialog`):
  - Opens from "Delete project" in the active and archived rows' "···" menus.
  - Title "Delete {project}?" / "Vil du slette {project}?".
  - Body "{project} moves to Deleted projects and is permanently deleted after 30 days. You can restore it until then." / "{project} flyttes til Slettede prosjekter og slettes for godt etter 30 dager. Du kan gjenopprette det frem til da."
  - Buttons "Cancel" · "Delete project" / "Avbryt" · "Slett prosjekt". The final button is Button (primary), and no typing is needed.
- **Sidebar:**
  - "Deleted projects ({n})" / "Slettede prosjekter ({n})" sits below the Archived group. It is collapsed by default, absent at 0, and not in the strip.
  - Each row is muted, with "Deleted · {n} days left" / "Slettet · {n} dager igjen" ("1 day left" / "1 dag igjen"). Its "···" menu is "Restore" / "Gjenopprett" only.
- **Deleted banner:** at the top of the chat column, "Deleted · {n} days left", with Restore (primary). The read-only state is the same as an archived Project's.
- **Landing:**
  - Deleting the open Project lands on the most recent other active Project, or `/projects` (the empty state) when none is left.
  - Deleting another Project stays on the current page.
  - Restore stays on the current page, with no Undo message.
- Days left = ceil((`purge_at` − now) / 1 day), at least 1.

## Boundaries & Constraints

**Always:**
- Only `services/projects` writes `deleted_at`.
- Only `services/jobs` writes `generation_jobs`.
- The delete changes nothing else: files, Mistakes, History and Topics stay.
- Copy comes from EXPERIENCE.md L172–181 through i18n; styles use tokens only. Reuse the 7.1 group, banner and focus patterns.

**Never:**
- No "Delete forever", purge, purge task, or Storage deletion of Project files (7.2b).
- No Settings entry point (Story 7.3 adds Settings).
- No Undo message for delete or restore.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Delete active | confirm the dialog | `deleted_at` set; row in "Deleted projects (1)" with "Deleted · 30 days left" | fails → dialog stays, error line |
| Delete archived | archived row › Delete project | moves from Archived into Deleted | N/A |
| Cancel | dialog Cancel or Esc | nothing changes; focus back on "···" | N/A |
| Running quiz | job running, delete | job ends `cancelled`, nothing saved to History | N/A |
| Queued image | queued `material_processing` for an image | job `cancelled`; image unit returned | N/A |
| Phone link | link open | revoked; open batch discarded | rollback → untouched |
| Delete twice | already deleted | 200, `deleted_at` unchanged | N/A |
| Restore | deleted (was archived before) | both columns NULL; in the active list; editing re-enabled | fails → error line, stays deleted |
| Archive deleted | `deleted_at` set | `409 project_read_only` (as 7.1) | N/A |
| Open deleted | from the group | read-only, Deleted banner with days left, no Mistakes card | N/A |
| Delete open, others left | open Project deleted | lands on the newest other active Project | N/A |
| Delete open, none left | last active Project | `/projects` empty state | N/A |
| Days left | `purge_at` in 29 d 2 h / 0 d 3 h | "30 days left" / "1 day left" | N/A |
| Login | last Project deleted | lands on the most recent active Project | N/A |

</frozen-after-approval>

## Code Map

- `backend/app/db/projects.py` -- `set_deleted`; widen `set_archived(False)` (or add `set_restored`) so restore clears both columns.
- `backend/app/services/projects.py` -- `delete(conn, storage, account_id, project_id)`: lock the row (404 when missing); idempotent when already deleted; revoke phone links; `jobs.cancel_for_project`; return `(project, after_commit, interrupt_ids)`. `restore` accepts deleted Projects now; `_lock_not_deleted` stays for `archive` only.
- `backend/app/services/jobs.py`, `backend/app/db/jobs.py` -- `cancel_for_project` modelled on `cancel_for_material` (L102) and `repo.cancel_queued_for` / `request_cancel_running_for` (L140, L164), scoped by `project_id`. It returns the queued jobs it cancelled and the running ids to interrupt.
- `backend/app/services/materials.py` -- `_release_if_unread` (L268) gives back a queued image's unit. Expose it (or move it beside the jobs code) so the delete can reuse it; don't duplicate the quota logic (`services/usage` owns it).
- `backend/app/api/projects.py` -- the `delete` route; after commit, the photo deletes and `request.app.state.runner.interrupt(id)` for each running job (as in `api/jobs.py` cancel). `Project.purge_at`, computed in SQL or the model.
- `backend/tests/test_routes_guard.py` -- allowlist the delete route.
- `backend/tests/test_delete_project.py` -- the backend matrix rows, using the job and phone patterns from `test_archive.py`.
- `frontend/src/components/DeleteProjectDialog.jsx` (+ css) -- modelled on `RemoveFileDialog.jsx`.
- `frontend/src/components/Sidebar.jsx` -- "Delete project" in both menus; the Deleted group (mirror the Archived group, including the reset when empty and the `groupList` scroll); "Restore" in the deleted rows' menu.
- `frontend/src/components/AppShell.jsx` -- `deleteProject(id)` (landing for the open Project) and `deletedProjects`. `restoreProject` already exists.
- `frontend/src/pages/ProjectHome.jsx` -- a Deleted banner beside the Archived one; `readOnly` already covers the rest.
- `frontend/src/components/daysLeft.js` -- a pure helper.
- `frontend/src/test/fakeApi.js` -- delete, restore clearing both, and `purge_at`.
- `frontend/src/i18n/en.json`, `nb.json` -- dialog, group, days-left (plural), and menu strings.

## Tasks & Acceptance

**Execution:**
- [x] `backend/app/db/projects.py`, `db/jobs.py`, `services/jobs.py`, `services/projects.py`, `services/materials.py`, `api/projects.py` -- delete, cancel for the Project, restore both, `purge_at`.
- [x] `backend/tests/test_delete_project.py` + `test_routes_guard.py` -- the backend matrix rows.
- [x] `frontend` dialog, Sidebar, AppShell, ProjectHome, `daysLeft.js`, fakeApi, i18n -- the dialog, Deleted group, banner, landing.
- [x] `frontend/src/components/DeleteProject.test.jsx` -- every frontend matrix row, focus after delete and restore (as 7.1), and Norwegian.

**Acceptance Criteria:**
- Given an archived Project that is then deleted, when the student restores it from the Deleted banner, then it shows in the active list (not Archived) and uploads are enabled.
- Given a quiz generating in a Project, when the student deletes that Project, then the job ends `cancelled` and no quiz is saved.

## Implementation Notes

- A queued `material_processing` job cancelled by the delete ends through `materials.end_unfinished` (the job's own terminal hook): its file is Rejected, its image unit returns, and its never-read original is deleted. Otherwise a restored Project would keep a file "Reading…" forever with no job.
- `Login.test.jsx` "after-sign-in failing with auth_unavailable" now counts only `/api/auth/after-sign-in` calls; the total call count raced the Projects page load.

## Verification

**Commands:**
- `cd backend; uv run pytest` -- expected: all green with `LLM_MODE=mock`
- `cd frontend; npm test; npm run lint` -- expected: all green (from PowerShell)

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | BH | queued-job cleanup hard-codes `material_processing` instead of the kind's terminal hook | medium | `projects.delete` imports `materials`; a future kind with a queued reservation would leak | patch — run each cancelled queued job's `on_terminal` from `jobs.cancel_for_project` |
| 2 | VG | storage cleanup after deleting a Project with a queued file job is untested | medium | the test never stores an original | patch |
| 3 | VG | Undo message cleared on delete of a just-archived Project is untested | medium | a leftover Undo would restore a deleted Project | patch |
| 4 | EC | `delete` docstring says files stay; mid-processing files are rejected | low | `end_unfinished` rejects them | patch — docstring |
| 5 | BH | delete clears an unrelated archive/restore error line | low | `setActionError(null)` in `deleteProject` | patch — drop it |
| 6 | BH, EC | files cancelled by delete show `processing_failed`, not `interrupted`; files rejected after restore | low | both codes have the same copy ("Reading stopped. Upload the file again."); a running file job was already rejected through the save guard before this story | reject |
| 7 | BH, EC | `SKIP LOCKED` lets a job being claimed or progress-locked run its model call | low | rare; the save step still cancels it, so only one call's cost | reject |
| 8 | BH, EC | `purge_at` depends on session timezone (DST) | low | local Supabase runs UTC; 30 calendar days is the intended meaning | reject |
| 9 | BH, EC | past `purge_at` shows "1 day left" and can still be restored | low | purge arrives with 7.2b (deferred-work.md), which treats expired Projects as gone | reject |
| 10 | BH | "30 days" duplicated in copy and code | low | the copy is signed in EXPERIENCE.md; `purge_at` drives the count | reject |
| 11 | BH | banner Restore can be double-clicked | false | `restore` returns early while busy (7.1 patch) | reject |
| 12 | BH | days-left not refreshed while the page stays open | low | changes once a day; any navigation re-renders | reject |
| 13 | BH | banner uses the Sidebar's days-left key | low | same signed copy (EXPERIENCE.md L177) | reject |
| 14 | BH | missing backend tests (running image job, phone link after restore, rejected after restore) | low | running file jobs are covered by the existing terminal-hook tests | reject |
| 15 | BH | frontend tests: delete the open archived Project; fake cancels jobs; fake 409s | low | covered by the open-Project and archived-row tests | reject |
| 16 | BH | test helper imports from nine modules | low | style only | reject |
| 17 | BH | `set_deleted` may return None | false | the row is locked by `get_for_update` just before | reject |
| 18 | EC | dialog stays open on a signed-out error | false | sign-out navigates to Login, which unmounts the shell | reject |
