---
title: 'Story 2.7: Remove a file'
type: 'feature'
created: '2026-11-17'
status: 'done'
baseline_commit: 'ec0c4f2df6e7c32399b504c2b332a4fe30d683ab'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A student can't take a wrong or failed file out of a Project, so it keeps its slot (10 max) and its text (FR-20, AD-23).

**Approach:**
- `DELETE /api/projects/{id}/materials/{material_id}` (ActiveProject, 204). One transaction in `materials.remove`:
  - `require_active`
  - lock the Material
  - set `removed_at`
  - empty its Sections' `text` (`tsv` follows)
  - `jobs.cancel_for_material`

  The stored original is deleted after commit.
- An already removed Material answers 204, so a retry is safe. A foreign or missing one answers `404 not_found`.
- `jobs.cancel_for_material`:
  - finishes a queued job as `cancelled` at once (this closes the 2.2 deferred item);
  - sets `cancel_requested` on a running one, which the Runner's save step already turns into `cancelled` without saving.
- In the Files panel:
  - Reading…, Ready, and partly-readable rows get a "···" Overflow menu with "Remove", which opens the Remove file dialog.
  - Rejected rows get a "Remove" button that removes at once, with no dialog.
  - Rows still uploading (no id yet) get neither.
- The dialog, from EXPERIENCE.md:
  - title "Remove {file name}?"
  - the body, or for a Reading… file the short body "Reading stops and the file won't be added."
  - "Cancel" and "Remove" (Button, danger)

  Decided by Cristoffer 2026-11-17: the Ready body is shown as written even before Quizzes and Mistakes exist, and the `[ASSUMPTION]` copy (EXPERIENCE.md L157, L160, L162) is approved in both languages.

  While removing, both buttons are disabled. On failure the dialog stays open with an Inline error ("We couldn't remove the file." + "Try again"), and the file keeps its slot. On success the row leaves, "Files · n of 10" updates, and focus goes to the Upload button.

## Boundaries & Constraints

**Always:**
- The removal is all-or-nothing (AD-23): a failure changes nothing.
- A removed Material never shows in the list or the slot count.
- Sections keep their labels; the file name stays in the database.
- Removing requires an active Project.
- Text only from `frontend/src/i18n/`; styles only from tokens.

