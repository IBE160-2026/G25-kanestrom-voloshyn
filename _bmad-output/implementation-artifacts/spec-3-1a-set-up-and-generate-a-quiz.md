---
title: 'Story 3.1a: Set up and generate a Quiz'
type: 'feature'
created: '2026-11-18'
status: 'in-review'
baseline_commit: 'b444b8c9c04f2a62c9e574ec9ce011e70d30df5a'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Students can't make a Quiz from their Topics (FR-10, FR-26). Epic 3 also needs the shared parts every later generator reuses: `topics.resolve_scope`, capacity, and the generation-job lifecycle. Cristoffer split Story 3.1 on 2026-11-18; the finish-while-away notice follows in 3.1b.

**Approach:**
- **Migration:** add `quizzes(id, account_id, project_id, job_id, generation_params jsonb, requested_count, created_at)` and `quiz_questions(id, quiz_id, position, question, options jsonb [4 × {id a–d, text}], correct_option_id, explanation, source_section_ids uuid[], material_ids uuid[])`. Both are insert-only, with RLS on and anon/authenticated revoked.
- **`topics.resolve_scope(conn, account_id, project_id, scope)`** is the only resolver (AD-7). It returns `{section_ids, topic_labels, material_ids, est_tokens}`. Shapes:
  - `{all_topics:true}`: every Section of every Ready, non-removed Material.
  - `{topic_ids:[…]}`: the Topics' Sections. A student-added Topic with no Sections resolves to its whole Material, and its label is passed as the focus.
  - Foreign ids give `404`; an empty result gives `422 insufficient_material`.
- **`GET /api/projects/{id}/capacity?scope=<json>`** returns `{max_questions}`. It is deterministic, with no AI call: `max(sections, words // CAPACITY_WORDS_PER_ITEM)`, capped at 20, with default `CAPACITY_WORDS_PER_ITEM=80`.
- **`POST /api/projects/{id}/quizzes {scope, count∈{5,10,20}}`** (ActiveProject):
  - Resolves the scope and refuses `est_tokens > LLM_CONTEXT_BUDGET_TOKENS` with `422 scope_too_large`.
  - Freezes `{count, section_ids, topic_labels}` into the `quiz` job's params and returns `202 {job_id}`.
- **The `quiz` job:**
  1. Reading: load the Sections.
  2. Writing: `llm.generate_quiz(sections, count, topic_labels)` with no transaction open.
  3. Checking: map `S1…Sn` back to Section ids, drop uncited items, keep at most `count`, shuffle the 4 options into `a`–`d`.
  4. Save in one transaction (AD-20). If the job was cancelled, the Project was deleted, or a cited Material was removed, nothing is saved. Archived Projects still save.

  `progress_step` follows reading → writing → checking. Zero items fails the job with `insufficient_material`.
- **Mock `generate_quiz`:** returns `min(count, capacity)` deterministic questions cycling over the Sections, each citing its Section. `LLM_MOCK_DELAY_MS` applies.
- **New job routes,** both allowlisted bookkeeping without the active-Project guard:
  - `POST /api/jobs/{id}/cancel` (AD-20).
  - `GET /api/projects/{id}/quizzes/{quiz_id}` returns `{id, requested_count, question_count}`. Questions are served from Story 3.2.
- **SPA:**
  - The tool buttons row gets "Quiz", disabled until a file is Ready and while read-only. It opens the Quiz setup: Activity header "← Back to chat", "Make a quiz", "Which topics?" with an "All topics" chip first, then Topic chips grouped like the Topic list, and "How many questions?" with 5/10/20 (default 10).
  - The primary button reads "Make {n} questions". When capacity is below the count, the Too-little-material note "There's only enough material for {n} questions." with "Make {n} instead" disables the button until the count fits.
  - After the request, Progress steps with Cancel follow the job's `progress_step`, polling every 2 s.
  - Cancel returns to setup with the choices kept and "Cancelled. Your choices are kept."
  - Failure shows the Inline error with "Try again", which starts a new job from the same choices.
  - `scope_too_large` shows "That's a lot of material. Pick fewer topics or one file."

## Boundaries & Constraints

