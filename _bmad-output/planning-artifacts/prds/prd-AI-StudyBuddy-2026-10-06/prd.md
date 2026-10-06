---
title: "PRD: AI Study Buddy"
status: draft
created: 2026-10-06
updated: 2026-10-06
---

# PRD: AI Study Buddy
*Working title — confirm.*

## 0. Document Purpose

This PRD defines Version 1 of AI Study Buddy for the team building it (an IBE160 course project) and for whoever picks up architecture and implementation planning next. It builds on the existing [Product Brief](../../briefs/brief-AI-StudyBuddy-2026-09-16/brief.md) — problem, users, and vision are not repeated here beyond what's needed for context. Vocabulary is Glossary-anchored (§3); Features (§4) group behavioral descriptions with globally-numbered Functional Requirements (FR-1 through FR-N) nested under them; inline `[ASSUMPTION]` tags mark anything inferred without explicit confirmation, indexed in §9.

## 1. Vision

Students already have what they need to study — lecture slides, PDFs, notes — but turning that material into active practice (a quiz, a flashcard set, a summary) takes time most students don't spend, so they fall back on passive re-reading. AI Study Buddy removes that step: a student uploads their own course material into a Project, and immediately generates a Quiz, Flashcards, a Summary, or asks Ask AI a question — all grounded in that material, not a generic curriculum.

The loop closes on itself rather than ending at "here's your quiz": incorrect quiz answers are captured as Mistakes, and Mistake Review turns them into targeted extra practice the student can return to whenever they choose. A Project persists everything — uploaded material, generated content, and mistake history — so a student can close the app and pick up exactly where they left off.

Version 1 is deliberately narrow — six integrated capabilities plus the account system needed to make "saved and resumed" real — competing on a simple, understandable, end-to-end workflow rather than feature count. AI Study Buddy does not claim to be the first tool to do this (NotebookLM, Quizlet, StudyFetch, Quizgecko, and Revisely already cover parts of this space); the bet is on tight integration between generation and mistake-driven review, not novelty.

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
  - **Path:** Creates an Account → creates a new Project and uploads her lecture slides to it → the Project auto-generates a name from the uploaded material (e.g. "Biology — Cell Division") → the Project view offers Quiz, Flashcards, Summarize, and Ask AI → she starts Quiz, answering AI-generated questions drawn from her slides.
  - **Climax:** Each answer gets immediate feedback with an explanation grounded in her own material; at the end she sees her score and which answers were wrong.
  - **Resolution:** Her incorrect answers are automatically recorded as Mistakes against the Project — she's turned a slide deck into graded practice without writing a single question.
  - **Edge case:** If generation can't produce a usable Quiz from the uploaded material (e.g. a file with too little extractable text), the student sees a clear message rather than an empty or broken quiz. *(Exact fallback behavior: [NOTE FOR PM] — not yet specified, see §8.)*

- **UJ-2. Emma comes back and clears her mistakes.**
  - **Persona + context:** Same Emma, a few days later, wants to pick up where she left off and deal with what she got wrong.
  - **Entry state:** authenticated (logs back in).
  - **Path:** Opens her Project list → opens "Biology — Cell Division," where her uploaded material and prior activity are exactly as she left them → the Project shows a visible mistake indicator ("3 mistakes to review") → she chooses to open Mistake Review.
  - **Climax:** She practices questions built specifically from what she previously got wrong, not a generic re-quiz.
  - **Resolution:** Her mistake count reflects what she's reviewed; she decides for herself when to review — the app surfaces the mistakes but never forces the session.
  - **Edge case:** A Project with zero Mistakes shows no indicator rather than a misleading "0 mistakes to review."

## 3. Glossary

- **Account** — A student's registered identity (credentials required). Required to create or access Projects. One Account can own multiple Projects; a Project belongs to exactly one Account (no sharing/multi-user access in V1).
- **Project** — A named, persistent container holding one or more Study Materials, the Study Content generated from them, and the student's accumulated Mistakes. Auto-named by the system on creation from the uploaded Study Material; renameable by the student at any time.
- **Study Material** — A file a student uploads into a Project: PDF, .docx, .pptx, .txt, .md, .jpg/.jpeg, .png, or .heic. The last three cover photos of handwritten or printed notes (.heic being the default format for iPhone camera photos). A Project may hold multiple Study Materials, added over time.
- **Selection Scope** — The subset of a Project's Study Material that a generation feature (Quiz, Flashcards, Summarize) operates on: either the whole Project or a student-chosen topic/section within it.
- **Study Content** — AI-generated output derived from Study Material within a Selection Scope: a Quiz, a Flashcard set, or a Summary.
- **Quiz** — A set of AI-generated questions drawn from a Selection Scope, answered one at a time with immediate per-question feedback (correct/incorrect plus an explanation grounded in the Study Material) and an end-of-quiz score.
- **Flashcards** — A set of AI-generated question/answer cards drawn from a Selection Scope.
- **Summarize** — An AI-generated summary of a Selection Scope (a whole Study Material or a chosen part of one).
- **Ask AI** — A free-form chat interface for asking questions about a Project's Study Material. Answers from all Study Material in the Project by default; the student may narrow a question to one specific Study Material.
- **Mistake** — A Quiz question a student answered incorrectly, recorded automatically against the Project.
- **Mistake Review** — A student-initiated practice session built from a Project's accumulated Mistakes.

