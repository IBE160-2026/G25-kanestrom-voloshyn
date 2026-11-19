---
title: 'Story 7.2b: Delete a Project forever, and the 30-day purge'
type: 'feature'
created: '2026-11-19'
status: 'done'
baseline_commit: '68fc079da43e2284f501908855b902affcb2edd6'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A deleted Project waits in Deleted projects, but nothing ever removes it. There is no way to remove it at once, and no automatic removal after 30 days (FR-24, §5.4, AD-22). This is Story 7.2 part B, deferred from 7.2a on 2026-11-19. Cristoffer asked for the button again on 2026-11-19: "a button to delete it permanently before the 30 days … when the project is put in [the] delete folder".

**Approach:**
- **`projects.purge(pool, storage, runner, account_id, project_id)`** uses its own short transactions, never one held across the wait (AD-18):
  1. Lock the Project. Missing or foreign → `404 not_found`. Not deleted → `409 project_not_deleted`. Then cancel its jobs (`jobs.cancel_for_project`) and commit.
  2. Interrupt the running jobs, then wait for them through a new `Runner.wait_for(job_ids, timeout)` (30 s; after that it proceeds anyway).
  3. `DELETE FROM projects … AND deleted_at IS NOT NULL`. Every child row goes by cascade, including Mistake history.
  4. After commit, delete the Storage prefix `{account_id}/{project_id}/`.
- **`POST /api/projects/{id}/purge`** is allowlisted bookkeeping and returns `204`.
- **Purge task:** `projects.purge_expired_forever` runs in the lifespan beside the phone cleanup, at startup and then hourly. It purges every Project whose `deleted_at` is more than 30 days old, one at a time; a failure is logged and the loop continues.
- **Reads treat an expired Project as gone** even before the task runs (a host that slept): `list_for` leaves it out, and `get`, `get_for_update` and restore answer `404`.
- **"Delete forever" / "Slett for godt"** appears in the deleted row's "···" menu (Restore · Delete forever) and in the Deleted banner, next to Restore. It opens a Confirm dialog:
  - title "Delete {project} forever?" / "Vil du slette {project} for godt?";
  - body "Its files, mistakes, and generated material are deleted. This can't be undone." / "Filene, feilene og det genererte innholdet slettes. Dette kan ikke angres.";
  - "Cancel" · "Delete forever", with Button (danger) and no typing.
- **Landing:**
  - From the open deleted Project, land on the most recent active Project, or `/projects` when none is left.
  - From the Sidebar menu for another Project, stay on the current page.
  - The row leaves the group, and the group disappears at 0.

## Boundaries & Constraints

**Always:**
- Only `services/projects` deletes `projects` rows; jobs go through `services/jobs`.
- Storage objects are deleted only after the row delete commits.
- No connection is held during the wait.
- Copy comes from EXPERIENCE.md L178, L182–184 through i18n; tokens only.
- `project_not_deleted` gets en/nb error text (approved by Cristoffer 2026-11-19) ("This project isn't in Deleted projects." / "Prosjektet ligger ikke i Slettede prosjekter.").

**Never:**
- No Account deletion (Story 7.4), no Settings (Story 7.3).
- No cron service or worker: the task lives in the FastAPI lifespan (AD-20).
- No purge of a Project that isn't deleted.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Delete forever | deleted Project, confirm | `204`; the row and all child rows gone; Storage prefix empty; leaves the group | request fails → dialog stays, error line |
| Not deleted | active or archived Project | `409 project_not_deleted`; nothing deleted | N/A |
| Missing or foreign | another Account's id | `404 not_found` | N/A |
| Running job | quiz running when purging | interrupted, waited for, nothing saved; Project gone | job outlives the 30 s wait → purge proceeds; its save finds no Project |
| Twice | purge again after success | `404 not_found` | N/A |
| Expired | `deleted_at` 31 days ago | absent from the list; open, restore and purge → `404`; the task purges it | N/A |
| Not yet expired | `deleted_at` 29 days ago | the task leaves it | N/A |
| Task failure | one purge raises | logged; the next Projects still purged; retried next hour | N/A |
| From the banner | open deleted Project, confirm | lands on the newest active Project, or `/projects` | N/A |
| From the menu | another deleted Project | stays on the current page | N/A |
| Cancel | dialog Cancel or Esc | nothing changes; focus back on the trigger | N/A |

</frozen-after-approval>

## Code Map

