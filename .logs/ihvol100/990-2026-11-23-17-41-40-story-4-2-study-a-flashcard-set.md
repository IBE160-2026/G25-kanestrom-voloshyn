# Story 4.2: Study a flashcard set

## 2026-11-23 kl. 17:41 — Ihvol100

### Oppgave
Merge Story 4.1 into `main` and push it, add the Story 4.1 Norwegian strings to the sign-off doc as Ihor approved, then build Story 4.2 (study a flashcard set) with `bmad-build`.

### Plan
- Add the sign-off row for the 4.1 strings (Ihor [x], Cristoffer [ ]), then merge `feature/4-1-flashcards` into `main` with `--no-ff`, push it, and delete the branch.
- Recompile `epic-4-context.md`, because the UX docs had changed since it was written.
- Write the spec: [spec-4-2-study-a-flashcard-set.md](../../_bmad-output/implementation-artifacts/spec-4-2-study-a-flashcard-set.md). Ihor approved the new card-front copy ("Term"/"Begrep", "Click to flip"/"Klikk for å snu") and kept the full spec.
- A subagent implements it. Three parallel reviewers (Blind Hunter, Edge Case Hunter, Verification Gap) review the result, and the patch findings go back to the same implementer.

### Resultat
- Story 4.1 merged into `main` (`ffc9bb2`) and pushed. The sign-off row is commit `dc0afb4`.
- Story 4.2 is commit `6fe7d02` on `feature/4-2-flashcard-study`:
  - New migration `flashcard_marks`: insert-only, at most one "Got it" per card, with a `card_id` index.
  - `services/flashcards`: `session()`, `get()` and `mark()` with the end rules: 30 minutes idle, opening another started set, or the last "Got it".
  - `lock_open` locks sets in id order, so `get` and `mark` can't deadlock.
  - New route `POST …/cards/{card_id}/mark`.
  - `FlashcardSession.jsx` replaces `FlashcardSetReady.jsx`: flip, "Got it" and "Not yet" with keys, the end screen, read-only mode, errors, and a persistent live region.
- Docs: EXPERIENCE.md row, sign-off row and UX memlog entry for the card-front copy.
- Review: 23 findings. 10 patched, 1 deferred (a concurrency test for two final marks at once, in deferred-work.md), 12 rejected with evidence. The full list is in the spec's Review Triage Log.
- Verified: pytest 916/916, Vitest 900/900, lint clean, db reset OK. `DeleteAccount.test.jsx` failed once under full load (known flake), then passed on its own and on a full rerun.
- Sprint status: 4-1 done, 4-2 review.

### Åpne punkter
- Cristoffer must tick the Story 4.1 and 4.2 rows in `norwegian-strings-signoff.md`.
- Manual check of the flashcard session in the running app: flip, keys, "Not yet" coming back, the end screen, and a screen reader announcing the answer.
- Concurrency test for two simultaneous final "Got it" marks (deferred-work.md).
