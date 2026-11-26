---
title: 'Story 5.1: Find everything I made in one History list'
type: 'feature'
created: '2026-11-25'
status: 'done'
route: 'dispatch'
baseline_commit: 'd555d4d6d4bc24eea09a7b2c0b3b2cd47235d4e2'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Chats, Quizzes, Flashcard sets, and Summaries are saved, but a student can't find any of them once they leave. There is no History yet, and the "History" link in the Chat bar is missing (FR-25, FR-8).

**Approach:** Add a read-only `GET /api/projects/{id}/history?type=&cursor=`. It is one `UNION ALL` over `chats`, `quizzes`, `flashcard_sets`, and `summaries`, newest first, with keyset pagination on `(created_at, id)` (AD-27). Add a History page at `/projects/:projectId/history`, opened from a "History" link in the Chat bar. Each row reopens its item through the routes that already exist.

## Boundaries & Constraints

**Always:**
- **Reading:** History is a pure read (AD-27). It has no history table and no write, and it works in archived and deleted Projects. It is scoped by `account_id`; a foreign or missing Project returns `404 not_found`.
- **Sort and pages:** sort by `created_at DESC, id DESC`. A chat sorts by `created_at`, not `last_opened_at`, which is accepted. The opaque `cursor` encodes the last row's `(created_at, id)`. The page size is 30. The response is `{items, next_cursor}`, where `next_cursor` is null on the last page.
- **Filter:** `type` is one of `chat|quiz|flashcards|summary`, or absent for All. Any other value returns `422`.
- **What each item carries:** `{type, id, created_at, title, ...}`. The title is the frozen `topic_labels` joined with ", ", or null for all topics, which the UI shows as "All topics". Per type:
  - **quiz:** `question_count`, `answered_count`, `correct_count`.
  - **flashcards:** `card_count`.
  - **summary:** the stored `title` and the frozen `file_name`.
  - **chat:** the first question as the title, `message_count`, and `scope_file_name`. `scope_file_name` is the scoped file's name only while that file is Ready; otherwise it is null, shown as "all materials".
- **Row contents (DESIGN.md › History row):**
  - **Layout:** the type label, the title truncated with an ellipsis, a muted meta line, and a muted date.
  - **Meta line per type:**
    - quiz: "{c} of {t} correct" when every question is answered, otherwise "Unfinished · {n} of {total}" (copy already signed off).
    - flashcards: "{n} cards".
    - chat: "{n} messages · {scope}".
    - summary: the file name.
  - **Date:** "Today, HH:MM", "Yesterday", otherwise a short month and day, with the year added if it isn't this year. Formatted with `Intl` in the UI language.
- **Opening a row:**
  - quiz → `/projects/:p/quizzes/:id`
  - flashcards → `/projects/:p/flashcard-sets/:id`
  - summary → `/projects/:p/summaries/:id`
  - chat → `GET /api/chats/{id}` (which makes it the chat last opened), then `/projects/:p`, which shows that chat. A read-only Project shows the chat read-only, as today.
- **Page states:**
  - **Layout:** the Activity header "← Back to chat", then the History filter (a segmented group like the Scope control, `aria-pressed`, wraps when narrow), then the list, at most chat width. Rows are buttons with 44 px targets.
  - **Loading:** static skeleton rows, and screen readers hear "Loading history". The filter stays usable.
  - **Empty or no match:** "Nothing here yet" plus the body line, with the filter still shown.
  - **Error:** the Inline error "We couldn't load your history." with "Try again", which takes focus.
  - **More pages:** "Show more" appends the next page.
- **Code rules:** all copy comes from the en/nb catalogues (AD-26) and every colour from `var(--…)` (AD-28). The History link sits right of "New chat" in the Chat bar. It is a text action and is never disabled, so it works in a read-only Project.

**Never:**
- No migration, and nothing new in `services/jobs`, Mistakes, or usage.
- None of Story 5.2: no "Do it again", no removed-file note, and no change to how a part-way Flashcard set opens (it still opens through FlashcardSession as today).
- No Mistake Review rounds in History, and no search, sorting options, or counts per filter.

