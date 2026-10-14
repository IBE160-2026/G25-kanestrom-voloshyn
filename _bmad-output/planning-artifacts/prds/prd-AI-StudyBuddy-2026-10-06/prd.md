---
title: "PRD: AI Study Buddy"
status: final
created: 2026-10-06
updated: 2026-10-14
sources:
  - ../../briefs/brief-AI-StudyBuddy-2026-09-16/brief.md
  - ../../ux-designs/ux-AI-StudyBuddy-2026-10-13/EXPERIENCE.md
  - ../../ux-designs/ux-AI-StudyBuddy-2026-10-13/DESIGN.md
---

# PRD: AI Study Buddy
*Project name: AI Study Buddy. The product's interface name and wordmark: "Study Buddy" (see DESIGN.md › Brand & Style).*

## 0. Document Purpose

This PRD defines Version 1 of AI Study Buddy for the team building it (an IBE160 course project) and for whoever plans architecture and implementation next. It builds on the [Product Brief](../../briefs/brief-AI-StudyBuddy-2026-09-16/brief.md) and repeats its problem, users, and vision only where context needs them. Vocabulary is anchored in the Glossary (§3). Features (§4) group behavior descriptions with globally numbered Functional Requirements. Inline `[ASSUMPTION]` tags mark inferences made without explicit confirmation; §10 indexes them.

FR IDs are stable. FR-1 through FR-18 keep their original numbers; FRs added in the 2026-10-14 update are numbered FR-19 onward and placed in their feature group, so reading order is not strictly numeric.

The companion UX contract is [EXPERIENCE.md](../../ux-designs/ux-AI-StudyBuddy-2026-10-13/EXPERIENCE.md) (behavior, flows, states, microcopy, accessibility floor) and [DESIGN.md](../../ux-designs/ux-AI-StudyBuddy-2026-10-13/DESIGN.md) (visual system). This PRD states capabilities and their testable consequences; layout, labels, keys, copy, and visual detail live in those spines.

## 1. Vision

Students already have what they need to study — lecture slides, PDFs, notes — but turning that material into active practice (a quiz, a flashcard set, a summary) takes time most students don't spend, so they fall back on passive re-reading. AI Study Buddy removes that step: a student uploads their own course material into a Project and immediately generates a Quiz, Flashcards, or a Summary, or asks Ask AI a question — all grounded in that material, not a generic curriculum.

The loop closes on itself rather than ending at "here's your quiz": incorrect quiz answers are captured as Mistakes, and Mistake Review turns them into targeted practice the student can return to whenever they choose. A Project keeps everything — uploaded material, generated content, chats, and mistake history — so a student can close the app and pick up exactly where they left off.

The study core of Version 1 is deliberately narrow: six integrated capabilities (Projects with upload, Quiz, Flashcards, Summarize, Ask AI, and Mistake Review). Around that core, V1 also carries the supports that make "saved and resumed" work day to day: email or Google sign-in, Settings, archiving and deleting Projects, a per-Project History, editable Topics, upload from a phone, and an English and Norwegian interface. These supports add no new way to study, but they do make V1 larger than the brief's "six features and nothing more", and the team accepts that cost knowingly. The bet is unchanged: *upload once, study many ways, review what you got wrong* — a simple, understandable, end-to-end workflow is worth more to a student right now than a longer feature list. This PRD makes no claim of category novelty: NotebookLM, Quizlet, Quizgecko, and Revisely already cover parts of this space, and StudyFetch in particular already does this at real scale. The differentiation is tight integration between generation and mistake-driven review, not an unprecedented feature.

Post-V1 direction (performance tracking, adaptive difficulty, cross-Project knowledge) is out of scope for V1 (§6, §7.2).

## 2. Target User

### 2.1 Jobs To Be Done

- Turn my own lecture slides, PDFs, and notes into quiz questions without writing them myself.
- Get flashcards out of my material instead of retyping terms by hand.
- Get a quick summary of a long reading before I commit time to it in full.
- Ask a specific question about my own course material and get an answer grounded in it, not a generic web answer.
- Know what I keep getting wrong, and get more practice on exactly that, without rebuilding the practice set myself.
- Get my handwritten notes in without scanning them on a separate device or app.
- Pick up a study session where I left off, without re-uploading or reorganizing anything.

### 2.2 Non-Users (v1)

- Instructors or course staff creating or assigning material — V1 is self-serve, single-student use only.
- Study groups sharing one Project — V1 Projects belong to one Account.
- K-12 or other non-higher-education learners — the brief and journeys are written for university or college material.

### 2.3 Key User Journeys

- **UJ-1. Emma turns a slide deck into graded practice in minutes.**
  - **Persona + context:** Emma, a university biology student, wants to turn today's lecture into something she can practice, not just re-read.
  - **Entry state:** unauthenticated, first visit.
  - **Path:** Optionally switches the interface to Norwegian → creates an Account with her first name, email, and password, or with Google → creates a Project and uploads her lecture slides → the Project names itself from the material (for example, "Biology — Cell Division") and lists the Topics it found → from the Project's Ask AI chat she starts Quiz and picks Topics and a question count (5, 10, or 20) → she answers questions drawn from her slides.
  - **Climax:** Each answer gets immediate feedback with an explanation grounded in her material that names where the answer comes from; at the end she sees her score and which answers were wrong.
  - **Resolution:** Her incorrect answers are recorded as Mistakes against the Project — she has turned a slide deck into graded practice without writing a single question.
  - **Edge cases:**
    - A Study Material too thin to quiz on is processed with a warning, or rejected if mostly unusable, rather than producing an empty or broken quiz (§5.1). A rejected file uses none of the Project's 10 slots.
    - If she uploads the wrong file, she removes it, even while it is processing (FR-20).
    - If she leaves mid-quiz, her Mistakes so far stay recorded and the quiz waits in History to be resumed (FR-25).

