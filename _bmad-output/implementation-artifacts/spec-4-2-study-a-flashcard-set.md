---
title: 'Story 4.2: Study a flashcard set'
type: 'feature'
created: '2026-11-23'
status: 'done'
baseline_commit: 'ffc9bb2e9663c763dbfa6c9631f05f68489a32ba'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 4.1 makes a flashcard set but only opens a "ready" page; the student can't study the cards (FR-14).

**Approach:** Replace the ready page with a study session: one card at a time, flip to see the answer and its Source label, "Got it" / "Not yet". "Not yet" cards return later, marks are saved insert-only, and the set ends with "{n} cards done. {m} needed a second try". A set left part-way is ended lazily and not resumable.

## Boundaries & Constraints

**Always:**
- Marks are insert-only rows (`flashcard_marks`); the only mutable column stays `flashcard_sets.ended_at` (AD-8, AD-27).
- A mark calls `projects.require_active` first (AD-22). No Mistake is ever written; `services/flashcards` never calls `services/mistakes` (AD-10).
- The server owns session state. From the marks it derives: `done` (cards with "Got it"), the `queue` of remaining cards, and `second_try` (cards with at least one "Not yet"). The queue is unmarked cards by `position`, then "Not yet" cards by their latest "Not yet" mark, oldest first. A reload while the set is open resumes the same state.
- Ending a set: when a read or mark finds a set with no `ended_at`, at least one mark, and the last mark older than 30 minutes, it sets `ended_at = now()`. Opening set X sets `ended_at` on the Account's other open sets that have at least one mark. The final "Got it" sets `ended_at` in the same transaction. A set with no marks is never ended.
- Existing copy only, from EXPERIENCE.md: "{n} of {total}", "Got it" / "Not yet" / "Stop for now", the end screen, "Make more cards", "← Back to chat", and `flashcards.fewer`. Key hints on desktop only (`@media (hover: none)` hides them). Keys are off while focus is in a text input or a modifier key is held.
- The flip uses subtle motion only under `prefers-reduced-motion: no-preference`, and is instant otherwise. Styles use only `var(--…)` tokens.

- **Decision (Ihor, 2026-11-23):** new card-front copy approved: "Term" / "Begrep" overline and "Click to flip" / "Klikk for å snu" with the Space key hint (DESIGN.md › Flashcard). Add both to EXPERIENCE.md (approved by Ihor with Story 4.2), add a `norwegian-strings-signoff.md` row with Ihor [x] and Cristoffer [ ], and add both strings to `en.json` / `nb.json`. Back of the card: the question small and muted, then the answer and its Source labels.
- **Decision (Ihor, 2026-11-23):** keep the full spec. It is one cohesive goal and over the token guideline.