**Decisions (Ihor, 2026-11-26):**
- **Copy is approved as proposed.** Type labels: Quiz/Quiz · Flashcards/Treningskort · Chat/Samtale · Summary/Sammendrag.
  - Meta lines: "{c} of {t} correct"/"{c} av {t} riktige" · "{n} cards"/"{n} kort" · "{n} messages"/"{n} meldinger" · "all materials"/"alt materiale".
  - Dates: "Today, {time}"/"I dag, {time}" · "Yesterday"/"I går".
  - Empty-state body: "Chats, quizzes, flashcard sets and summaries you make in this project will show up here." / "Samtaler, quizer, treningskort og sammendrag du lager i dette prosjektet, dukker opp her."
  - Also: "Show more"/"Vis flere" · the filter's accessible name "Filter by type"/"Filtrer etter type".
- **Hide empty chats.** A chat with no messages is not listed, under All or Chats. It stays reachable through "← Back to chat".

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Mixed list | 1 chat, 2 quizzes, 1 set, 1 summary | 5 items, newest first, each with its own fields | N/A |
| Filter | `type=quiz` | Only quizzes | Bad `type` → 422 |
| Pages | 65 items | Pages of 30, 30, 5; no row repeated or skipped, including rows with an equal `created_at` | N/A |
| Unfinished quiz | 10 questions, 3 answered | "Unfinished · 3 of 10" | N/A |
| Chat scoped to a removed file | `material_id` file removed | "{n} messages · all materials" | N/A |
| Empty chat | A chat with 0 messages | Not listed | N/A |
| Read-only Project | Archived or deleted | History lists and opens items | N/A |
| Another Account's Project | Foreign id | `404 not_found` | Inline error with no "Try again" |
| Load fails | Network or 500 | Inline error with "Try again", focused; the filter stays | Retry reloads the current filter |

</frozen-after-approval>

## Code Map

- `backend/app/db/chats.py`, `db/quizzes.py`, `db/flashcards.py`, `db/summaries.py` -- table shapes. `generation_params` holds `topic_labels`, and for a summary also `file_name`. Counts come from `quiz_questions` and `quiz_answers.is_correct`, from `flashcards`, and from `chat_messages`.
- `backend/app/db/history.py` (new) -- the one `UNION ALL` with the per-type subqueries, the keyset predicate `(created_at, id) < (%s, %s)`, and `LIMIT page+1`.
- `backend/app/services/history.py` (new) -- `projects.get` (read, no guard), then maps rows and encodes and decodes the cursor (base64 JSON; a bad cursor → 422 `invalid_request` or the existing validation code).
- `backend/app/api/history.py` (new) + `backend/app/main.py` -- register the router. A GET, so `tests/test_routes_guard.py` needs no entry.
- `backend/app/api/projects.py`, `services/projects.py` -- `projects.get` for the 404 pattern.
- `frontend/src/routes.jsx` -- add `/projects/:projectId/history`.
- `frontend/src/components/ChatBar.jsx` (+ `.module.css`) -- the History link next to `newChat`, matching its style.
- `frontend/src/components/ScopeControl.module.css` -- the segment look to mirror for the filter.
- `frontend/src/pages/SummaryView.jsx`, `QuizPage.module.css` (`activity`, `header`, `back`, `title`, `skeleton`) -- the Activity header and skeleton to reuse.
- `frontend/src/components/InlineError.jsx`, `i18n/errors.js` -- the error state.
- `frontend/src/test/fakeApi.js` -- add a `history` fixture and the `GET /api/projects/{id}/history` route (with filter and cursor). `GET /api/chats/{id}` exists from Story 4.5; reuse it or add it.

## Tasks & Acceptance

