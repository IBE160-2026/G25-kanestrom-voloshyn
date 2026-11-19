---
title: 'Stories 3.4 + 3.5: Start a Mistake Review round and clear Mistakes in review'
type: 'feature'
created: '2026-11-19'
status: 'done'
baseline_commit: '508ce037e2554dd43e0b7bc057c57feeb9e97102'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Mistakes card shows a count, but there is no way to practise (FR-17, FR-18, AD-10, AD-11). Cristoffer decided on 2026-11-19 to build Stories 3.4 and 3.5 together, so no temporary screen is needed.

**Approach:**

**Data (one migration).** All tables have RLS on with anon and authenticated revoked, and are insert-only unless noted.
- `review_rounds(id, account_id, project_id, job_id unique, created_at)`.
- `practice_questions(id, account_id, mistake_id, question, options jsonb[4 a–d], correct_option_id, explanation, source_section_ids, material_ids, from_original bool, created_at)`.
- `round_items(round_id, practice_question_id, position)`: lets an unanswered Practice Question move into a later round without rewriting it.
- `practice_answers(id, practice_question_id unique, account_id, submitted_option_id, is_correct, created_at)`.
- `mistakes.cleared_by_answer_id` (nullable).
- A partial unique index on `generation_jobs(project_id) WHERE kind='review_round' AND status IN ('queued','running')`.

**Starting (3.4).** `POST /api/projects/{id}/review-rounds` (ActiveProject):
- With no outstanding Mistakes, it refuses with `422 insufficient_material`.
- Otherwise it inserts the round and a `review_round` job and returns `202 {job_id, round_id}`.
- A second request while one is queued or running gets `409 review_in_progress`, through the index.

**The `review_round` job** (AD-11, AD-20, steps "Looking at your mistakes → Writing practice questions"):
1. **Reading.** Take the oldest outstanding Mistakes, up to 20. Each Mistake gets one of:
   - **An existing question:** if it has an unanswered Practice Question from an earlier round, reuse it.
   - **The original:** if any cited Material is removed, use the saved original question from its snapshot, re-shuffled, with `from_original=true` and no AI call.
   - **New generation:** otherwise it becomes a target `{mistake_id, question_text, correct_text, source_section_ids}` with its Sections' text.
2. **Writing.** One batched `llm.generate_practice(targets)` (new typed task with schema, prompt and mock). It runs only when there are targets, with no transaction open.
3. **Save.**
   - New items are checked and shuffled to `a`–`d`.
   - Then, in one transaction, the Practice Questions and `round_items` are inserted in Mistake age order.
   - If the job was cancelled or the Project deleted, nothing is saved. A Mistake cleared or withdrawn meanwhile is skipped.
   - An AI item with no valid citation falls back to the original question.

**Session API (3.5).**
- `GET /api/projects/{id}/review-rounds/{round_id}` returns:
  - `{items: [{id, position, question, options, context: {question, earlier_answer_text, correct_text?}, file_removed, answer|null}], cleared_count, total, remaining_outstanding}`.
  - Answer keys stay hidden until answered, as for the Quiz.
- `POST …/review-rounds/{round_id}/items/{pq_id}/answer {option_id}` (ActiveProject, one transaction):
  - It scores the answer in the backend and is idempotent.
  - A correct answer calls the new `mistakes.clear(conn, mistake_id, practice_answer_id)`. It is idempotent and only `services/mistakes` writes it.
  - It returns the answered shape plus `cleared`, `cleared_count` and `remaining_outstanding`.
  - A wrong answer never creates a Mistake.

**SPA.**
- **Mistakes card:** gains "Start" (EXPERIENCE.md L252), active Projects only. It opens `/projects/:id/review`, which posts the round and shows the shared `GenerationProgress` with the two Mistake Review steps (L130).
  - Cancel returns to the chat.
  - Failure shows the Inline error with the generic error text and "Try again". The count is unchanged.
- **Leaving while it generates:** the chat notice "Your practice questions are ready · Open" (L161) appears. It extends 3.1b's notices to `review_round` jobs, with the same seen rules.
- **Session** `/projects/:id/review/:roundId`:
  - A context card shows the original question and "Your earlier answer" (L266) with that answer's text, plus "The file this came from was removed." when it applies.
  - The practice question works like a Quiz question: keys 1–4, the Feedback panel, sources, no auto-advance, "Next mistake" (L125).
  - The progress reads "{n} of {m} cleared" (L265). The card's count drops only after a clear is saved.
  - A failed save shows the Inline error, and the Mistake stays counted.
  - "Stop for now" and "← Back to chat" return to the chat with "Your progress is saved." (L192).
