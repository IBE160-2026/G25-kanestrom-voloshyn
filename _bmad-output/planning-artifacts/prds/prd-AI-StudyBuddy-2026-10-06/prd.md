---
title: "PRD: AI Study Buddy"
status: final
created: 2026-10-06
updated: 2026-10-06
---

# PRD: AI Study Buddy
*Working title — confirm.*

## 0. Document Purpose

This PRD defines Version 1 of AI Study Buddy for the team building it (an IBE160 course project) and for whoever picks up architecture and implementation planning next. It builds on the existing [Product Brief](../../briefs/brief-AI-StudyBuddy-2026-09-16/brief.md) — problem, users, and vision are not repeated here beyond what's needed for context. Vocabulary is Glossary-anchored (§3); Features (§4) group behavioral descriptions with globally-numbered Functional Requirements (FR-1 through FR-N) nested under them; inline `[ASSUMPTION]` tags mark anything inferred without explicit confirmation, indexed in §10.

## 1. Vision

Students already have what they need to study — lecture slides, PDFs, notes — but turning that material into active practice (a quiz, a flashcard set, a summary) takes time most students don't spend, so they fall back on passive re-reading. AI Study Buddy removes that step: a student uploads their own course material into a Project, and immediately generates a Quiz, Flashcards, a Summary, or asks Ask AI a question — all grounded in that material, not a generic curriculum.

The loop closes on itself rather than ending at "here's your quiz": incorrect quiz answers and flashcards marked as not yet known are captured as Mistakes, and Mistake Review turns them into targeted extra practice the student can return to whenever they choose. A Project persists everything — uploaded material, generated content, and mistake history — so a student can close the app and pick up exactly where they left off.

Version 1 is deliberately narrow — six integrated capabilities plus the account system needed to make "saved and resumed" real. The bet is: *upload once, study many ways, review what you got wrong* — a simple, understandable, end-to-end workflow is worth more to a student right now than a longer feature list. This PRD makes no claim of category novelty: NotebookLM, Quizlet, Quizgecko, and Revisely already cover parts of this space, and StudyFetch in particular already does this at real scale. The differentiation is tight integration between generation and mistake-driven review, not an unprecedented feature.

Post-V1 direction (performance tracking, adaptive difficulty, cross-Project knowledge) is explicitly out of scope for V1 — see §6, §7.2.

## 2. Target User

### 2.1 Jobs To Be Done

- Turn my own lecture slides/PDFs/notes into quiz questions without writing them myself.
- Get flashcards out of my material instead of retyping terms by hand.
- Get a quick summary of a long reading before I commit time to it in full.
- Ask a specific question about my own course material and get an answer grounded in it, not a generic web answer.
- Know what I keep getting wrong, and get more practice on exactly that, without re-building the practice set myself.
- Pick up a study session where I left off, without re-uploading or re-organizing anything.

### 2.2 Non-Users (v1)

- Instructors/course staff creating or assigning material to students — V1 is self-serve, single-student use only.
- Multi-student/collaborative study groups sharing one Project — V1 Projects belong to one Account.
- K-12 or non-higher-education learners — the brief and journeys are written for university/college-level material.

### 2.3 Key User Journeys

- **UJ-1. Emma turns a slide deck into graded practice in minutes.**
  - **Persona + context:** Emma, a university biology student, wants to turn today's lecture into something she can actually practice, not just re-read.
  - **Entry state:** unauthenticated, first visit.
  - **Path:** Creates an Account → creates a new Project and uploads her lecture slides to it → the Project auto-generates a name from the uploaded material (for example, "Biology — Cell Division") → the Project view offers Quiz, Flashcards, Summarize, and Ask AI → she starts Quiz, answering AI-generated questions drawn from her slides.
  - **Climax:** Each answer gets immediate feedback with an explanation grounded in her own material; at the end she sees her score and which answers were wrong.
  - **Resolution:** Her incorrect answers are automatically recorded as Mistakes against the Project — she's turned a slide deck into graded practice without writing a single question.
  - **Edge case:** If a Study Material can't produce a usable Quiz (too little readable text), the system processes what it can with a warning, or rejects the material outright if it's mostly unusable — per the Content Integrity rule (§5.1) — rather than showing an empty or broken quiz.

