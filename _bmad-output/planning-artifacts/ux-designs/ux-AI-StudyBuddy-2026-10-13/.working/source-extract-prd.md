# Source Extract — PRD: AI Study Buddy

Extracted from `prd-AI-StudyBuddy-2026-10-06/prd.md` for EXPERIENCE.md drafting.

## 1. User Journeys (verbatim protagonist names)

### UJ-1. Emma turns a slide deck into graded practice in minutes.
Protagonist: **Emma** (university biology student). Entry state: unauthenticated, first visit.
1. Emma creates an Account.
2. Emma creates a new Project and uploads her lecture slides to it.
3. The Project auto-generates a name from the uploaded material (e.g., "Biology — Cell Division").
4. The Project view offers Quiz, Flashcards, Summarize, and Ask AI.
5. Emma starts Quiz, answering AI-generated questions drawn from her slides.
6. Climax: each answer gets immediate feedback with an explanation grounded in her own material; at the end she sees her score and which answers were wrong.
7. Resolution: her incorrect answers are automatically recorded as Mistakes against the Project.
8. Edge case: if a Study Material can't produce a usable Quiz (too little readable text), the system processes what it can with a warning, or rejects the material outright if mostly unusable (per Content Integrity rule, §5.1), rather than showing an empty/broken quiz.

### UJ-2. Emma comes back and clears her mistakes.
Protagonist: **Emma** (same, a few days later). Entry state: authenticated (logs back in).
1. Emma opens her Project list.
2. Opens "Biology — Cell Division" — her uploaded material and prior activity are exactly as she left them.
3. The Project shows a visible mistake indicator ("3 mistakes to review").
4. She chooses to open Mistake Review.
5. Climax: she practices questions built specifically from what she previously got wrong, not a generic re-quiz.
6. Resolution: her mistake count reflects what she's reviewed; she decides for herself when to review — the app never forces the session.
7. Edge case: a Project with zero Mistakes shows no indicator rather than a misleading "0 mistakes to review."

### UJ-3. Emma refreshes a topic with Summarize, then clarifies it with Ask AI.
Protagonist: **Emma** (same, preparing for a lecture review session). Entry state: authenticated, inside her existing Project.
1. Emma opens the Project.
2. Clicks Summarize and chooses one uploaded chapter as the Selection Scope.
3. Reads the generated summary to quickly refresh the topic.
4. Spots a concept she still doesn't understand.
5. Opens Ask AI and asks "What is the difference between mitosis and meiosis?"
6. Gets an answer grounded in her uploaded material.
7. Asks a follow-up question.
8. Climax: the follow-up conversation resolves her confusion using her own course material, not a generic web answer.
9. Resolution: the Ask AI conversation is saved with the Project so she can return to it later, alongside everything else.

**All three journeys share the single protagonist: Emma.** No other named personas appear in the PRD's User Journeys.

## 2. Functional Requirements by Feature Area (IA backbone)

### 4.1 Account & Authentication
- FR-1: Account creation — visitor creates an Account with email + password; duplicate email blocked with clear error; passwords never stored/logged in plain text; email verification optional for V1.
- FR-2: Login — registered student logs in with email/password, reaches their Project list; incorrect credentials show a generic invalid-login message; session persists 30 days unless logged out sooner.
- FR-3: Password reset — student requests reset (works regardless of email verification) and regains access via emailed reset link `[ASSUMPTION]`; old password stops working after reset.

### 4.2 Study Projects
- FR-4: Project creation and auto-naming — logged-in student creates a Project; name auto-generated from first uploaded Study Material's content once extraction succeeds; empty Project shows placeholder state, not a generated name.
- FR-5: Project renaming — student can rename a Project at any time to any text; takes effect immediately and persists across sessions.
- FR-6: Study Material upload — student uploads one or more files (PDF, .docx, .pptx, .txt, .md, .jpg/.jpeg, .png, .heic) at any time; unsupported type rejected with clear error naming supported types; max 10 Study Materials per Project (11th rejected); max 50 MB per file (larger rejected).
- FR-7: Text extraction from images — see Section 3 below (three-tier accept/warn/reject).
- FR-8: Project resume — returning logged-in student opens a previously created Project exactly as left: every previously uploaded Study Material present; every previously generated Study Content item (Quiz, Flashcards, Summary) present.
- FR-9: Mistake indicator — Project visibly shows a count of outstanding Mistakes (drawn from both Quiz and Flashcards); indicator (e.g., "3 mistakes to review") appears only when count > 0; no indicator when count is zero.

### 4.3 Quiz
- FR-10: Quiz generation — student chooses a Selection Scope (whole Project or specific topic/section) and generates a Quiz of up to 20 questions; every question traceable to content in the chosen scope; single request produces no more than 20 questions.
- FR-11: Quiz taking with immediate feedback — student answers questions one at a time; each answer immediately shows correct/incorrect plus an explanation grounded in the Study Material; end-of-quiz overall score shown, accurately reflecting correct answers.
- FR-12: Automatic mistake capture — any Quiz question answered incorrectly is automatically recorded as a Mistake against the Project; no separate student action required.
- Feature NFR: Quiz generation completes within 60 seconds end-to-end for a single lecture-deck-sized upload `[ASSUMPTION]`.

