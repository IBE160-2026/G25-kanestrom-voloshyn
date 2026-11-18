---
title: 'Story 2.6b: Edit the Topics in each file'
type: 'feature'
created: '2026-11-18'
status: 'done'
baseline_commit: '16bd59e619f83f73a5deaa88dfe3c12bb699dbee'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 2.6a shows each file's Topics, but students can't fix them. FR-22 and AD-21 let a student rename, merge, delete, and add Topics. Each edit stays inside its own file and is kept. Split from Story 2.6 by Cristoffer on 2026-11-18; this story keeps the sprint key `2-6-see-and-edit-the-topics-in-each-file`.

**Approach:**
- New routes. Each one requires an active Project (`ActiveProject`), runs in one transaction, and locks the Material row `FOR UPDATE`. Each answers `200` with the Material's whole Topic list `{material_id, topics}`. Every id must belong to the URL's Project, or the answer is `404 not_found`.
  - `PATCH /api/projects/{id}/topics/{topic_id}` `{label}`: rename. The label is trimmed and must be 1–100 characters, else `422 invalid_name`.
  - `DELETE /api/projects/{id}/topics/{topic_id}`: delete. The last Topic is refused with `422 topic_last_cannot_delete`.
  - `POST /api/projects/{id}/topics/merge` `{topic_ids}`: needs 2 or more distinct ids. Topics from different files are refused with `422 topic_merge_cross_material`. The Topic with the lowest position keeps its id, label, and group. It takes the union of the Sections, and the other Topics are deleted.
  - `POST /api/projects/{id}/materials/{material_id}/topics` `{label}`: add a Topic with `origin='student'`, no Sections, and no group, placed last. The 101st is refused with `422 topic_limit_reached`. Only a Ready, non-removed Material accepts it; any other is `404`.
- Topic list, when the Project is active:
  - Chips become buttons. A click or Enter opens an inline rename field: Enter saves, Esc cancels, and an unchanged or blank label closes without saving.
  - Each chip has a × that deletes it. The last chip has no ×.
  - "+ Add topic" opens the same field, and Enter adds.
  - Ctrl+click or Space selects chips. With 2 or more selected, a ghost "Merge" appears. The merged Topic then opens for rename.
  - The count and the list update from the response.
  - A failed edit shows the Inline error under the list, and the Topics stay as they were. A network or server error offers "Try again"; a refusal that names a rule shows only its message.
- Read-only Projects show the list without edit controls (EXPERIENCE.md L485, L516).
- Merge mode, decided by Cristoffer 2026-11-18 after the browser check (a plain click always renamed, so Merge was hard to find): the file's "···" menu gets "Merge topics" (Ready, active, 2+ Topics). It shows the hint "Select the topics to merge." / "Velg emnene som skal slås sammen."; a click or Space on a chip selects instead of renaming; "Merge" (enabled at 2+) and "Cancel" / "Avbryt" end the mode. Ctrl+click and Space stay as shortcuts. One merge kind only: combine into the lowest-position Topic, then rename. Menu item copy "Merge topics" / "Slå sammen emner".
- Merge mode follow-up, decided by Cristoffer 2026-11-18: Ctrl+click or Space on a chip starts merge mode with that chip selected; the action row (hint, primary "Merge", ghost "Cancel", and "+ Add topic" outside merge mode) sits outside the scrolling list so it is always visible.
- Copy, decided by Cristoffer 2026-11-18 and added to EXPERIENCE.md's strings table: edit failed "We couldn't change the topics." / "Vi fikk ikke endret emnene."; `topic_limit_reached` "A file can have at most 100 topics." / "En fil kan ha høyst 100 emner."; `topic_last_cannot_delete` "A file needs at least one topic." / "En fil må ha minst ett emne."; `topic_merge_cross_material` "Only topics from the same file can be merged." / "Bare emner fra samme fil kan slås sammen."; `invalid_name` on a Topic "Give the topic a name." / "Gi emnet et navn."; accessible names "Rename topic" / "Gi emnet nytt navn", "Delete topic {label}" / "Slett emnet {label}", "New topic" / "Nytt emne". "+ Add topic" and "Merge" come from EXPERIENCE.md L238, L144.

## Boundaries & Constraints

**Always:**
- Only `services/topics` writes `topics` and `topic_sections`.
- Every Section still has at least one Topic after any edit. Merge keeps all links on the surviving Topic, and delete never removes the last Topic.
- Labels are trimmed. Positions stay unique per Material.
- Copy comes from i18n in both languages; styles use tokens only.