- **UJ-2. Emma comes back and clears her mistakes.**
  - **Persona + context:** Same Emma, a few days later, wants to pick up where she left off and deal with what she got wrong.
  - **Entry state:** authenticated (logs back in).
  - **Path:** Opens her Project list → opens "Biology — Cell Division," where her uploaded material and prior activity are exactly as she left them → the Project shows a visible mistake indicator ("3 mistakes to review") → she chooses to open Mistake Review.
  - **Climax:** She practices questions built specifically from what she previously got wrong, not a generic re-quiz.
  - **Resolution:** Her mistake count reflects what she's reviewed; she decides for herself when to review — the app surfaces the mistakes but never forces the session.
  - **Edge case:** A Project with zero Mistakes shows no indicator rather than a misleading "0 mistakes to review."

- **UJ-3. Emma refreshes a topic with Summarize, then clarifies it with Ask AI.**
  - **Persona + context:** Same Emma, preparing for a lecture review session, wants a quick refresher rather than a full quiz.
  - **Entry state:** authenticated, inside her existing Project.
  - **Path:** Opens the Project → clicks Summarize and chooses one uploaded chapter as the Selection Scope → reads the generated summary to quickly refresh the topic → spots a concept she still doesn't understand → opens Ask AI and asks "What is the difference between mitosis and meiosis?" → gets an answer grounded in her uploaded material → asks a follow-up question.
  - **Climax:** The follow-up conversation resolves her confusion using her own course material, not a generic web answer.
  - **Resolution:** The Ask AI conversation is saved with the Project so she can return to it later, alongside everything else.

## 3. Glossary

- **Account** — A student's registered identity (credentials required). Required to create or access Projects. One Account can own multiple Projects; a Project belongs to exactly one Account (no sharing/multi-user access in V1). Session length: see FR-2.
- **Project** — A named, persistent container holding one or more Study Materials, the Study Content generated from them, and the student's accumulated Mistakes. Auto-named by the system on creation from the uploaded Study Material; renameable by the student at any time.
- **Study Material** — A file a student uploads into a Project: PDF, .docx, .pptx, .txt, .md, .jpg/.jpeg, .png, or .heic. The last three cover photos of handwritten or printed notes (.heic being the default format for iPhone camera photos). Per-Project and per-file limits: see FR-6.
- **Selection Scope** — The subset of a Project's Study Material that a generation feature (Quiz, Flashcards, Summarize) operates on: either the whole Project or a student-chosen topic/section within it.
- **Study Content** — AI-generated output derived from Study Material within a Selection Scope: a Quiz, a Flashcard set, or a Summary.
- **Quiz** — A set of AI-generated questions drawn from a Selection Scope, answered one at a time with immediate per-question feedback (correct/incorrect plus an explanation grounded in the Study Material) and an end-of-quiz score. Generation limit: see FR-10.
- **Flashcards** — A set of AI-generated question/answer cards drawn from a Selection Scope, each markable by the student as known or not yet known. Generation limit: see FR-13.
- **Summarize** — An AI-generated summary of a Selection Scope (a whole Study Material or a chosen part of one).
- **Ask AI** — A free-form chat interface for asking questions about a Project's Study Material. Answers from all Study Material in the Project by default; the student may narrow a question to one specific Study Material. Chat history persists within its Project. Daily message limit: see FR-16.
- **Mistake** — A Quiz question answered incorrectly, or a Flashcard the student marks as not yet known, recorded automatically against the Project. Outstanding-count and retention behavior: see FR-12, FR-18.
- **Mistake Review** — A student-initiated practice session built from a Project's accumulated Mistakes.

## 4. Features

### 4.1 Account & Authentication

**Description:** A student needs a persistent identity for Projects to mean anything across sessions (realizes the entry step of UJ-1 and the return in UJ-2). `[ASSUMPTION: email + password is the signup/login mechanism — no third-party sign-in (Google, and so on) specified or assumed for V1.]`

