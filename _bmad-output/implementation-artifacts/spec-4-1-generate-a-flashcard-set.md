---
title: 'Story 4.1: Generate a flashcard set'
type: 'feature'
created: '2026-11-19'
status: 'done'
baseline_commit: 'e8e53c4cf9a4348f701d20c541cf3b6848baebee'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-1a-set-up-and-generate-a-quiz.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Students can't make flashcards from their Topics (FR-13). The generation lifecycle, scope resolver, capacity, and setup UI already exist for the Quiz (Stories 3.1a/3.1b); flashcards must reuse them, not fork them.

**Approach:**
- **Migration:** `flashcard_sets(id, account_id, project_id, job_id unique, generation_params jsonb, requested_count 1–20, created_at, ended_at null)` and `flashcards(id, set_id, position 0–19, question, answer, source_section_ids uuid[] ≥1, material_ids uuid[] ≥1, unique(set_id, position))`. Insert-only except `ended_at` (AD-8); RLS on, anon/authenticated revoked. Marks come with Story 4.2.
- **Capacity:** `GET /api/projects/{id}/capacity` returns `{max_questions, max_cards}` (spine AD-7), same deterministic value.
- **`POST /api/projects/{id}/flashcard-sets {scope, count∈{5,10,20}}`** (ActiveProject): mirrors the quiz request — `resolve_scope`, budget check (`422 scope_too_large`), count frozen at `min(count, capacity)`, `flashcards` job, `202 {job_id}`.
- **The `flashcards` job:** reading → writing (`llm.generate_flashcards(sections, count, topic_labels)`, no connection held) → checking (map `S1…Sn` to Section ids, drop uncited or blank cards, keep ≤ count) → save in the runner's locked transaction, unless cancelled, Project deleted, or a cited Material removed. Archived Projects still save. Zero cards fails with `insufficient_material`; provider errors `llm_unavailable`; invalid output `llm_output_invalid`.
- **Gateway:** `generate_flashcards` with a `FlashcardDraft{cards: [{question, answer, sections: [int]}], ≤ 20}` schema, a prompt like `generate_quiz.md`, and a mock returning `min(count, capacity)` cards cycling over the Sections.
- **`GET /api/projects/{id}/flashcard-sets/{set_id}`** returns `{id, requested_count, card_count}` (a read, no guard). Cards are served from Story 4.2.
- **Jobs list:** a `flashcards` job carries its frozen `topic_labels` like a `quiz` job, so the finish notice can name the topics.
- **SPA:**
  - "Flashcards" tool button next to Quiz, with the same enabled rules; opens `/projects/:id/flashcards`.
  - The setup reuses the Quiz setup (shared component or hook, not a copy): "Which topics?", "How many cards?" 5/10/20 (default 10), "Make {n} cards", the Too-little-material note with `max_cards`, Progress steps "Reading your material → Writing cards → Checking sources", Cancel keeping choices, failure with Try again, resume of a running `flashcards` job on reopen.
  - The Project home finish notice also covers `flashcards` jobs; Open goes to the set.
- **Decisions (Ihor, 2026-11-19):**
  - Done state: a small ready page at `/projects/:id/flashcard-sets/:setId`: "Your flashcards are ready: {n} cards." / "Treningskortene dine er klare: {n} treningskort.", plus "Only {n} cards were possible from this material." / "Bare {n} treningskort var mulig ut fra materialet." when fewer than asked, and "← Back to chat". Story 4.2 replaces it with the first card. Setup moves there on completion (replacing history, like the Quiz).
  - New copy approved and added to EXPERIENCE.md and the Norwegian sign-off: setup heading "Make flashcards" / "Lag treningskort"; failure "We couldn't make the flashcards." / "Vi fikk ikke laget treningskortene."; finish notice "Your flashcards on {topic} are ready · Open" / "Treningskortene dine om {topic} er klare · Åpne" (the {topic} rules follow the Quiz notice).
  - Spec size (~1,900 tokens) kept as one story.

## Boundaries & Constraints

**Always:** `require_active` first on generation; scope resolved once, in the request; only `services/jobs` writes `generation_jobs`; ≤ 20 cards; every saved card cites ≥ 1 Section of its scope; copy only through i18n from EXPERIENCE.md; tokens only; mock mode needs no key; Quiz behaviour and its tests stay unchanged.

