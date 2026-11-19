---
title: 'Story 3.2: Take the Quiz with immediate, sourced feedback'
type: 'feature'
created: '2026-11-18'
status: 'done'
baseline_commit: '5153eaa0279a264354bb38d847c4786c36231dc0'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 3.1a makes and saves a Quiz but only shows "Quiz ready". The student can't answer the questions or see feedback and a score (FR-11, AD-9).

**Approach:**
- **Migration:** add `quiz_answers(id, quiz_question_id unique, account_id, submitted_option_id a–d, is_correct, created_at)`. It is insert-only, with RLS on and anon/authenticated revoked.
- **`GET /api/projects/{id}/quizzes/{quiz_id}`** grows to `{id, requested_count, question_count, questions:[{id, position, question, options:[{id,text}], answer|null}]}`.
  - An unanswered question never carries `correct_option_id`, `explanation`, or sources.
  - An answered one carries `answer: {submitted_option_id, is_correct, correct_option_id, explanation, sources:[{label}]}`.
- **`POST /api/projects/{id}/quizzes/{quiz_id}/questions/{question_id}/answer {option_id}`** (ActiveProject, one transaction):
  - It scores `option_id == correct_option_id` with no AI call, inserts the answer, and returns the answered shape above.
  - If an answer already exists, it returns the stored result unchanged, even when the new `option_id` differs.
  - Bad ids give `404`; an option outside `a`–`d` gives `422 invalid_request`.
- **Source labels:**
  - Each label is `"{file_name} · {section label}"` (for example "lecture.pdf · Page 4"), joined from `source_section_ids`.
  - Labels are de-duplicated and kept in order.
  - A removed file keeps its name and label.
- **Quiz page** `/projects/:id/quizzes/:quizId`:
  - **Navigation:**
    - When 3.1a's job completes, the setup page navigates here instead of showing the "Quiz ready" panel.
    - The Activity header has "← Back to chat".
    - When fewer questions than requested, the 3.1a note "Only {n} questions were possible from this material." shows above the first question.
  - **One question at a time:**
    - Each question has a progress bar and 4 Answer options.
    - Keys 1–4 or a click answer it, desktop key hints are shown, and keys are disabled in inputs.
    - The Feedback panel appears right after the answer is saved, in a polite live region:
      - Correct: "Correct".
      - Wrong: "Not quite" + "It stays in your review." in the mistake colour, never red.
      - Both: the explanation and its Source labels.
    - The options then read "Your answer" (in `--color-mistake` when wrong) and "Correct answer" (in `--color-correct`); the others dim.
    - There is no auto-advance: "Next question" (→), or "See results" on the last question.
  - **Opening a Quiz part-way:** it starts at the first unanswered question, or at the Score summary when all are answered.
  - **Score summary:**
    - "{correct} of {total} correct".
    - Each missed question with both answers.
    - "Missed questions stay in your review."
    - "← Back to chat" (primary) and "New quiz" (opens Quiz setup).
  - **A failed answer save** shows the Inline error with "Try again", and the question stays unanswered.
  - **A read-only Project** shows the Quiz with options disabled.

## Boundaries & Constraints

**Always:**
- Scoring happens only in the backend.
- Answers are idempotent, one per question.
- Answering calls `require_active` first.
- Every query is scoped by `account_id`, and the question must belong to the Quiz in the URL, which must belong to the Project.
- Copy comes from EXPERIENCE.md (L91, L106, L125–126, L253–255, L261, L307, L372–374) through i18n; styles use tokens only.