- **End of a round:**
  - The **Round done panel** shows when every item is answered and Mistakes remain: "Round done. {n} mistakes still to review." · "Review mistakes" (a new round) · "← Back to chat" (L191).
  - The **All cleared panel** shows only when the last outstanding Mistake was cleared and saved: "All cleared! Nice work." · "Make a new quiz" · "← Back to chat" (L112, L190). The card is then gone, with no animation.
- **Reopening a round part-way** starts at the first unanswered item.

## Boundaries & Constraints

**Always:**
- Review starts only on a student's request.
- Only `services/mistakes` writes `mistakes`.
- Only `services/jobs` writes `generation_jobs`.
- Practice answers never create Mistakes.
- Never more than 20 items per round.
- Cleared and withdrawn Mistakes, and every practice attempt, are kept.
- Copy comes only from existing EXPERIENCE.md strings, through i18n. Styles use tokens only.
- Mock mode needs no key, and `generate_practice`'s mock is deterministic.

**Never:**
- No new user-facing copy beyond the cited lines and the existing generic error.
- No automatic review, no spaced repetition, no stored counter.
- No History (Epic 5).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Start | 3 outstanding | 202; round of 3 items after the steps | N/A |
| Double start | a round is queued or running | one round | second → `409 review_in_progress` |
| Over 20 | 25 outstanding | the 20 oldest; 5 remain for later | N/A |
| Reuse | Mistake with an unanswered item from an earlier round | the same Practice Question in the new round; no new generation for it | N/A |
| File removed | cited Material removed | original question re-shuffled, `from_original`, no AI call; "The file this came from was removed." | N/A |
| None outstanding | 0 | nothing queued | `422 insufficient_material` |
| Correct | right option | Mistake `cleared_at` set and linked; "1 of 3 cleared"; count drops after the save | save fails → Inline error, still counted |
| Wrong | wrong option | Mistake stays; no new Mistake | N/A |
| Resubmit | same item twice | stored result; one clear | N/A |
| Round done | all answered, 2 still outstanding | "Round done. 2 mistakes still to review." | N/A |
| All cleared | last outstanding cleared and saved | "All cleared! Nice work."; card gone | N/A |
| Stop | "Stop for now" part-way | chat with "Your progress is saved."; no panel | N/A |
| Cancel / failure | during generation | cancel → chat; failure → Inline error + Try again; count unchanged | N/A |
| Away | left while generating | "Your practice questions are ready · Open" in the chat | N/A |
| Read-only | archived Project | no Start; answer → `409 project_read_only` | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/` -- new `20261119140000_mistake_review.sql`, in the style of `20261119120000_mistakes.sql` and `20261118180000_quiz_answers.sql`.
- `backend/app/services/mistakes.py`, `db/mistakes.py` -- add `clear`, `oldest_outstanding(conn, account_id, project_id, limit)`, and a snapshot read.
- `backend/app/services/review.py` (new), `db/review.py` (new), `api/review.py` (new, registered in `main.py`) -- in the style of `services/quiz.py` and `api/quizzes.py`.
  - Reuse quiz's `check`, the shuffle and `source_labels`. Extract them to a shared helper, not a copy.
  - `jobs.set_progress`, `request_cancel`, `should_stop`, `JobFailed` exist from 3.1a. Register the `review_round` kind in `main.py` beside `quiz_kind`.
- `backend/app/llm/schemas.py`, `gateway.py`, `fixtures.py`, `prompts/generate_practice.md` -- `PracticeDraft{items: [{mistake_id, question, options[4], correct_index, explanation, sections:[int]}]}`. The mock writes one item per target from its question text.
- `backend/tests/test_routes_guard.py` -- start and answer are guarded; GET is a read.
- `frontend/src/components/MistakesCard.jsx` -- add "Start". `frontend/src/components/GenerationProgress.jsx` -- reuse it.
- `frontend/src/pages/QuizPage.jsx` -- the question, Feedback panel and keys. Extract the shared question view into a component rather than copying it.
- `frontend/src/pages/useQuizNotices.js`, `components/ReadyNotice.jsx` -- extend to `review_round`.
- `frontend/src/pages/ReviewStart.jsx`, `ReviewSession.jsx` (new); `routes.jsx`.
- `frontend/src/pages/useMistakes.js` -- refresh after clears and on return.
- `frontend/src/test/fakeApi.js` -- rounds, items, answers and clears.
- `frontend/src/i18n/*.json` -- the cited strings.

## Tasks & Acceptance

**Execution:**
- [x] Migration -- the tables, the column and the index.
- [x] Backend -- `mistakes.clear` and the reads, `generate_practice` with its mock, `services/review` with the job, the routes, and registration.
- [x] `backend/tests/test_review.py`, `test_routes_guard.py` -- every backend matrix row, with the mock delay for progress and cancel.
- [x] Frontend -- Start, the start page with progress, the session, the panels, notices for review, and the shared question view.
- [x] `frontend/src/pages/ReviewSession.test.jsx` (+ `ReviewStart.test.jsx`) -- the SPA rows above, including keyboard use and Norwegian.

**Acceptance Criteria:**
- Given 2 mistakes in mock mode, when the student starts a round and answers both correctly, then "All cleared! Nice work." shows and the chat has no Mistakes card.
- Given one correct and one wrong answer, when the round ends, then "Round done. 1 mistake still to review." shows, and "Review mistakes" starts a new round for that Mistake with a newly generated Practice Question (the old one was answered, so it is not reused).

## Verification

**Commands:**
- `npx supabase db reset` -- expected: migrations apply
- `cd backend; uv run pytest` -- expected: all green with `LLM_MODE=mock`
- `cd frontend; npm test; npm run lint` -- expected: all green (from PowerShell)

## Implementation Notes

- Shared helpers, not copies: `services/questions.py` (option check, shuffle, the answered-question shape) and `db/sections.py` (`load_sections`, `removed_materials`, `source_labels`) now serve both `services/quiz` and `services/review`; `components/QuestionView.jsx` is the question view both `QuizPage` and `ReviewSession` render.
- The job never aborts a whole round for a removed file: the plan carries no `material_ids`; an AI item whose file is removed before the save falls back to the original instead. A save with nothing left (every picked Mistake cleared or withdrawn meanwhile) fails the job with `insufficient_material` (the SPA shows the generic error).
- `cleared_count` counts the round's answers that cleared a Mistake (`mistakes.cleared_by_answer_id`); `context.correct_text` is null until the item is answered, since for a `from_original` item it is the answer key.
- The start page follows an already-running `review_round` job (also after `409 review_in_progress`) instead of showing the unapproved "already being made" string (EXPERIENCE.md L267).
- "Your progress is saved." shows as a muted status line at the top of the chat after "Stop for now", the session's "← Back to chat", and the Round done panel's "← Back to chat" (passed in router state). DESIGN.md's "Cleared" line, "From your quiz on [date]" label, and "· {k} left" are not built: they are not in the cited copy.
- No Activity header title on the review pages: no title string is among the cited lines.
- Review fixes: removal beats reuse (AD-11); reuse is re-checked in the save transaction; model items are matched by parsed UUID and dropped when they echo the original question; each Section is cut to 4,000 chars and targets past `LLM_CONTEXT_BUDGET_TOKENS` use their originals; one answer clears at most one Mistake (unique index); the round read carries its job's `status`/`error_code` and each item's `from_original`.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | BH, EC | model `mistake_id` compared as a raw string | medium | `by_id.get(item.mistake_id)` | patch |
| 2 | EC | bad snapshot section id fails the whole job | low | inline `UUID(str(v))` | patch |
| 3 | BH | reuse wins over a removed file | medium | AD-11: removed material → saved original | patch |
| 4 | EC | reuse decided at read time | low | a question answered during generation is reused | patch |
| 5 | BH | echoed original counted as AI practice | low | no equality check | patch |
| 6 | BH | prompt size unbounded | medium | 20 targets × full Sections | patch — per-target cap and budget |
| 7 | BH | no DB guard on one answer clearing two Mistakes | low | no index on `cleared_by_answer_id` | patch |
| 8 | BH | round API can't tell generating or failed from missing | medium | `items: []` in every case | patch — job status in the response |
| 9 | VG, BH | missing backend tests (removed during generation, all withdrawn, withdrawn item, foreign clear, invalid output) | medium | none in `test_review.py` | patch |
| 10 | EC, BH | failed job with a rule code offers Try again | low | poll mapped every failure to generic | patch |
| 11 | EC, BH | "Round done. 0 mistakes…" with a dead restart | medium | panel logic needed clears > 0 | patch — All cleared when none remain |
| 12 | BH | original-question items leak a wrong option in the context | low | same question plus the earlier pick | patch — shown after answering |
| 13 | BH | "Your progress is saved." returns on reload | low | router state never cleared | patch |
| 14 | VG | empty round untested | low | only reachable by URL | patch (with #8) |
| 15 | EC | Mistake cleared during the save | low | narrow race; the save re-reads outstanding | reject |
| 16 | BH | a provider error loses the whole round | low | spec: failure shows the error and keeps the count | reject |
| 17 | BH | `insufficient_material` copy reads oddly for review | low | Start is hidden at 0; no approved review copy | defer to Cristoffer |
| 18 | BH | prompt doesn't include the wrong answer | low | AD-11 fixes the target shape; a spine change | defer to Cristoffer |
| 19 | BH | `useQuizNotices` name | low | naming only | reject |
