---
id: SPEC-AI-StudyBuddy
companions:
  - ../../planning-artifacts/architecture/architecture-AI-StudyBuddy-2026-10-13/ARCHITECTURE-SPINE.md
  - ../../planning-artifacts/ux-designs/ux-AI-StudyBuddy-2026-10-13/DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-AI-StudyBuddy-2026-10-13/EXPERIENCE.md
  - glossary.md
  - acceptance-criteria.md
  - user-journeys.md
sources:
  - ../../planning-artifacts/prds/prd-AI-StudyBuddy-2026-10-06/prd.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# AI Study Buddy V1

## Why

This spec addresses a pain and is also a course mandate. University and college students already have their lecture slides, PDFs, and notes, but turning that material into active practice takes time they don't spend, so they fall back on passive re-reading, and nothing tracks what they keep getting wrong. AI Study Buddy lets a student upload their own material once, study it several ways (quiz, flashcards, summary, grounded chat), and review exactly what they got wrong: *upload once, study many ways, review what you got wrong*. The study core is six integrated capabilities. Around it, V1 carries the supports that make "saved and resumed" work day to day:
- Google sign-in
- Settings
- archive and delete
- History
- Topics
- upload from phone
- an English/Norwegian interface

The team accepts that this makes V1 larger than the brief's six features. It is the IBE160 group project (G25, autumn 2026), so it must really work end to end and be runnable by a grader. NotebookLM, Quizlet, StudyFetch, Quizgecko, and Revisely already cover parts of this space. The differentiation is the focused workflow and the integrated Mistake Review, not novelty.

## Capabilities

FR, UJ, and SM ids are the PRD's; AD ids are the architecture spine's. Each FR's testable consequences are in `acceptance-criteria.md`. Screens, states, and copy are in EXPERIENCE.md, and the look is in DESIGN.md.

- **CAP-1** — Account & authentication (FR-1, FR-2, FR-3, FR-19)
  - **intent:** A student can create an Account and log in with email and password, with Google, or with both on one Account, and reset a forgotten password, so their work persists across sessions.
  - **success:**
    - One Account exists per email, and passwords shorter than 8 characters are refused.
    - A failed login shows a generic message.
    - A session lasts 30 days unless the student logs out, and login opens the last-used active Project.
    - A 24-hour verification link gates only Google linking.
    - A Google sign-in links a verified Account at once and takes over an unverified one, ending its old password and sessions.
    - Reset links are single-use, valid for 1 h, and replaced by any newer link.

- **CAP-2** — Study Projects (FR-4, FR-5, FR-8, FR-9)
  - **intent:** A student can create Projects that keep their Study Material, Topics, Study Content, chats, and Mistakes. A Project is named once from its first usable material and can be renamed while active.
  - **success:**
    - A reopened Project shows every non-removed Material with its Topics, and every Study Content item and chat.
    - An Unfinished Quiz resumes.
    - An empty Project shows a placeholder, never a generated name.
    - A student's rename is never overwritten.
    - The mistake indicator appears exactly when the outstanding count is > 0 and the Project is active.

