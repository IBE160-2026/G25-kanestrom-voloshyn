---
id: SPEC-AI-StudyBuddy
companions:
  - ../../planning-artifacts/architecture/architecture-AI-StudyBuddy-2026-10-13/ARCHITECTURE-SPINE.md
  - glossary.md
  - acceptance-criteria.md
  - user-journeys.md
sources:
  - ../../planning-artifacts/prds/prd-AI-StudyBuddy-2026-10-06/prd.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# AI Study Buddy V1

## Why

This spec addresses a pain and is also a course mandate. University and college students already have their lecture slides, PDFs, and notes, but turning that material into active practice takes time they don't spend, so they fall back on passive re-reading. Nothing tracks what they keep getting wrong. AI Study Buddy lets a student upload their own material once, study it several ways (quiz, flashcards, summary, grounded chat), and review exactly what they got wrong: *upload once, study many ways, review what you got wrong*. It is the IBE160 group project (G25, autumn 2026), so it must really work end to end and be runnable by a grader. NotebookLM, Quizlet, StudyFetch, Quizgecko, and Revisely already cover parts of this space. The differentiation is the focused workflow and the integrated Mistake Review, not novelty.

## Capabilities

FR, UJ, and SM ids are the PRD's. AD ids are the architecture spine's. Per-FR testable consequences are in `acceptance-criteria.md`.

- **CAP-1** — Account & authentication (FR-1, FR-2, FR-3)
  - **intent:** A student can create an Account with email and password, log in to reach their own Projects, and reset a forgotten password, so their work persists across sessions.
  - **success:** Sign-up, login, logout, and reset each work end to end. A duplicate email gets a clear error, a failed login gets a generic message, and a session lasts 30 days unless the student logs out.

- **CAP-2** — Study Projects (FR-4, FR-5, FR-8, FR-9)
  - **intent:** A student can create Projects that persist their Study Material, generated Study Content, chat, and Mistakes. Each Project is auto-named once from its first usable material and can be renamed at any time.
  - **success:** A reopened Project shows every Material, Study Content item, and chat message as left. A Project with no material shows a placeholder, not a generated name. A student rename is never overwritten. The mistake indicator appears exactly when the outstanding count is > 0.

- **CAP-3** — Study Material upload and extraction (FR-6, FR-7, PRD §5.1)
  - **intent:** A student can add PDF, .docx, .pptx, .txt, .md, .jpg/.jpeg, .png, or .heic files to a Project at any time. Text is extracted from every format, including printed or handwritten text in photos, so all features treat the material identically.
  - **success:** Each upload ends in exactly one of three outcomes (accepted, accepted with a warning, rejected) per AD-6's thresholds. Unsupported types, files over 50 MB, an 11th Material, and a 26th image in a day are declined with specific messages.

- **CAP-4** — Quiz (FR-10, FR-11, FR-12)
  - **intent:** A student can generate a Quiz of up to 20 multiple-choice questions from a chosen Selection Scope, answer them one at a time with immediate grounded explanations, see a final score, and have every wrong answer recorded as a Mistake.
  - **success:** Every question and explanation is traceable to the chosen scope. The score equals the number of correct answers. Each incorrect answer yields an outstanding Mistake with no extra student action. Generation for a lecture-deck-sized upload completes within 60 s.

- **CAP-5** — Flashcards (FR-13, FR-14)
  - **intent:** A student can generate up to 50 flashcards from a chosen Selection Scope, step through them revealing answers on demand, and mark each card known or not yet known.
  - **success:** Every card is traceable to the scope. Marking a card "not yet known" records a Mistake in the same pool as Quiz Mistakes, and marking it "known" does not.

- **CAP-6** — Summarize (FR-15)
  - **intent:** A student can generate a summary of a whole Study Material or a chosen part of one.
  - **success:** Sampled summaries contain no claims absent from the source material.

- **CAP-7** — Ask AI (FR-16)
  - **intent:** A student can ask free-form questions answered only from the Project's material, optionally narrowed to one Study Material, in one chat thread that persists with the Project.
  - **success:**
    - Answers introduce no facts outside the active scope.
    - Narrowing applies to later questions until the student broadens the scope.
    - History survives logout and login.
    - The 51st message of the day from an Account is declined with a clear message.