- **UJ-2. Emma comes back and clears her mistakes.**
  - **Persona + context:** Same Emma, a few days later, wants to pick up where she left off and deal with what she got wrong.
  - **Entry state:** authenticated (logs back in).
  - **Path:** Logs in and lands on "Biology — Cell Division", her last-opened Project, with her material, chats, and activity exactly as she left them → the Project shows a mistake indicator ("3 mistakes to review") → she chooses to start Mistake Review.
  - **Climax:** She practices questions built from the Quiz questions she got wrong, not a generic re-quiz.
  - **Resolution:** Her mistake count reflects what she has cleared; she decides when to review — the app surfaces Mistakes but never forces the session.
  - **Edge cases:**
    - A Project with no outstanding Mistakes shows no indicator rather than "0 mistakes to review."
    - If she stops part-way, cleared Mistakes stay cleared and the rest stay outstanding.
    - If Mistakes remain after a round's 20 practice questions, she sees how many remain and can start another round (FR-18).
    - An archived Project shows no indicator until she restores it.

- **UJ-3. Emma refreshes a topic with Summarize, then clarifies it with Ask AI.**
  - **Persona + context:** Same Emma, preparing for a lecture review session, wants a quick refresher rather than a full quiz.
  - **Entry state:** authenticated, inside her existing Project.
  - **Path:** Opens the Project on its chat → starts Summarize and chooses one Study Material, optionally narrowed to one of its Topics → reads the summary to refresh the topic → spots a concept she still doesn't understand → returns to the chat and asks "What is the difference between mitosis and meiosis?" → gets an answer grounded in her material → asks a follow-up question.
  - **Climax:** The follow-up conversation resolves her confusion from her own course material, with each answer naming its source.
  - **Resolution:** The chat and the summary are saved with the Project and listed in its History, so she can return to either later.

- **UJ-4. Emma gets her handwritten notes in from her phone.**
  - **Persona + context:** Same Emma, at her desk with the Project open on her laptop and paper notes from a seminar beside her.
  - **Entry state:** authenticated on the computer, inside her Project; not logged in on her phone.
  - **Path:** Chooses to upload from her phone → scans the code shown on the computer → the phone opens an upload page for that one Project, with no login → she photographs six pages, drops a blurry one, and sends the rest.
  - **Climax:** Without a refresh, the computer shows one new Study Material ("Handwritten notes, 5 pages") being read, and the Project's file count goes up by one.
  - **Resolution:** Her handwritten notes work with Quiz, Flashcards, Summarize, and Ask AI like any other file; when she closes the upload on the computer, the phone link stops working.
  - **Edge cases:**
    - If one page is unreadable, the batch becomes one Study Material with a warning naming that page; if every page is unreadable, it is rejected and uses no slot.
    - If the batch would go past her daily image limit or the Project's 10 files, the phone warns her before sending.

- **UJ-5. Emma runs through a flashcard set before class.**
  - **Persona + context:** Same Emma, ten minutes before class, wants quick recall practice rather than a graded quiz.
  - **Entry state:** authenticated, inside her existing Project.
  - **Path:** Starts Flashcards from the chat, keeps the default 10 cards, and picks two Topics → steps through the cards, revealing each answer and marking it known or not yet known → cards marked not yet known come back later in the same set.
  - **Climax:** The set ends when every card is known, telling her how many cards she did and how many needed a second try.
  - **Resolution:** Nothing is scheduled and nothing is added to Mistake Review; the set is saved in History, where she can run it again.

## 3. Glossary

- **Account** — A student's registered identity, with a first name and one or more sign-in methods: email and password, a linked Google account, or both (FR-1, FR-19). Required to create or access Projects. An Account can own several Projects; a Project belongs to exactly one Account. At most one Account exists per email address.
- **Project** — A named, persistent container holding one or more Study Materials, the Study Content and chats generated from them, and the student's Mistakes. Named by the system from its first Study Material; the student can rename it while it is active (FR-4, FR-5).
- **Active Project** — A Project that is neither archived nor in Deleted projects. Only an active Project can be changed: chatting, generation, upload, and edits.
- **Archived Project** — A Project the student has moved out of the active list without deleting anything. It is read-only until restored (FR-23).
- **Deleted projects** — The group holding Projects the student has deleted, read-only and restorable until permanently deleted (FR-24). The lowercase "projects" matches the interface label; it is the same term as Project.
- **Study Material** — One file a student uploads into a Project (PDF, .docx, .pptx, .txt, .md, .jpg/.jpeg, .png, or .heic), or one batch of photos sent together from a phone (FR-21). The image formats cover photos of handwritten or printed notes; .heic is the default iPhone camera format. Each Study Material is processing, ready (fully or partly readable), or rejected (§5.1). Limits: FR-6, §5.2.
- **Topic** — A subject the system detects in a Study Material, which the student can rename, merge, delete, or add. Topics belong to one Study Material and are the unit of Selection Scope for Quiz and Flashcards (FR-22).
- **Selection Scope** — The part of a Project's Study Material that a generation feature or chat works from. Quiz and Flashcards: all Topics, or one or more chosen Topics. Summarize: one Study Material, whole or narrowed to one of its Topics. Ask AI: all Study Material, or one chosen Study Material.
- **Study Content** — AI-generated output derived from Study Material within a Selection Scope: a Quiz, a Flashcard set, or a Summary.
- **Quiz** — A set of AI-generated questions drawn from a Selection Scope, answered one at a time with immediate feedback and an end-of-quiz score (FR-10, FR-11).
- **Unfinished Quiz** — A Quiz left before its last question, saved with its progress and resumable from History (FR-25).
- **Flashcards** — A set of AI-generated question-and-answer cards drawn from a Selection Scope, self-assessed as known or not yet known. Flashcards never create Mistakes (FR-13, FR-14).
- **Summarize** — An AI-generated summary of one Study Material, whole or narrowed to one of its Topics (FR-15).
- **Ask AI** — The free-form chat for asking questions about a Project's Study Material, and the Project's home view. The interface calls it "Chat" (FR-16).
- **Chat** — One Ask AI conversation. A Project can hold several chats (FR-16).
- **History** — The per-Project list of past chats, Quizzes, Flashcard sets, and Summaries, newest first (FR-25).
- **Mistake** — A Quiz question answered incorrectly, recorded against the Project with the Study Material it came from. A Mistake is outstanding until cleared in Mistake Review or taken out of review when its Study Material is removed; its history stays for as long as the Project exists (FR-12, FR-18, FR-20).
- **Mistake Review** — A student-initiated practice session built from a Project's outstanding Mistakes (FR-17, FR-18).
- **Phone upload link** — A one-time, upload-only, short-lived link, shown on the computer as a QR code, that lets a phone send photos into one Project without logging in (FR-21).
- **Interface language** — English or Norwegian (bokmål) for the app's own text. It does not change the language of generated content (FR-29).
- **Settings** — The page where a student manages their Account, interface language, and data (FR-27).