**Never:**
- No Mistakes checkbox or `mistakes.withdraw_for_material` (Story 3.3); the checkbox stays hidden.
- No image-unit release (Story 2.5 adds it).
- No undo.
- No hard delete of the row.
- No new migration unless the code shows one is needed.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Remove Ready | Ready file with Sections | 204; `removed_at` set; Section text empty, labels kept; original deleted; gone from list; slot free | N/A |
| Remove Reading…, running | job running | 204; job ends `cancelled`; no Sections saved; slot free at once | N/A |
| Remove Reading…, queued | job queued | 204; job `cancelled` at once and never run | N/A |
| Remove Rejected | Rejected file | 204, no dialog; row leaves | N/A |
| Remove twice | already removed | 204, no change | N/A |
| Foreign / missing | another Account's or unknown id | 404 `not_found` | N/A |
| Read-only Project | archived/deleted Project | 409 `project_read_only` | N/A |
| 11th file after removal | 10 files, one removed | the next upload is accepted | N/A |
| Remove fails (SPA) | DELETE rejects | dialog stays open, Inline error, "Try again" | file kept in list |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261117120000_study_materials.sql`:
  - `removed_at` (L25) exists.
  - The slot rule is in code (`OCCUPIES_SLOT`).
  - `sections.tsv` is generated from `text` (L45).
  - `generation_jobs.cancel_requested` (L61).
- `backend/app/db/materials.py`:
  - `count_slots` and `list_for_project` (L53) already skip `removed_at`.
  - Add `mark_removed` and `empty_sections`.
  - `get_for_update` (L67) returns `removed_at`.
- `backend/app/services/materials.py`:
  - Add `remove`.
  - Reuse `material_path` and `storage.delete` (it logs and swallows) for the after-commit delete.
  - `on_terminal` (L216) only rejects `processing` rows. A removed running Material ends `rejected` + removed, which is harmless.
- `backend/app/db/jobs.py` / `services/jobs.py`:
  - `claim` (L39) skips `cancel_requested`.
  - `finish` (L59) works on queued jobs.
  - The save step aborts on `any_material_removed` (L205-212).
  - Add `cancel_for_material`; it is the only writer of `cancel_requested` (AD-20).
- `backend/app/api/materials.py`:
  - Add the DELETE route with `ActiveProject` and `after_commit` from `api/conn.py`.
  - `backend/tests/test_routes_guard.py` (L71) requires the guard; add a per-route test like `test_upload_is_guarded` (L82).
- `frontend/src/components/FileRow.jsx`: the comment at L6-7 expects the menu. Copy the DropdownMenu pattern from `AccountMenu.jsx` (L51-89).
- `frontend/src/components/PrivacyNotice.jsx`: the Dialog pattern with focus return. Build the new `RemoveFileDialog.jsx` from it.
- `frontend/src/components/FilesPanel.jsx`:
  - the count is at L22;
  - pending rows have no id (L25).
- `frontend/src/pages/useProjectFiles.js`: add `remove(material)`. It returns a promise and drops the row from `loaded` on success.
- `frontend/src/i18n/en.json`, `nb.json`: add `files.remove.*` from EXPERIENCE.md L156-162. `inlineError.reassurance` exists.
- `frontend/src/test/fakeApi.js`: add the DELETE handler.

## Tasks & Acceptance

**Execution:**
- [x] `backend/app/db/materials.py`, `backend/app/db/jobs.py`, `backend/app/services/jobs.py`, `backend/app/services/materials.py`, `backend/app/api/materials.py` -- the repo functions, `cancel_for_material`, `remove`, and the route.
- [x] `backend/tests/test_remove_material.py`, `backend/tests/test_routes_guard.py` -- every backend matrix row, including a removal while the job is held mid-extraction.
- [x] `frontend/src/components/FileRow.jsx`, `RemoveFileDialog.jsx`, `FilesPanel.jsx`, `frontend/src/pages/useProjectFiles.js`, i18n -- the menu, the Rejected button, the dialog, and the removal.
- [x] `frontend/src/components/RemoveFile.test.jsx` -- the SPA rows:
  - the dialog for Ready and Reading…;
  - the immediate Rejected removal;
  - the failure with Try again;
  - the count updates;
  - focus;
  - Esc/Cancel removes nothing;
  - Norwegian.

**Acceptance Criteria:**
- Given a removed file, when the Project reopens, then the file isn't listed and "Files · n of 10" excludes it.
- Given the dialog, when it opens, then focus is inside it, and Esc or Cancel returns focus to the "···" trigger with nothing removed.

## Verification

**Commands:**
- `cd backend; uv run pytest` -- expected: all green with `LLM_MODE=mock`
- `cd frontend; npm test; npm run lint` -- expected: all green

## Implementation Notes

- `jobs.cancel_for_material` locks job rows with `FOR UPDATE SKIP LOCKED`. The runner's save step locks the job row first and then the Project (`FOR SHARE`) and the Material. Removal locks the Project and then the Material, so waiting on the job row could deadlock. A job skipped because it is locked is either being claimed or in its save transaction. Both paths reach the save step's `any_material_removed` check, which ends the job `cancelled` without saving.
- A queued job cancelled by removal doesn't run the `on_terminal` hook, so its Material stays `processing` with `removed_at` set. It never lists or counts. The route's after-commit step deletes the original.
- No migration was needed.
- On the frontend, the Rejected-row "Remove" shows the same Inline error ("We couldn't remove the file." + "Try again") in the panel's error area when it fails. The spec gives no copy for this case, so the dialog's failure string is reused.
- Removal errors in the SPA (the dialog and the Rejected-row button) branch on the code:
  - signed-out codes do nothing here, because the app handles sign-out;
  - `not_found` counts as removed, so the row leaves and the dialog closes;
  - `project_read_only` shows `errors.project_read_only` with no "Try again";
  - anything else shows "We couldn't remove the file." + "Try again".
- `materials.remove` returns the original's delete on the already-removed path too. A retry answers 204 without changing the database, but it deletes an original whose earlier after-commit delete failed. The storage delete is idempotent.
- The "···" glyph is an inline SVG because `oxlint`'s `jsx-no-literals` rule rejects the literal. The trigger's accessible name comes from i18n.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | EC, BH, VG | a poll's stale list brings a removed row back | medium | `fetchList` replaced `loaded` wholesale after `remove` filtered it | patch — removed ids filtered per Project; test added |
| 2 | EC, BH | every DELETE failure offers "Try again", even `not_found` / `project_read_only` / signed-out | medium | No branch on `code` in the dialog or `removeNow` | patch — code branching; tests added |
| 3 | EC, BH | removal state survives a Project switch | low | `FilesPanel` wasn't remounted per Project | patch — `key={projectId}` |
| 4 | EC, BH | one `removingNow` for parallel Rejected removals | low | Second click overwrote the first's state | patch — Set of ids, per-file errors |
| 5 | EC, BH | dialog shows a stale copy of the file | low | `target` held the material from when it opened | patch — live lookup by id; closes when gone |
| 6 | BH | a failed storage delete is never retried | low | Already-removed path returned None | patch — delete returned on every path |
| 7 | BH | danger/ghost buttons lack hover/focus-visible; hard-coded values | low | CSS had no such states | patch — states added; tokens where they exist |
| 8 | VG | no test that uploading rows get no controls | medium | No test rendered a row without an id and looked for them | patch — test added |
| 9 | EC, BH | cancelled job of a removed Reading… file never marked seen | low | Picked up and marked seen by the next poll when a file processes; only an extra list fetch | reject |
| 10 | EC, VG | auto-naming can use a file removed between its ready commit and the name write | low | Narrow window; fix needs a new guard in `auto_name_if_unnamed` | reject |
| 11 | BH | removed Materials end `processing` or `rejected` depending on timing | low | Hidden everywhere by `removed_at`; no reader of their status yet | reject |
| 12 | BH | claim/removal SKIP LOCKED race untested | low | Save step's `any_material_removed` covers it; a held-claim test needs new infrastructure | reject |
| 13 | BH | failure test injects only one failure | low | One injected failure proves the single transaction rolls back | reject |
| 14 | BH | "Remove" menu item not styled destructive | false | EXPERIENCE.md: menu items are normal text; danger only on the dialog's final button | reject |
| 15 | BH | removal not announced to screen readers | low | Focus moves to Upload and the count updates; no copy exists for an announcement | reject |
| 16 | BH | spec vs sprint status differ | false | Workflow syncs sprint status at step 3 and step 5 | reject |
| 17 | BH | Code Map line numbers drift | low | Function names are given beside them | reject |
| 18 | BH | no frontend test for `deleted_at` read-only | low | Same `readOnly` flag as `archived_at`, which is tested | reject |