**Functional Requirements:**

#### FR-1: Account creation
A visitor can create an Account with an email and password. Realizes UJ-1.

**Consequences (testable):**
- An email already registered to an Account cannot register a second Account; the student sees a clear error.
- Passwords are never stored or logged in plain text.

**Notes:** Email verification is optional for V1 — not required for an Account to function; may be added later if time permits.

#### FR-2: Login
A registered student can log in with their Account's email and password and reach their Project list. Realizes UJ-2.

**Consequences (testable):**
- Correct credentials reach the student's own Project list, showing every Project exactly as previously saved.
- Incorrect credentials show a generic invalid-login message (does not reveal whether the email is registered).
- A logged-in session persists for 30 days before requiring login again, unless the student logs out sooner.

#### FR-3: Password reset
A student who has forgotten their password can request a reset and regain access to their Account. Supports §1 Vision's account-persistence promise.

**Consequences (testable):**
- A reset request succeeds whether or not the Account's email has been verified (email verification is optional per FR-1).
- After a successful reset, the old password no longer works; the student logs in with the new one.

**Notes:** `[ASSUMPTION: reset works via a link emailed to the Account's address — no other mechanism specified.]`

### 4.2 Study Projects

**Description:** The container that makes "upload once, study many ways, resume later" possible. Realizes the project-handling beats of both UJ-1 and UJ-2.

**Functional Requirements:**

#### FR-4: Project creation and auto-naming
A logged-in student can create a new Project. Once the student completes their first Study Material upload to it, the system generates a Project name from that material's content. Realizes UJ-1.

**Consequences (testable):**
- A newly created Project with no Study Material yet shows a placeholder state, not a generated name.
- The generated name is derived from the extracted content of the uploaded Study Material, not a static placeholder like "Project 1" — verifiable by confirming the naming step runs only after content extraction succeeds, never independently of it.

#### FR-5: Project renaming
A student can rename a Project at any time to any text they choose. Realizes UJ-1 (auto-name) and gives the student final control.

**Consequences (testable):**
- A rename takes effect immediately and persists across sessions.

#### FR-6: Study Material upload
A student can upload one or more files into a Project, in PDF, .docx, .pptx, .txt, .md, .jpg/.jpeg, .png, or .heic format, added at any time (not only at creation). Realizes UJ-1.

**Consequences (testable):**
- An unsupported file type is rejected with a clear, specific error message naming the supported types.
- A Project can hold up to 10 Study Materials simultaneously (for example, several lecture PDFs from the same course, or several photographed pages of handwritten notes); an 11th upload is rejected with a clear message.
- A single Study Material cannot exceed 50 MB; a larger file is rejected with a clear error message.

#### FR-7: Text extraction from images
For an uploaded .jpg/.jpeg, .png, or .heic Study Material, the system extracts the text it contains — printed or handwritten — so that content is usable by Quiz, Flashcards, Summarize, and Ask AI on equal footing with text-based formats. Realizes UJ-1 for image-based uploads specifically.

**Consequences (testable):**
- An image whose text is extracted is treated identically to a PDF/.docx/.pptx/.txt/.md upload by every other feature — no feature distinguishes an image-sourced Study Material from a text-sourced one.
- A fully readable image is accepted and processed with no warning.
- A partially readable image is accepted and processed using whatever text was successfully extracted, with a warning shown that extraction may be incomplete.
- A mostly unreadable image is rejected outright rather than accepted with little or no usable text.
- A 26th image processed for the same Account on the same day is declined with a clear message rather than silently failing.
- `[NOTE FOR PM]` The exact confidence thresholds separating these three outcomes are deferred to architecture: this PRD requires the three outcomes (accept / warn-and-continue / reject) but does not set the numeric boundary between them. Whoever designs the extraction pipeline must set and document a concrete threshold before this FR is implementable.

**Out of Scope:**
- Any other image-adjacent format (for example, WEBP, GIF).

