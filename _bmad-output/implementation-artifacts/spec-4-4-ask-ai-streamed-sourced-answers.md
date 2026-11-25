---
title: 'Story 4.4: Ask questions about my material and get streamed, sourced answers'
type: 'feature'
created: '2026-11-25'
status: 'done'
baseline_commit: '070fb79b3c73a98970a1cef1fcd1531665bd77af'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Project home shows an empty thread area. The student can't ask questions about their material (FR-16).

**Approach:** Add the Project's chat as the home view. A Chat bar holds the "Answer from" label and the Scope control. Below it are the thread, the composer, and the Limit notice. Each message streams a grounded, sourced answer over SSE (AD-25). Quota is reserved before the stream and released if it fails (AD-12). Nothing is stored unless the answer completes (AD-18).

## Boundaries & Constraints

**Always:**
- **Data (AD-25):**
  - `chats(id, account_id, project_id, current_scope jsonb default {"all_materials": true}, created_at, last_opened_at)`.
  - `chat_messages(id, chat_id, seq, role user|assistant, scope jsonb, text, source_section_ids uuid[], material_ids uuid[], created_at)`, with `UNIQUE(chat_id, seq)`.
  - `chat_messages` is insert-only. Only `current_scope` and `last_opened_at` change on `chats`.
  - Story 4.4 has one chat per Project. `GET /api/projects/{id}/chat` returns it, creating it on first use (a read, so it works in a read-only Project too), with its messages in `seq` order: `{id, current_scope, messages:[{id, role, text, sources:[{label}]}]}`. Story 4.5 adds "New chat".
- **Scope:**
  - `PATCH /api/chats/{id}` `{scope: {"all_materials": true} | {"material_id": M}}` calls `require_active` first, and M must be Ready. Scope is resolved only through `topics.resolve_scope`: `{"all_topics": true}` for all materials, or the `material_id` branch.
  - A chat whose scoped file is no longer Ready falls back to all materials on its next read.
  - Each message stores the scope it was asked under.
- **Send:** `POST /api/chats/{id}/messages` `{text}` (1–2000 characters).
  - Before the stream starts, in transaction 1: `require_active`, then a scope with no Ready material refuses with `422 insufficient_material`, then `usage.reserve("ask_ai_message")` (the limit is 50 a day). These refusals are normal JSON errors: `quota_exceeded`, `project_read_only`, `insufficient_material`, `not_found`. Transaction 1 commits before the stream starts.
  - The stream holds no DB connection, including the request connection. The send route must not keep the per-request `Conn` open while it streams.
  - It returns FastAPI's `EventSourceResponse` with `delta{text}`, then `done{message_id, sources:[{label}]}` or `error{code}`.
  - On success, transaction 2 inserts the user and assistant messages together, with `seq` assigned under a lock on the chat row.
  - On a disconnect, a provider error (`llm_unavailable`), or a mid-stream error chunk: abort the provider call, release the quota against the reserved day, and store nothing.
  - One stream per chat (in-process; there is one instance). A second send returns `409 chat_busy`.
- **Context:**
  - If the scope's `est_tokens` fit the budget, send all of its Sections. Otherwise rank them with `websearch_to_tsquery('simple', question)` against `sections.tsv`, using `ts_rank`, and send the top ones that fit.
  - Prior turns, newest first, are capped at a fifth of the budget.
  - Only `llm/` estimates tokens.
- **Gateway `answer_chat_stream(sections, history, question)`:**
  - It streams raw text deltas, then a final validated `sources` list. Sections are labelled `S1…`, and inline `[S3]`-style labels are mapped back to Section ids.
  - The server strips the labels from the deltas it forwards; a partial label at a chunk edge is held back. The stored text contains no labels, and unknown labels are dropped.
  - The prompt says: use only the supplied material; cite labels; write in the material's main language.
  - **Decision (Ihor, 2026-11-25):** when the material doesn't cover the question, the model says so in its own words, in the material's language, makes no factual claim, and cites nothing. The answer is stored with empty sources and still costs one message. There is no fixed UI string for it.
  - **Mock mode:**
    - It streams a deterministic fixture in chunks, honouring `LLM_MOCK_DELAY_MS`.
    - It cites `S1` (and `S2`) when the question shares a word with the supplied Sections.
    - Otherwise it returns a fixed "not covered" sentence with no sources.
