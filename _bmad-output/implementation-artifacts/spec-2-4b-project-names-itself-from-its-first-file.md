---
title: 'Story 2.4b: My Project names itself from its first file'
type: 'feature'
created: '2026-11-17'
status: 'done'
baseline_commit: '3db53bd81228921c91f42ab05188119a37d2a422'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every new Project stays "New project" until the student renames it; FR-4 says it should get a name from its first ready file (AD-14). Story 2.4a built the gateway and `name_project`; nothing calls it yet.

**Approach:**
- When a `material_processing` job saves a Material as `ready`, its after-commit step calls `projects.auto_name_if_unnamed`. It reads the Project; if `name_source` is already set it stops without calling the model. Otherwise it calls `llm.name_project` on that Material's Sections (in memory from the job) with no transaction open (AD-18), cleans the name with `clean_name`, and saves with `UPDATE … SET name, name_source='auto' WHERE id AND name_source IS NULL`.
- Any failure (gateway error, blank name, DB error) is logged by type only and leaves the name `NULL`; the file stays Ready, and the next ready file tries again.
- The SPA shows the name without a refresh. After it sees a file turn Ready while the Project has no name, Project home re-reads `GET /api/projects/{id}` every 2 s, for at most 30 s, until `name` is set. It then updates the Top bar title and the Sidebar through `upsertProject`.

## Boundaries & Constraints

**Always:**
- Only `projects.auto_name_if_unnamed` writes `name_source='auto'`. A student rename (`name_source='student'`) is never overwritten, even when it lands while the model is answering.
- Naming never changes the Material, the job outcome, or the response of any request.
- Tests run with `LLM_MODE=mock`.
- If the title is being edited when the name arrives, the open field keeps what the student typed.

**Never:**
- No migration and no new route.
- No naming from a rejected file and no renaming of a named Project.
- No new user-facing copy. The placeholder stays `projects.placeholder` until a name exists.
- No polling while nothing turned Ready in this view.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First file Ready | unnamed Project, `photosynthesis-notes.md` | `name="Photosynthesis: Study Notes"`, `name_source='auto'` | N/A |
| Already auto-named | named `auto`, a second file Ready | name unchanged, model not called | N/A |
| Renamed by student | `name_source='student'`, file Ready | name unchanged, model not called | N/A |
| Rename during naming | the student renames while the model answers | the student's name stays (`WHERE name_source IS NULL`) | N/A |
| Naming fails | gateway raises `ProviderUnavailable` / `LLMOutputError` | Material `ready`, job `completed`, name `NULL` | logged, no error to the user |
| Retry | the first file's naming failed, a second file Ready | the Project gets a name from the second file | N/A |
| Rejected file | the file is rejected | no naming attempt | N/A |
| SPA, name arrives | the file turns Ready, the next `GET` returns a name | the Top bar and the Sidebar show it, no reload | stops re-reading once named or after 30 s |

</frozen-after-approval>

## Code Map

- `backend/app/services/materials.py` `processing_kind` (L150-209). `save_ready` (L187) returns early when the Material is no longer `processing`, so it should record whether it saved (as `save_rejected` does). The ready `SavePlan` (L200) has no `after_commit` yet. The in-memory `extracted.sections` have `.text`, which fits the gateway's `SectionLike`.
- `backend/app/services/jobs.py` -- `SavePlan.after_commit` runs after the commit, outside a transaction. `_after` (L95-102) logs and swallows failures, but naming still catches its own errors.
- `backend/app/main.py` -- L115 builds `processing_kind(settings, storage)`. `app.state.llm` (L103) and `pool` exist there; pass the gateway and the pool in.
- `backend/app/services/projects.py` -- add `auto_name_if_unnamed`, reusing `clean_name` (L37-43).
- `backend/app/db/projects.py` -- add an `UPDATE` beside `set_student_name` (L51-64) with `WHERE name_source IS NULL`. The DB check requires `(name IS NULL) = (name_source IS NULL)`.
- `backend/tests/test_materials.py` -- helpers `upload_and_wait`, `wait_for` and `create_project`. Fixtures come from `test_auth.py`. A failing gateway can be monkeypatched on `app.state.llm` or `Gateway.name_project`.
- `frontend/src/pages/ProjectHome.jsx` -- fetches the Project once (L84-106) and calls `upsertProject`. `anyReady` is at L114. The re-read goes here, triggered by the ready count rising while `project.name` is null.
- `frontend/src/components/ProjectName.jsx` -- `value` state is initialised once from `project.name` (L22). The title shows `project.name` while not editing, so check that a new name renders and that an open field isn't reset.
- `frontend/src/test/fakeApi.js` (`finish()`, the `GET /api/projects/{id}` handler) -- extend the fake so a test can set the name the next `GET /api/projects/{id}` returns.

## Tasks & Acceptance