**Execution:**
- [x] `backend/app/db/history.py`, `services/history.py`, `api/history.py`, `main.py` -- add the endpoint as bounded above.
- [x] `backend/tests/test_history.py` -- cover every backend row of the matrix: mixed list, filter, three pages with equal timestamps, unfinished counts, the removed-file chat scope, read-only, foreign 404, bad type and bad cursor 422, and the empty-chat rule.
- [x] `frontend/src/pages/History.jsx` (+ `.module.css`), `routes.jsx`, `components/ChatBar.jsx` -- add the page, the link, and the row navigation.
- [x] `frontend/src/i18n/en.json`, `nb.json` -- add the `history.*` keys (approved copy).
- [x] `frontend/src/test/fakeApi.js`, `frontend/src/pages/History.test.jsx` -- cover the link, the filter, loading, empty, error with retry and focus, "Show more", opening each type (a chat via `GET /api/chats/{id}`), read-only, and NB.

**Acceptance Criteria:**
- Given a Project with items, when I select "History", then History replaces the chat with every item newest first, and "← Back to chat" returns to the chat.
- Given a completed Quiz or an ended Flashcard set, when I open its row, then its read-only results show (the Score summary or the end screen).
- Given an earlier chat, when I open its row, then the Project home shows that chat, which I can continue in an active Project.
- Given I come back in a later session, when I open History, then every item is there unchanged. History writes nothing; `last_opened_at` changes only when I open a chat.

## Design Notes

The "Unfinished · {n} of {total}" label lands here because a quiz row needs a status. Resuming already works: QuizPage opens at the first unanswered question. Story 5.2 adds "Do it again", the removed-file rule, and the ended-set rule.

## Verification

**Commands:**
- `npx supabase db reset` -- expected: clean
- `cd backend && LLM_MODE=mock uv run pytest -q` -- expected: all pass
- `cd frontend && npx vitest run --maxWorkers=4 && npm run lint` -- expected: all pass, lint clean

## Implementation Notes