- **UI** (EXPERIENCE.md › Chat bar, Scope control, Chat message, Composer, Limit notice; DESIGN.md › Chat bar, Chat message):
  - The Chat bar has the "Answer from" label and a segmented "All materials" / "One file ▾" control. "One file" opens a list of the Ready files. Once one is chosen, the segment shows its file name.
  - The student's message appears as a bubble on the right. The answer has no bubble: a muted "Study Buddy" label, `body-reading` text, and Source labels.
  - "Study Buddy is thinking…" shows in a polite live region until the first delta. The dots are static under reduced motion. Then the text streams in, with no caret.
  - Send (and Enter) is disabled until the answer completes, and while there is no Ready file or the Project is read-only. Shift+Enter makes a new line.
  - When the answer completes, it is announced once ("Answer ready" plus the text).
  - "{n} messages left today" shows under the composer at 10 or fewer, using a new `messages_left_today` field in `GET /api/usage`.
  - At the limit, the error-coloured "Chat, message limit reached" message replaces the notice.
  - A failed stream removes the pending answer, puts the question back in the composer, and shows the Inline error with "Try again", which resends it.
  - "Study this material" labels the tool buttons row.
- **Decision (Ihor, 2026-11-25):** new copy approved: "Answer from" / "Svar fra" (also the Scope control's accessible name) and "Study this material" / "Studer dette materialet". The orchestrator writes the EXPERIENCE.md rows, the sign-off row (Ihor [x], Cristoffer [ ]) and the memlog entry. Every other string comes from EXPERIENCE.md, and the composer placeholder is "Ask about your material".
- **Decision (Ihor, 2026-11-25):** keep the full spec. It is one cohesive goal and over the token guideline.

**Never:**
- "New chat", a list of chats, or `last_opened_at` routing (Story 4.5).
- A History link (Epic 5).
- Embeddings or pgvector.
- Storing a failed or partial answer.
- An LLM call inside an open write transaction.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Covered question | Ready file; the question matches it | `delta`… then `done{message_id, sources ≥ 1}`; two messages stored; one unit used | — |
| Not covered | A question outside `test-data/photosynthesis-notes.md` | A "not covered" answer with empty sources; stored; one unit used | — |
| One file | scope `{material_id: M}` | Context only from M; later sends stay on M until broadened | — |
| Too big for the budget | the scope's tokens exceed the budget | Only the top FTS-ranked Sections that fit are sent | — |
| 51st today | 50 units already used | Nothing streamed or stored | `429 quota_exceeded`; the limit message |
| Provider error | error before or mid-stream | `error{llm_unavailable}`; nothing stored; unit released | Inline error + "Try again" |
| Disconnect | the client aborts mid-stream | Provider call aborted; nothing stored; unit released | — |
| Busy | a second send while streaming | Nothing reserved | `409 chat_busy` |
| Read-only | archived or deleted Project | Thread readable; send and scope change refused | `409 project_read_only` |
| No Ready file | none Ready | Composer disabled | `422 insufficient_material` |
| Foreign | another Account's chat | — | `404 not_found` |

</frozen-after-approval>

## Code Map

- `backend/app/services/usage.py` -- `LIMITS`; add `ASK_AI_MESSAGE = "ask_ai_message"` with 50. `reserve`/`remaining`/`release` already exist. `api/usage.py` -- add `messages_left_today`.
- `backend/app/api/conn.py::request_conn` -- the per-request connection. `app/auth.py` uses it, so `UserAuth` holds a connection. The send route needs auth plus transaction 1 on a short connection that is returned before the stream (e.g. its own `pool.connection()` blocks, and an auth variant that releases).
- `backend/app/services/topics.py::resolve_scope` -- `all_topics` and the `material_id` branch (Story 4.3). `db/topics.py` scope queries; `sections.tsv` is `to_tsvector('simple', text)` (migration `20261117120000`).
- `backend/app/llm/gateway.py` -- `label_sections`, `estimate_tokens`, `mock_pause`, and `_live`'s client and `extra_body` settings. `llm/errors.py` -- `ProviderError` family; add `ProviderStreamError`. `llm/fixtures.py`, `llm/prompts/`.
- `backend/app/db/sections.py::source_labels` -- the labels.
- `backend/app/api/deps.py::ActiveProject`, `services/projects.require_active`, `test_routes_guard.py` -- guard every mutating route.
- `frontend/src/api/client.js::apiFetch` -- auth headers and error shape. The stream needs a `fetch` + ReadableStream SSE reader that adds the same headers.
- `frontend/src/pages/ProjectHome.jsx` (~lines 288-380) -- replace the empty `.thread` div. Keep the notices, the Mistakes card, the drop zone, and the tools row with its rules (`!ready || !anyReady || readOnly`).
- `frontend/src/components/InlineError.jsx`, `i18n/errors.js` -- errors. `test/fakeApi.js` -- add the chat routes and a fake SSE stream.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/20261125120000_chats.sql` -- `chats` and `chat_messages` as above. Indexes: `chats(project_id)`, `chat_messages(chat_id, seq)`. RLS on; revoke `anon` and `authenticated`.
- [x] `backend/app/llm/*` -- `answer_chat_stream`, label stripping and mapping, `ProviderStreamError`, the mock fixture, and `prompts/answer_chat.md`.
- [x] `backend/app/services/chat.py`, `db/chats.py`, `api/chats.py` -- get-or-create, scope `PATCH`, and send (transaction 1, stream, transaction 2 or release), the context picker, and the busy set. Register in `main.py`. `services/usage.py`, `api/usage.py`.
- [x] `backend/tests/test_chat.py` -- every matrix row; the "not covered" case against `test-data/photosynthesis-notes.md` (uploaded through the normal path); labels stripped from deltas and stored text; no pool connection checked out during the stream; FTS selection over budget; scope persistence and fallback; the browser-key lockout for both tables; the route guard.
- [x] `frontend/src/` -- the SSE reader (`api/stream.js`), the chat column components (Chat bar, Scope control with the file list, thread, message, composer, Limit notice), the ProjectHome wiring, i18n keys, and fakeApi.
- [x] `EXPERIENCE.md`, `norwegian-strings-signoff.md`, UX `.memlog.md` -- the approved strings (written by the orchestrator).
- [x] `frontend/src/**/*.test.jsx` -- streaming render; "thinking" until the first delta; Send disabled while streaming; announce once; sources; the not-covered answer with no sources; the scope switch and its persistence after a reload; the limit notice at 10 and the message at 0; a failed stream restores the question and "Try again" resends it; read-only and no-Ready-file disabled states; Enter and Shift+Enter; Norwegian.

**Acceptance Criteria:**
- Given an active Project with a Ready file, when it opens, then the chat is the home view, with the Chat bar ("Answer from", "All materials" selected), the thread, the tool buttons, and an enabled composer.
- Given a send, when the first `delta` arrives, then "Study Buddy is thinking…" is replaced by the streaming text, and Send stays disabled until `done` or `error`.
- Given a reload after a successful answer, when the chat opens, then both messages show with the answer's Source labels and the chat's scope as it was left.

## Design Notes

Holding back labels: keep any trailing `[`, `[S`, `[S12` fragment until the next chunk shows whether it closes. Emit the text with complete `[Sn]` labels (and their leading space) removed. Collect `n` for the sources.

Each send's lifecycle in `services/chat`:
1. `async with pool.connection()`: transaction 1 (guard, scope, reserve), then commit.
2. The generator streams with no connection held.
3. In `finally`: on success, run transaction 2 (insert both messages). Otherwise run a release transaction.

`request.is_disconnected()` or generator cancellation counts as abandoned.

## Verification

**Commands:**
- `cd backend && LLM_MODE=mock uv run pytest -q` -- expected: all pass
- `cd frontend && npx vitest run && npm run lint` -- expected: all pass, lint clean
- `npx supabase db reset` -- expected: the new migration applies

## Implementation Notes

- **Route guard:** the chat routes carry no Project id, so `ActiveProject` can't guard them. `PATCH /api/chats/{id}` takes the new `deps.ActiveChat` (chat owned, Project active, no lock), then the service calls `require_active`. The send is guarded by its `chats.prepared_send` dependency, whose transaction 1 calls `require_active`. `test_routes_guard.py` now accepts any of `{active_project, active_chat, prepared_send}`.
- **No connection during the stream:** the send route takes `ReleasedUserAuth` and never `Conn`. Transaction 1 runs inside the `prepared_send` yield dependency, so every refusal is an ordinary JSON error before any byte is streamed. The dependency's teardown runs `chat.abandon` (idempotent). It releases the unit and frees the chat, even when the stream never started. The generator's `finally`, the provider-stream close, and transaction 2 are shielded from cancellation, and `settled` is set only after the commit. A disconnect noticed after the last words, before the save, stores nothing.
- **Context budget:** earlier turns are taken as whole question-and-answer pairs, newest first, within `budget // 5`. The Sections get the budget minus the system prompt and question (`llm.chat_overhead_tokens`) and minus the tokens those turns actually used. If not even the top-ranked Section fits alone, it is sent cut to the room left (`llm.fit_tokens`).
- **Mock chat:** a question "shares a word" when it has a word of 5 or more letters, outside a small stopword list, that is also in a Section. The fixture cites `S1` (and `S2`) literally, as the spec says, and is streamed in 12-character chunks, so labels split across chunks.
- **Stream outcomes:** every path ends with an event. An answer empty after stripping, or any gateway error, is `error{llm_unavailable}`. A transaction-2 failure or an unexpected error is `error{internal_error}`. A chat deleted mid-stream is `error{not_found}`, and a Project deleted mid-stream is `error{project_read_only}` (an archived one still saves, as jobs do, AD-20). Each releases the unit and stores nothing. Live answers are capped at `max_tokens=1500` and a 60 s stream deadline; a raw `httpx2.HTTPError` mid-stream is a `ProviderStreamError`.
- **Composer while streaming:** the whole composer (text field and Send) is off while an answer is pending or streaming, as EXPERIENCE.md › Composer says; focus returns to the field when the answer ends, and a failed answer puts the question back. Refusals that retrying can't fix (`project_read_only`, `insufficient_material`, `not_found`, `chat_busy`, `quota_exceeded`) show their message without "Try again".
- **Strings:** an empty thread uses EXPERIENCE.md's "New chat, empty thread" row ("Ask anything about your material."). `chat_busy` has no Strings row, so it renders the generic error. Send is off while streaming, so it is practically unreachable. A scoped file that is no longer Ready shows as "All materials". The Limit notice is a plain line, not a live region, so only the answer is announced, once per answer, even when two answers have the same text.
- **Frontend suite:** under the full parallel `npx vitest run`, a few unrelated tests time out intermittently (`ForgotPassword`, `Settings`, `LinkGoogle`, `Projects`, `RemoveFile`). They pass in isolation, and the baseline commit `070fb79` fails the same way.

- Verified after review pass 1: pytest 1023/1023; Vitest 962/962 (with `--maxWorkers=4`; full-parallel runs hit the known timeout flakes in unrelated files, which pass alone); lint clean; `npx supabase db reset` OK.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-11-25): Blind Hunter (BH), Edge Case Hunter (EC), Verification Gap (VG).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | BH/EC: `_save` not shielded, so a disconnect at commit stores the turn and releases the unit; a disconnect after the last item still stores | medium | `abandon` is shielded, `_save` isn't; `settled` is set after commit; there's no disconnect check after the loop | patch |
| 2 | BH/EC: the Section budget ignores the prompt and question; one oversized top Section sends nothing | medium | `pick_context(..., budget - history_tokens)`; an empty pick gives "not covered" and costs a unit | patch |
| 3 | BH: history can keep an answer without its question | low | `_history` stops per message, newest first; the fix is to take pairs | patch |
| 4 | EC: a Project deleted mid-stream still gets messages | medium | `_save` doesn't recheck the Project; jobs abort on deletion (AD-20) | patch |
| 5 | EC: non-Provider exceptions and raw httpx errors cut the stream with no `error` event | medium | only `except ProviderError` exists in `stream`; `_live_stream` doesn't wrap `httpx.HTTPError` | patch |
| 6 | BH: no `max_tokens` or overall stream deadline | medium | the SDK timeout limits gaps only; a runaway answer holds `_busy` | patch |
| 7 | BH: `\s?` before a label swallows newlines | medium | `"list:\n[S1] item"` merges lines | patch |
| 8 | VG: settle paths (empty answer, save failure, chat gone) and teardown release are untested | medium (pre-verified gap) | no test drives those branches | patch |
| 9 | VG: the history cap is unpinned | medium (pre-verified gap) | the default 100k budget never hits the cap | patch |
| 10 | VG: real `apiFetch` raw/signal/abort is untested | medium (pre-verified gap) | every chat test mocks `apiFetch` | patch |
| 11 | VG: abort on unmount or Project switch is untested | medium (pre-verified gap) | `state.aborted` is never asserted | patch |
| 12 | BH: the text field stays editable while streaming | medium | EXPERIENCE.md › Composer (final): the composer is disabled while pending or streaming | patch |
| 13 | BH: "Try again" offered for non-retryable refusals | medium | every code lands in `failure` with a retry | patch |
| 14 | EC/BH: a scoped file gone from Ready shows "One file" while the server uses all; `aria-pressed` on the menu trigger | medium | `ScopeControl` trusts `current_scope`; Radix already sets the menu ARIA | patch |
| 15 | EC: identical consecutive answers aren't re-announced; the Limit notice live region competes | low | the same text in the live region doesn't re-announce; the notice is `role="status"` | patch |
| 16 | BH: other citation formats (`[S1–S3]`, `(S1)`) leak | low | the prompt asks for `[Sn]`; supporting more variants adds parsing | reject |
| 17 | BH: GET creates or updates chats in read-only Projects | false | the frozen spec: get-or-create is a read that works in a read-only Project; it's bookkeeping, not content | reject |
| 18 | BH: the limit message hard-codes 50; `errors.quota_exceeded` mentions images | low | approved EXPERIENCE copy says 50; the chat uses its own string | reject |
| 19 | BH: no catalogue text for `chat_busy` / `aborted` | low | Send is disabled while streaming; `aborted` is client-only and never shown | reject |
| 20 | BH: the local question gets a made-up id | low | it only affects React keys until reload; adding `question_id` changes the AD-25 `done` shape | reject |
| 21 | EC: `done` with unparseable data | false | the server always serializes `done` with `message_id` | reject |
| 22 | EC: the fit check uses budget minus history (claim) | low | the budget must include history; consistent after #2 | reject |
| 23 | BH: sprint status vs spec status; empty logs | false | step-05 sets the sprint entry to `review`; logs are filled by this pass | reject |
| 24 | BH: real disconnects untested | low | covered by #1 and #8 tests with forced cancellation; a uvicorn-level test is out of reach of the suite | reject |
