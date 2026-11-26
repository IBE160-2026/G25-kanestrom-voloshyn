---
title: 'Story 5.2: Resume an unfinished quiz and run things again'
type: 'feature'
created: '2026-11-26'
status: 'done'
route: 'dispatch'
baseline_commit: '028ced778032a7c48d2b67aff2eeb976806b7737'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A student can reopen a finished Quiz or Flashcard set, but can't practise it again with the same setup. Nothing tells them when the file it came from has been removed (FR-25). An Unfinished Quiz already shows its status in History (Story 5.1) and resumes at its first unanswered question (Story 3.2); this story keeps that working.

**Approach:** Add "Do it again" to the Quiz Score summary and the Flashcard end screen. It is backed by `POST …/quizzes/{id}/again` and `POST …/flashcard-sets/{id}/again`. Each queues a normal job from the artifact's stored `generation_params`, unchanged. The SPA then opens the matching setup page, which already resumes a running job's progress and moves on to the new result. GET returns `source_removed`, so the button can be disabled with the note "The file this came from was removed."

## Boundaries & Constraints

**Always:**
- **The again routes:** they take `ActiveProject`, so `require_active` runs first (AD-22) and a read-only Project returns `409 project_read_only`. A foreign or missing artifact returns `404 not_found`.
- **Frozen params (AD-7):** the job's params are exactly the artifact's `generation_params`: `count`, `section_ids` and `topic_labels`. They are never resolved again, so the same per-generation limits apply. The job kind is the same (`quiz` or `flashcards`), so the existing runner, progress, cancel, failure and finish notice apply. The route returns `202 {job_id}` and starts the job after the commit, like `create_quiz`. The original artifact is never changed.
- **Removed source:** if any Material behind the frozen `section_ids` is removed (or gone), the route returns `409 material_removed` and nothing is queued. `GET` of a Quiz or set adds `source_removed: bool`, computed the same way. A Material removed after the job starts ends it `cancelled`, as today.
- **UI:**
  - **Quiz:** "Do it again" / "Gjør det igjen" is a ghost button on the Score summary, next to "New quiz".
  - **Flashcards:** it is a ghost button on the end screen, next to "Make more cards".
  - **Removed source:** with `source_removed`, the button is disabled and the muted caption "The file this came from was removed." sits beside it.
  - **Read-only Project:** the button is disabled, and the page's existing read-only notice explains why.
  - **On success:** the page navigates, replacing itself in the history, to `/projects/:p/quiz` or `/projects/:p/flashcards`, where the running job's progress shows.
  - **On failure:** the Inline error. A rule code (`material_removed`, `project_read_only`, `not_found`) shows its message only; anything else adds "Try again".
- Existing catalogue strings are reused (`errors.material_removed`; add `history.again` with the signed-off copy). No other new copy.

**Never:**
- No migration.
- No change to one attempt per Quiz: there is no retake of the same Quiz, and an Unfinished Quiz is not offered "Do it again".
- No "Do it again" for Summaries or chats, and none in the History rows themselves.
- No new daily limit.
- No change to how a Flashcard set ends (AD-27 rules stay as Story 4.2 built them).

**Decisions (Ihor, 2026-11-26):**
- **Part-way Flashcard sets follow AD-27 as built.** A set left more than 30 minutes ago, or replaced by another set, opens on the end screen with "Do it again". One reopened sooner continues where it was. How a set ends doesn't change.
- **"Do it again" always shows** on the Score summary and the end screen, including right after finishing.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Quiz again | Completed Quiz, active Project | `202 {job_id}`; the job params equal the Quiz's `generation_params`; a new Quiz arrives; the old one is unchanged | N/A |
| Set again | Ended set, active Project | `202`; a new set from the same params; the old set and its marks are unchanged | N/A |
| Source removed | A Material behind the `section_ids` is removed | `GET` → `source_removed: true`; the button is disabled with the note | `POST` → `409 material_removed`, no job |
| Read-only | Archived or deleted Project | The results open; the button is disabled | `POST` → `409 project_read_only` |
| Foreign or missing | Another Account's id | — | `404 not_found` |
| Unfinished Quiz | 3 of 10 answered | History row "Unfinished · 3 of 10"; opening resumes at question 4; no "Do it again" | N/A |
| Part-way set | Marks exist, idle over 30 min | Opens on the end screen with "Do it again" | N/A |
| Removed mid-run | Material removed while the again job runs | The job ends `cancelled`, as today | The setup page shows the cancel as today |

</frozen-after-approval>

## Code Map

- `backend/app/api/quizzes.py:127` `create_quiz` -- the pattern to copy: `ActiveProject`, `after_commit(runner.submit)`, `JobAccepted`. Add `POST /quizzes/{quiz_id}/again`, and `source_removed` on the `Quiz` model.
- `backend/app/api/flashcards.py:74` -- the same for `POST /flashcard-sets/{set_id}/again`, plus `source_removed` on `FlashcardSet`.
- `backend/app/services/quiz.py` `request` / `get`, and `services/flashcards.py` `request` / `get` -- add `again(conn, account_id, project_id, id)`: `require_active`, load the artifact (404), check removal, then `jobs.enqueue(..., KIND, params=<generation_params>)`. Add `source_removed` in `get`.
- `backend/app/db/jobs.py:267` `any_material_removed(material_ids)` -- the removal test to reuse. The Material ids come from `sections.material_id` for the frozen `section_ids`. Add a small read in `db/sections.py` or reuse an existing one; don't take `FOR UPDATE` locks for the GET.
- `frontend/src/pages/QuizPage.jsx` (Score summary `foot`, about line 216; `readOnly` at line 88) and `FlashcardSession.jsx` (`renderEnd`, about line 280; `readOnly` at line 81) -- add the button, the note and the error.
- `frontend/src/pages/GenerationSetup.jsx` + `useGenerationJob.js` -- already resume an active job (`findActive` → `resume`) and go on to the result; nothing to change there. Known gap (deferred-work): after a cancel, the setup shows default choices, not the frozen ones.
- `frontend/src/i18n/en.json` / `nb.json` -- add `history.again` ("Do it again" / "Gjør det igjen"). `review.fileRemoved` / `errors.material_removed` already hold the note copy.
- `frontend/src/test/fakeApi.js` -- add the two again routes, plus `source_removed` on the fixtures.