**Never:** scores, streaks, due dates, spaced repetition, or "next review" language. No restudying an ended set (that is Epic 5's "Do it again"). No History list. No model calls.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open a fresh set | GET, no marks | Cards with `sources: [{label}]`; `queue` = all ids by position; `ended_at` null | — |
| Not yet | POST mark `not_yet` on card A | Row inserted; A moves to the end of `queue`; A counts in `second_try` | — |
| Got it | POST mark `got_it` | A leaves `queue` and is counted in `done` | — |
| Repeat Got it | `got_it` on a card already done | No new row; current state returned | — |
| Last card known | final `got_it` | `queue` empty, `ended_at` set → end screen | — |
| Idle 30 min | read or mark; last mark > 30 min ago | `ended_at` set; a mark then returns `409 flashcard_set_ended` | Client reloads and shows the end screen |
| Open another set | GET set Y while X has marks and is open | X gets `ended_at`; Y unaffected | — |
| Ended set opened | GET, `ended_at` set | End screen with what was done (`done` count, `second_try` count) | — |
| Read-only Project | mark on an archived or deleted Project | `409 project_read_only` | Cards open and flip; mark buttons disabled |
| Foreign or missing | other Account's set, or a card from another set | `404 not_found` | Inline error, no "Try again" |
| Save fails | network or 5xx | Card stays and the state is unchanged | Inline error with "Try again" |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20261119180000_flashcards.sql` -- defines `flashcard_sets` (with `ended_at`) and `flashcards`. Don't edit it; add a new migration.
- `backend/app/services/flashcards.py` -- `get()` (extend), `FlashcardSetNotFound`. Keep 4.1's generation code unchanged.
- `backend/app/db/flashcards.py` -- `get()`; add the card, mark, and end queries here.
- `backend/app/api/flashcards.py` -- GET route (extend the response); add the mark route. Use `ActiveProject` for the mark, as `api/review.py::answer_item` does.
- `backend/app/db/sections.py::source_labels` -- labels in the form "file · label"; reuse as `services/quiz.get` does.
- `backend/app/services/projects.py::require_active` -- locks the Project row.
- `backend/app/errors.py` -- the `AppError` pattern; add `flashcard_set_ended` (409).
- `frontend/src/pages/FlashcardSetReady.jsx` -- replace with `FlashcardSession.jsx`. Copy its load, error and redirect pattern.
- `frontend/src/pages/QuizPage.jsx`, `components/QuestionView.jsx` -- patterns for the activity header, progress bar, save errors, read-only handling, the keyboard guard (`TEXT_INPUT`, modifier keys) and Key hint CSS.
- `frontend/src/routes.jsx:43` -- point the route at the session.
- `frontend/src/pages/FlashcardSetup.test.jsx` -- the three ready-page tests move to the new session tests.
- `frontend/src/test/fakeApi.js` -- add the mark endpoint.
- `frontend/src/i18n/en.json`, `nb.json` -- add `flashcards.session.*`; remove `flashcards.ready_*` (that page is gone).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/20261123120000_flashcard_marks.sql` -- `flashcard_marks(id bigint identity, set_id → flashcard_sets cascade, card_id → flashcards cascade, mark text check in ('got_it','not_yet'), created_at)`, a partial unique index on `(card_id) where mark='got_it'`, and an index on `(set_id, id)`. RLS on; revoke `anon` and `authenticated`.
- [x] `backend/app/db/flashcards.py` -- cards, marks, insert mark, end idle and other sets. Plain SQL, scoped by `account_id`.
- [x] `backend/app/services/flashcards.py` -- `session(cards, marks)` is pure and returns `queue`, `done`, `second_try`. `get()` applies the end rules, then returns the set plus cards with labels plus the session. `mark()` runs: `require_active` → lock the set → idle check → `409 flashcard_set_ended` if ended → card must belong to the set (`404`) → insert unless it repeats a "Got it" → end the set on the last card.
- [x] `backend/app/api/flashcards.py` -- GET returns `{id, requested_count, card_count, ended_at, cards:[{id, position, question, answer, sources:[{label}]}], queue, done_count, second_try_count}`. `POST …/flashcard-sets/{set_id}/cards/{card_id}/mark` `{mark}` returns the same shape. Update the module docstring.
- [x] `backend/tests/test_flashcard_study.py` -- every matrix row, the pure `session()` ordering, that no Mistake rows are created, the 30-minute end with a controlled clock (backdate `created_at` in SQL), and `test_routes_guard.py` for the mark route.
- [x] `frontend/src/pages/FlashcardSession.jsx` + `.module.css` -- session, flip, marks, end screen, read-only, errors, keys, focus.
- [x] `frontend/src/routes.jsx`, `fakeApi.js`, i18n -- wire it up; delete `FlashcardSetReady.jsx`.
- [x] `EXPERIENCE.md`, `norwegian-strings-signoff.md` -- the two approved strings (see Decision). Add the EXPERIENCE row and the UX `.memlog.md` decision entry with `uv run _bmad/scripts/memlog.py append`.
- [x] `frontend/src/pages/FlashcardSession.test.jsx` -- flip by click and by Space; → and ←; requeue; end screen counts; an ended set opens on the end screen; `409 flashcard_set_ended` reloads; read-only; save error and "Try again"; keys ignored in a text input; the fewer note; "Make more cards" navigation.

**Acceptance Criteria:**
- Given a set opens, when the first card shows, then "1 of {total}" and a progress bar show, and a set with fewer cards than asked shows the `flashcards.fewer` note.
- Given the card is flipped, when the student presses → or clicks "Got it", then the next card in `queue` shows and focus moves to it. "Got it" and "Not yet" appear only once the card is flipped.
- Given the set ends, then "{n} cards done. {m} needed a second try" shows with "Make more cards" (primary, opens Flashcards setup) and "← Back to chat".
- Given "Stop for now" or "← Back to chat" part-way, then the student returns to the chat and nothing is written.

## Design Notes

"{n} of {total}": `n` = `done_count + 1` while cards remain, `total` = `card_count`. The progress bar fills with `done_count / card_count`. Saving a mark waits for the server, as the Quiz does, so the queue never diverges from the stored marks. The answer side is a polite live region, so flipping announces it once.

## Verification

**Commands:**
- `cd backend && LLM_MODE=mock uv run pytest -q` -- expected: all pass
- `cd frontend && npx vitest run && npm run lint` -- expected: all pass, lint clean
- `npx supabase db reset` -- expected: the new migration applies

## Implementation Notes

- The EXPERIENCE.md row, the sign-off row and the UX .memlog entry were written by the orchestrating session before dispatch, as Ihor approved.
- When a mark finds a set idle, the 409 is returned rather than raised (`api/flashcards.mark_card`), so the request transaction still commits `ended_at`. `FlashcardSetEnded` is defined in `services/flashcards`, like other service errors. It has no catalogue text because the client reloads instead of showing it.
- Any mark on a card already "Got it" saves nothing, including "Not yet". Opening any set, even an ended one, ends the Account's other open marked sets in every Project.
- `flashcards.session.spaceKey` reads "Space" in both catalogues (EXPERIENCE.md: "Flashcard keys are language-independent").
- Review fixes: one persistent, visually hidden live region outside the card; "Try again" works from either side of the card; key repeat and Space are ignored while a save runs; `lock_open` locks the Account's open sets plus this one in id order, so `get` and `mark` lock in the same order; a plain `card_id` index is added.
- Verified: pytest 916/916; Vitest 900/900; lint clean; db reset OK. `DeleteAccount.test.jsx` failed once under full load (pre-existing flake), then passed on its own and on a full rerun.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-11-23): Blind Hunter (BH), Edge Case Hunter (EC), Verification Gap (VG).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | BH/EC: answer live region re-keyed on flip and nested in the card button, so it may not announce | medium | `role="status"` sits inside `<span key={flipped…}>` inside `<button>`; it mounts already filled, and a button's children are presentational | patch |
| 2 | BH: progress line `aria-live` announces on every mark | low | `aria-live="polite"` on the "{n} of {total}" line; the fix is deleting one attribute | patch |
| 3 | EC: "Try again" does nothing after flipping back; Space unflips during a save | medium | `submit` returns early when `!flipped`; the Space handler doesn't check `saving` | patch |
| 4 | BH/EC: key auto-repeat flips repeatedly and can mark the next card | low | the keydown handler doesn't check `event.repeat`; one-line fix | patch |
| 5 | BH/EC: concurrent GETs deadlock (end_others + end_if_idle, no lock order); idle end races a mark | medium | GET X updates Y while GET Y updates X, then each updates its own row → opposite lock order; only `mark` locks | patch |
| 6 | BH: no plain `card_id` index for the cascade | low | only the partial `got_it` index covers `card_id`; a direct one-index fix | patch |
| 7 | VG: cross-Project end_others untested | medium (pre-verified gap) | the second-Project set has no marks, so a per-Project scope passes every test | patch |
| 8 | VG: failed reload after `flashcard_set_ended` untested | medium (pre-verified gap) | only the successful reload is tested | patch |
| 9 | BH: untested NATIVE_SPACE, `not_found` save, GET of an ended set | low | no test hits these branches; adding tests is direct | patch |
| 10 | BH: flip CSS uses `--space-reading-width` as the perspective | low | a layout token misused as a 3D length; direct fix | patch |
| 11 | VG: concurrent final marks untested | maybe-false → medium unverified | the lock exists (and is reinforced by #5); a deterministic two-transaction test needs new fixtures | defer |
| 12 | VG: `flashcard_set_ended` has no catalogue text | low | the client reloads and never shows the code; adding it needs new copy approval | reject |
| 13 | BH: no composite FK tying `card_id` to `set_id` | low | `mark()` checks the card is in the locked set before the only insert; no reachable bad state | reject |
| 14 | BH: repeated reads, and require_active twice | low | efficiency only; the same double guard as `api/review.py::answer_item` + `review.answer` | reject |
| 15 | BH: epic-4-context.md stale | false | it's a cache; EXPERIENCE.md is now newer, so the next story's step-01 recompiles it | reject |
| 16 | BH: EXPERIENCE "set ready (until Story 4.2)" row kept; no Assumptions index entry | false | the row names its own end; approved copy rows (4.1, 3.1b, Epic 6) are tagged inline the same way, with no index entries | reject |
| 17 | BH: `spaceKey` NB value is English ("Space" vs "Mellomrom") | false | EXPERIENCE.md › Keyboard shortcuts: "Flashcard keys are language-independent"; the mock's key cap reads "Space" | reject |
| 18 | BH: sprint status `in-progress` vs spec `in-review` | false | step-05 sets the sprint entry to `review` | reject |
| 19 | BH: the no-model test names Gateway methods | low | future-proofing only; 4.3/4.4 add their own tests | reject |
| 20 | BH: opening an already-ended set ends the open session | false | the frozen rule and AC: opening another set ends the others; code follows it | reject |
| 21 | BH: 409 missing from OpenAPI `responses` | low | no route in the app declares error responses; docs-only | reject |
| 22 | EC: double activation inserts duplicate `not_yet` rows | false | clicks and keydowns are discrete events, so React re-renders with `saving` between them; key repeat is fixed in #4 | reject |
| 23 | EC: `not_yet` after `got_it` dropped (claim) | low | unreachable from the UI (a done card is never shown); saving nothing keeps the session unchanged | reject |