## 4. Features

### 4.1 Account & Authentication

**Description:** A student needs a persistent identity for Projects to mean anything across sessions (the entry step of UJ-1 and the return in UJ-2). A student can sign up and log in with email and password, with Google, or with both on the same Account.

**Functional Requirements:**

#### FR-1: Account creation
A visitor can create an Account with a first name, an email, and a password. Realizes UJ-1.

**Consequences (testable):**
- An email already registered to an Account, by either sign-in method, cannot register a second Account; the student sees a clear error.
- A password shorter than 8 characters is refused, and no Account is created until a valid one is entered.
- Passwords are never stored or logged in plain text.
- An email-and-password Account can verify its email through an emailed link valid for 24 hours; an expired link does not verify the email.
- Until the email is verified, the student can request a new verification email at any time (FR-27); each new link is valid for 24 hours.
- Verification is not required to use the Account. It gates only linking Google (FR-19); it never gates changing or resetting the password (FR-3, FR-27).

#### FR-2: Login
A registered student can log in with their Account's email and password, or with Google (FR-19), and reach their Projects. Realizes UJ-2.

**Consequences (testable):**
- Correct credentials open the student's most recently used active Project, or, with no active Project, a start state offering to create one. Every Project is listed and appears exactly as saved.
- Incorrect credentials show a generic invalid-login message that does not reveal whether the email is registered.
- A session lasts 30 days before login is required again, unless the student logs out sooner.
- Logging out ends the session immediately.
- When a session expires during use, the next successful login returns the student to the Project they were in.

#### FR-3: Password reset
A student who has forgotten their password can request a reset link, emailed to the Account's address, and regain access. Applies to Accounts that have a password; an Account created with Google alone has none. Supports §1 Vision's account-persistence promise.

**Consequences (testable):**
- The reset-request reply is identical whether or not the email belongs to an Account.
- A reset request succeeds whether or not the Account's email is verified (FR-1).
- A reset link is valid for 1 hour and works once. Requesting a newer reset link invalidates every earlier one.
- An expired, used, or replaced link does not reset the password, and the student can request a new link.
- After a successful reset, the old password no longer works; the student logs in with the new one.

#### FR-19: Sign in with Google
A visitor can create an Account, or log in to one, with a Google account as an alternative to email and password. Realizes UJ-1.

**Consequences (testable):**
- At most one Account exists per email address, whichever sign-in method created it.
- A Google-created Account takes its first name and profile picture from the Google profile.
- A Google sign-in whose email matches an email-and-password Account with a **verified** email does not sign in at once. The student is told to log in once with the password; after that login the Google identity is linked, and either method reaches the same Account.
- A Google sign-in whose email matches an email-and-password Account with an **unverified** email takes over that Account: the student is signed in, and the Google identity is linked.
- After such a takeover, the old password no longer works, every session that existed before the takeover ends at once, and the student is told once (not on later logins) that the Account now signs in with Google.
- Google can be linked to an email-and-password Account, by either route, only after that Account's email is verified (FR-1). This rule and the takeover rule together stop someone from pre-registering another person's email to block or capture their Google sign-in.
- A Google identity already linked to a different Account cannot be linked again; the student sees a clear error.
- Cancelling Google consent leaves every Account unchanged, and the student can try again with either method.

### 4.2 Study Projects

**Description:** The container that makes "upload once, study many ways, resume later" possible. Realizes the Project beats of UJ-1, UJ-2, and UJ-4. Generation and chat (FR-10, FR-13, FR-15, FR-16) are available only in an active Project that holds at least one ready Study Material.

**Functional Requirements:**

#### FR-4: Project creation and auto-naming
A logged-in student can create a Project. Once the student's first Study Material upload to it completes, the system names the Project from that material's content. Realizes UJ-1.

**Consequences (testable):**
- A new Project with no Study Material shows a placeholder state, not a generated name.
- The generated name is derived from the extracted content, not a static placeholder like "Project 1"; the naming step runs only after extraction succeeds.

#### FR-5: Project renaming
A student can rename an active Project at any time to any text. Realizes UJ-1 and gives the student final control over the auto-name.

**Consequences (testable):**
- A rename takes effect immediately and persists across sessions.
- An archived Project, or one in Deleted projects, cannot be renamed until restored (FR-23, FR-24).

#### FR-6: Study Material upload
A student can upload one or more files into an active Project at any time, in PDF, .docx, .pptx, .txt, .md, .jpg/.jpeg, .png, or .heic format, from the computer or from a phone (FR-21). Realizes UJ-1.

**Consequences (testable):**
- An unsupported file type is rejected with an error naming the supported types.
- A Project holds up to 10 Study Materials. Material still processing counts toward the 10; rejected material never counts, and a processing file that is then rejected frees its slot. An upload that would exceed 10 is rejected with a clear message.
- A file over 50 MB is rejected with a clear message. For phone batches, the limit applies to each photo (FR-21).
- The server enforces the 10-file and 50 MB limits on receipt, whatever the client showed before sending.