- `backend/app/services/projects.py` -- `purge`, `purge_expired`, `purge_expired_forever` (copy the shape of `phone.cleanup_forever`, `backend/app/services/phone.py` ~L330). `delete` (7.2a) shows how `jobs.cancel_for_project` and the terminal-hook after-steps are used. Run those after-steps after the first commit.
- `backend/app/db/projects.py` -- `delete_deleted(conn, account_id, project_id)` (the `DELETE … deleted_at IS NOT NULL`) and `expired_ids(conn)`. Add `AND (deleted_at IS NULL OR deleted_at > now() - interval '30 days')` to `list_for`, `get` and `get_for_update`, so every guard sees an expired Project as gone.
- `backend/app/services/jobs.py` -- `Runner.wait_for(job_ids, timeout)`: wait on the tasks running those ids (`_in_handler` holds only the handler phase; track the task per job id for the whole `_run`).
- `backend/app/storage.py` -- `delete_prefix(prefix)`: list with `POST /storage/v1/object/list/{bucket}` (`{"prefix", "limit", "offset"}`; entries with `id: null` are folders, so recurse), then remove in bulk with `DELETE /storage/v1/object/{bucket}` and `{"prefixes": [...]}`. Log and swallow failures, like `delete`.
- `backend/app/main.py` -- start and cancel the purge task beside `phone.cleanup_forever` (L142-150).
- `backend/app/api/projects.py` -- the purge route. It uses `request.app.state` pool, storage and runner, not the request `Conn` transaction.
- `backend/app/errors` / `frontend/src/i18n/errors.js` and catalogues -- `project_not_deleted`.
- `backend/tests/test_routes_guard.py` -- allowlist.
- `backend/tests/test_purge.py` -- every backend matrix row. Use storage objects (`storage_put`, `stored_objects` as in `test_delete_project.py`), the running-job race (pattern from 7.2a's running-quiz test), child rows (materials, sections, topics, quizzes, mistakes, jobs, phone rows) gone, and another Account's rows untouched.
- `frontend/src/components/PurgeProjectDialog.jsx` (+ css) -- modelled on `DeleteProjectDialog.jsx`, with the danger button token.
- `frontend/src/components/Sidebar.jsx`, `AppShell.jsx` (`purgeProject`: drop it from `projects` and land), `pages/ProjectHome.jsx` (the Deleted banner button), `test/fakeApi.js`, i18n.
- `frontend/src/components/PurgeProject.test.jsx` -- every frontend matrix row, focus, and Norwegian.

## Tasks & Acceptance

**Execution:**
- [x] `backend/app/db/projects.py`, `services/projects.py`, `services/jobs.py`, `storage.py`, `api/projects.py`, `main.py`, errors -- purge, the expiry filter, the task.
- [x] `backend/tests/test_purge.py` + `test_routes_guard.py` -- the backend matrix rows.
- [x] `frontend` dialog, Sidebar, AppShell, ProjectHome, fakeApi, i18n -- Delete forever.
- [x] `frontend/src/components/PurgeProject.test.jsx` -- the frontend matrix rows.

**Acceptance Criteria:**
- Given a deleted Project with files, quizzes and Mistakes, when the student chooses "Delete forever" and confirms, then it is gone from the Sidebar and the database, and its Storage objects are deleted.
- Given a Project deleted 31 days ago while the app was stopped, when the app starts, then the task purges it, and before that it never shows in the list.

## Verification

**Commands:**
- `cd backend; uv run pytest` -- expected: all green with `LLM_MODE=mock`
- `cd frontend; npm test; npm run lint` -- expected: all green (from PowerShell)

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | BH, EC | concurrent purge: the loser gets 404, the dialog errors and the row stays | medium | `purgeProject` rejects before `forgetProject` | patch — treat `not_found` on purge as done |
| 2 | BH, VG | restored-during-the-wait branch untested | medium | no test reaches `delete_deleted` → False | patch |
| 3 | BH | cascade test checks only direct children | medium | grandchild FKs unchecked | patch — assert every FK chain from `projects` cascades |
| 4 | BH | dialog lacks DESIGN.md's inset box and bold "This can't be undone." | medium | AD-28: DESIGN.md wins | patch — inset box for the loss sentence, bold second sentence |
| 5 | BH | banner "Delete forever" not the shared ghost button | low | own `.bannerPurge` style | patch — reuse ghost styles if present |
| 6 | BH | banner Delete forever clickable during a restore | low | no disabled state | patch |
| 7 | BH | `< 3 s` timing assertion; task test asserts only `purged >= 1` | low | flaky on slow runs; weak check | patch |
| 8 | EC | a non-list Storage list body raises TypeError after commit → 500 | low | `delete_prefix` doesn't swallow it | patch |
| 9 | BH | over-long Sidebar comment; dead `setArchived` in `purgeProject`; `runner: Any` | low | cosmetic / typing | patch |
| 10 | BH, EC | Storage delete failure after commit is never retried (orphans) | medium | best-effort like material removal; AD-16 orders Storage after commit | defer |
| 11 | VG | purge loop's round-level error handling untested | low | same shape as `phone.cleanup_forever`; reads hide expired Projects anyway | reject |
| 12 | BH | expiry filter not proven on child-data GET routes | maybe-false | those routes resolve the Project first; unverified per route | reject (low if true) |
| 13 | BH | no focus target after a failed banner purge | low | rare; dialog stays open with its error | reject |
| 14 | BH, EC | a job outliving the 30 s wait may write Storage or skip its quota hook | low | needs a > 30 s handler during a purge | reject |
| 15 | BH | `Runner.wait_for` has no unit test | low | covered end-to-end by two purge tests | reject |
| 16 | EC | restore during the wait leaves jobs cancelled and the purge answers 409 | low | correct outcome; the cancel is the purge's intent | reject |
| 17 | EC | wait blocks on an after-commit auto-naming call | low | bounded by the 30 s timeout | reject |
| 18 | EC | restored then re-deleted during the wait is purged without a new confirm | low | needs two actions inside 30 s | reject |
| 19 | VG | queued jobs cancelled in step 1 aren't waited for | low | they never run; the cascade removes them | reject |
| 20 | BH | spec missing from the review diff | false | excluded on purpose | reject |