**Never:**
- No Mistakes and no indicator (Story 3.3).
- No History or resume list (Epic 5).
- No AI calls.
- No retakes: one attempt per Quiz.
- No finish notice (3.1b).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open fresh Quiz | 10 unanswered | no `correct_option_id`/`explanation`/sources in any question | N/A |
| Right answer | option = correct | `is_correct=true`; "Correct" + explanation + "file · Page n" | N/A |
| Wrong answer | option ≠ correct | `is_correct=false`; "Not quite" + "It stays in your review."; Your/Correct answer marked | N/A |
| Double submit | same question twice, any option | second returns the first stored result; one row | N/A |
| Foreign ids | another Account's Quiz or question, or a question from another Quiz | nothing saved | `404 not_found` |
| Bad option | `"e"` | nothing saved | `422 invalid_request` |
| Read-only | archived Project | the Quiz is readable | answer → `409 project_read_only` |
| Removed file | a cited file removed after generation | Quiz still answerable; label keeps the file name | N/A |
| Last question | answered, "See results" | "{c} of {t} correct"; missed listed with both answers | N/A |
| Reopen part-way | 4 of 10 answered | opens at question 5 | N/A |
| Save fails | POST rejects (network) | Inline error + Try again; question unanswered | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/` -- new `…_quiz_answers.sql`, in the style of `20261118160000_quizzes.sql`.
- `backend/app/services/quiz.py` -- `get` (L98) is extended. Add `answer(conn, account_id, project_id, quiz_id, question_id, option_id)`, which calls `projects.require_active` first.
- `backend/app/db/quizzes.py` -- `get` (L85). Add `questions_for`, `answers_for`, `insert_answer` (`ON CONFLICT (quiz_question_id) DO NOTHING`, then read back), and `source_labels(section_ids)` (sections joined with `study_materials.file_name`).
- `backend/app/api/quizzes.py` -- `get_quiz` (L108) gets the new response model; add the answer route. `backend/tests/test_routes_guard.py`: the answer route is guarded.
- `frontend/src/pages/QuizSetup.jsx` -- the completion handler (the "Quiz ready" panel around L27, L33) navigates to the Quiz page; keep the cancel and failure paths.
- `frontend/src/pages/QuizPage.jsx` (new) and its CSS module; `frontend/src/routes.jsx` (L29) gets the route.
- `frontend/src/components/InlineError.jsx`, `frontend/src/api/client.js`, `frontend/src/test/fakeApi.js` -- the quiz GET and answer routes, with stored answers.
- `frontend/src/styles/tokens.css` -- `--color-mistake` and `--color-correct` (check the names).
- `frontend/src/i18n/*.json` -- the quiz strings above.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/20261118180000_quiz_answers.sql` -- the table.
- [x] `backend/app/db/quizzes.py`, `services/quiz.py`, `api/quizzes.py` -- the hidden-answer payload, the answer route, scoring, idempotency, and source labels.
- [x] `backend/tests/test_quiz_answers.py`, `test_routes_guard.py` -- every backend matrix row.
- [x] `frontend/src/pages/QuizPage.jsx` (+ css), `routes.jsx`, `QuizSetup.jsx`, i18n, `fakeApi.js` -- the page, feedback, keys, summary, and navigation.
- [x] `frontend/src/pages/QuizPage.test.jsx` -- right and wrong feedback, keys 1–4 and →, no auto-advance, "See results" and the summary, reopening part-way, save failure with Try again, read-only, Norwegian.

**Acceptance Criteria:**
- Given a Quiz just generated in mock mode, when its job completes, then the student lands on question 1 without reloading.
- Given keyboard only, when a student answers with 2 and presses →, then the next question shows and focus is on its first option.

## Verification

**Commands:**
- `npx supabase db reset` -- expected: migrations apply
- `cd backend; uv run pytest` -- expected: all green with `LLM_MODE=mock`
- `cd frontend; npm test; npm run lint` -- expected: all green (from PowerShell)

## Implementation Notes

- The answer request body is a Pydantic `Literal["a","b","c","d"]`, so a bad option is refused as `422 invalid_request` by the validation handler before the guard; the service checks it again after `require_active`.
- `GET …/quizzes/{id}` keeps `question_count` and adds `questions`; the 3.1a generation test now checks the subset.
- Quiz setup navigates with `replace: true` once the job completes, so browser Back from the Quiz returns to the chat, not to a finished setup. The "Quiz ready" panel and its `quiz.ready_*` strings are removed.
- Strings beyond the cited EXPERIENCE.md lines: the progress line reuses the "{n} of {total}" pattern (EXPERIENCE.md L259), and the key-hint words "answer" / "next" come from DESIGN.md › Feedback panel ("1–4 answer", "→ next"); their NB forms ("svar", "neste") are not in the signed-off list.
- The missed-question rows label both answers with "Your answer" / "Correct answer" (L253) instead of the mock's "You said" / "Answer".

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | EC | read-only Quiz stuck on the first unanswered question | medium | options disabled and Next needed an answer | patch |
| 2 | EC, BH | `409 project_read_only` on save offers a Try again that can't work | medium | every save error showed Try again | patch |
| 3 | BH | failed load has no Try again | low | `InlineError` without `onRetry` | patch |
| 4 | BH | "1–4 answer" hint shows only after answering | low | the hint sat inside `{answer && …}` | patch |
| 5 | BH | keys 1–4 swallowed when ignored | low | `preventDefault` before the guard | patch |
| 6 | BH | progress bar shows position, not progress; announced twice | low | fill used `index + 1` | patch |
| 7 | EC, BH | a Quiz with zero questions opens on "0 of 0 correct" | low | `startAt([])` returned the summary | patch |
| 8 | VG, BH | service option check unreachable | low | the request model's `Literal` rejects first | patch — removed |
| 9 | BH | `questions_for` and `source_labels` not scoped by account | medium | AD-2 requires `account_id` on every repository function | patch |
| 10 | BH | no index on `quiz_answers.account_id` | low | cascade from profiles scans the table | patch |
| 11 | VG, BH | GET explanation and sources untested; deleted-Project GET untested | medium | only the POST asserted them | patch |
| 12 | BH | review copy ships before Mistakes exist; no backfill | low | Story 3.3 records Mistakes; no real users yet | reject |
| 13 | BH | parallel submit and `extra="forbid"` untested | low | the unique constraint and Pydantic own them | reject |
| 14 | BH | no-model test covers four named methods | low | answering imports no gateway | reject |
| 15 | EC | setup can stay on progress if the poll stops while marking seen | low | only on unmount, when the page is gone | reject |
| 16 | EC | same file name and label from two files collapse | false | the labels read the same to the student | reject |
| 17 | BH | `staysInReview` Norwegian "Den" vs neuter "Det" | maybe-false | matches EXPERIENCE.md L107; a fix edits the final doc | defer to Cristoffer |
| 18 | BH | planning files missing from the review diff | false | excluded on purpose | reject |
| 19 | VG | frontend deleted read-only untested | low | same flag as archived, which is tested | reject |