- **CAP-3** — Study Material upload, extraction, and removal (FR-6, FR-7, FR-20, PRD §5.1)
  - **intent:** A student can add PDF, .docx, .pptx, .txt, .md, .jpg/.jpeg, .png, or .heic files to an active Project at any time, including printed or handwritten text in photos, and remove any of them, even while processing or after rejection.
  - **success:**
    - Each upload ends accepted, accepted with a warning, or rejected, per AD-6.
    - These are declined with specific messages: unsupported types, files over 50 MB, an 11th slot (processing counts toward it, rejected files don't), and a 26th image in a day.
    - A removal frees the slot at once and keeps generated content in History. The material's Mistakes stay outstanding unless the student takes them out of review.

- **CAP-4** — Quiz (FR-10, FR-11, FR-12)
  - **intent:** A student can generate a Quiz of 5, 10, or 20 multiple-choice questions (default 10) from all Topics or chosen Topics, answer one at a time with immediate grounded explanations that name their source, see a final score, and have every wrong answer recorded as a Mistake.
  - **success:**
    - Every question and explanation is traceable to the scope.
    - A scope too thin for the requested count offers the largest supported count, with no padding.
    - The score equals the number of correct answers.
    - Each wrong answer yields one outstanding Mistake that records its Study Material, even if the student leaves part-way.

- **CAP-5** — Flashcards (FR-13, FR-14)
  - **intent:** A student can generate 5, 10, or 20 flashcards (default 10) from all Topics or chosen Topics, reveal answers on demand, and mark each card known or not yet known. Cards marked not yet known return later in the same set.
  - **success:**
    - Every card is traceable to the scope, and its answer names the source.
    - Marking a card never creates a Mistake and never schedules anything.
    - The end shows how many cards were completed and how many needed more than one attempt, with no score.

- **CAP-6** — Summarize (FR-15)
  - **intent:** A student can summarize one ready Study Material, whole or narrowed to one of its Topics.
  - **success:** Sampled summaries contain no claims absent from the source, and each summary section names its source.

- **CAP-7** — Ask AI (FR-16)
  - **intent:** From the Project's home chat, a student can ask free-form questions answered only from the Project's material, optionally narrowed per chat to one Study Material, and keep several chats per Project.
  - **success:**
    - Answers introduce no facts outside the chat's scope, and they name their sources.
    - An answer starts appearing within 5 s and is complete within 15 s.
    - Starting a new chat leaves the old ones intact in History, and chats persist across sessions.
    - The 51st message of the day from an Account, in any chat or Project, is declined with a clear message.

- **CAP-8** — Mistake Review (FR-17, FR-18)
  - **intent:** A student can choose to start Mistake Review, which generates practice targeting each outstanding Quiz Mistake. A correct answer clears it, and all history is kept.
  - **success:**
    - Review never starts on its own.
    - A round covers at most 20 Mistakes, oldest first, and further rounds can start at once.
    - Mistakes whose material was removed are practised from their saved question.
    - A clear decrements the indicator only after it is saved.
    - "All cleared" shows only when none remain.

- **CAP-9** — Project archive and deletion (FR-23, FR-24)
  - **intent:** A student can archive a Project to make it read-only and restore it, or delete it into Deleted projects for 30 days and restore it, delete it forever, or let it be deleted permanently.
  - **success:**
    - Archived and deleted Projects allow reading but no changes.
    - Restore returns the Project exactly as it was.
    - Deleted Projects show the days remaining and are purged after 30 days, or at once with "Delete forever", removing everything in them (§5.4).
    - Archiving lets running generation finish; deleting cancels it. Both revoke the phone link.

- **CAP-10** — Upload from phone (FR-21)
  - **intent:** From an active Project, a student can show a one-time QR link that lets a phone send photos into that Project without logging in.
  - **success:**
    - The link can only add material, reads only the Project name and whether a batch fits the limits, and dies after about 10 minutes, on close, or on archive or delete.
    - A batch becomes one Study Material, and photos over a limit are declined one by one.
    - The phone warns before sending.
    - The new material appears on the computer without a refresh.

- **CAP-11** — Topics (FR-22)
  - **intent:** After processing, the system lists the Topics each Study Material covers, and the student can rename, merge, delete, or add Topics. Topics are the scope unit for Quiz and Flashcards and an optional narrowing for Summarize.
  - **success:**
    - Detection yields about 1 Topic per 5 pages (at least 3, at most 100), counted by the server, and extra content is grouped rather than dropped.
    - Edits persist and stay inside their own Material.
    - The last Topic can't be deleted.
    - A student-added Topic absent from the material produces no content.

- **CAP-12** — History and generation lifecycle (FR-25, FR-26)
  - **intent:** A student can find every chat and Study Content item in one per-Project list, reopen it, resume an Unfinished Quiz, or run it again. Generation keeps running when they leave the screen and can be cancelled.
  - **success:**
    - History lists items newest first and filters by type.
    - Run-again reuses the same count, Topics, and material, and is unavailable, with the reason shown, if the material was removed.
    - Finished generation is saved and announced in the Project.
    - Cancel and failure keep the setup choices.
    - Each generation completes within 60 s for a lecture-deck-sized upload.

- **CAP-13** — Settings and account deletion (FR-27, FR-28)
  - **intent:** A student can manage their name, email, picture, and sign-in methods, change their password, resend verification, link Google, and permanently delete their Account.
  - **success:**
    - An email Account can edit its name; a Google Account's name and picture are read-only.
    - A password change works without verification.
    - Account deletion needs a deliberate confirmation, deletes everything at once (including Deleted projects and Mistake history), ends the session, and frees the email.

- **CAP-14** — Interface language (FR-29)
  - **intent:** A student can use the interface in English or Norwegian (bokmål), switching at any time, including before signing in.
  - **success:**
    - Every interface string, including errors and limit messages, exists in both languages.
    - The default follows the browser language, with English as the fallback.
    - The choice persists on the Account.
    - Generated content follows the material's main language, not the interface language.

## Constraints

- **Binding documents.** The architecture spine (AD-1 to AD-29) binds all implementation, cited by id. A conflicting change amends the spine through `bmad-architecture` and never renumbers an id. DESIGN.md and EXPERIENCE.md bind every screen, and DESIGN.md wins over a mock.
- **Environment.** The teacher sets the required environment: Python/uv, Node/npm, Docker, Supabase, GitHub. The spine fixes how each is used.
- **Grounding.** No feature fabricates content to cover missing or unreadable material, an absent Topic, or a count the material can't support. Every explanation, card, summary section, practice question, and chat answer names its source Study Material and its location (PRD §5.1, SM-4).
- **Content Integrity.** Every format and every phone batch has three outcomes (accept, warn and continue, reject), with AD-6's thresholds.
- **Limits** (§5.2), all enforced by the server, each with a clear message in the interface language:
  - ≤ 20 Quiz questions, ≤ 20 flashcards, and ≤ 20 practice questions per generation
  - 50 Ask AI messages per Account per day, across all chats
  - 25 images per Account per day, counting each phone photo
  - 10 Study Materials per Project, including those still processing
  - 50 MB per file and per photo
  - 100 Topics per Material

  No other daily limit exists.
- **Data use.** Uploaded material serves only its owner's own content and is never shared with other Accounts (§5.3). Live AI calls retain nothing at the provider (AD-3).
- **Data lifecycle.** Deletion follows PRD §5.4: Material removal, archive, soft delete with a 30-day purge, delete forever, and Account deletion.
- **Account boundary:** a Project belongs to exactly one Account; there is no sharing.
- **Platform:** a desktop web app plus one single-purpose phone upload page.
- **LLM access:** all LLM calls go through one module with a deterministic mock mode, so the grader runs the app and tests with no key and no paid calls (AD-3, AD-4).
- **Simplicity:** one app instance; no microservices, queues, separate workers, or infrastructure beyond the spine.
- **Honesty:** never claim the product is the first or only tool of its kind.

## Non-goals

- Instructor or course-staff features, shared or collaborative Projects, group study.
- K-12 or non-higher-education learners.
- A general tutoring platform with its own curriculum; it teaches only from uploaded material.
- Note-taking or editing uploaded material. Topic edits change only the Topic list.
- A mobile or native app, or a mobile layout beyond the phone upload page.
- Academic-integrity or plagiarism checking.
- Post-V1 items: progress analytics, spaced repetition, adaptive difficulty, cross-document or cross-Project linking, study recommendations, exam planning.
- Mandatory email verification.
- Image formats beyond .jpg/.jpeg/.png/.heic (for example WEBP or GIF), and OCR of scanned PDF pages.
- Resuming a Flashcard set left part-way.
- Profile-photo upload for email Accounts, adding a password to a Google-created Account, and changing an Account's email.
- Interface languages beyond English and Norwegian (bokmål); a light theme or user-chosen colours.
- Free-text quiz answers and AI-graded answers.
- Embeddings or vector search.
- Adding a feature because a competitor has it.

## Success signal

The signal is met when **at least 5 test users** each complete the core loop in one sitting, with no crash, no timeout, and no response contradicting their material (SM-1):

1. Sign up.
2. Create a Project.
3. Upload one text-based Material and one image-based Material (directly or from a phone).
4. Generate a Quiz, Flashcards, or a Summary.
5. For a Quiz, see a scored result.

All of the following must also hold:

- **Mistake Review (SM-2):** at least 50 % of students with outstanding Quiz Mistakes start a Mistake Review within 7 days. Mistakes withdrawn by removal or hidden by archive or delete don't count (SM-C2).
- **Resume (SM-3):** reopened Projects show all material, content, and chats intact; an Unfinished Quiz resumes; a restored Project returns unchanged.
- **Grounding (gating, SM-4):** sampled outputs contain no unsupported claims, and each names a source that contains it.
- **No instruction needed (gating, SM-5):** every cohort user completes UJ-1 without being told how.
- **Counter-metric (SM-C1):** never shorten Quiz explanations to gain speed.

## Assumptions

- The Phone upload link's "about 10 minutes" is a round-number lifetime.
- Restoring a Project from Deleted projects returns it to the active list, even if it was archived before.
- The 60 s per-generation target is a round number, not a measured baseline.
- Account deletion frees the email address for a new Account.
- When the browser language is neither English nor Norwegian, the interface falls back to English.
- A demo cohort of 5 test users is a round number for a course demo.
- As a gating condition, SM-5 requires every user in the cohort to pass.

## Open Questions

- **Privacy notice:** must students be told, before uploading, that their material is sent to a third-party AI provider (OpenRouter and the model host) for processing? Deletion and retention are settled by FR-24, FR-28, and §5.4, and provider retention by AD-3's zero-data-retention routing, but neither the PRD nor the UX shows students a notice.
- **Norwegian strings:** FR-29 is done only once the team signs off the Norwegian strings in EXPERIENCE.md (PRD §9.3).
- **Stale UX state:** EXPERIENCE.md still shows the "log in with your password once to link Google" state, which the 2026-11-02 FR-19 amendment removed. Cristoffer must approve the UX update.