#### FR-8: Project resume
A returning, logged-in student who opens a previously created Project can access it exactly as left. Realizes UJ-2.

**Consequences (testable):**
- Every previously uploaded Study Material is present.
- Every previously generated Study Content item (Quiz, Flashcards, Summary) is present.

#### FR-9: Mistake indicator
A Project visibly shows a count of its outstanding Mistakes, drawn from both Quiz and Flashcards. Realizes UJ-2.

**Consequences (testable):**
- The indicator (for example, "3 mistakes to review") appears whenever the outstanding count is greater than zero.
- No indicator appears when the count is zero.

### 4.3 Quiz

**Description:** Turns a Selection Scope into graded, explained practice — the first thing Emma does with new material in UJ-1.

**Functional Requirements:**

#### FR-10: Quiz generation
A student can choose a Selection Scope (the whole Project or a specific topic/section) and generate a Quiz of up to 20 questions from it. Realizes UJ-1.

**Consequences (testable):**
- Every generated question is traceable to content present in the chosen Selection Scope (no questions about material outside it).
- A single generation request produces no more than 20 questions.

#### FR-11: Quiz taking with immediate feedback
A student can answer Quiz questions one at a time; each answer immediately shows whether it was correct and an explanation grounded in the Study Material. At the end, the student sees an overall score. Realizes UJ-1.

**Consequences (testable):**
- Every explanation references content actually present in the Selection Scope, not invented facts.
- The end-of-quiz score accurately reflects the number of correct answers given.

#### FR-12: Automatic mistake capture
Any Quiz question answered incorrectly is automatically recorded as a Mistake against the Project. Realizes UJ-1, feeds UJ-2.

**Consequences (testable):**
- No separate student action is required for an incorrect answer to become a Mistake.

**Feature-specific NFRs:**
- Quiz generation completes within 60 seconds end-to-end for a single lecture-deck-sized upload, consistent with UJ-1's "a few minutes" framing. `[ASSUMPTION: 60 seconds is a reasonable round-number target for a course-project MVP, not measured against any baseline — see §10.]`

### 4.4 Flashcards

**Description:** An alternative study format from the same material, for students who prefer recall-practice over quiz format — and, like Quiz, a source of Mistakes for Mistake Review.

**Functional Requirements:**

#### FR-13: Flashcard generation
A student can choose a Selection Scope (whole Project or a specific topic/section) and generate a Flashcard set of up to 50 cards from it, the same scoping model as Quiz (FR-10). Supports §1 Vision's "study many ways" bet; no single UJ covers Flashcards standalone (it is captured only as a Mistake Review feeder via FR-14).

**Consequences (testable):**
- Every generated flashcard is traceable to content present in the chosen Selection Scope.
- A single generation request produces no more than 50 flashcards.

#### FR-14: Flashcard study and self-assessment
A student can step through a generated Flashcard set, viewing each card's prompt and revealing its answer on demand. After revealing an answer, the student can mark the card as either known or not yet known. Realizes UJ-2 (Mistake Review) via Flashcard-sourced Mistakes.

**Consequences (testable):**
- Marking a card "not yet known" automatically records a Mistake against the Project — the same pool Quiz mistakes feed into.
- Marking a card "known" does not create a Mistake.

### 4.5 Summarize

**Description:** Compresses a Selection Scope into a summary a student can read before committing to the full material.

**Functional Requirements:**

#### FR-15: Summary generation
A student can generate a summary of either an entire Study Material or a chosen part of one. Realizes UJ-3.

**Consequences (testable):**
- The summary contains no claims absent from the source Study Material.

### 4.6 Ask AI

**Description:** A conversational way to interrogate a Project's material directly, for questions the other three generation features don't anticipate.

**Functional Requirements:**

#### FR-16: Project-grounded chat
A student can ask free-form questions about a Project's Study Material, up to 50 messages per Account per day. By default, Ask AI answers using all Study Material in the Project; the student can optionally narrow a question to one specific Study Material. Realizes UJ-3.