## 4. Features

### 4.1 Account & Authentication

**Description:** A student needs a persistent identity for Projects to mean anything across sessions (realizes the entry step of UJ-1 and the return in UJ-2). `[ASSUMPTION: email + password is the signup/login mechanism — no third-party sign-in (Google, etc.) specified or assumed for V1.]`

**Functional Requirements:**

#### FR-1: Account creation
A visitor can create an Account with an email and password. Realizes UJ-1.

**Consequences (testable):**
- An email already registered to an Account cannot register a second Account; the student sees a clear error.
- Passwords are never stored or logged in plain text.

**Out of Scope:**
- Email verification and password-reset flows. `[ASSUMPTION: deferred past V1 — see Open Questions §8.]`

#### FR-2: Login
A registered student can log in with their Account's email and password and reach their Project list. Realizes UJ-2.

**Consequences (testable):**
- Correct credentials reach the student's own Project list, showing every Project exactly as previously saved.
- Incorrect credentials show a generic invalid-login message (does not reveal whether the email is registered).

**Notes:** Session length/expiry is unspecified. `[NOTE FOR PM]` — see §8.

### 4.2 Study Projects

**Description:** The container that makes "upload once, study many ways, resume later" possible. Realizes the project-handling beats of both UJ-1 and UJ-2.

**Functional Requirements:**

#### FR-3: Project creation and auto-naming
A logged-in student can create a new Project. Once the student's first Study Material upload to it completes, the system generates a Project name from that material's content. Realizes UJ-1.

**Consequences (testable):**
- A newly created Project with no Study Material yet shows a placeholder state, not a generated name.
- The generated name reflects the uploaded content's subject matter (e.g. slides on cell division auto-name the Project something recognizably related, not a generic "Project 1").

#### FR-4: Project renaming
A student can rename a Project at any time to any text they choose. Realizes UJ-1 (auto-name) and gives the student final control.

**Consequences (testable):**
- A rename takes effect immediately and persists across sessions.

#### FR-5: Study Material upload
A student can upload one or more files into a Project, in PDF, .docx, .pptx, .txt, .md, .jpg/.jpeg, .png, or .heic format, added at any time (not only at creation).

**Consequences (testable):**
- An unsupported file type is rejected with a clear, specific error message naming the supported types.
- A Project can hold more than one Study Material simultaneously (e.g. several lecture PDFs from the same course, or several photographed pages of handwritten notes).

**Out of Scope:**
- Maximum file size/count per Project. `[NOTE FOR PM]` — see §8.

#### FR-6: Text extraction from images
For an uploaded .jpg/.jpeg, .png, or .heic Study Material, the system extracts the text it contains — printed or handwritten — so that content is usable by Quiz, Flashcards, Summarize, and Ask AI on equal footing with text-based formats.

**Consequences (testable):**
- An image whose text (handwritten or printed) is extracted is treated identically to a PDF/.docx/.pptx/.txt/.md upload by every other feature — no feature distinguishes an image-sourced Study Material from a text-sourced one.
- When extraction confidence is low, the student sees a clear flag on that Study Material (e.g. "this may not have been read correctly") rather than the system silently generating Quiz/Flashcard/Summary/Ask AI content from a poor or garbled extraction.
- An image too illegible for any usable extraction produces a clear message to the student rather than proceeding with empty or near-empty text. `[NOTE FOR PM]` — the confidence threshold for "low" vs. "too illegible" is undefined; see §8.

**Out of Scope:**
- Any other image-adjacent format (e.g. WEBP, GIF).

#### FR-7: Project resume
A returning, logged-in student who opens a previously created Project sees every previously uploaded Study Material and every previously generated Study Content item exactly as left. Realizes UJ-2.

#### FR-8: Mistake indicator
A Project visibly shows a count of its outstanding Mistakes (e.g. "3 mistakes to review") when that count is greater than zero, and shows no such indicator when it is zero. Realizes UJ-2.