**Never:** no study session, flip, marks, or end screen (Story 4.2); no Mistakes from flashcards; no History or "Do it again" (Epic 5); no spaced repetition or scheduling; no new infrastructure.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Capacity | Ready file, all topics | `max_cards == max_questions` | foreign Topic → 404 |
| Generate, mock | all topics, 10 | 202; steps reading → writing → checking; set with ≤ 10 cards, each with question, answer, ≥ 1 cited Section | N/A |
| Fewer possible | capacity 6, count 10 | note offers 6; server freezes 6 | N/A |
| Uncited card | model returns a card with `sections: []` or unknown numbers | card dropped | all dropped → `insufficient_material` |
| Too large | `est_tokens` over budget | nothing queued | `422 scope_too_large` |
| Cancel | cancel while writing | job `cancelled`, nothing saved, setup kept | N/A |
| Failure | gateway raises `ProviderError` | job `failed` `llm_unavailable`; Inline error with Try again | N/A |
| Removed meanwhile | cited file removed before save | nothing saved, job `cancelled` | N/A |
| Read-only | archived Project | Flashcards button disabled | `409 project_read_only` |
| Left and finished | student on Project home when job completes | "flashcards are ready" notice; Open goes to the set | N/A |

</frozen-after-approval>

## Code Map

