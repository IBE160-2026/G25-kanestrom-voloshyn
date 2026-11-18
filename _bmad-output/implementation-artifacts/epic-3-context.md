# Epic 3 Context: Quiz and the Mistake loop

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Deliver the core study loop: a student picks Topics and a question count, gets a grounded multiple-choice Quiz generated in the background, answers it one question at a time with immediate sourced feedback and a final score, and has every wrong answer recorded as a Mistake. Outstanding Mistakes show as a count on the Project and can be practised, on the student's request only, in Mistake Review rounds where a correct answer clears the Mistake. This is the product's differentiator (integrated Mistake Review) and it establishes the generation lifecycle (progress steps, leave and come back, cancel, failure, finished notice) that Epic 4's flashcards and summaries reuse.

## Stories

- Story 3.1: Generate a Quiz from my Topics
- Story 3.2: Take the Quiz with immediate, sourced feedback
- Story 3.3: My wrong answers become Mistakes, and the Project shows how many
- Story 3.4: Start a Mistake Review round
- Story 3.5: Clear Mistakes in review

## Requirements & Constraints

- **Quiz generation:** 5, 10, or 20 questions (default 10) from "All topics" or chosen Topics; hard cap 20, server-enforced. Thin scope offers the largest supported count; fewer items than requested is valid ("only {n} were possible"), zero items is a failure. Must finish within 60 s for one lecture-deck-sized upload in live mode.
- **Quiz taking:** four options, exactly one correct, scored without any AI call; one question at a time; immediate feedback with a grounded explanation and source label; no auto-advance; final score equals the number of correct answers, with missed questions listed (both answers shown).
- **Mistakes:** every wrong Quiz answer becomes a Mistake at answer time, recording its source Materials and the question and explanation as shown. Answers part-way through a Quiz still produce Mistakes. Flashcards and practice answers never create Mistakes.
- **Indicator:** shows the outstanding count only when > 0 and the Project is active; never "0 mistakes"; hidden while archived or deleted.
- **Mistake Review:** starts only by explicit student choice; ≤ 20 practice questions per round, oldest Mistakes first; Mistakes whose file was removed are practised from the saved original question; a Mistake clears only after the correct answer is saved; rounds are repeatable; cleared and withdrawn Mistakes keep their history until permanent deletion.
- **Background generation:** continues when the student leaves, is cancellable, keeps setup choices on cancel and failure, and is announced when finished. Archiving lets it finish; deleting the Project cancels it.
- **Grounding:** no unsupported claims; every explanation and practice question names its source.
- **Test mode:** everything above must run and be testable with no AI key (mock mode), including progress, cancel, failure, and finish-while-away paths.

## Technical Decisions

- **Scope resolution:** request shapes are only `{"topic_ids": [...]}` or `{"all_topics": true}`. Resolve exclusively through `topics.resolve_scope` (returns `section_ids`, `topic_labels`, `material_ids`, `est_tokens`); removed Materials are never in scope. The resolved scope (count, `section_ids`, `topic_labels`) is frozen into the job's `params` and the Quiz's `generation_params`; Retry reuses it unchanged, returning `409 material_removed` if a cited Material is gone. `est_tokens` over `LLM_CONTEXT_BUDGET_TOKENS` → `scope_too_large`.
- **Capacity endpoint:** `GET /api/projects/{id}/capacity?scope=…` returns `{max_questions, max_cards}` deterministically (`CAPACITY_WORDS_PER_ITEM`, at least 1 per Section), no LLM call.
- **Gateway:** use the `generate_quiz` and `generate_practice` typed tasks only; output is Pydantic-validated, one retry then `LLMOutputError`. Questions come back as `options[4]` + `correct_index`; the gateway maps local `S1…Sn` labels to Section ids and drops uncited items. Mock fixtures return `min(requested, capacity)` items; `LLM_MOCK_DELAY_MS` exercises progress and cancel.
- **Question format and scoring:** the service shuffles options and assigns ids `a`–`d` plus `correct_option_id` and `explanation`. Score is `submitted_option_id == correct_option_id` in the backend. Question payloads omit `correct_option_id`, explanation, and sources until answered; afterwards the explanation returns with source labels ("file · slide/page") joined from `source_section_ids`. Each question stores `source_section_ids` and derived `material_ids`.
- **Immutability:** Quizzes, Questions, Practice Questions, and all answers are insert-only. One attempt per Quiz. Answers are idempotent (one per Question / Practice Question); a resubmit returns the stored result. In `mistakes`, only `cleared_at` and `withdrawn_at` are mutable.
- **Mistakes ownership:** only `services/mistakes` writes the table, via `record_failure(conn, account_id, project_id, quiz_question_id, failed_answer_id)`, idempotent `clear(conn, mistake_id, practice_answer_id)`, `withdraw_for_material(conn, account_id, material_id)`, and `outstanding_count(conn, account_id, project_id)`. A partial unique index on (`account_id`, `quiz_question_id`) `WHERE cleared_at IS NULL AND withdrawn_at IS NULL` prevents duplicates; a repeat failure while outstanding is a no-op, a failure after clearing creates a new row. The indicator is computed, never a stored counter. `record_failure` runs in the same transaction as the wrong answer.
- **Review rounds:** an explicit request creates a `review_rounds` row and a `review_round` job. A partial unique index allows one queued/running `review_round` job per Project; a second request → `409 review_in_progress`. The job takes the oldest ≤ 20 outstanding Mistakes, moves any unanswered earlier Practice Question into this round, and generates the rest in one batched `generate_practice` call (targets `{mistake_id, question_text, correct_text, source_section_ids}`) only for Mistakes whose cited Materials all still exist; removed-material Mistakes reuse the saved original Question re-shuffled, no LLM call. Each Practice Question stores `mistake_id`. The round API returns `remaining_outstanding` for "Round done" vs "All cleared".
- **Jobs:** kinds `quiz` and `review_round` run via the existing `services/jobs` runner; feature handlers return a save plan and never write job rows. Requests return `202 {job_id}`; `progress_step` is `reading` → `writing` → `checking`. The save transaction locks the job `FOR UPDATE` and aborts if `cancel_requested`, the Project is deleted, or a cited Material is removed; it does not call `require_active` (archived Projects still save). Failure stores `error_code` and keeps `params`; Retry creates a new job. The SPA polls `GET /api/projects/{id}/jobs` every 2 s while a job is active; a completed unseen job shows the "… is ready · Open" notice (not a chat message), dismissed via `POST /api/jobs/{id}/seen`.
- **Transactions:** never call the LLM inside an open write transaction; job steps are read txn → LLM call with no connection → save txn. Services take `conn` and never commit.
- **Read-only guard:** generation, quiz answers, and review (start and answers) are content mutations and call `projects.require_active` first (`409 project_read_only`); job seen and cancel are allowlisted bookkeeping.
- **Removal hook:** file removal with the opt-out checked calls `mistakes.withdraw_for_material` inside the removal transaction; unchecked Mistakes stay outstanding.
- **Error codes in play:** `scope_too_large`, `insufficient_material`, `material_removed`, `review_in_progress`, `project_read_only`, `generation_cancelled`, `interrupted`, `llm_unavailable`, `llm_output_invalid`.
- **REST naming:** plural nouns nested under the Project, e.g. `/api/projects/{project_id}/quizzes`.