**Consequences (testable):**
- An answer never introduces facts absent from the material in the active scope (whole Project or the narrowed document).
- Narrowing to one document changes which material subsequent answers draw from until the student broadens the scope again.
- Chat history persists within its Project and is available when the student resumes the Project in a later session (realizes UJ-2's resume expectation).
- A 51st message from the same Account on the same day is declined with a clear message, rather than silently failing.

### 4.7 Mistake Review

**Description:** Closes the loop from Quiz and Flashcards back into targeted practice, entirely at the student's initiative — the core of UJ-2.

**Functional Requirements:**

#### FR-17: Mistake Review session start
From a Project with one or more outstanding Mistakes, a student can choose to start a Mistake Review session. Realizes UJ-2.

**Consequences (testable):**
- Mistake Review never starts automatically and is never pushed to the student — it is always a choice they initiate.

#### FR-18: Targeted practice generation
A Mistake Review session generates additional practice questions targeting the specific content/topic of each outstanding Mistake, not a generic re-quiz. Realizes UJ-2.

**Consequences (testable):**
- Answering a Mistake's practice question correctly removes it from the Project's outstanding Mistake count (FR-9's indicator decrements accordingly).
- The historical record of the original incorrect attempt, and of any review attempts, remains stored even after the Mistake is cleared from the active count.

## 5. Cross-Cutting Constraints and Guardrails

### 5.1 Content Integrity

Across every Study Material format, not only images (FR-7): a file that is fully usable is accepted silently; a file that is partially usable is accepted and processed using whatever content was successfully extracted, with a warning shown to the student; a file that is mostly or entirely unusable (a corrupted document, an image too illegible to read) is rejected rather than silently producing content from little or no real material. No generation feature — Quiz, Flashcards, Summarize, or Ask AI — fabricates content to compensate for missing or unreadable source material; every explanation, flashcard, summary, or chat answer reflects only what is actually present in the available Study Material. `[NOTE FOR PM]` This same threshold gap applies here for every format, not only images — see FR-7's note.

### 5.2 Cost Controls (Generation Limits)

- Quiz generation: up to 20 questions per generation request (FR-10) — enough to cover a typical lecture's worth of material in one sitting while bounding per-request AI cost.
- Flashcard generation: up to 50 flashcards per generation request (FR-13) — covers a full topic/section without inviting one unbounded all-at-once generation.
- Ask AI: up to 50 messages per Account per day (FR-16) — generous for a full day's study session while bounding per-account daily AI cost. `[ASSUMPTION: this allowance is per Account, shared across all of a student's Projects, not per individual Project — see §10.]`
- Image text extraction (OCR): up to 25 images processed per Account per day (FR-7). `[ASSUMPTION: the daily/per-Account unit mirrors Ask AI's cap, since only the count (25) was specified — confirm if this should instead be scoped per upload or per Project — see §10.]`

## 6. Non-Goals (Explicit)

- AI Study Buddy is not a general tutoring platform with its own curriculum (unlike Khanmigo) — it only ever teaches from material the student uploads.
- Not a note-taking or document-editing tool — uploaded Study Material is read and generated-from, not edited in place.
- Not multi-user or collaborative — V1 has no shared Projects, group study, or instructor-side features.
- Not a mobile or native app — V1 is a desktop web app only.
- Not an academic-integrity or plagiarism checker.
- Not a personalized/adaptive learning system in V1 (see §7.2; may become true post-V1 per the brief's Vision).

## 7. MVP Scope

### 7.1 In Scope

- Account creation, login, and password reset (FR-1–FR-3).
- Study Projects: creation, AI auto-naming, renaming, multi-file upload (including photos of handwritten or printed notes), text extraction from images, resume (FR-4–FR-9).
- Quiz: scoped generation, immediate per-question feedback with explanations, scoring, automatic mistake capture (FR-10–FR-12).
- Flashcards: scoped generation, self-paced study with known/not-known self-assessment feeding Mistake Review (FR-13, FR-14).
- Summarize: whole-document or partial summarization (FR-15).
- Ask AI: project-grounded chat, optional single-document narrowing, persistent chat history (FR-16).
- Mistake Review: student-initiated, targeted practice generation, drawing from both Quiz and Flashcard mistakes (FR-17, FR-18).
- Cross-cutting content-integrity and cost-control guardrails (§5).

### 7.2 Out of Scope for MVP

- Detailed progress analytics (performance tracked by topic over time).
- Spaced repetition scheduling.
- Advanced adaptive learning (difficulty/question selection that adapts automatically to performance).
- Cross-document knowledge linking (connecting concepts across a student's multiple Projects).
- Advanced study recommendations.
- Full exam planning.
- Email verification (FR-1 Notes) — optional, not required for V1.
- Image formats beyond .jpg/.jpeg/.png/.heic, for example WEBP, GIF (FR-7 Out of Scope).
- Multi-user/shared Projects, mobile app (§6 Non-Goals).

All items above are candidates for post-V1 versions per the brief's long-term Vision, not MVP requirements.

## 8. Success Metrics

**Primary**
- **SM-1**: End-to-end core loop completion — a student can, in one sitting: create a Project, upload Study Material (text-based or image-based), generate at least one of Quiz/Flashcards/Summary, and (for Quiz) see a scored result. Target: completes with no crash, no timeout, and no response contradicting the uploaded material, across a demo cohort of at least 5 test users each covering one text-based and one image-based upload. Validates FR-4, FR-6, FR-7, FR-10, FR-11, FR-13, FR-15. `[ASSUMPTION: a cohort of 5 is a reasonable round number for a course-project demo, not a measured requirement — see §10.]`
- **SM-2**: Mistake-to-review follow-through — of Projects that accumulate at least one Mistake (from Quiz or Flashcards), the student opens Mistake Review at least once. Validates FR-9, FR-12, FR-14, FR-17, FR-18.
- **SM-3**: Resume integrity — a Project reopened in a later session shows all previously uploaded Study Material and generated Study Content exactly as left, and separately, all Ask AI chat history persists too, with nothing lost. Validates FR-8, FR-16.

**Gating Conditions (apply throughout — not secondary, per the brief)**
- **SM-4**: Generated-content relevance — Quiz questions, Flashcards, Summaries, and Ask AI answers, sampled during testing, contain no claims unsupported by the uploaded Study Material, including material sourced from images via FR-7's text extraction. This is a condition every other metric is evaluated under, not a nice-to-have alongside them. Validates FR-7, FR-10, FR-11, FR-13, FR-15, FR-16.
- **SM-5**: Usability without instruction — a first-time student test user can complete UJ-1 (upload → generate → quiz → score) without being told how, per the brief's "simple enough to use without instruction" criterion. Equally gating, not secondary.

**Counter-metrics (do not optimize)**
- **SM-C1**: Speed of generation should not be optimized by shortening or skipping explanations in Quiz feedback — explanation quality is load-bearing for SM-4, not a cost to cut for SM-1's "completes quickly" framing.

## 9. Open Questions

None requiring a product decision remain outstanding. One `[NOTE FOR PM]` callout is left for architecture, not the PM: the numeric confidence thresholds behind the Content Integrity three-way outcome (accept / warn-and-continue / reject) are deliberately unset at the PRD level (§5.1, FR-7) — whoever builds the extraction pipeline must define and document them. See §10 for the handful of inferences made while applying product decisions.

## 10. Assumptions Index

- §4.1 — Account creation/login uses email + password; no third-party sign-in in V1.
- §4.1 (FR-3 Notes) — Password reset is assumed to work via an emailed reset link; no other mechanism specified.
- §4.3 (FR-12 NFR) — 60 seconds end-to-end for quiz generation is a round-number target standing in for the brief's qualitative "a few minutes," not a measured baseline.
- §5.2 — Ask AI's 50-messages/day cap is assumed to apply per Account, shared across all of a student's Projects, not per individual Project.
- §5.2 — OCR's 25-images/day cap is assumed to be scoped per Account per day (mirroring Ask AI), since only the count was specified.
- §8 (SM-1) — A demo cohort of 5 test users is a round-number target for a course-project demo, not a measured requirement.