#### FR-7: Text extraction from images
For an uploaded .jpg/.jpeg, .png, or .heic image, on its own or in a phone batch, the system extracts the printed or handwritten text it contains, so that content works with Quiz, Flashcards, Summarize, and Ask AI on equal footing with text formats. Realizes UJ-1 and UJ-4 for image uploads.

**Consequences (testable):**
- No feature distinguishes an image-sourced Study Material from a text-sourced one.
- Image extraction follows the three outcomes in §5.1: fully readable is accepted with no warning, partly readable is accepted with a warning that extraction may be incomplete, and mostly unreadable is rejected.
- Every image counts toward the Account's limit of 25 images per day, including each photo in a phone batch. An image past that limit is declined with a clear message rather than failing silently.
- `[NOTE FOR PM]` The confidence thresholds separating the three outcomes are deferred to architecture: this PRD requires the outcomes (accept, warn and continue, reject) but does not set the numeric boundaries. Whoever designs the extraction pipeline must set and document concrete thresholds before this FR is implementable.

**Out of Scope:**
- Other image formats, such as WEBP or GIF.

#### FR-8: Project resume
A returning student who opens a Project finds it exactly as they left it. Realizes UJ-2.

**Consequences (testable):**
- Every Study Material that has not been removed is present, with its Topics.
- Every Study Content item and chat is present and reachable through History (FR-25).
- An Unfinished Quiz can be resumed where it was left (FR-25).

#### FR-9: Mistake indicator
A Project shows a count of its outstanding Mistakes. Realizes UJ-2.

**Consequences (testable):**
- The indicator appears whenever the outstanding count is greater than zero and the Project is active.
- No indicator appears when the count is zero.
- The indicator is hidden while the Project is archived or in Deleted projects; the Mistakes are kept, and the indicator returns on restore.

#### FR-20: Study Material removal
A student can remove any Study Material from an active Project, including one still processing or one that was rejected. Realizes UJ-1.

**Consequences (testable):**
- Removing ready material requires confirmation; removing rejected material does not.
- Removing material that is still processing cancels its processing.
- The slot frees immediately and the Project's file count updates.
- Study Content already generated from the removed material stays in History (FR-25).
- The material's Mistakes stay outstanding by default and are practiced from their saved question and explanation (FR-18). At removal, the student can instead take them out of the outstanding count; their history is kept either way.
- A failed removal leaves the material and its slot in place, and the student is told.

#### FR-21: Upload from phone
From an active Project on the computer, a student can create a one-time Phone upload link, shown as a QR code. Opening it on a phone lets the student take or choose photos and send them into that Project without logging in on the phone. Realizes UJ-4.

**Consequences (testable):**
- The link can only add Study Material to that one Project. The only data it can read is the Project's name, which the phone page shows so the student can confirm the destination; it cannot list the Project's files.
- The link expires about 10 minutes after creation, when the student closes it on the computer, or when the Project is archived or deleted, whichever comes first; an expired link cannot send. `[ASSUMPTION: "about 10 minutes" is a round-number lifetime, not a measured requirement.]`
- All photos sent together become one Study Material, which uses one of the Project's 10 slots (FR-6). There is no maximum number of photos per batch.
- A photo over 50 MB, or past the Account's 25 images per day (FR-7), is declined individually with a clear message, and the rest of the batch goes through. If no photo goes through, no Study Material is created and no slot is used.
- Before sending, the phone warns when the batch would exceed the daily image limit or the Project's 10-file limit. The server re-checks both on receipt (FR-6).
- If some photos are unreadable, the Study Material is accepted with a warning naming the unreadable pages; if all are unreadable, it is rejected (§5.1).
- Material sent from the phone appears in the Project on the computer without a manual refresh.

#### FR-22: Topic detection and editing
After a Study Material is processed, the system detects the Topics it covers and lists them with that material. The student can rename, merge, delete, or add Topics. Realizes UJ-1, UJ-3, and UJ-5.

**Consequences (testable):**
- Topics appear only after extraction succeeds.
- Detection yields about 1 Topic per 5 pages, with a minimum of 3 and a ceiling of 100 per Study Material. A page is a page for PDF; one slide or one photo counts as one page; for .txt, .md, and .docx, a page is about 500 words of extracted text.
- The minimum of 3 applies to detection only. The student can merge or delete Topics down to 1; the last Topic of a Study Material cannot be deleted.
- Merging two or more Topics of the same Study Material replaces them with one Topic covering all of their content.
- Above the ceiling, extra content is grouped under broader Topics; no content is left out of every Topic.
- The server calculates and enforces the Topic count and ceiling; a value sent by the client is not trusted.
- Renaming, merging, deleting, or adding a Topic affects only its own Study Material and never changes the material itself (§6).
- Topic edits persist and apply to every later Selection Scope choice.
- Topic choice in Quiz, Flashcards, and Summarize setup stays usable with up to 100 Topics per Study Material; grouping and collapse rules are owned by EXPERIENCE.md › Component Patterns.
- A student-added Topic absent from the material produces no fabricated content (§5.1).

#### FR-23: Project archive and restore
A student can archive a Project, moving it from the active list to an archived list without deleting anything, and can restore it at any time. Supports §1 Vision's "saved and resumed" promise; realizes the archived edge case of UJ-2.

**Consequences (testable):**
- An Archived Project's Study Material, Study Content, chats, and History can be read but not changed: no chatting, generation, Mistake Review, upload, Study Material removal, Topic edits, rename, or quiz resume until it is restored.
- Archiving needs no confirmation and can be undone immediately.
- Archiving keeps Mistakes (FR-9), lets running generation finish (FR-26), and revokes the Phone upload link (FR-21).
- Restoring returns the Project to the active list exactly as it was.