## UX & Interaction Patterns

- **Entry:** Quiz button in the chat home's tool buttons row (added in 3.1). Activity header with "← Back to chat"; Topic scope picker reuses the Topic list grouping; Count picker 5/10/20 with the button reading "Make {n} questions"; Too-little-material note disables the button until the count fits. Quiz stays disabled until a file is Ready.
- **Generating:** Progress steps with Cancel (Reading your material → Writing questions → Checking answers) driven by real `progress_step`. Cancel → back to setup with choices kept (Mistake Review start: back to chat). Failure → Inline error ("Nothing you've made is lost." + "Try again" taking focus), choices kept. Leaving → finish notice "Your quiz on {topic} is ready · Open" in the chat.
- **Quiz:** one question, progress bar, Answer options (keys 1–4 or click; "Your answer" / "Correct answer" colours). Feedback panel: wrong → "Not quite" / "It stays in your review." in the mistake (amber) colour, never red; explanation plus Source label. "Next question" (→) or "See results" on the last. Score summary lists missed questions with both answers, offers "← Back to chat" (primary) and "New quiz". Leaving part-way keeps answered Mistakes (resume is Epic 5).
- **Mistakes card:** "{n} mistakes to review · Start" at the top of the chat; absent at 0 and in archived/deleted Projects.
- **Mistake Review session:** original mistake as context ("Your earlier answer"), plus "The file this came from was removed." when applicable; works like a Quiz question; progress "{n} of {m} cleared"; "Stop for now" / "← Back to chat" show "Your progress is saved." Round done panel "Round done. {n} mistakes still to review." with "Review mistakes" (new round). All cleared panel "All cleared! Nice work." only after the last clear is saved, never after stopping; no celebratory animation. Save failure → Inline error, Mistake stays counted.
- **Accessibility:** Feedback panel, progress changes, and Progress steps use a polite live region; Inline errors are alerts; keyboard shortcuts shown as Key hints, desktop only, disabled in text inputs; reduced motion makes transitions instant.
- Copy comes from the signed-off EN/NB strings; all strings in `en.json`/`nb.json`.

## Cross-Story Dependencies

- Builds on Epic 2: Topics and `resolve_scope` inputs, the LLM gateway with mock mode, the `services/jobs` runner, `require_active`, and Story 2.7's Remove file dialog (Story 3.3 adds its mistakes checkbox behaviour).
- 3.1 establishes the generation lifecycle (jobs, progress, cancel, failure, finished notice) reused by 3.4 and by Epic 4 (Stories 4.1, 4.3).
- 3.2 depends on 3.1; 3.3 hooks into 3.2's answer transaction; 3.4 needs 3.3's Mistakes and the indicator card; 3.5 needs 3.4's rounds and Practice Questions.
- Epic 5 (History) later lists Quizzes, resumes Unfinished Quizzes, and runs "Do it again" from the frozen `generation_params`; Epic 7's archive/delete rely on the indicator hiding and job-cancel behaviour defined here.
