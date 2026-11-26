# Epic 5 Context: History

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give each Project one History list holding every chat, Quiz, Flashcard set, and Summary, so nothing the student made gets lost and a returning student finds the Project exactly as they left it. From History the student reopens results read-only, continues a chat, resumes an Unfinished Quiz, and runs a Quiz or Flashcard set again from its frozen setup. History is a read model over the artifact tables that Epics 3 and 4 already write. It adds no new write path and no history table. It is a Core requirement and is never cut.

## Stories

- Story 5.1: Find everything I made in one History list
- Story 5.2: Resume an unfinished quiz and run things again

## Requirements & Constraints

- **One list per Project:** chats (one row per chat), Quizzes, Flashcard sets, and Summaries, newest first. It can be filtered by type (All, Chats, Quizzes, Flashcards, Summaries).
- **Reopening:** a completed Quiz or Flashcard set opens as read-only results. A Summary or a chat reopens in full, and a chat in an active Project can be continued.
- **Resume (FR-8):** in a later session, every Study Content item and chat is in History exactly as left. A Quiz left before its last question is an Unfinished Quiz and resumes at its first unanswered question. Each Quiz has only one attempt.
- **Do it again:** offered for a completed Quiz or Flashcard set. It starts a normal new generation with the same count, Topics, and Material, under the same per-generation limits (20 questions, 20 cards), and leaves the original unchanged. It adds no new daily limit.
- **Removed source file:** the results stay viewable, but "Do it again" is unavailable and the student is told why.
- **Part-way Flashcard set:** shown as ended. It can't be resumed but offers "Do it again".
- **Archived or deleted Project:** History is read-only. Nothing can be resumed, continued, or run again until the Project is restored.
- **Test mode:** everything runs with no AI key. "Do it again" uses the existing mock generation fixtures.

## Technical Decisions

- **Endpoint:** `GET /api/projects/{id}/history?type=` is one read-only `UNION ALL` over `chats`, `quizzes`, `flashcard_sets`, and `summaries`, in `db/history.py`, with `services/history` as the service. It returns rows newest first, uses keyset pagination on `(created_at, id)` so no row is skipped or duplicated, and returns a per-type status (for example "Unfinished · n of total").
- **Ordering:** History orders chats by `created_at`. The Project home opens the chat with the latest `last_opened_at`. The two orderings differ on purpose; a review flagged this as accepted.
- **Immutability:** Quizzes, Questions, Flashcard Sets and Cards, Summaries, Chat Messages, and all answers and marks are insert-only. History never changes an artifact. The only mutable columns it can touch are `flashcard_sets.ended_at` and the chat's `current_scope` / `last_opened_at`.
- **Ending a Flashcard set:** `ended_at` is set when the student opens another set, or lazily on the next read once no mark has been added for 30 minutes (this already exists from Story 4.2). "Needed a second try" counts cards marked more than once.
- **Do it again = frozen params:** the job `params` and the artifact's `generation_params` hold the same frozen value (count, `section_ids`, `topic_labels`). "Do it again" reuses it unchanged and doesn't resolve the scope again. If a cited Material has been removed since, the server returns `409 material_removed`. The run goes through the existing `services/jobs` lifecycle (`202 {job_id}`, progress, cancel, failure, finish notice).
- **Removed Materials (tombstone):** Section text is emptied, but file names and Section labels are kept, so old results keep their Source labels. Removed Materials never count toward scopes, capacity, or "Do it again".
- **Read-only guard:** "Do it again", resuming a quiz (quiz answers), and chat messages are content mutations and call `projects.require_active` (`409 project_read_only`). Reading History is never blocked. Opening a chat (`last_opened_at`) and ending a flashcard set are bookkeeping on the allowlist.
- **API conventions:** responses are `snake_case` JSON. Errors are `{"error": {"code", "params", "message"}}`, and the SPA shows only catalogue text keyed by `code`. Relevant codes: `material_removed`, `project_read_only`, `not_found`, plus the existing generation codes (`scope_too_large`, `generation_cancelled`, `llm_unavailable`, `llm_output_invalid`).
- **Tests:** backend tests use `pytest` in mock mode against local Supabase. Frontend tests use Vitest with the real i18n catalogues. The route test that checks `require_active` or the allowlist must cover any new mutating route.

## UX & Interaction Patterns

- **Entry:** the History link in the Chat bar (a primary-coloured caption text action) opens History in place of the chat, with the Activity header "← Back to chat". The filter row is on top and the list below, at most chat width.
- **History filter:** segmented options All · Chats · Quizzes · Flashcards · Summaries (NB Alle · Samtaler · Quizer · Treningskort · Sammendrag). It can be reached by keyboard, stays usable while loading and when empty, and wraps in a narrow window.
- **History row:** surface background, border, `rounded.lg`, hover tint. The title uses `ui` type and the meta line uses muted caption type.
- **States:** empty shows "Nothing here yet" / "Ingenting her ennå" (the same line for a filter with no matches) with the filter still visible. Loading shows static skeleton rows with no shimmer, and screen readers hear "Loading history" / "Laster historikk". An error shows the Inline error "We couldn't load your history." / "Vi fikk ikke lastet historikken din." with "Try again" / "Prøv igjen", which takes focus. "← Back to chat" stays.
- **Copy:** "History" / "Historikk"; "Do it again" / "Gjør det igjen"; "Unfinished · {n} of {total}" / "Ikke fullført · {n} av {total}"; removed source "The file this came from was removed." / "Filen dette kom fra, er fjernet." (shown beside the disabled "Do it again"). These Norwegian strings are signed off and binding.
- **Reopened results:** reuse the existing Score summary (Quiz), Flashcard end screen ("{n} cards done. {m} needed a second try"), Summary view, and chat thread. Results stay factual, with no score history, streak, or due date.
- **Archived or deleted Project:** History, chats, and files can still be read. "Do it again", quiz resume, and the composer wait for Restore.
- **Accessibility and styling:** 44×44 px targets, full Tab path, Inline errors as alerts. Styles use `var(--…)` tokens only.

## Cross-Story Dependencies

- **Epics 3 and 4 (done):** History lists what they create. It reuses the Quiz page's "open part-way at the first unanswered question" behaviour, Story 4.2's `ended_at` and end screen, Story 4.3's Summary view, Story 4.5's several chats and `GET /api/chats/{id}`, and the generation lifecycle (`useGenerationJob`, progress steps, finish notice) for "Do it again".
- **Epic 7 (done):** archive and soft delete already exist, so History and its actions must respect the read-only states now.
- **Within this epic:** Story 5.1 builds the list, filter, states, and reopening. Story 5.2 adds the Unfinished status and resume, "Do it again", and the removed-source and part-way Flashcard rules on top of 5.1's rows.
- **Known gap:** a deferred item notes that Quiz and Flashcards setup don't restore the chosen Topics when resuming a running job. "Do it again" should take its setup from the frozen params, not from that path.