#### FR-24: Project deletion
A student can delete a Project, active or archived. A deleted Project moves to Deleted projects for 30 days and is then permanently deleted automatically. Supports §1 Vision (the student controls their own data).

**Consequences (testable):**
- Before deletion, the student confirms and is told that the Project can be restored for 30 days and is then permanently deleted.
- A Project in Deleted projects is read-only on the same terms as an Archived Project (FR-23).
- Each Project in Deleted projects shows how many days remain before permanent deletion.
- Restoring a Project from Deleted projects returns it, with everything in it, to the active list. `[ASSUMPTION: restore always returns the Project to the active list, even if it was archived before it was deleted.]`
- A student can delete a Project forever from Deleted projects after a confirmation stating that this cannot be undone; the Project is then permanently deleted at once.
- Permanent deletion, automatic or forever, removes everything in the Project (§5.4).
- Deleting a Project cancels its running generation (FR-26) and revokes its Phone upload link (FR-21).
- Deleting the open Project opens the student's most recent other active Project, or the start state if none remains (FR-2).

### 4.3 Quiz

**Description:** Turns a Selection Scope into graded, explained practice — the first thing Emma does with new material in UJ-1.

**Functional Requirements:**

#### FR-10: Quiz generation
In an active Project with at least one ready Study Material, a student can choose a Selection Scope (all Topics, or one or more Topics, FR-22) and generate a Quiz of 5, 10, or 20 questions (default 10). Realizes UJ-1.

**Consequences (testable):**
- Every question is traceable to content in the chosen Selection Scope.
- A single generation produces no more than 20 questions.
- If the Selection Scope cannot support the requested count without fabrication, the student is told and offered the largest count it supports; the Quiz is never padded (§5.1).

#### FR-11: Quiz taking with immediate feedback
A student answers Quiz questions one at a time; each answer immediately shows whether it was correct, with an explanation grounded in the Study Material. Realizes UJ-1.

**Consequences (testable):**
- Every explanation reflects only content in the Selection Scope and names its source (§5.1).
- At the end, the student sees an overall score that matches the number of correct answers, and which questions were answered incorrectly.

#### FR-12: Automatic mistake capture
Any Quiz question answered incorrectly is recorded as a Mistake against the Project. Realizes UJ-1, feeds UJ-2.

**Consequences (testable):**
- No separate student action is needed for an incorrect answer to become a Mistake.
- Each Mistake records which Study Material it came from, with the question and explanation as shown.
- A Mistake is recorded when the question is answered, so Mistakes already made stay recorded if the student leaves the Quiz part-way.

### 4.4 Flashcards

**Description:** An alternative study format from the same material, for students who prefer recall practice. Flashcards are self-assessed within the set and do not feed Mistake Review. Realizes UJ-5.

**Functional Requirements:**

#### FR-13: Flashcard generation
In an active Project with at least one ready Study Material, a student can choose a Selection Scope as in FR-10 and generate a Flashcard set of 5, 10, or 20 cards (default 10). Realizes UJ-5.

**Consequences (testable):**
- Every card is traceable to content in the chosen Selection Scope.
- A single generation produces no more than 20 cards.
- If the Selection Scope cannot support the requested count without fabrication, the student is told and offered the largest count it supports; the set is never padded (§5.1).

#### FR-14: Flashcard study and self-assessment
A student steps through a Flashcard set, viewing each card's prompt and revealing its answer on demand, then marks the card known or not yet known. Cards marked not yet known return later in the same set until marked known. Realizes UJ-5.

**Consequences (testable):**
- Marking a card not yet known creates no Mistake.
- No spaced-repetition schedule or due date is created.
- Each card's answer names its source (§5.1).
- At the end of the set, the student sees how many cards were completed and how many needed more than one attempt; no score is given.

### 4.5 Summarize

**Description:** Compresses a Selection Scope into a summary a student can read before committing to the full material.

**Functional Requirements:**

#### FR-15: Summary generation
In an active Project, a student can generate a summary of one ready Study Material, whole or narrowed to one of its Topics (FR-22). Realizes UJ-3.

**Consequences (testable):**
- The summary contains no claims absent from the source Study Material.
- Each summary section names its source (§5.1).

### 4.6 Ask AI

**Description:** A conversational way to question a Project's material directly, for questions the other generation features don't anticipate. Ask AI is the Project's home view; Quiz, Flashcards, Summarize, and Mistake Review start from it and return to it.

**Functional Requirements:**

#### FR-16: Project-grounded chat
In an active Project with at least one ready Study Material, a student can ask free-form questions about the Project's Study Material, up to 50 messages per Account per day. A Project can hold several chats: the student can start a new chat at any time, and earlier chats are kept. A chat answers from all Study Material in the Project by default; the student can narrow it to one Study Material. Realizes UJ-3.

**Consequences (testable):**
- An answer never introduces facts absent from the material in the chat's scope, and names its source (§5.1).
- Narrowing to one Study Material changes which material later answers in that chat draw from, until the student broadens the scope again.
- Starting a new chat leaves the previous chat unchanged and lists it in History (FR-25).
- Each chat persists across sessions (UJ-2); a reopened chat in an active Project can be continued.
- A 51st message from the same Account on the same day, in any chat or Project, is declined with a clear message rather than failing silently.

**Feature-specific NFRs:**
- An answer starts appearing within 5 seconds of sending and is complete within 15 seconds.

### 4.7 Mistake Review

**Description:** Closes the loop from Quiz back into targeted practice, entirely at the student's initiative — the core of UJ-2.

**Functional Requirements:**

#### FR-17: Mistake Review session start
From an active Project with one or more outstanding Mistakes, a student can choose to start a Mistake Review session. Realizes UJ-2.

**Consequences (testable):**
- Mistake Review never starts automatically and is never pushed on the student.

