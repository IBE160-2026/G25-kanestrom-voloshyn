---
title: 'Story 3.3: My wrong answers become Mistakes, and the Project shows how many'
type: 'feature'
created: '2026-11-19'
status: 'done'
baseline_commit: '218d3119a23e29ca0699020d2eb6eabebaa9e49b'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Wrong Quiz answers are scored but not kept for review. The Project doesn't show how many Mistakes are waiting, and removing a file can't take its Mistakes out of review (FR-9, FR-12, FR-20, AD-10).

**Approach:**
- **Migration:** a `mistakes` table with these columns:
  - `id`, `account_id`, `project_id`, `quiz_question_id`
  - `failed_answer_id`, the wrong answer
  - `material_ids uuid[]`, copied from the question
  - `question_snapshot jsonb`, holding the question, options, correct option, explanation and source section ids as shown
  - `created_at`, `cleared_at`, `withdrawn_at`

  A partial unique index on `(account_id, quiz_question_id) WHERE cleared_at IS NULL AND withdrawn_at IS NULL` stops duplicates. RLS is on, and anon/authenticated are revoked.
- **New `services/mistakes`,** the only writer of the table:
  - `record_failure(conn, account_id, project_id, quiz_question_id, failed_answer_id)`: insert `ON CONFLICT DO NOTHING`, so a repeat failure while outstanding does nothing.
  - `withdraw_for_material(conn, account_id, material_id)`: sets `withdrawn_at` on outstanding Mistakes whose `material_ids` contain the file.
  - `outstanding_count(conn, account_id, project_id)` and `outstanding_by_material(...)`.
  - `clear` arrives with Story 3.5.
- **Answering:** `quiz.answer` calls `record_failure` in the same transaction as a newly saved wrong answer, never for a stored resubmit.
- **`GET /api/projects/{id}/mistakes/summary`** returns `{outstanding, by_material: {material_id: n}}`. It is a read: it works on read-only Projects, but the SPA hides the card there.
- **Removal:** `DELETE …/materials/{mid}?withdraw_mistakes=true` calls `withdraw_for_material` inside the removal transaction (AD-23). Without the flag, the Mistakes stay outstanding.
- **SPA:**
  - The Mistakes card sits at the top of the chat when outstanding > 0 and the Project is active: "{n} mistakes to review" / "Du har {n} feil å repetere" ("1 mistake to review").
  - Never "0", and it is hidden while the Project is archived or deleted.
  - It refreshes when the Project opens and when the student returns from a Quiz.
  - Decided by Cristoffer 2026-11-19: the card has no "Start" until Story 3.4 adds it.
- **Remove file dialog:** shows the unchecked checkbox "Also remove its mistakes from my review" / "Fjern også feilene fra repetisjonen min" only when that file has outstanding Mistakes, and sends the flag when it is checked.

## Boundaries & Constraints

**Always:**
- Only `services/mistakes` writes `mistakes`, and only from a Quiz answer.
- Withdrawn and cleared rows stay as history and never count.
- The count is computed each time, never stored.
- Copy comes from EXPERIENCE.md (L111, L167, L252) through i18n; styles use tokens only.

