# Epic 4 Context: Flashcards, summaries, and Ask AI

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give the student three more ways to study their own material: flashcard sets for quick recall (flip, "Got it" / "Not yet", with no Mistakes and no scheduling), a summary of one file or one of its Topics, and the Project's grounded chat (Ask AI). The chat is the Project home, a Project can hold several chats, and answers stream in with sources. Flashcards and summaries reuse Epic 3's scope resolver, source labels, and generation-job lifecycle. Ask AI adds the app's only streaming path and the daily message quota.

## Stories

- Story 4.1: Generate a flashcard set
- Story 4.2: Study a flashcard set
- Story 4.3: Summarize a file or one of its Topics
- Story 4.4: Ask questions about my material and get streamed, sourced answers
- Story 4.5: Keep several chats in a Project

## Requirements & Constraints

- **Flashcard generation:** 5, 10, or 20 cards (default 10) from "All topics" or chosen Topics, capped at 20 on the server. Capacity and the "only {n} were possible" result work exactly as for the Quiz. Each card has a question, an answer, and cited Sections.
- **Flashcard study:** one card at a time. "Not yet" brings the card back later in the same set until it is marked "Got it". Flashcards never create a Mistake. There is no score, streak, due date, or spaced repetition. The end screen shows only the cards done and how many needed a second try. A set left part-way is recorded as ended and can't be resumed.
- **Summary:** covers exactly one Ready file, either whole or narrowed to one of its Topics. Each section names its source, nothing is claimed that isn't in the file, and it is written in the material's main language.
- **Ask AI:** the first words appear within 5 s and the answer is complete within 15 s. Answers are grounded only in the chat's current scope ("All materials" or one file), and narrowing to one file persists for that chat until broadened. When the material doesn't cover a question, the chat says so, makes no factual claim, and still uses one message.
- **Message quota:** 50 messages per Account per day, across all chats and Projects. A notice shows when 10 or fewer are left, and the 51st message is declined clearly. A failed or abandoned answer costs nothing and stores nothing.
- **Several chats:** "New chat" starts an empty chat and keeps the old one unchanged. On return, the Project opens the chat last used. Chats persist across sessions.
- **Generation performance:** flashcard and summary generation each finish within 60 s for one lecture-deck-sized upload.
- **Test mode:** everything above runs with no AI key, including streaming, the "not covered" answer (a deterministic fixture plus a test against a `test-data/` document), progress, cancel, and failure.

## Technical Decisions

- **Scope:** Flashcards accept `{"topic_ids": [...]}` or `{"all_topics": true}`. Summarize accepts `{"material_id", "topic_id": null|…}`. Chat accepts `{"material_id": null|…}`. Resolve every scope only through `topics.resolve_scope`. For Flashcards and Summarize, the result (count, `section_ids`, `topic_labels`) is frozen into the job `params` and the artifact's `generation_params`. If `est_tokens` exceeds `LLM_CONTEXT_BUDGET_TOKENS`, return `scope_too_large`. `max_cards` comes from the existing capacity endpoint.
- **Gateway tasks:** `generate_flashcards` and `summarize` return Pydantic models, with one retry and then `LLMOutputError`. Uncited items are dropped, zero items is an error, and fewer than requested is valid. `answer_chat_stream` is the one raw-text task: it yields text deltas, then a validated `sources` list. Only `llm/` imports `openai`. Mock fixtures cite `S1…` labels, the chat fixture streams in chunks, and `LLM_MOCK_DELAY_MS` exercises progress, cancel, and streaming.
- **Provenance:** every card, summary section, and chat answer stores `source_section_ids` and the `material_ids` derived from them. Source labels read "file · slide/page".
- **Jobs:** the `flashcards` and `summary` kinds run through the existing `services/jobs` runner. A request returns `202 {job_id}` and `progress_step` moves `reading` → `writing` → `checking`. Handlers return save plans and never write job rows. The locked save transaction aborts on cancel, on a deleted Project, or when a cited Material has been removed. It doesn't call `require_active`. Failure keeps `params`, and Retry creates a new job.
- **Immutability:** Flashcard Sets, Cards, Summaries and their sections, Chat Messages, and Flashcard marks are insert-only. The only mutable columns are `flashcard_sets.ended_at` and `chats.current_scope` / `last_opened_at`.
- **Ending a set:** `ended_at` is set when the student opens another set, or lazily on the next read once no mark has been added for 30 minutes. "Needed a second try" counts cards marked more than once.
- **Chat data:** `chats(id, project_id, current_scope, created_at, last_opened_at)` and `chat_messages(id, chat_id, seq, role, scope, text, source_section_ids)` with `UNIQUE(chat_id, seq)`. `seq` is assigned under a lock on the chat row.
- **Streaming:** `POST /api/chats/{id}/messages` returns an `EventSourceResponse` that sends `delta{text}`, then `done{message_id, sources}` or `error{code}`. The SPA reads it with `fetch` and a ReadableStream. Inline citation labels are mapped and validated at the end, then stripped from the stored text. Only one stream runs per chat, and a second send returns `409 chat_busy`.
- **Stream transactions:** (1) reserve quota in transaction 1, (2) stream with no DB connection held, (3) insert the user and assistant messages together in transaction 2, only on success. A disconnect, a provider error, or a mid-stream error chunk aborts the provider call, releases the quota against the reserved `usage_day`, and stores nothing.
- **Chat context:** if the scope fits the budget, send all of it. Otherwise rank its Sections by Postgres full-text search (`tsvector`) and send the top ones that fit. Prior turns are capped by the budget. V1 has no embeddings or pgvector.
- **Quota:** only `services/usage` touches counters. `reserve("ask_ai_message")` is an atomic upsert that raises `QuotaExceeded` (mapped to `quota_exceeded`). `remaining()` drives the notice. The day is calculated in `QUOTA_TIMEZONE`.
- **Read-only guard:** generation, flashcard marks, and sending chat messages call `projects.require_active` first (`409 project_read_only`).
- **Error codes:** `scope_too_large`, `insufficient_material`, `material_removed`, `quota_exceeded`, `chat_busy`, `project_read_only`, `generation_cancelled`, `interrupted`, `llm_unavailable`, `llm_output_invalid`.
- **Placement:** Flashcards go in `services/flashcards`, summaries in `services/summaries`, and chat in `services/chat`. REST paths are plural nouns nested under the Project.