**Always:**
- Generation calls `require_active` first; cancel doesn't.
- The scope is resolved once, in the request. The job uses only its frozen params.
- Only `services/jobs` writes `generation_jobs`.
- `progress_step` is set through `services/jobs`.
- Never more than 20 questions.
- Every saved question cites at least one Section of its scope.
- Copy comes from EXPERIENCE.md through i18n. Styles use tokens only.
- Mock mode needs no key.

**Never:**
- No answering, score, or Mistakes (Stories 3.2 and 3.3).
- No finish notice in the chat (3.1b).
- No History or "Do it again" (Epic 5).
- No new infrastructure.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Capacity | `photosynthesis-notes.md` Ready, all topics | `max_questions` = min(20, max(8, words//80)) | foreign Topic → 404 |
| Generate, mock | all topics, 10 | 202; steps reading → writing → checking; Quiz with 10 questions, options `a`–`d`, 1 correct, each citing a Section | N/A |
| Fewer possible | capacity 6, count 10 | the note offers 6; the server still saves only what's valid | N/A |
| Student Topic | an added Topic with no Sections | resolves to its whole Material plus focus label | N/A |
| Too large | `est_tokens` over budget | nothing queued | `422 scope_too_large` |
| No Ready file | Project with only Reading… files | button disabled; the API refuses | `422 insufficient_material` |
| Cancel | cancel while writing (mock delay) | job `cancelled`, nothing saved, setup kept | N/A |
| Failure | gateway raises `ProviderUnavailable` | job `failed` with `llm_unavailable`; Inline error; Try again starts a new job | N/A |
| Removed meanwhile | a cited file removed before the save | nothing saved, job `cancelled` | N/A |
| Read-only | archived Project | Quiz button disabled | `409 project_read_only` |

</frozen-after-approval>

## Open Questions

1. **What shows when the Quiz is done, before Story 3.2 builds answering?** Options:
   - (a) A small "Quiz ready" panel: "Your quiz is ready: {n} questions." / "Quizen din er klar: {n} spørsmål." When fewer than requested, it adds "Only {n} questions were possible from this material." / "Bare {n} spørsmål var mulig ut fra materialet." It also has "← Back to chat". Story 3.2 then replaces the panel with the first question.
   - (b) Go straight back to setup, with no panel.
2. **Copy for a failed generation** (EXPERIENCE.md has the reassurance and "Try again", but no message line). Proposed: "We couldn't make the quiz." / "Vi fikk ikke laget quizen." Approve, or change it?

## Code Map

- `backend/app/services/topics.py` -- add `resolve_scope`, built on `db/topics` plus the Sections. Words are counted with `extraction.text.count_words`, and tokens are estimated with `llm.gateway.estimate_tokens`.
- `backend/app/services/jobs.py` -- `JobKind`, `SavePlan`, `Runner`, `cancel_for_material`.
  - Add `set_progress(pool, job_id, step)` and `request_cancel(conn, account_id, job_id)`.
  - `progress_step` is set to `reading` at claim in `db/jobs.py` L44, then moved by the handler.
  - The save step already locks the job and checks `any_material_removed`. Extend it to check the plan's material ids and the Project's `deleted_at`.
- `backend/app/api/jobs.py` -- `GET` jobs and `POST …/seen` exist; add `POST /api/jobs/{id}/cancel`.
- `backend/app/llm/schemas.py`, `gateway.py`, `fixtures.py`, `prompts/generate_quiz.md`:
  - The schema is `QuizDraft{questions: [{question, options[4], correct_index 0–3, explanation, sections: [int]}], ≤ 20}`, using `label_sections`.
  - The prompt says to use only the supplied text, to answer in the material's language, and to focus on `topic_labels`.
- `backend/app/services/quiz.py` (new), `backend/app/db/quizzes.py` (new), `backend/app/api/quizzes.py` (new, registered in `main.py`), `backend/app/api/capacity.py` (or inside the quizzes router).
- `backend/app/config.py`, `.env.example` -- `capacity_words_per_item` (80).
- `backend/tests/test_routes_guard.py` -- the quiz POST is guarded, and cancel is allowlisted.
- `frontend/src/App.jsx` -- the router. Add the Quiz setup route under the Project, e.g. `/projects/:id/quiz`.
- `frontend/src/pages/ProjectHome.jsx` L214 -- the empty tool buttons row; add "Quiz" there.
- `frontend/src/components/TopicList.jsx` -- reuse its consecutive-run grouping for the read-only selectable picker. Extract a small shared helper; don't duplicate.
- `frontend/src/components/InlineError.jsx`, `frontend/src/api/client.js`, `frontend/src/test/fakeApi.js` -- add the new routes and a controllable job state.
- `frontend/src/i18n/*.json` -- the Quiz setup, Count picker, Too-little-material note, Progress steps, cancelled, `scope_too_large` (EXPERIENCE.md L121, L123, L127, L248, L252, L256, L257, L261, L286), plus the answers to the Open Questions.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/20261118160000_quizzes.sql` -- the tables.
- [x] `backend/app/services/topics.py`, capacity route -- `resolve_scope` and capacity.
- [x] `backend/app/llm/*`, `config.py`, `.env.example` -- `generate_quiz`, its mock, and the setting.
- [x] `backend/app/services/quiz.py`, `db/quizzes.py`, `api/quizzes.py`, `services/jobs.py`, `api/jobs.py`, `main.py` -- the request, the job, the save, cancel, and progress.
- [x] `backend/tests/test_quiz_generation.py`, `test_scope.py`, `test_routes_guard.py` -- every backend matrix row, with mock delay for progress and cancel.
- [x] `frontend` -- the Quiz button, setup page, picker, Count picker, note, Progress steps, cancel, failure, and the done state from Open Question 1.
- [x] `frontend/src/pages/QuizSetup.test.jsx` -- default 10, "Make {n} questions", the note and its button, progress labels, cancel keeps the choices, failure with Try again, the read-only button, and Norwegian.

**Acceptance Criteria:**
- Given mock mode with `LLM_MOCK_DELAY_MS=1500`, when a student makes a quiz, then all three progress steps are visible in turn before the done state.
- Given an archived Project with a running quiz job, when the job finishes, then the Quiz is saved.

## Verification

**Commands:**
- `npx supabase db reset` -- expected: migrations apply
- `cd backend; uv run pytest` -- expected: all green with `LLM_MODE=mock`
- `cd frontend; npm test; npm run lint` -- expected: all green (from PowerShell)

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | BH, EC | "Make 6 instead" asks for 10; the model may return 10 | medium | the API takes 5/10/20 and `check` capped at the request | patch — count frozen at min(request, capacity) |
| 2 | BH, EC | capacity failure leaves Make enabled; no reason when disabled | medium | `maxQuestions` null made `canMake` true; `insufficient_material` never shown | patch |
| 3 | BH, EC | Cancel shows "Cancelled" before the answer; a completed Quiz can be reported cancelled | medium | `cancel()` switched state at once and swallowed errors | patch |
| 4 | BH | leaving mid-generation loses the job; a duplicate can start | medium | the page never looked for an active quiz job on mount | patch |
| 5 | BH | every failed job offers Try again with the generic text | low | the poll ignored `error_code` | patch |
| 6 | BH | focus falls to `<body>` on screen changes | medium | only the failure path moved focus | patch |
| 7 | BH, EC | model called after a cited file was removed | low | `run` loaded blank text and still called the model | patch |
| 8 | BH, EC | duplicate options give two "correct" answers | medium | nothing required distinct options | patch |
| 9 | BH | student Topic labels in the system prompt | medium | `{focus}` placed labels in the system message | patch — moved to the user message, quoted |
| 10 | EC | Topic of a non-Ready file sends its label with no Sections | low | `resolve_scope` didn't check the Material's status | patch — 404 |
| 11 | BH | `QUIZ_MAX`, explanation check, `job_id` unique | low | small inconsistencies | patch |
| 12 | VG | missing-Project redirect untested | medium | no test opened an unknown Project | patch |
| 13 | VG, BH | shutdown vs student-cancel branch in the Runner untested | low | needs a runner-level drain test | defer |
| 14 | EC | server-side cancel (file removed) shows "Cancelled. Your choices are kept." | low | the choices are kept and nothing was saved | reject |
| 15 | EC | job missing from the list after being seen elsewhere reads as failure | low | marking seen arrives with 3.1b | reject |
| 16 | EC | a detected Topic emptied by edits widens to its whole file | false | edits never leave a Topic without its own Sections (2.6b keeps coverage) | reject |
| 17 | EC | `JobFailed` after a cancel request ends failed, not cancelled | low | a narrow window; the save step already checks cancel | reject |