### 4.4 Flashcards
- FR-13: Flashcard generation — student chooses a Selection Scope (same scoping model as Quiz) and generates a Flashcard set of up to 50 cards; every card traceable to content in scope; single request produces no more than 50 flashcards.
- FR-14: Flashcard study and self-assessment — student steps through a Flashcard set, viewing each card's prompt and revealing its answer on demand; after revealing, marks card known or not yet known; marking "not yet known" automatically records a Mistake (same pool as Quiz mistakes); marking "known" creates no Mistake.

### 4.5 Summarize
- FR-15: Summary generation — student generates a summary of either an entire Study Material or a chosen part of one; summary contains no claims absent from the source Study Material.

### 4.6 Ask AI
- FR-16: Project-grounded chat — student asks free-form questions about a Project's Study Material, up to 50 messages per Account per day; by default answers using all Study Material in the Project, optionally narrowed to one specific Study Material; narrowing persists for subsequent answers until broadened again; answer never introduces facts absent from active scope; chat history persists within its Project and is available on resume; a 51st message same-day is declined with a clear message.

### 4.7 Mistake Review
- FR-17: Mistake Review session start — from a Project with one or more outstanding Mistakes, student can choose to start a Mistake Review session; never starts automatically, never pushed — always student-initiated.
- FR-18: Targeted practice generation — Mistake Review session generates additional practice questions targeting the specific content/topic of each outstanding Mistake, not a generic re-quiz; see Section 5 below for enter/leave "active" count behavior.

## 3. Three-Tier Accept/Warn/Reject Behavior (FR-7, Image Text Extraction)

Applies to uploaded .jpg/.jpeg, .png, or .heic Study Material (also generalized across all formats under §5.1 Content Integrity):

- **Accept (no warning):** "A fully readable image is accepted and processed with no warning." Once extracted, the Study Material is treated identically to a PDF/.docx/.pptx/.txt/.md upload by every other feature — no feature distinguishes an image-sourced Study Material from a text-sourced one.
- **Accept with warning:** "A partially readable image is accepted and processed using whatever text was successfully extracted, with a warning shown that extraction may be incomplete."
- **Reject:** "A mostly unreadable image is rejected outright rather than accepted with little or no usable text."
- Additional cap-driven rejection: "A 26th image processed for the same Account on the same day is declined with a clear message rather than silently failing." (See numeric caps, Section 4.)
- `[NOTE FOR PM]` Exact confidence thresholds separating the three outcomes are deferred to architecture — not set numerically in the PRD; UI must represent the three states without a specified numeric boundary.
- §5.1 generalizes this pattern PRD-wide: fully usable → accepted silently; partially usable → accepted + warning, using whatever was extracted; mostly/entirely unusable (corrupted doc, illegible image) → rejected outright. No generation feature (Quiz, Flashcards, Summarize, Ask AI) fabricates content to compensate for missing/unreadable material.

## 4. User-Facing Numeric Caps/Limits (must surface in UI)

- **Quiz generation cap:** up to 20 questions per generation request (FR-10, §5.2).
- **Flashcard generation cap:** up to 50 flashcards per generation request (FR-13, §5.2).
- **Ask AI daily message cap:** up to 50 messages per Account per day; 51st message same-day declined with a clear message (FR-16, §5.2). `[ASSUMPTION: per Account, shared across all Projects, not per individual Project.]`
- **OCR daily image cap:** up to 25 images processed per Account per day; 26th image same-day declined with a clear message (FR-7, §5.2). `[ASSUMPTION: scoped per Account per day, mirroring Ask AI's cap.]`
- **Study Material count limit:** up to 10 Study Materials per Project simultaneously; 11th upload rejected with a clear message (FR-6).
- **Study Material file size limit:** a single Study Material cannot exceed 50 MB; larger file rejected with a clear error message (FR-6).
- **Session length:** a logged-in session persists for 30 days before requiring login again, unless the student logs out sooner (FR-2). (Not a content cap, but user-facing/system behavior worth noting.)

## 5. Mistake Review — Active-Count Enter/Leave Behavior (relevant to mistake-indicator component states)

**Enters the active/outstanding count:**
- A Quiz question answered incorrectly is automatically recorded as a Mistake against the Project (FR-12) — no separate student action required.
- A Flashcard marked "not yet known" automatically records a Mistake against the Project — same pool as Quiz mistakes (FR-14). Marking "known" does not create a Mistake.
- The Mistake indicator (FR-9) draws its count from both Quiz and Flashcard mistakes combined, and appears whenever the outstanding count is greater than zero.

**Leaves the active/outstanding count:**
- Answering a Mistake's practice question correctly during Mistake Review removes it from the Project's outstanding Mistake count — the FR-9 indicator decrements accordingly (FR-18).
- The historical record of the original incorrect attempt, and of any review attempts, remains stored even after the Mistake is cleared from the active count (FR-18) — i.e., clearing is a count/active-state change, not a deletion of history.

**Indicator display rule (FR-9):**
- Count > 0 → indicator shown (e.g., "3 mistakes to review").
- Count = 0 → no indicator shown at all (not a "0 mistakes to review" message) — explicit edge case called out in UJ-2.

**Initiation rule (FR-17):** Mistake Review never starts automatically and is never pushed to the student — always a student-initiated choice, available only when count ≥ 1.