**Never:**
- No reordering and no group editing.
- No undo.
- No re-detection.
- No `resolve_scope` (that is Epic 3).
- No Topic count from the client.
- No new migration unless the code shows it is needed.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Rename | `{label:"  Cell cycle "}` | `label="Cell cycle"`; nothing else changes | blank or over 100 → `422 invalid_name` |
| Delete | 3 Topics, delete 1 | 2 left; its Sections stay linked to another Topic | N/A |
| Delete last | 1 Topic | refused, nothing changes | `422 topic_last_cannot_delete` |
| Merge | Topics at positions 2 and 0 of one file | the one at position 0 survives with both Topics' Sections; the other is gone | fewer than 2 ids → `422 invalid_request` |
| Merge across files | Topics of 2 Materials | nothing changes | `422 topic_merge_cross_material` |
| Add | 3 Topics | 4th, `origin='student'`, no Sections, last | N/A |
| Add past 100 | 100 Topics | nothing changes | `422 topic_limit_reached` |
| Foreign or removed | another Account's Topic, or a removed Material's | nothing changes | `404 not_found` |
| Read-only | archived or deleted Project | nothing changes; the SPA shows no controls | `409 project_read_only` |
| SPA failure | an edit's request fails | Inline error; chips and count unchanged; "Try again" repeats the edit | rule refusals show no "Try again" |

</frozen-after-approval>

## Code Map

- `backend/app/services/topics.py`:
  - Add `rename`, `delete`, `merge`, and `add`. Each calls `projects.require_active`, then locks the Material with `db.materials.get_for_update`.
  - Each returns `list_for_materials(...)[material_id]`.
  - Domain errors subclass `AppError`; see `services/projects.py` L27-40, including `InvalidName`, which can be reused with Topic copy keyed in the SPA by context.
- `backend/app/db/topics.py`:
  - Add `get` (a join through `study_materials`, filtered by `account_id`, `project_id`, and `removed_at IS NULL`), `count`, `max_position`, `update_label`, `delete`, `relink`, and `insert_one`.
  - Merge: `INSERT … SELECT … ON CONFLICT DO NOTHING` into the survivor's links, then delete the others. Their links cascade.
- `backend/app/api/topics.py` (new), registered beside `api/materials.py`. `ActiveProject` and `Conn` come from `api/deps.py`. The `invalid_request` 422 for bad bodies already exists in `errors.py`.
- `backend/tests/test_routes_guard.py` -- new mutating routes must use the guard; add per-route guard tests like `test_remove_is_guarded`.
- `backend/tests/test_topics.py` -- helpers `upload_and_wait` and `topics_of` exist.
- `frontend/src/components/TopicList.jsx` -- consecutive group runs and the open-state Map (keep them). It gets `material` and `onChange(materialId, topics)`, or no handler when read-only.
- `frontend/src/components/FileRow.jsx`, `FilesPanel.jsx` -- pass the editing handler only when the Project is active, as `onRemove` already is.
- `frontend/src/pages/useProjectFiles.js` -- a `setTopics(materialId, topics)` updates `loaded`.
- `frontend/src/api/` -- the existing client, with `code` and `params` on errors.
- `frontend/src/components/InlineError.jsx` -- `onRetry` only for non-rule errors (the pattern in `RemoveFileDialog.jsx`).
- `frontend/src/test/fakeApi.js` -- handlers for the four routes, with the same rule errors.
- `frontend/src/i18n/en.json`, `nb.json` -- `files.topics.*` (Add topic, Merge, and the approved copy).

## Tasks & Acceptance

**Execution:**
- [x] `backend/app/db/topics.py`, `backend/app/services/topics.py`, `backend/app/api/topics.py`, router registration -- the four edits.
- [x] `backend/tests/test_topic_edits.py`, `backend/tests/test_routes_guard.py` -- every backend matrix row, plus coverage of every Section after delete and merge.
- [x] `frontend/src/components/TopicList.jsx` (+ css), `FileRow.jsx`, `FilesPanel.jsx`, `useProjectFiles.js`, i18n, `fakeApi.js` -- the chip interactions and the error handling.
- [x] `frontend/src/components/TopicEdit.test.jsx` -- rename (Enter, Esc, blank), delete (no × on the last chip), add, merge (Ctrl+click, Space, then rename opens), failure with and without "Try again", read-only shows no controls, Norwegian.