**Execution:**
- [x] `backend/app/db/projects.py`, `backend/app/services/projects.py` -- `set_auto_name` (conditional UPDATE) and `auto_name_if_unnamed(pool, llm, account_id, project_id, sections)`.
- [x] `backend/app/services/materials.py`, `backend/app/main.py` -- the ready plan's `after_commit` calls it, only when `save_ready` saved; wire in the gateway and the pool.
- [x] `backend/tests/test_auto_name.py` -- every backend matrix row, through a real upload and job where practical.
- [x] `frontend/src/pages/ProjectHome.jsx` (and `ProjectName.jsx` if needed) -- the bounded re-read, plus `upsertProject`.
- [x] `frontend/src/pages/ProjectHome.test.jsx` or a new `AutoName.test.jsx` -- the SPA row: the name appears in the title and the Sidebar; re-reading stops when named; no re-read without a Ready transition.

**Acceptance Criteria:**
- Given an unnamed Project with one ready file in mock mode, when the student opens it after a reload, then no re-reading starts. Naming only retries after the next ready file.
- Given a Project named by the student, when any number of files turn Ready, then `name_project` is never called.

## Verification

**Commands:**
- `cd backend; uv run pytest` -- expected: all green with `LLM_MODE=mock`
- `cd frontend; npm test; npm run lint` -- expected: all green

## Implementation Notes

- `projects.auto_name_if_unnamed` takes the pool (it is an after-commit step, outside any transaction): a short read, the model with no connection held, then `db.projects.set_auto_name` (`WHERE name_source IS NULL AND archived_at IS NULL AND deleted_at IS NULL`). It also skips archived or deleted Projects. Every exception is caught and logged by type only.
- `processing_kind(settings, storage, pool, llm)`: `save_ready` records whether it saved; the ready plan's `after_commit` names only then, from the in-memory `extracted.sections`.
- SPA: the ready-count baseline is taken from the first list of the Project, so opening a Project never re-reads. A rise while unnamed starts (or restarts) a 15-try, 2 s re-read of `GET /api/projects/{id}`; it stops on a name, on `not_found`/signed-out, on unmount, or when the shell's copy of the Project gets a name (e.g. a student rename).
- `ProjectName`: an untouched field compares against the name it opened with, so Enter on an empty field opened before the auto-name arrived closes without a PATCH instead of failing `invalid_name`.
- `jobs.Runner`: `_steps` now returns the after-commit step and `_run` awaits it after releasing the semaphore (same task, so `drain` still waits), so auto-naming's model call never holds one of the `JOBS_MAX_CONCURRENT` slots.
- `fakeApi`: `finish(state, id, changes, { projectName })` makes the next `GET /api/projects/{id}` return that auto-name; the GET now returns a copy.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | BH, EC | after-commit naming holds a job slot for the whole model call | medium | `Runner._run` awaited `_after` inside `async with self._semaphore`; 3 slots, up to 60 s each | patch — after-commit runs after the slot is released; test added |
| 2 | BH, EC | concurrent Ready files each call the model | low | True; the conditional UPDATE keeps one name. Preventing it needs a per-Project lock | reject |
| 3 | BH, EC | SPA gives up after 30 s while a live call may take 60 s | low | Only with a slow model; the name shows after a reload or the next file. 30 s is frozen intent | reject |
| 4 | BH, EC | each re-read sets `last_project_id`; a late GET after navigating away can mark the old Project | low | Same id while on the page; the late case needs a navigation inside a 2 s window | reject |
| 5 | VG, BH | archived/deleted skip untested | medium | No test set `archived_at` around naming | patch — two tests added |
| 6 | VG | restart of re-reading on a second Ready file untested | medium | Every SPA test used one file | patch — two-file test added |
| 7 | VG | rename stopping the re-read untested | low | No test counted reads after a rename | patch — test added |
| 8 | BH, EC | `openedWith` match skips a deliberate save of the old name | low | Opened "A", name became "B", typing "A" closed with no PATCH | patch — skip only when equal to the saved name or still empty; test added |
| 9 | BH | ready-count trigger can fire on a drop-then-rise | low | Removal arrives with 2.7; a later list showing more Ready rows is a Ready transition in view | reject |
| 10 | BH | sprint key vs spec name differ | false | `2-4-my-project-names-itself-from-its-first-file` is 2.4b's key by the split | reject |
| 11 | BH | `epic-2-context.md` not in the diff | false | Excluded on purpose: a regenerated planning cache, not code | reject |
| 12 | BH | acceptance criteria thin | low | Matrix carries those cases; the fix would edit this spec | reject |
| 13 | BH | `saved` list flag fragile | false | `apply` runs once per job (the Runner never retries a save); same pattern as `save_rejected` | reject |
| 14 | BH | restart between commit and naming leaves the name NULL | low | AD-14 accepts it: retried after the next ready file | reject |
| 15 | EC | shutdown cancel during the model call drops naming | low | Only at shutdown; retried after the next ready file | reject |