**Never:**
- No Mistake Review round, Practice Questions, or `clear` (Stories 3.4 and 3.5).
- No Mistakes from flashcards.
- No stored counter.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Wrong answer | new wrong answer | 1 outstanding Mistake with the snapshot and `material_ids` | N/A |
| Right answer | correct | no Mistake | N/A |
| Resubmit | the same wrong answer posted again | still 1 Mistake | N/A |
| Same question again | an outstanding Mistake exists for it | no duplicate (index) | N/A |
| Leave part-way | 3 of 10 answered, 2 wrong | 2 outstanding after reopening | N/A |
| Card | 0 / 1 / 5 outstanding | none / "1 mistake to review" / "5 mistakes to review" | N/A |
| Archived | outstanding 5 | no card; summary still readable | N/A |
| Remove, unchecked | the file has 2 Mistakes | removed; still 2 outstanding | N/A |
| Remove, checked | `withdraw_mistakes=true` | removed; 0 outstanding; rows have `withdrawn_at` | rollback → nothing withdrawn |
| No mistakes | the file has none | no checkbox in the dialog | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/` -- new `…_mistakes.sql`, in the style of `20261118180000_quiz_answers.sql`.
- `backend/app/services/quiz.py` `answer` (L119-155): `insert_answer` (L130) saves with `ON CONFLICT DO NOTHING`. It must tell whether this request inserted the row (e.g. return `inserted`) so `record_failure` runs only then. The snapshot comes from the question row.
- `backend/app/services/mistakes.py`, `backend/app/db/mistakes.py` (new); `backend/app/api/mistakes.py` (new, registered in `main.py`).
- `backend/app/services/materials.py` `remove` (L216) and `backend/app/api/materials.py` `remove_material` (L90): the optional `withdraw_mistakes` query flag.
- `backend/tests/test_routes_guard.py` -- the summary route is a read, so no guard.
- `frontend/src/pages/ProjectHome.jsx` -- the Mistakes card at the top of the chat column, above the quiz notices.
- `frontend/src/components/RemoveFileDialog.jsx` -- L16 expects the checkbox. `FilesPanel.jsx`, `useProjectFiles.remove` pass the flag.
- `frontend/src/pages/QuizPage.jsx` -- nothing to change unless needed. The card refreshes on the chat's mount.
- `frontend/src/api/client.js`, `frontend/src/test/fakeApi.js` -- the summary route, the removal flag, and a wrong answer creating a Mistake.
- `frontend/src/i18n/*.json` -- the card and checkbox strings.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/20261119120000_mistakes.sql` -- the table and the partial unique index.
- [x] `backend/app/services/mistakes.py`, `db/mistakes.py`, `api/mistakes.py`, `services/quiz.py`, `db/quizzes.py`, `services/materials.py`, `api/materials.py`, `main.py` -- record, withdraw, count, summary, and the removal flag.
- [x] `backend/tests/test_mistakes.py` -- every backend matrix row, including a removal with the flag where a later step fails and nothing is withdrawn.
- [x] `frontend` -- the card, the dialog checkbox, and the flag.
- [x] `frontend/src/pages/MistakesCard.test.jsx` (+ cases in `RemoveFile.test.jsx`) -- card counts and plural, none at 0 and when archived, refresh after a Quiz, checkbox shown only with mistakes, the flag sent when checked, Norwegian.

**Acceptance Criteria:**
- Given a student who answers 2 questions wrong and goes "← Back to chat", when the chat shows, then the card reads "2 mistakes to review" without a reload.
- Given a Mistake whose file was removed without the checkbox, when the summary is read, then it still counts.

## Verification

**Commands:**
- `npx supabase db reset` -- expected: migrations apply
- `cd backend; uv run pytest` -- expected: all green with `LLM_MODE=mock`
- `cd frontend; npm test; npm run lint` -- expected: all green (from PowerShell)

## Implementation Notes

- `db/mistakes.insert` builds the row with `INSERT … SELECT` from the Account's own `quiz_questions` row (scoped by `account_id` and `project_id`), so `record_failure` keeps the spec's signature and the snapshot (`question`, `options`, `correct_option_id`, `explanation`, `source_section_ids`) and `material_ids` come straight from the Question. `ON CONFLICT … WHERE cleared_at IS NULL AND withdrawn_at IS NULL DO NOTHING` targets the partial unique index.
- `db/quizzes.insert_answer` now returns `(stored, inserted)`; `quiz.answer` calls `record_failure` only when `inserted and not is_correct`.
- `materials.remove` calls `withdraw_for_material` after the job cancel, also for an already removed file (a retry with the flag still withdraws).
- `by_material` counts a Mistake once for each Material it cites.
- The card has no muted supporting line: the mock's "From your recent quizzes…" has no signed-off string in EXPERIENCE.md.
- SPA: `pages/useMistakes.js` reads the summary when the chat mounts (so "← Back to chat" refreshes it) and again after each removal; `api/client.js` needed no change (generic `apiFetch`).
- Extra tests: `test_routes_guard.py` asserts the summary route is an unguarded GET; `test_mistakes.py` asserts only `services/mistakes` uses the repository.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | VG | the `inserted` guard is untested | medium | ON CONFLICT hides a resubmit while outstanding | patch — test after withdraw |
| 2 | VG, EC, BH | flag on an already removed file withdraws; docstring says nothing changes | low | `withdraw_for_material` sits outside the `removed_at` block | patch — kept for retries, docstring fixed, test |
| 3 | BH | `insert` doesn't check the failed answer | medium | the SELECT never joined `quiz_answers` | patch |
| 4 | EC, BH | withdraw not scoped by Project | low | other queries filter `project_id` | patch |
| 5 | BH | two-file Mistakes untested | medium | no test cites two files | patch — AD-10 "every Material" |
| 6 | BH | a row can be both cleared and withdrawn | low | no check constraint | patch |
| 7 | BH | failed-removal test may not exercise the rollback | low | depends on call order | patch — spy |
| 8 | EC, BH | stale or out-of-order summary responses; duplicated fetch | medium | no sequence guard; refresh dropped while the first read is pending | patch |
| 9 | BH | checkbox missing when the summary failed or is pending | medium | the dialog relied on the shell's summary | patch — refresh on open |
| 10 | BH | card count changes not announced | low | no live region | patch |
| 11 | BH | Rejected-row removal flag untested | low | no test | patch |
| 12 | BH | cascades can delete Mistake history | low | no Quiz delete exists; only Project/Account purge, which must delete all | reject |
| 13 | EC, BH | a wrong answer to an old Quiz from a removed file records a Mistake | low | every wrong Quiz answer records (FR-12); the snapshot keeps it practisable | reject |
| 14 | BH | refresh failure after removal untested | low | the next chat open re-reads | reject |
| 15 | BH | comment line widths | low | cosmetic | reject |
| 16 | BH | spec missing from the review diff | false | excluded on purpose | reject |
