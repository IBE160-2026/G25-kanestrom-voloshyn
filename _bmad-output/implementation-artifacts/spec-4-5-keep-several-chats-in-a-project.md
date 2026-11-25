---
title: 'Story 4.5: Keep several chats in a Project'
type: 'feature'
created: '2026-11-25'
status: 'done'
route: 'oneshot'
baseline_commit: 'e9270a1d2999b1da9cf6795705b7b4085eb12343'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A Project has a single chat (Story 4.4). The student can't start a fresh conversation when they change subject, and the Project always reopens its newest chat rather than the one last used (FR-16, AD-25).

**Approach:**
- **New chat:** add a "New chat" button on the right of the Chat bar. It opens a fresh, empty chat ("Ask anything about your material.", scope "All materials"). The previous chat is kept unchanged: its messages, its scope, and its order. The button is disabled exactly when the composer is (no Ready file, archived or deleted, or an answer pending or streaming), and it keeps focus after the click.
- **Reopening:** the Project opens the chat with the latest `last_opened_at`.
- **API:** `POST /api/projects/{id}/chats` (active Project only) creates the chat. If the current chat has no messages yet, the server reuses that chat, reset to "All materials", instead of adding another empty row. `GET /api/chats/{id}` opens any chat of the Account and makes it the last opened, so a chat can be continued (History links to it in Story 5.1).
- **Ordering:** `seq` stays unique per chat and is assigned under the chat lock.
- **Unchanged:** existing copy only ("New chat" / "Ny samtale" and the empty-thread line). There is no chat list, because that is History (Story 5.1).

</frozen-after-approval>

## Implementation Notes

- Backend:
  - `db/chats.latest_for_project` orders by `last_opened_at DESC` (then `created_at`, `id`).
  - `services/chat` gains `new_chat`, which reuses an empty current chat reset to all materials, and `open_chat_by_id`. They share one `_view` that touches `last_opened_at` and renders the thread.
  - Routes: `POST /api/projects/{id}/chats` (`ActiveProject`, 201) and `GET /api/chats/{id}`.
- Frontend:
  - `ChatBar` has the "New chat" button (DESIGN.md › New chat button) and `useChat.newChat`.
  - The button is disabled when the composer is, or while an answer streams.
  - A failure uses the existing Inline error slot under the Chat bar.
  - New `chat.newChat` key ("New chat" / "Ny samtale", already signed off in EXPERIENCE.md).
- Fake API: `POST /api/projects/{id}/chats`, with `earlierChats`.
- Tests: `backend/tests/test_several_chats.py` (6) and `frontend/src/pages/NewChat.test.jsx` (7).
- Review fixes:
  - An empty chat with an answer streaming is never reused.
  - While "New chat" loads, sends and repeat clicks are ignored. The button stays enabled so it keeps focus.
  - A typed draft is kept.
  - The fake API clones earlier chats.
  - Doc comments are updated.
  - New tests: deleted Project refused, busy chat not reused, fallback on open-by-id, reuse in the UI, re-enabled after an answer.
- Verified: pytest 1032/1032; Vitest 970/970 (`--maxWorkers=4`); lint clean.

## Review Triage Log

Pass 1 (2026-11-25, Blind Hunter only; the one-shot route has no edge-case or verification-gap layers).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | `new_chat` has no lock, so a double POST makes two empty chats | false | `projects.require_active` locks the Project row FOR UPDATE first, so concurrent New chats serialize and the second reuses the empty one | reject |
| 2 | An empty chat whose first answer is streaming gets reused, and the turn lands in the "new" chat | medium | `new_chat` checked only `has_messages`; the turn is stored at the stream's end | patch |
| 3 | SPA race: a send or second click during the New chat POST | low | `newChat` had no in-flight guard; a direct fix | patch |
| 4 | New chat wipes the typed draft | low | `setDraft('')`; neither the spec nor EXPERIENCE asks for it; deleting the line keeps input | patch |
| 5 | No screen-reader cue for a new chat | low | focus stays on the button (mock); a cue would need new copy | reject |
| 6 | "Disabled with no Ready file" vs the Chat bar being absent | false | before a Ready file the drop zone replaces the whole chat area (EXPERIENCE › Empty Project), as in Story 4.4 | reject |
| 7 | Stale or duplicated doc comments | low | direct edits | patch |
| 8 | epic-4-context.md allowlist claim | false | the context file is a regenerated cache, not code; the GET routes are reads by the frozen 4.4 rule | reject |
| 9 | History `created_at` vs `last_opened_at` ordering | false | History ordering is Story 5.1's (AD-27); the Project home follows `last_opened_at` as the spine says | reject |
| 10 | Missing backend tests (deleted Project, busy reuse, fallback on open-by-id) | low | direct test additions | patch |
| 11 | Frontend and fake gaps (re-enabled after an answer, reuse path, live object in `earlierChats`) | low | direct test and fake fixes | patch |
| 12 | The spec has no verification section; sign-off row | false | the one-shot template has no such section; "New chat" and the empty line are in the signed Ask AI row | reject |