## Tasks & Acceptance

**Execution:**
- [x] `backend/app/services/quiz.py`, `services/flashcards.py`, `api/quizzes.py`, `api/flashcards.py` (+ the db read) -- add the again routes and `source_removed`.
- [x] `backend/tests/test_do_it_again.py` -- cover every backend row of the matrix for both kinds: the params equal the frozen ones, the original is unchanged, 409 for a removed source, 409 for read-only, 404, and `source_removed` on GET. The route guard test must pass with the new routes guarded.
- [x] `frontend/src/pages/QuizPage.jsx`, `FlashcardSession.jsx`, `i18n/*.json`, `test/fakeApi.js` -- add the button, the note, read-only, the error and the navigation.
- [x] `frontend/src/pages/DoItAgain.test.jsx` -- cover both pages: navigation to setup with the progress shown, disabled with the note when the source is removed, disabled when read-only, a rule error with no "Try again", another error with "Try again", and NB.

**Acceptance Criteria:**
- Given a completed Quiz in an active Project, when I select "Do it again", then the Quiz setup page shows the progress steps and then opens a new Quiz with the same count and topics, and the old Quiz still shows its own results in History.
- Given an Unfinished Quiz in History, when I open it, then it resumes at its first unanswered question.

## Verification

**Commands:**
- `cd backend && LLM_MODE=mock uv run pytest -q` -- expected: all pass
- `cd frontend && npx vitest run --maxWorkers=4 && npm run lint` -- expected: all pass, lint clean

## Implementation Notes

- Removal test: `db/sections.any_section_removed(section_ids)` (plain read, no lock): a missing Section, or a removed or missing Material behind one, counts as removed. `services/quiz.again_params` / `source_removed` are shared by both kinds.
- UI: one `pages/DoItAgain.jsx` (button, caption, Inline error, navigate with `replace`) used by both pages. The Quiz Score summary now also shows the existing read-only notice above the score (it had none), and the Flashcard end screen shows it under the headline. The button is hidden while any question is unanswered (an Unfinished Quiz reached in a read-only Project).

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | Edge, Blind | The setup page discards the returned `job_id`: a job that ends before `findActive` reads `/jobs` leaves a blank setup, and another active job of that kind is resumed in its place | high | `findActive` keeps only queued and running jobs (useGenerationJob.js:55-60), and `LLM_MOCK_DELAY_MS` defaults to 0 (config.py:45), so in mock mode (the grader's path) the again job usually ends before the setup reads `/jobs`. The list also holds finished jobs not yet seen, so passing the id lets the setup settle it | patch |
| 2 | Blind | `any_section_removed` reads `sections` without an account filter | low | True; the ids come from the artifact's own params, so nothing leaks, but it is the only unscoped new read, and adding the account is a direct correction | patch |
| 3 | Blind | The disabled button gives assistive tech no reason | low | The caption isn't linked to the button. `aria-describedby` on the button is a direct one-attribute fix | patch |
| 4 | Edge, Blind | A direct POST runs an Unfinished Quiz again | low | True, but the spec's rule is about what is *offered* (the UI hides it), and a new Quiz isn't a retake of the old one (one attempt per Quiz still holds). A guard would add a new error code | reject |
| 5 | Blind, Edge | A 409 from the POST doesn't disable the button or show the caption | low | The Inline error explains it; the page reloads correctly on the next open. Lifting it into page state adds branches for a rare race | reject |
| 6 | Blind | A fast double-click queues two jobs | false | The click is a discrete event: React 18 flushes `setBusy(true)` synchronously, so the button is disabled before a second click is handled | reject |
| 7 | Blind | The docstring says the original set never changes, but opening the new set ends it | false | "Do it again" is offered only on the end screen, so the original is already ended; `end_others` touches only open sets (AD-27) | reject |
| 8 | Blind | The button is enabled before the Project loads | false | QuizPage and FlashcardSession load the Project and the artifact with `Promise.allSettled`, and the summary or end screen renders only after both | reject |
| 9 | Blind | The shared helpers live in `services/quiz.py`; `frozen_section_ids` is in `db/` | low | Flashcards already imports its shared constants and `_Section` from quiz; no caller diverges | reject |
| 10 | Blind | The spec and sprint status disagree | false | By design: step 05 sets the sprint to `review` | reject |
| 11 | Blind | No test for both Quizzes in History; the no-Ready-file gap isn't logged | low | History lists every Quiz row (tested in 5.1); the gap is already in deferred-work.md | reject |
| 12 | Blind | Redundant guard test, the `failure.path` check, duplicated `.caption` CSS, fixture comments, the `or {}` fallback | low | Cosmetic; nothing breaks | reject |
| 13 | Edge | Empty `section_ids` or a non-UUID entry | false | Unreachable: `request` freezes the resolved Section ids, and a scope with none is refused before queuing | reject |
| 14 | VG | No verification gaps | — | Pre-verified by the layer | — |