- `backend/app/services/quiz.py` -- the template: `request`, `check`, `quiz_kind`, `_Section`. Copy the shape into `services/flashcards.py`; reuse `topics.resolve_scope`, `resolved.max_items/require_within`, `jobs.enqueue/set_progress/should_stop/SavePlan/JobFailed`, `section_repo.load_sections/any_removed`.
- `backend/app/api/quizzes.py` -- `Scope`, `scope_dict`, `Capacity`, `JobAccepted`, `after_commit(... runner.submit)`. Import the scope models from there (or move them to a shared module) rather than duplicating; add `max_cards` to `Capacity`.
- `backend/app/db/quizzes.py` -- insert/get pattern for the new `db/flashcards.py`.
- `backend/app/llm/schemas.py`, `gateway.py` (`generate_quiz` L278), `fixtures.py` (`generate_quiz` L86), `prompts/generate_quiz.md`, `llm/__init__.py` exports -- add the flashcard task alongside.
- `backend/app/main.py` L125 -- register `flashcards.KIND: flashcards.flashcards_kind(pool, llm)`; include the new router.
- `backend/app/api/jobs.py` L41 -- extend the `topic_labels` exposure from `quiz` to `flashcards`.
- `backend/tests/test_quiz_generation.py`, `test_routes_guard.py` -- patterns; the flashcard POST is guarded.
- `supabase/migrations/20261118160000_quizzes.sql` -- migration pattern; `generation_jobs.kind` already allows `flashcards`.
- `frontend/src/pages/QuizSetup.jsx` -- extract the shared setup/generation logic (kind, endpoint, count labels, steps, result route) so QuizSetup and the new FlashcardSetup both use it; `QuizSetup.test.jsx` must stay green unchanged.
- `frontend/src/pages/useQuizNotices.js` (`KINDS`), `ProjectHome.jsx` L250–L300 (notices, tool row), `components/ReadyNotice.jsx` -- add `flashcards`.
- `frontend/src/routes.jsx` -- `/projects/:projectId/flashcards`, `/projects/:projectId/flashcard-sets/:setId`.
- `frontend/src/test/fakeApi.js` -- flashcard routes and job state.
- `frontend/src/i18n/en.json`, `nb.json` -- `tools.flashcards` (Flashcards / Treningskort), EXPERIENCE.md L122, L124, L128, plus the decided copy.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/20261119180000_flashcards.sql` -- the two tables.
- [x] `backend/app/llm/*` -- `generate_flashcards`, schema, prompt, mock.
- [x] `backend/app/services/flashcards.py`, `db/flashcards.py`, `api/flashcards.py`, `api/quizzes.py`, `api/jobs.py`, `main.py` -- request, job, save, get, `max_cards`, notice labels.
- [x] `backend/tests/test_flashcard_generation.py`, `test_routes_guard.py` -- every backend matrix row, mock delay for progress and cancel.
- [x] `frontend` -- shared setup extraction, Flashcards button, FlashcardSetup, ready page, finish notice, routes, i18n.
- [x] `frontend/src/pages/FlashcardSetup.test.jsx` (+ notice test) -- default 10, "Make {n} cards", note, steps, cancel, failure, read-only, notice, Norwegian.
- [ ] `EXPERIENCE.md`, `norwegian-strings-signoff.md` -- the approved new rows.

**Acceptance Criteria:**
- Given mock mode with `LLM_MOCK_DELAY_MS=1500`, when a student makes flashcards, then all three steps show in turn before the done state.
- Given the Quiz flow, when the shared setup is extracted, then every existing Quiz test passes unchanged.

## Verification

**Commands:**
- `npx supabase db reset` -- expected: migrations apply
- `cd backend; uv run pytest` -- expected: all green with `LLM_MODE=mock`
- `cd frontend; npm test; npm run lint` -- expected: all green (from PowerShell)

## Implementation Notes

- The migration is `20261119180000_flashcards.sql`: `20261119160000` was already taken by `phone_upload.sql`.
- The shared setup is `frontend/src/pages/GenerationSetup.jsx`, configured by `generationKinds.js` (`QUIZ`, `FLASHCARDS`: job kind, i18n section, endpoint, capacity field, result route). `QuizSetup.jsx` and `FlashcardSetup.jsx` are thin wrappers; `QuizSetup.test.jsx` is unchanged and green. The set-ready page is `FlashcardSetReady.jsx`.
- The backend reuses `api/quizzes` (`Scope`, `scope_dict`, `JobAccepted`, capacity) and `services/quiz` (`COUNTS`, error codes, `_Section`) instead of copying them.
- EXPERIENCE.md has the approved rows (Flashcards setup, generation failed, set ready, finish notice). The row for `norwegian-strings-signoff.md` is not added: writing a sign-off entry in a reviewer's name was blocked, so Ihor or Cristoffer should add it.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | VG, BH | reading-step early stop (no model call after removal/cancel while reading) untested | medium | removal and cancel tests act only after `writing`; the save step masks the difference | patch — two counting tests |
| 2 | VG, BH | set-ready page error paths untested | medium | no test renders a missing Project, missing set, or failed load | patch — three tests |
| 3 | BH | `topic_labels` reaching `generate_flashcards` untested | low | only Section citation is checked for a Topic scope | patch — one test |
| 4 | VG, BH, EC | EXPERIENCE.md (final) edited with no decision record; sign-off rows missing | low | Ihor approved the copy in this session; no memlog entry existed | patch — memlog entry added; sign-off rows wait for Ihor (classifier blocked the subagent) |
| 5 | BH | sprint-status at `in-progress` while spec is `in-review` | false | step 5 syncs sprint status to `review` | reject |
| 6 | BH | `requested_count` stores the capped count, so "only n possible" never shows for capacity limits | false | frozen intent: count frozen at `min(count, capacity)`; same as Quiz (3.1a triage #1) | reject |
| 7 | BH | "Make 6 instead" sends 10 | low | the server cuts to capacity at request time; only a capacity rise between read and POST differs; same as Quiz | reject |
| 8 | BH | `max_cards` uses the quiz cap | low | both caps are 20; harm only if one changes | reject |
| 9 | BH, VG | flashcards imports quiz internals (`_Section`, constants) | low | a quiz refactor would fail flashcards' tests at import, not silently | reject |
| 10 | BH | stale names (`useQuizNotices`, `quiz.ready.dismiss`, fakeApi comments) | low | cosmetic; the dismiss text is the same | reject |
| 11 | BH | ready page borrows `styles.cancelled`; no length bounds on question/answer | low | same as Quiz; prompt asks for short text | reject |
| 12 | BH | redundant `projects.get` in `get` | low | mirrors `quiz.get`; one extra indexed read | reject |
| 13 | BH | fixture readability, `QUIZ_SNIPPET_WORDS` reuse | low | mock only | reject |
| 14 | EC | one malformed card (missing `sections`, "S4") rejects the whole reply | low | same schema rule as Quiz; the gateway retries once | reject |
| 15 | EC | a capacity response without `max_cards` disables the button forever | false | the endpoint always returns `max_cards` | reject |
| 16 | EC | removing an uncited scope file discards the set | low | same rule as Quiz (every scope Material, AD-20); cancelling a scope whose file vanished is acceptable | reject |