#### FR-18: Targeted practice generation
A Mistake Review session generates practice questions that target the content of each outstanding Mistake, built from the original incorrect Quiz answer, not a generic re-quiz. Realizes UJ-2.

**Consequences (testable):**
- Practice targets incorrect Quiz answers only (FR-12).
- One Mistake Review generation produces no more than 20 practice questions. When more than 20 Mistakes are outstanding, the oldest are selected first; the rest wait for a later round.
- An outstanding Mistake whose Study Material was removed (FR-20) is practiced with its saved original question and explanation; nothing new is generated for it (§5.1). It clears normally when answered correctly.
- A correct practice answer removes the Mistake from the outstanding count, and the indicator (FR-9) decrements, only after the answer is saved; if saving fails, the Mistake stays outstanding.
- A wrong practice answer keeps the Mistake outstanding.
- Each practice question's feedback names its source (§5.1).
- When a round's practice questions are all answered and Mistakes remain, the session shows how many remain, and the student can start another round at once as a new generation. The session is reported as all cleared only when no outstanding Mistakes remain.
- Ending a session part-way keeps every cleared Mistake cleared and every other Mistake outstanding.
- Mistake Review generation follows the lifecycle in FR-26.
- The record of the original incorrect attempt, and of any review attempts, stays stored after the Mistake is cleared or taken out of review (FR-20), for as long as the Project exists. Permanent deletion of the Project (FR-24) or the Account (FR-28) deletes it.

### 4.8 History & Generation

**Description:** Keeps everything a student has generated or discussed in a Project findable, and keeps generation from tying the student to one screen. Realizes the resume beats of UJ-1, UJ-3, and UJ-5.

**Functional Requirements:**

#### FR-25: History
A student can see every Study Content item and chat in a Project in one list, newest first, and filter it by type (chats, Quizzes, Flashcard sets, Summaries). Realizes UJ-1 (unfinished quiz), UJ-3, and UJ-5.

**Consequences (testable):**
- A completed Quiz or Flashcard set reopens as its read-only results and can be run again as a new generation with the same count, Topics, and Study Material, under the same per-generation limits (§5.2).
- Results generated from a Study Material that was later removed stay viewable; running such an item again is unavailable, and the student is told why (FR-20).
- A Summary or chat reopens in full.
- A Quiz left before the last question is saved as an Unfinished Quiz and resumes from the next unanswered question.
- A Flashcard set left part-way is saved as ended and is not resumable; it can be run again.
- In an Archived Project, or one in Deleted projects, History is read-only: nothing can be resumed, continued, or run again until the Project is restored.

#### FR-26: Generation lifecycle
Quiz, Flashcard, Summary, and Mistake Review generation continues when the student leaves the screen that started it, and the student can cancel it while it runs. Supports §1 Vision's "saved and resumed" promise.

**Consequences (testable):**
- Cancelling stops generation and keeps the student's setup choices.
- Generation that finishes while the student is elsewhere is saved and announced in the Project; Study Content is listed in History (FR-25).
- A generation failure keeps the setup choices, tells the student, and loses no saved work.
- Generation still running when its Project is archived finishes and is saved (FR-23); generation running when its Project is deleted is cancelled (FR-24).

**Feature-specific NFRs:**
- Each generation completes within 60 seconds end-to-end for a single lecture-deck-sized upload, in line with UJ-1's "in minutes" framing. `[ASSUMPTION: 60 seconds is a round-number target for a course-project MVP, not measured against a baseline.]`

### 4.9 Settings & Language

**Description:** Gives the student control over their Account, interface language, and data. Supports §1 Vision; FR-29 also realizes UJ-1's language choice.

**Functional Requirements:**

#### FR-27: Account settings
A logged-in student can view and manage their Account's first name, email, profile picture, and sign-in methods. Supports §1 Vision's account-persistence promise.

**Consequences (testable):**
- An email-and-password Account can change its first name; the change shows immediately and persists.
- An Account with a password can change it without a verified email; the old password then stops working.
- An Account with an unverified email can request a new verification email until the email is verified (FR-1).
- An email-and-password Account with a verified email can link a Google account (FR-19).
- A Google Account's name and picture follow the Google profile and cannot be edited in the app.
- From Settings, the student can set the interface language (FR-29), delete a Project (FR-24), and delete the Account (FR-28).

#### FR-28: Account deletion
A student can permanently delete their Account and everything in it after an explicit, deliberate confirmation (stronger than a single click) that names what is lost and states that it cannot be undone. Supports §1 Vision (the student controls their own data).

**Consequences (testable):**
- Deletion is immediate and permanent: every Project, including those in Deleted projects, and everything in them, including Mistake history, is deleted (§5.4).
- The session ends and the student sees confirmation that the Account was deleted.
- The email can then be used to register again. `[ASSUMPTION: account deletion frees the email address for a new Account.]`

#### FR-29: Interface language
The interface is available in English and Norwegian (bokmål), including errors and limit messages. The student can switch language at any time, including before signing in. Realizes UJ-1.

**Consequences (testable):**
- With no saved choice, the interface follows the browser language. `[ASSUMPTION: the interface falls back to English when the browser language is neither English nor Norwegian.]`
- A chosen language is saved to the Account and persists across sessions.
- Every interface string, including errors and limit messages, exists in both languages.
- Generated Study Content, Mistake Review practice, and chat answers follow the main language of the selected material, whatever the interface language.

## 5. Cross-Cutting Constraints and Guardrails

### 5.1 Content Integrity