### 4.3 Quiz

**Description:** Turns a Selection Scope into graded, explained practice — the first thing Emma does with new material in UJ-1.

**Functional Requirements:**

#### FR-9: Quiz generation
A student can choose a Selection Scope (the whole Project or a specific topic/section) and generate a Quiz from it. Realizes UJ-1.

**Consequences (testable):**
- Every generated question is traceable to content present in the chosen Selection Scope (no questions about material outside it).

#### FR-10: Quiz taking with immediate feedback
A student answers Quiz questions one at a time; each answer immediately shows whether it was correct and an explanation grounded in the Study Material. At the end, the student sees an overall score. Realizes UJ-1.

**Consequences (testable):**
- Every explanation references content actually present in the Selection Scope, not invented facts.
- The end-of-quiz score accurately reflects the number of correct answers given.

#### FR-11: Automatic mistake capture
Any Quiz question answered incorrectly is automatically recorded as a Mistake against the Project, with no separate student action required. Realizes UJ-1, feeds UJ-2.

**Feature-specific NFRs:**
- Quiz generation should complete within a time the student experiences as "a few minutes" end-to-end per UJ-1's framing, not a multi-step wait. `[ASSUMPTION: no numeric SLA set for a course-project MVP — see Open Questions §8.]`

### 4.4 Flashcards

**Description:** An alternative study format from the same material, for students who prefer recall-practice over quiz format.

**Functional Requirements:**

#### FR-12: Flashcard generation
A student can choose a Selection Scope (whole Project or a specific topic/section) and generate a Flashcard set from it, the same scoping model as Quiz (FR-9).

**Consequences (testable):**
- Every generated flashcard is traceable to content present in the chosen Selection Scope.

#### FR-13: Flashcard study
A student can step through a generated Flashcard set, viewing each card's prompt and revealing its answer on demand.

**Out of Scope:**
- Flashcards do not generate Mistakes or feed Mistake Review in V1. `[ASSUMPTION: Mistake Review is Quiz-sourced only, based on the narrated journeys — confirm in §8 if flashcards should also contribute.]`

### 4.5 Summarize

**Description:** Compresses a Selection Scope into a summary a student can read before committing to the full material.

**Functional Requirements:**

#### FR-14: Summary generation
A student can generate a summary of either an entire Study Material or a chosen part of one.

**Consequences (testable):**
- The summary contains no claims absent from the source Study Material.

### 4.6 Ask AI

**Description:** A conversational way to interrogate a Project's material directly, for questions the other three generation features don't anticipate.

**Functional Requirements:**

#### FR-15: Project-grounded chat
A student can ask free-form questions about a Project's Study Material. By default, Ask AI answers using all Study Material in the Project; the student can optionally narrow a question to one specific Study Material.

**Consequences (testable):**
- An answer never introduces facts absent from the material in the active scope (whole Project or the narrowed document).
- Narrowing to one document changes which material subsequent answers draw from until the student broadens it again.

**Notes:** Whether chat history persists across sessions (part of "resume" per UJ-2) is unspecified. `[NOTE FOR PM]` — see §8.

### 4.7 Mistake Review

**Description:** Closes the loop from Quiz back into targeted practice, entirely at the student's initiative — the core of UJ-2.

**Functional Requirements:**

#### FR-16: Mistake Review session start
From a Project with one or more outstanding Mistakes, a student can choose to start a Mistake Review session. Nothing about Mistake Review is pushed or forced on the student. Realizes UJ-2.

#### FR-17: Targeted practice generation
A Mistake Review session generates additional practice questions targeting the specific content/topic of each outstanding Mistake, not a generic re-quiz.

**Notes:** Whether a Mistake is cleared from the count once answered correctly in review, or persists until some other condition, is unspecified. `[NOTE FOR PM]` — see §8.

## 5. Non-Goals (Explicit)