**Acceptance Criteria:**
- Given an edited Topic list, when the Project reopens, then the same Topics show in the same order.
- Given keyboard use only, when a student tabs to a chip, then Enter renames, Space selects, and the × and "+ Add topic" can be reached with Tab.

## Verification

**Commands:**
- `cd backend; uv run pytest` -- expected: all green with `LLM_MODE=mock`
- `cd frontend; npm test; npm run lint` -- expected: all green (from PowerShell)

## Implementation Notes

## Spec Change Log

### 2026-11-18 — merge mode follow-up (human renegotiation)
- Trigger: Cristoffer's browser check — in a long grouped list the Merge button sat at the bottom of the scroll area, looked faint, and Ctrl+click selection did not show the merge controls.
- Amended: frozen Approach gains the follow-up bullet; DESIGN.md Topic list and EXPERIENCE.md Merge updated as decided.
- KEEP: merge mode from the menu, the routes, and every existing test.

### 2026-11-18 — merge mode (human renegotiation)
- Trigger: Cristoffer's browser check — clicking a second chip opened rename, so Merge could not be reached without knowing Ctrl+click.
- Amended: frozen Approach gains the merge-mode bullet; EXPERIENCE.md Topic list, File row, and strings updated as decided by Cristoffer.
- Avoids: a Merge that exists but cannot be discovered.
- KEEP: the four routes, the service, the grouped-run rendering, Ctrl+click/Space shortcuts, and every existing test.


## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | VG, BH | editing a grouped file is never tested | medium | edit tests use ungrouped Topics; grouped tests pass no edit handler | patch — grouped edit tests |
| 2 | BH, EC | focus falls to `<body>` when the next chip is in a collapsed group | low | chip refs exist only for rendered chips | patch — fall back to "+ Add topic" |
| 3 | BH | the × is a 12px target | medium | `.remove` is `var(--space-3)` square, below 24×24 | patch — 24×24 hit area |
| 4 | BH | `not_found` leaves stale, failing chips | low | nothing refreshed the list after the refusal | patch — refetch on `not_found` |
| 5 | BH | merge answers 422 before 409 on a read-only Project | low | id check ran before `require_active` | patch — guard first; test added |
| 6 | BH, EC | API labels keep newlines and whitespace runs | low | `clean_label` only stripped the ends | patch — collapse whitespace; test added |
| 7 | BH | missing tests: 101-char add, student heir on delete | low | no such tests in `test_topic_edits.py` | patch — tests added |
| 8 | BH, EC | a list poll answered after an edit can show old Topics | low | polls run only while a file is Reading…; corrected by the next fetch | reject |
| 9 | BH, EC | a malformed 200 response empties the list | false | the route's response model always carries `topics` | reject |
| 10 | BH, EC | Enter during another edit is ignored without feedback | low | edits finish in well under a second; adds busy UI | reject |
| 11 | EC | merge selection or survivor inside a collapsed group | low | chips can only be selected while visible; the survivor is the first selected by position | reject |
| 12 | BH | a failure drops the typed label | low | blank closes without saving and `maxLength` stops long labels; "Try again" resends the label | reject |
| 13 | BH | leaving the field cancels, untested | low | Enter saves and Esc cancels per EXPERIENCE.md; leaving cancels like Esc | reject |
| 14 | BH | `aria-pressed` on a chip that renames on Enter | low | announces the Merge selection (EXPERIENCE.md L634) | reject |
| 15 | BH | rename, delete, and merge don't check Ready | false | only Ready files have Topics; the job saves Topics under the same Material lock | reject |
| 16 | BH | add on a non-Ready file answers 404 | false | the spec's choice (Approach, Add) | reject |
| 17 | BH | later references to deleted Topics | false | nothing references `topics.id` yet; Epic 3 freezes ids at request time (AD-7) | reject |
| 18 | BH | `topic_limit_reached` copy ignores `params.max` | low | the approved copy states 100 | reject |
| 19 | BH | edits not logged | low | no logging rule asks for it | reject |
| 20 | BH, VG | UTF-16 vs code-point length | low | differs only for emoji-heavy labels | reject |
| 21 | VG | unknown edit type throws without `code` | low | no caller can reach it | reject |
| 22 | BH | planning files missing from the review diff | false | excluded on purpose; the copy edit was approved by Cristoffer | reject |
| 23 | BH | rename checks the label before the Topic exists | low | only the error code differs for a bad label on a foreign id | reject |