- **Extraction outcomes.** Every Study Material format, not only images (FR-7), has three outcomes: a fully usable file is accepted silently; a partly usable file is accepted and processed from what was extracted, with a warning; a mostly or entirely unusable file (a corrupted document, an illegible image) is rejected rather than producing content from little or no real material. A phone batch follows the same rule as a whole, naming any unreadable pages (FR-21). `[NOTE FOR PM]` The threshold gap in FR-7's note applies to every format.
- **No fabrication.** No generation feature — Quiz, Flashcards, Summarize, Ask AI, or Mistake Review — fabricates content to cover missing or unreadable material, a student-added Topic absent from the material (FR-22), or a count the material cannot support (FR-10, FR-13). Every explanation, flashcard, summary, practice question, and chat answer reflects only what is present in the Study Material of its Selection Scope. Reusing a Mistake's saved question and explanation after its Study Material is removed is not new generation; that content was grounded when it was created (FR-18).
- **Sources.** Every Quiz explanation, flashcard answer, summary section, Mistake Review feedback, and chat answer names the Study Material it is drawn from and, where available, the location within it (slide or page).

### 5.2 Cost Controls and Limits

| Limit | Value | Applies to | Rationale |
|---|---|---|---|
| Quiz questions | Up to 20 per generation (FR-10) | Each Quiz generation, including running one again (FR-25) | Covers a typical lecture in one sitting while bounding per-request AI cost. |
| Flashcards | Up to 20 per generation (FR-13) | Each Flashcard generation, including running one again (FR-25) | Matches the 5, 10, or 20 choice; covers a topic without one unbounded generation. |
| Mistake Review practice questions | Up to 20 per generation (FR-18) | Each Mistake Review generation | Bounds per-session cost; remaining Mistakes wait for another round. |
| Ask AI messages | 50 per Account per day (FR-16) | All chats in all of the Account's Projects | Enough for a full day's study while bounding per-Account daily AI cost. |
| Image text extraction (OCR) | 25 images per Account per day (FR-7) | Every image, including each photo in a phone batch (FR-21) | Bounds the most expensive extraction path per Account. |
| Study Materials | 10 per Project (FR-6) | Includes material still processing; rejected material never counts | Keeps a Project focused and bounds storage. |
| File size | 50 MB per file and per phone photo (FR-6, FR-21) | Each uploaded file or photo; no maximum photos per batch | Bounds upload and extraction cost per item. |
| Topics | Ceiling of 100 per Study Material (FR-22) | Calculated by the server | 100 Topics covers about 500 pages, a full textbook; extra content is grouped, never dropped. |

No other daily limit exists. The server enforces every limit, and reaching one shows a clear message in the interface language rather than failing silently.

### 5.3 Data Use

Uploaded Study Material is used only to generate that student's own Study Content, chat answers, and Mistake Review practice. It is not shared with other Accounts. `[ASSUMPTION: the team can honor this promise with the chosen AI provider; architecture must confirm.]`

### 5.4 Data Lifecycle and Deletion

| Action | What happens to the data |
|---|---|
| Remove a Study Material (FR-20) | The material is removed at once and its slot frees. Study Content generated from it stays viewable. Its Mistakes stay outstanding, with their saved question and explanation, unless the student takes them out of review; their history is kept. |
| Archive a Project (FR-23) | Nothing is deleted. The Project is read-only until restored. |
| Delete a Project (FR-24) | The Project moves to Deleted projects, read-only and restorable, for 30 days, then is permanently deleted automatically. |
| Delete a Project forever (FR-24) | The Project and everything in it are permanently deleted at once. |
| Delete the Account (FR-28) | Immediate and permanent: every Project, including those in Deleted projects, and everything in them. |

Mistake history is kept for as long as its Project exists (FR-18). Permanent deletion covers stored files, extracted text, generated content, chats, and Mistakes, including Mistake history.

### 5.5 Account Security

Account security rules are owned by their FRs:

- One Account per email address, whatever the sign-in method (FR-1, FR-19).
- Passwords of at least 8 characters, never stored or logged in plain text (FR-1).
- Email verification by a 24-hour link, resendable until verified, gating only Google linking (FR-1).
- Google linking only after verification, and takeover of an unverified Account by a matching Google sign-in, which together close the pre-registration hole (FR-19).
- Login errors and reset replies that never reveal whether an email is registered (FR-2, FR-3).
- Single-use, 1-hour reset links, invalidated by any newer link (FR-3).
- An upload-only, one-Project, short-lived Phone upload link that reads only the Project's name (FR-21).

### 5.6 Interface Language

The interface is bilingual and generated content follows the material's language (FR-29). Microcopy and the Norwegian term list are owned by EXPERIENCE.md › Voice and Tone. The accessibility floor in EXPERIENCE.md › Accessibility Floor binds V1.

## 6. Non-Goals (Explicit)