- AI Study Buddy is not a general tutoring platform with its own curriculum (unlike Khanmigo) — it only ever teaches from material the student uploads.
- Not a note-taking or document-editing tool — uploaded Study Material is read and generated-from, not edited in place.
- Not multi-user or collaborative — V1 has no shared Projects, group study, or instructor-side features.
- Not a mobile or native app — V1 is a desktop web app only.
- Not an academic-integrity or plagiarism checker.
- Not a personalized/adaptive learning system in V1 — no performance tracking by topic, no spaced repetition, no cross-document intelligence (see §6.2; may become true post-V1 per the brief's Vision).

## 6. MVP Scope

### 6.1 In Scope

- Account creation and login (FR-1, FR-2).
- Study Projects: creation, AI auto-naming, renaming, multi-file upload (including photos of handwritten or printed notes), text extraction from images, resume (FR-3–FR-8).
- Quiz: scoped generation, immediate per-question feedback with explanations, scoring, automatic mistake capture (FR-9–FR-11).
- Flashcards: scoped generation, self-paced study (FR-12, FR-13).
- Summarize: whole-document or partial summarization (FR-14).
- Ask AI: project-grounded chat, optional single-document narrowing (FR-15).
- Mistake Review: student-initiated, targeted practice generation (FR-16, FR-17).

### 6.2 Out of Scope for MVP

- Detailed progress analytics (performance tracked by topic over time).
- Spaced repetition scheduling.
- Advanced adaptive learning (difficulty/question selection that adapts automatically to performance).
- Cross-document knowledge linking (connecting concepts across a student's multiple Projects).
- Advanced study recommendations.
- Full exam planning.
- Email verification and password reset (FR-1 Out of Scope). `[NOTE FOR PM]` — revisit if timeline allows; a course deliverable without any account-recovery path is a real usability gap if the demo runs long.
- Image formats beyond .jpg/.jpeg/.png/.heic, e.g. WEBP, GIF (FR-6 Out of Scope).
- Multi-user/shared Projects, mobile app (§5 Non-Goals).

All items above are candidates for post-V1 versions per the brief's long-term Vision, not MVP requirements.

## 7. Success Metrics

**Primary**
- **SM-1**: End-to-end core loop completion — a student can, in one sitting: create a Project, upload Study Material (text-based or image-based), generate at least one of Quiz/Flashcards/Summary, and (for Quiz) see a scored result. Target: works without failure for all test/demo users. Validates FR-3, FR-5, FR-6, FR-9, FR-10, FR-12, FR-14.
- **SM-2**: Mistake-to-review follow-through — of Projects that accumulate at least one Mistake, the student opens Mistake Review at least once. Validates FR-8, FR-11, FR-16, FR-17.
- **SM-3**: Resume integrity — a Project reopened in a later session shows all previously uploaded Study Material and generated Study Content with nothing lost. Validates FR-7.

**Secondary**
- **SM-4**: Generated-content relevance — Quiz questions, Flashcards, Summaries, and Ask AI answers, sampled during testing, contain no claims unsupported by the uploaded Study Material, including material sourced from images via FR-6's text extraction. Validates FR-6, FR-9, FR-10, FR-12, FR-14, FR-15.
- **SM-5**: Usability without instruction — a first-time student test user can complete UJ-1 (upload → generate → quiz → score) without being told how, per the brief's "simple enough to use without much explanation" criterion.

**Counter-metrics (do not optimize)**
- **SM-C1**: Speed of generation should not be optimized by shortening or skipping explanations in Quiz feedback — explanation quality is load-bearing for SM-4, not a cost to cut for SM-1's "completes quickly" framing.

## 8. Open Questions

1. What happens when a Quiz, Flashcard, or Summary generation can't produce usable output from the uploaded material (too little text, corrupted file, illegible handwriting)? (UJ-1 edge case, FR-9.)
2. Should Account sessions expire, and if so when — must a student log in every visit, or does a session persist for some period? (FR-2.)
3. Should email verification and/or password reset be in V1, given this is meant to be a genuinely usable deliverable, not a disposable mockup? (FR-1, §6.2.)
4. Is there a maximum file size or file count per Project upload, even a rough one to design around? (FR-5.)
5. What confidence threshold separates "flag as low-confidence but proceed" from "too illegible, reject" for image text extraction? (FR-6.)
6. Should Flashcards contribute to Mistake Review, or does Mistake Review remain Quiz-only? (FR-13.)
7. Does Ask AI chat history persist when a student resumes a Project later, the same way uploaded material and generated content do? (FR-15, UJ-2.)
8. Once a Mistake is answered correctly during Mistake Review, is it cleared from the Project's mistake count, or does it persist for further review? (FR-17.)
9. Is there any expected limit or cost-control on AI generation calls (quiz/flashcard/summary/chat/image extraction), given this runs on a course-project budget? (Cross-cutting.)

## 9. Assumptions Index

- §4.1 — Account creation/login uses email + password; no third-party sign-in in V1.
- §4.1 (FR-1 Out of Scope) — Email verification and password reset are deferred past V1.
- §4.3 (FR-11 NFR) — No numeric performance SLA set for quiz generation speed; "a few minutes end-to-end" is qualitative, per the brief's framing.
- §4.4 (FR-13 Out of Scope) — Mistake Review draws only from Quiz mistakes, not Flashcards.
