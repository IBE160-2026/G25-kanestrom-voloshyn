# Acceptance Criteria

These are the testable consequences of each PRD requirement, keyed by FR id and grouped by capability. A story is done only when its FRs' criteria pass, in mock mode for automated tests (AD-4). The AD ids name the spine rules that govern each item.

## CAP-1 — Account & authentication

- **FR-1 Account creation** (UJ-1). A visitor creates an Account with email and password.
  - An email that is already registered cannot register a second Account, and the visitor sees a clear error. Email confirmation is off (AD-2).
  - Passwords are never stored or logged in plain text.
  - Email verification is optional and is not required for the Account to work.
- **FR-2 Login** (UJ-2).
  - Correct credentials reach the student's own Project list, with every Project exactly as saved.
  - Incorrect credentials show one generic invalid-login message, which never reveals whether the email is registered.
  - A session lasts 30 days unless the student logs out sooner. After logout, the old token is refused (AD-2).
- **FR-3 Password reset.**
  - A reset succeeds whether or not the email was ever verified.
  - After a reset, the old password stops working and the new one works.

## CAP-2 — Study Projects

- **FR-4 Project creation and auto-naming** (UJ-1).
  - A new Project with no material shows a placeholder state, not a generated name.
  - The name is generated from the extracted content of the first accepted Material, never independently of extraction (for example, never "Project 1").
  - Auto-naming happens at most once, and a naming failure never fails the upload (AD-14).
- **FR-5 Project renaming.**
  - A rename takes effect immediately and persists across sessions.
  - A student-set name is never replaced automatically. Blank names are rejected, and names are capped at 100 characters (AD-14).
- **FR-8 Project resume** (UJ-2, SM-3).
  - Every previously uploaded Study Material is present.
  - Every previously generated Quiz, Flashcard set, and Summary is present.
- **FR-9 Mistake indicator** (UJ-2).
  - The indicator (for example "3 mistakes to review") counts outstanding Mistakes from both Quiz and Flashcards and appears whenever the count is > 0.
  - No indicator appears when the count is 0.

## CAP-3 — Study Material upload and extraction

- **FR-6 Study Material upload** (UJ-1). One or more files can be added at any time, uploaded one file per request (AD-5).
  - An unsupported type is rejected with a specific message naming the supported types.
  - An 11th Material in a Project is rejected with a clear message. Rejected files don't count toward the 10.
  - A file over 50 MB is rejected with a clear message.
- **FR-7 Text extraction from images** (UJ-1).
  - Text extracted from an image is treated by every feature exactly like text from a document.
  - A fully readable image is accepted with no warning.
  - A partly readable image is accepted and processed with a warning that extraction may be incomplete.
  - A mostly unreadable image is rejected.
  - The 26th image processed for an Account on the same day (Europe/Oslo) is declined with a clear message.
  - The three outcomes use AD-6's thresholds.
  - Formats such as WEBP and GIF are out of scope.
- **PRD §5.1 Content Integrity** applies to every format: accept / warn and continue / reject, per AD-6. A corrupt or unparseable file is rejected.

## CAP-4 — Quiz

- **FR-10 Quiz generation** (UJ-1).
  - Every question is traceable to the chosen Selection Scope.
  - One generation produces ≤ 20 questions.
  - A scope too large for the configured budget returns a clear "narrow your scope" message. A normal whole Project of 10 lecture-sized Materials always fits (AD-7).
- **FR-11 Quiz taking** (UJ-1).
  - Questions are answered one at a time.
  - Each answer immediately shows correct or incorrect, plus an explanation that references only content in the scope.
  - The explanation is hidden until the question is answered (AD-9).
  - The final score equals the number of correct answers.
- **FR-12 Automatic mistake capture** (UJ-1 → UJ-2).
  - An incorrect answer becomes a Mistake with no extra student action.
  - A repeat failure on an item that already has an outstanding Mistake never creates a duplicate (AD-10).
  - **NFR:** Quiz generation completes within 60 s end to end for one lecture-deck-sized upload.

## CAP-5 — Flashcards

- **FR-13 Flashcard generation.**
  - Every card is traceable to the chosen scope.
  - One generation produces ≤ 50 cards.
  - It uses the same scoping model as Quiz.
- **FR-14 Flashcard study and self-assessment** (UJ-2).
  - The student steps through the cards, revealing each answer on demand.
  - Marking a card "not yet known" records a Mistake in the same pool as Quiz Mistakes.
  - Marking a card "known" creates no Mistake and never clears an existing one (AD-10).

## CAP-6 — Summarize

- **FR-15 Summary generation** (UJ-3).
  - A summary can cover a whole Study Material or a chosen part of one.
  - The summary contains no claims absent from the source.

## CAP-7 — Ask AI

- **FR-16 Project-grounded chat** (UJ-3).
  - Answers never introduce facts absent from the active scope (the whole Project, or the narrowed Material).
  - Narrowing to one Material applies to later questions until the student broadens the scope again.
  - Chat history persists with the Project and is present after the student logs out and back in.
  - The 51st message from an Account on the same day is declined with a clear message. A failed answer does not use up a message (AD-12).

## CAP-8 — Mistake Review

- **FR-17 Mistake Review session start** (UJ-2).
  - Review never starts automatically and is never pushed on the student.
  - It is available only when the Project has at least one outstanding Mistake.
- **FR-18 Targeted practice generation** (UJ-2).
  - Practice questions target the specific content of each outstanding Mistake, never a generic re-quiz.
  - Each request covers up to 20 Mistakes; the rest stay outstanding (AD-11).
  - A correct practice answer removes the Mistake from the outstanding count, and the indicator decrements.
  - The original incorrect attempt and every review attempt stay stored after the Mistake is cleared.

## Cross-cutting

- **SM-4 Grounding (gating):** sampled Quiz questions, Flashcards, Summaries, and Ask AI answers, including those from image-sourced material, contain no claims unsupported by the uploaded material.
- **SM-5 No instruction needed (gating):** a first-time test user completes UJ-1 without being told how.
- **SM-C1:** never shorten or skip Quiz explanations to gain generation speed.
- **Mock mode:** every criterion above that involves the LLM is testable with `LLM_MODE=mock`, with no key and no paid calls (AD-4).