- **Backend:** `db/history.py` composes the `UNION ALL` from only the branches the filter asks for, with a column alias list on the derived table (`h(type, id, …)`) so a single-branch query keeps its names. The keyset predicate is `(created_at, id) < (%s, %s)` with `LIMIT 31`. A chat's title is its first `user` message, and `scope_file_name` comes from a `LEFT JOIN` on a Ready, non-removed `study_materials` row; chats with no messages are excluded by `EXISTS`. `services/history.py` decodes the cursor (urlsafe base64 JSON `{at, id}`, which must be tz-aware) before `projects.get` runs (no guard). A bad cursor returns `422 invalid_request` with `params.fields = ["query.cursor"]`. A bad `type` is a FastAPI `Literal` validation error, which is also `422 invalid_request`. The response is a discriminated union per type.
- **Frontend:** `pages/History.jsx` is a route under AppShell at `/projects/:projectId/history`. The History link is a router `<Link>` in `ChatBar`, right of "New chat", using the same text-action style; `ProjectChat` passes `historyHref`. Date formatting lives in `pages/historyDates.js` (oxlint `only-export-components`). `InlineError` gained an optional `focusRetry` prop, so "Try again" takes focus. A failed "Show more" shows the Inline error, and its Try again retries that page. A failed chat open shows the Inline error without Try again.
- **Copy:** `history.cards` and `history.messages` have `_one`/`_other` plural forms. The singular EN forms ("1 card", "1 message · …") are grammatical variants of the approved copy and were not separately approved. A chat always has at least 2 messages.
- **Known gap:** the Chat bar (and so the History link) only renders once the Project has a Ready file, as before. A Project whose files are all removed or still processing has no way into History from the UI, although `/projects/:id/history` still works.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | VG, Blind | A failed "Show more" and its page-only retry have no test | medium | Pre-verified: the only "Show more" test covers success; dropping `setLoadError` or the `failed.more` branch passes every test | patch |
| 2 | VG, Blind | A failed chat open (Inline error, no Try again, stays on History) has no test | low | Pre-verified: both chat-open tests seed `storedChats`; nothing fails `GET /api/chats/{id}` | patch |
| 3 | Blind, Edge | `hour12: false` can print "24:05" just after midnight | low | Known Intl behaviour (picks h24 in some engines and locales); the fix is a direct swap to `hourCycle: 'h23'` | patch |
| 4 | Blind | The "Loading history" status region is mounted with its text already in it, so it may not be announced | low | History.jsx mounts `<p role="status">` only while loading; a region inserted already filled is often skipped. Fix: keep the region mounted and change only its text | patch |
| 5 | Blind | `aria-busy` on the section also covers the filter | low | `aria-busy={loading}` sits on the `<section>` that holds the filter group; moving it to the rows container is a direct correction | patch |
| 6 | Blind, Edge | Keyboard focus drops to body after "Show more" (the button unmounts on the last page or during a retry) | medium | History.jsx: the button renders only while `shown.next && !failed`; nothing moves focus. Breaks the Accessibility Floor's full Tab path | patch |
| 7 | Blind | No way into History in a Project with no Ready file | medium | The Chat bar renders only once a file is Ready (ProjectChat `enabled`), and the History link lives there, as the frozen intent and DESIGN.md (final) place it. A Project whose files were all removed keeps its items with no UI entry. Placing History elsewhere means amending final UX docs | defer |
| 8 | Blind | The spec and sprint status disagree (in-review vs in-progress) | false | By design: step 05 sets the sprint to `review` after review | reject |
| 9 | Blind | `[ASSUMPTION: copy, approved …]` tags on EXPERIENCE.md are mislabelled and not indexed | false | The project convention since Story 2.6b; 15 such rows exist, none indexed separately | reject |
| 10 | Blind | The singular forms "1 card" / "1 message" aren't in EXPERIENCE.md or the sign-off | low | Real, but these are grammatical variants of approved copy, and "1 message" can't occur (messages come in pairs). Only the user can approve them, so they are surfaced in the summary, not written into the docs | reject |
| 11 | Blind | A chat with a null title shows a blank row | false | Only chats with messages are listed, and every send inserts the user question first (`insert_turn`), so a listed chat always has a first question | reject |
| 12 | Blind, VG, Edge | "Unfinished · 0 of 0" or "0 cards" for an empty quiz or set | false | quiz.py:220 fails the job with `insufficient_material` when no questions survive (flashcards does the same), so no empty artifact is stored | reject |
| 13 | Blind | A chat row can be opened twice by a double click | low | The duplicate `GET /api/chats/{id}` only touches `last_opened_at` again and navigates to the same path; harmless. The fix would add pending state | reject |
| 14 | Blind | The per-row subqueries run over the whole Project before `LIMIT` | low | Real at scale, but V1 Projects are small (a 10-file cap). Restructuring adds complexity for no user-visible gain | reject |
| 15 | Blind | Full first-question text is sent for chat titles | low | Questions are capped at 2,000 characters; at most 30 per page. Negligible | reject |
| 16 | Blind | Backend tests are missing cases (another Project of the same Account, a non-Ready scoped file, a cursor reused across filters, cursor-before-404 order) | low | The query filters on `project_id`, and the Ready check is in the same JOIN as the removal check, which is tested. The cursor order leaks nothing (no data). Unlikely to regress | reject |
| 17 | Blind | Reopened results are checked by URL, not by what renders | low | QuizPage and FlashcardSession tests already cover the summary and end screen on reopen | reject |
| 18 | Blind | The fake API's cursor is an index, not a keyset | low | The keyset is covered by the 65-row backend test; the fake only stands in for paging | reject |
| 19 | Blind | `styles.newChat` is reused for the History link; `historyHref` has no default | low | Cosmetic; ProjectChat is ChatBar's only caller and always passes it | reject |
| 20 | Edge | Switching filters away and back while loading shows the old appended list, which page 1 then replaces | low | Real but harmless: the list refreshes to page 1 | reject |
| 21 | Edge | `topic_labels`, `material_id`, or `file_name` with the wrong type would mangle the title or cause a 500 | false | Unreachable: all three are written only by our services (lists, a pydantic UUID, `material["file_name"]`) | reject |