- **CAP-8** — Mistake Review (FR-17, FR-18)
  - **intent:** A student can choose to start a Mistake Review that generates practice targeting each outstanding Mistake. A correct answer clears the Mistake, and every attempt is kept as history.
  - **success:** Review never starts on its own. Each practice question targets its Mistake's source content. A correct answer decrements the indicator, and the original and review attempts remain stored.

## Constraints

- **The architecture spine binds all implementation.** AD-1 to AD-18 apply and are cited by id; a conflicting change amends the spine through `bmad-architecture` and never renumbers an id. The required environment is set by the teacher: Python/uv, Node/npm, Docker, Supabase, GitHub. The spine fixes how each is used.
- **Generation is grounded.** No feature fabricates content to cover missing or unreadable material, and every output reflects only the material in its scope (PRD §5.1, SM-4).
- **Content Integrity applies to every format.** A usable file is accepted silently, a partly usable one is processed with a warning, and a mostly unusable one is rejected. The thresholds are AD-6's.
- **Cost limits:**
  - ≤ 20 Quiz questions per generation
  - ≤ 50 flashcards per generation
  - ≤ 50 Ask AI messages per Account per day
  - ≤ 25 extracted images per Account per day
  - ≤ 20 Mistakes per review request (AD-11)
- **Upload limits:** ≤ 10 Study Materials per Project, ≤ 50 MB per file, and only the eight listed formats.
- **Account boundary:** a Project belongs to exactly one Account, with no sharing.
- **Platform:** desktop web only.
- **LLM access:** all LLM calls go through one module with a deterministic mock mode, so the grader can run the app and tests with no key and no paid calls (AD-3, AD-4).
- **Simplicity:** pick the simplest design that meets these requirements. No microservices, job queues, or infrastructure beyond the spine.
- **Honesty:** never claim the product is the first or only tool of its kind.

## Non-goals

- Instructor or course-staff features, shared or collaborative Projects, group study.
- K-12 or non-higher-education learners.
- A general tutoring platform with its own curriculum; it teaches only from uploaded material.
- Note-taking or editing uploaded material in place.
- Mobile or native apps.
- Academic-integrity or plagiarism checking.
- Post-V1 items: progress analytics, spaced repetition, adaptive difficulty, cross-document or cross-Project linking, study recommendations, exam planning.
- Email verification (optional, not required); third-party sign-in.
- Image formats beyond .jpg/.jpeg/.png/.heic (for example WEBP or GIF), and OCR of scanned PDF pages.
- Free-text quiz answers and AI-graded answers.
- Embeddings or vector search.
- Adding a feature because a competitor has it.

## Success signal

The signal is met when **at least 5 test users** each complete the core loop in one sitting, with no crash, no timeout, and no response contradicting their material:

1. Create a Project.
2. Upload one text-based and one image-based Material.
3. Generate a Quiz, Flashcards, or a Summary.
4. For a Quiz, see a scored result.

All of the following must also hold:

- **Mistake Review:** Projects with Mistakes are opened in Mistake Review at least once (SM-2).
- **Resume:** reopened Projects show all material, content, and chat intact (SM-3).
- **Grounding (gating, SM-4):** sampled outputs contain no unsupported claims.
- **No instruction needed (gating, SM-5):** a first-time user completes UJ-1 without being told how.
- **Counter-metric (SM-C1):** never shorten Quiz explanations to gain speed.

## Assumptions

- Sign-up and login use email and password only; no third-party sign-in in V1.
- Password reset works through a link emailed to the Account's address.
- The 60 s Quiz-generation target is a round number, not a measured baseline.
- The 50-message Ask AI cap is per Account, shared across all of a student's Projects.
- The 25-image cap is per Account per day.
- A demo cohort of 5 test users is a round number for a course demo.

## Open Questions

- GDPR for student data (the product is used in Norway, so EU rules apply): is account deletion and export of a student's data in or out of V1? How long are uploads kept? Must students be told that their material is sent to a third-party LLM through OpenRouter? Neither the PRD nor the spine addresses this.