## UX & Interaction Patterns

- **Tool buttons:** Story 4.1 adds Flashcards and Story 4.3 adds Summarize to the tool buttons row, next to Quiz. The buttons and the composer are disabled until a file is Ready and while the Project is archived or deleted.
- **Flashcards setup:** Topic scope picker, Count picker, and the "Make {n} cards" button. The Too-little-material note disables the button until the count fits.
- **Flashcards copy (Story 4.1, approved):** setup heading "Make flashcards"; failure "We couldn't make the flashcards." + "Try again"; finish notice "Your flashcards on {topic} are ready · Open", with {topic} joined as for the Quiz.
- **Generation progress:** a spinner with a rotating status line plus the real step "Step {n} of {total} · {label}" ("Reading your material → Writing cards → Checking sources"; the summary variant says "Writing the summary"), with Cancel. Screen readers hear only the real step. Cancel returns to setup with choices kept, failure shows an Inline error with choices kept, and leaving shows the "… is ready · Open" finish notice.
- **Flashcard session:** shows "{n} of {total}" with a Progress bar. Space or a click flips the card to show the answer and its Source label, → is "Got it", and ← is "Not yet". "Stop for now" is always available. The flip uses subtle motion, which is instant under reduced motion. Keyboard shortcuts work on desktop only and are off while focus is in a text input.
- **Flashcard front:** overline "Term" and "Click to flip" with the Space key hint (NB "Begrep" / "Klikk for å snu").
- **Flashcard end screen:** "{n} cards done. {m} needed a second try" (singular "1 card done"), with "Make more cards" (primary) and "← Back to chat". Results stay factual: no score, streak, due date, or "next review" wording. Actions read "Got it" / "Not yet" / "Stop for now" (NB "Kan det" / "Ikke ennå" / "Stopp for nå"); keys are language-independent.
- **Summarize setup:** pick exactly one file, then optionally a Topic ("Whole file" is the default, the Topic choices follow the file, and the Topic row reuses the Topic list's grouping and collapse rules). There is no Count picker, and nothing generates until "Make summary". Radio groups use arrow keys, and Tab leaves the group. Failure shows the Inline error with both choices kept. Generation continues if the student leaves.
- **Summarize copy (signed off EN/NB):** tool button "Summarize" / "Oppsummer"; setup "Make a summary" · "Which file?" · "Narrow to one topic (optional)" · "Whole file" · "Make summary" (NB "Lag et sammendrag" · "Hvilken fil?" · "Begrens til ett emne (valgfritt)" · "Hele filen" · "Lag sammendrag"); steps NB "Leser materialet ditt → Skriver sammendraget → Sjekker kildene"; end line "Saved to History" / "Lagret i historikken". The Strings table has no summary-specific failure message or finish notice yet (Flashcards and Quiz have their own), so any Story 4.3 additions need recording in EXPERIENCE.md Strings and a new row in the Norwegian sign-off file.
- **Summary view:** a calm, spacious reading screen with a Source label on each section, ending with "Saved to History" and "← Back to chat". Composition reference is `mockups/key-summary.html` (setup, view, generating, error).
- **Chat home:** the Chat bar has the Scope control ("All materials" / "One file") on the left and New chat plus the History link on the right. A new chat shows "Ask anything about your material." The pending answer shows "Study Buddy is thinking…" with dots that don't animate under reduced motion, then streams into place. Send stays disabled until the answer completes.
- **Message limit:** with 10 or fewer messages left, "{n} messages left today" shows under the composer. At 0 the message is declined with an error-coloured message.
- **Accessibility:** the pending answer uses a polite live region. A streamed answer is announced once, when it is complete. Inline errors are alerts.
- **Wording:** "Flashcards" is "Treningskort" in Norwegian (also for "cards"), "Summary" is "Sammendrag", and "Chat" is "Samtale". The signed-off EN/NB strings go in `en.json` and `nb.json`, with singular and plural forms. The Story 4.1 additions (setup heading, failure, finish notice) and the Story 4.2 Flashcard front copy are approved by Ihor but still await Cristoffer's Norwegian sign-off.

## Cross-Story Dependencies

- **Epic 3:** Stories 4.1 and 4.3 reuse Story 3.1's generation lifecycle (jobs, polling, progress, cancel, failure, finish notice) and the Topic scope picker, Count picker, capacity, and Too-little-material components.
- **Epic 2 only:** Stories 4.4–4.5 need only Epic 2 (Ready Materials, Sections with `tsvector`, the gateway with mock mode, `require_active`), so they can run in parallel with Epic 3.
- **Within this epic:** Story 4.2 (done) builds on 4.1 and replaced its interim set-ready page with the study session. Story 4.3 is independent of the flashcard stories but follows the same generation pattern. Story 4.5 builds on 4.4's chats and messages.
- **Epic 5:** History lists flashcard sets, summaries, and each chat. It relies on `ended_at` and the frozen `generation_params` for "Do it again", and lists earlier chats (Story 5.1).