- AI Study Buddy is not a general tutoring platform with its own curriculum (unlike Khanmigo) — it only teaches from material the student uploads.
- Not a note-taking or document-editing tool — Study Material is read and generated from, never edited. Topic edits change only the Topic list (FR-22).
- Not multi-user or collaborative — V1 has no shared Projects, group study, or instructor features.
- Not a mobile or native app. V1 is a desktop web app; the only phone surface is the single-purpose upload page reached by QR code (FR-21).
- Not an academic-integrity or plagiarism checker.
- Not a personalized or adaptive learning system in V1 (§7.2; may become one post-V1 per the brief's Vision).

## 7. MVP Scope

### 7.1 In Scope

- Account creation, login, logout, password reset, and Google sign-in with account linking (FR-1–FR-3, FR-19).
- Study Projects: creation, AI auto-naming, renaming, multi-file upload (including photos of handwritten or printed notes), text extraction from images, resume, and the Mistake indicator (FR-4–FR-9).
- Study Material removal, upload from phone, Topic detection and editing, Project archive and restore, and Project deletion with Deleted projects (FR-20–FR-24).
- Quiz: Topic-scoped generation of 5, 10, or 20 questions, immediate feedback with sourced explanations, scoring, and automatic mistake capture (FR-10–FR-12).
- Flashcards: Topic-scoped generation of 5, 10, or 20 cards, self-paced study with known or not-yet-known self-assessment (FR-13, FR-14).
- Summarize: one Study Material, whole or one Topic (FR-15).
- Ask AI: project-grounded chat as the Project home, several chats per Project, optional narrowing to one Study Material, persistent chat history (FR-16).
- Mistake Review: student-initiated, targeted practice from incorrect Quiz answers (FR-17, FR-18).
- History, Unfinished Quiz resume, running a Quiz or Flashcard set again, and background generation with cancel (FR-25, FR-26).
- Settings, account deletion, and an English and Norwegian interface (FR-27–FR-29).
- Cross-cutting content-integrity, cost-control, data-use, data-lifecycle, account-security, and language guardrails (§5).

### 7.2 Out of Scope for MVP

- Detailed progress analytics (performance tracked by topic over time).
- Spaced repetition scheduling.
- Advanced adaptive learning (difficulty or question selection that adapts automatically to performance).
- Cross-document knowledge linking (connecting concepts across a student's Projects).
- Advanced study recommendations.
- Full exam planning.
- Mandatory email verification — verification is available, and required only before linking Google (FR-1, FR-19).
- Image formats beyond .jpg/.jpeg/.png/.heic, such as WEBP or GIF (FR-7).
- Resuming a Flashcard set left part-way (FR-25).
- Profile-photo upload for email-and-password Accounts.
- Adding a password to an Account created with Google, and changing an Account's email address.
- Interface languages beyond English and Norwegian (bokmål).
- A light theme and user-chosen theme colors.
- Multi-user or shared Projects; a mobile app or full mobile layout beyond the phone upload page (§6).

All items above are candidates for post-V1 versions per the brief's long-term Vision, not MVP requirements.

## 8. Success Metrics

**Primary**
- **SM-1**: End-to-end core loop completion — in one sitting, a student creates a Project, uploads Study Material (text-based, and image-based either directly or from a phone), generates at least one of Quiz, Flashcards, or Summary, and, for Quiz, sees a scored result. Target: completes with no crash, no timeout, and no response contradicting the uploaded material, across a demo cohort of at least 5 test users each covering one text-based and one image-based upload. Validates FR-4, FR-6, FR-7, FR-10, FR-11, FR-13, FR-15, FR-21, FR-22. `[ASSUMPTION: a cohort of 5 is a round number for a course-project demo, not a measured requirement.]`
- **SM-2**: Mistake-to-review follow-through — of students with outstanding Mistakes from Quiz, the share who start a Mistake Review within 7 days. Target: at least 50%. Validates FR-9, FR-12, FR-17, FR-18.
- **SM-3**: Resume integrity — a Project reopened in a later session shows all Study Material, Study Content, and chats exactly as left, an Unfinished Quiz resumes where it stopped, and a restored archived or deleted Project returns unchanged. Validates FR-8, FR-16, FR-23, FR-24, FR-25.

**Gating Conditions (apply throughout — not secondary, per the brief)**
- **SM-4**: Generated-content relevance — sampled Quiz questions, Flashcards, Summaries, Ask AI answers, and Mistake Review practice contain no claims unsupported by the uploaded Study Material, including text extracted from images (FR-7), and each names a source that contains it. Saved items reused for removed material (FR-18) are judged as originally generated. Every other metric is evaluated under this condition. Validates FR-7, FR-10, FR-11, FR-13, FR-14, FR-15, FR-16, FR-18.
- **SM-5**: Usability without instruction — first-time test users complete UJ-1 (sign up → upload → generate → quiz → score) without being told how, per the brief's "simple enough to use without instruction" criterion. Target: every user in the SM-1 demo cohort. Equally gating. Validates FR-1, FR-4, FR-6, FR-10, FR-11. `[ASSUMPTION: as a gating condition, SM-5 requires every user in the SM-1 cohort to pass.]`

**Counter-metrics (do not optimize)**
- **SM-C1**: Do not speed up generation by shortening or skipping Quiz explanations — explanation quality is load-bearing for SM-4, not a cost to cut for SM-1.
- **SM-C2**: Mistakes taken out of review through Study Material removal (FR-20), or hidden by archiving or deleting a Project (FR-23, FR-24), do not count as follow-through for SM-2. Only Mistakes cleared in Mistake Review do.

## 9. Open Questions

No product decision is outstanding. These items remain open for other owners:

1. **Content Integrity thresholds (architecture).** The numeric confidence thresholds behind the three outcomes (accept, warn and continue, reject) are deliberately unset in this PRD (§5.1, FR-7); whoever builds the extraction pipeline must define and document them.
2. **AI provider data handling (architecture).** Confirm that the chosen AI provider lets the team honor the data-use promise (§5.3) and that permanent deletion (§5.4) reaches any copies the provider keeps.
3. **Norwegian strings (dependency for FR-29).** FR-29 is complete only once the team signs off the Norwegian strings proposed in EXPERIENCE.md › Voice and Tone; that sign-off is a UX action, not a PRD decision.

§10 lists the inferences made while applying product decisions.

## 10. Assumptions Index

- §4.2 (FR-21) — The Phone upload link's "about 10 minutes" lifetime is a round number, not a measured requirement.
- §4.2 (FR-24) — Restoring a Project from Deleted projects always returns it to the active list, even if it was archived before deletion.
- §4.8 (FR-26 NFR) — 60 seconds end-to-end per generation (Quiz, Flashcards, Summary, Mistake Review) is a round-number target standing in for the brief's qualitative "a few minutes," not a measured baseline.
- §4.9 (FR-28) — Account deletion frees the email address for a new Account.
- §4.9 (FR-29) — The interface falls back to English when the browser language is neither English nor Norwegian.
- §5.3 — The data-use promise can be honored with the chosen AI provider; architecture must confirm.
- §8 (SM-1) — A demo cohort of 5 test users is a round-number target for a course-project demo, not a measured requirement.
- §8 (SM-5) — As a gating condition, SM-5 requires every user in the SM-1 demo cohort to complete UJ-1 without instruction.
