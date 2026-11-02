# Acceptance Criteria

These are the testable consequences of each PRD requirement, keyed by FR id and grouped by capability. A story is done only when its FRs' criteria pass, with automated tests in mock mode (AD-4). The AD ids name the spine rules that govern each item. Copy, layout, and keys are in EXPERIENCE.md.

## CAP-1 — Account & authentication

- **FR-1 Account creation** (UJ-1). A visitor creates an Account with a first name, email, and password.
  - An email already registered by either method can't register again; the visitor sees a clear error.
  - A password shorter than 8 characters is refused, and no Account is created (AD-2).
  - Passwords are never stored or logged in plain text.
  - An email Account can verify through an emailed link valid for 24 h; an expired link doesn't verify.
  - Until verified, the student can request a new link at any time. Each new link is valid for 24 h and replaces older ones (AD-19).
  - Verification never gates use, password change, or reset. It gates only Google linking.
- **FR-2 Login** (UJ-2), by email and password, or by Google.
  - Correct credentials open the most recently used active Project, or, with none, a start state offering to create one. Every Project is listed exactly as saved.
  - Wrong credentials show one generic message that never reveals whether the email is registered.
  - A session lasts 30 days unless the student logs out. Logging out ends it at once, and the old token is refused (AD-2).
  - After a session expires mid-use, the next login returns the student to the Project they were in.
- **FR-3 Password reset** (only for Accounts with a password).
  - The reset-request reply is identical whether or not the email exists, and a Google-only Account gets no link (AD-19).
  - Reset works whether or not the email is verified.
  - A reset link is valid for 1 h and works once. A newer link invalidates every earlier one. An expired, used, or replaced link doesn't reset, and a new one can be requested.
  - After a reset, the old password stops working and every other session ends (AD-19).
- **FR-19 Sign in with Google** (UJ-1).
  - At most one Account exists per email, whatever method created it.
  - A Google-created Account takes its first name and picture from Google.
  - A Google sign-in that matches a **verified** email Account signs in and links at once; either method then reaches the same Account.
  - A Google sign-in that matches an **unverified** email Account takes it over:
    - the old password stops working
    - every earlier session ends
    - the student is told once

    This is enforced server-side even if the browser skips the follow-up call (AD-19).
  - Google can be linked to an email Account, by either route, only after verification.
  - A Google identity already linked to another Account can't be linked again, and the student sees a clear error.
  - Cancelling consent changes nothing, and both methods can be retried.
  - With no Google keys configured, the Google option is hidden (AD-2).

## CAP-2 — Study Projects

- **FR-4 Creation and auto-naming** (UJ-1).
  - A new Project with no material shows a placeholder, not a generated name.
  - The name is derived from extracted content, never a static placeholder. Naming runs only after extraction succeeds, at most once, and a naming failure never fails the upload (AD-14).
- **FR-5 Renaming.**
  - A rename takes effect at once and persists.
  - Archived and deleted Projects can't be renamed until restored.
  - Blank names are rejected, and names are trimmed and capped at 100 characters (AD-14).
- **FR-8 Resume** (UJ-2, SM-3).
  - Every non-removed Study Material is present, with its Topics.
  - Every Study Content item and chat is present and reachable through History.
  - An Unfinished Quiz resumes where it was left.
- **FR-9 Mistake indicator** (UJ-2).
  - It shows the outstanding count whenever the count is > 0 and the Project is active, with no indicator at 0.
  - It is hidden while the Project is archived or deleted. The Mistakes are kept, and the indicator returns on restore.

## CAP-3 — Study Material upload, extraction, and removal

- **FR-6 Upload** (UJ-1). One file per request; several files upload one after another, from the computer or a phone.
  - An unsupported type is rejected with an error naming the supported types.
  - A Project holds up to 10 Study Materials:
    - processing material counts toward the 10
    - rejected material never counts
    - a processing file that is then rejected frees its slot
    - an upload past 10 is rejected with a clear message
  - A file over 50 MB is rejected; for phone batches the limit applies per photo.
  - The server enforces 10 files and 50 MB on receipt, whatever the client showed.
- **FR-7 Text extraction from images** (UJ-1, UJ-4).
  - No feature distinguishes image-sourced material from text-sourced material.
  - Each image is accepted, accepted with an "extraction may be incomplete" warning, or rejected, per AD-6.
  - Every image, including each phone photo, counts toward 25 per Account per day (Europe/Oslo day). The 26th is declined with a clear message (AD-12).
  - WEBP, GIF, and other formats are out of scope.
- **§5.1 Content Integrity** applies to every format and to each phone batch as a whole, using AD-6's thresholds. A corrupt or unparseable file is rejected.
- **FR-20 Removal** (UJ-1), from an active Project, including processing and rejected material.
  - Removing ready material needs confirmation; removing rejected material doesn't.
  - Removing processing material cancels its processing.
  - The slot frees at once and the file count updates.
  - Study Content generated from the material stays in History, with its source labels (AD-23).
  - The material's Mistakes stay outstanding by default and are practised from their saved question and explanation. Alternatively, the student takes them out of the count at removal. Their history is kept either way.
  - A failed removal leaves the material and its slot in place, and the student is told.

## CAP-4 — Quiz

- **FR-10 Generation** (UJ-1), in an active Project with at least one ready Material.
  - The scope is all Topics or chosen Topics, and the count is 5, 10, or 20 (default 10).
  - Every question is traceable to the scope.
  - One generation produces ≤ 20 questions.
  - A scope too thin for the requested count tells the student and offers the largest supported count, with no padding. The note appears in setup, before generating (AD-7).
  - A scope over the context budget asks the student to narrow it. A normal whole Project of 10 lecture-sized Materials always fits (AD-7).
- **FR-11 Taking** (UJ-1).
  - Questions are answered one at a time.
  - Each answer immediately shows correct or incorrect, plus an explanation that reflects only the scope and names its source. The explanation is hidden until the question is answered (AD-9).
  - At the end, the score equals the number of correct answers, and the wrong ones are listed.
- **FR-12 Mistake capture** (UJ-1 → UJ-2).
  - An incorrect answer becomes a Mistake with no extra action. It records its Study Material, with the question and explanation as shown.
  - It is recorded when the question is answered, so it survives leaving part-way.
  - A repeat failure on an item that is already outstanding never creates a duplicate (AD-10).

## CAP-5 — Flashcards

- **FR-13 Generation** (UJ-5).
  - It uses the same scoping as Quiz, with 5, 10, or 20 cards (default 10).
  - Every card is traceable to the scope.
  - One generation produces ≤ 20 cards.
  - A too-thin scope offers the largest supported count, with no padding.
- **FR-14 Study and self-assessment** (UJ-5).
  - Answers are revealed on demand, and each names its source.
  - Each card is marked known or not yet known. Not-yet-known cards return later in the same set until marked known.
  - Marking creates no Mistake and no schedule or due date.
  - The end shows the cards completed and how many needed more than one attempt, with no score.

## CAP-6 — Summarize

- **FR-15 Summary** (UJ-3), in an active Project.
  - It covers one ready Study Material, whole or one Topic.
  - It contains no claims absent from the source.
  - Each summary section names its source.

## CAP-7 — Ask AI

- **FR-16 Project-grounded chat** (UJ-3), in an active Project with at least one ready Material.
  - Answers never introduce facts absent from the chat's scope, and they name their source.
  - Narrowing to one Material applies to that chat's later answers until it is broadened.
  - A new chat can start at any time. Earlier chats stay unchanged and are listed in History.
  - Each chat persists across sessions and can be continued while the Project is active.
  - The 51st message from an Account on the same day, in any chat or Project, is declined with a clear message. A failed or abandoned answer uses no message (AD-12, AD-25).
  - **NFR:** an answer starts appearing within 5 s and is complete within 15 s.

## CAP-8 — Mistake Review

- **FR-17 Session start** (UJ-2). It is available only from an active Project with at least one outstanding Mistake, and it never starts automatically or is pushed on the student.
- **FR-18 Targeted practice** (UJ-2).
  - It targets incorrect Quiz answers only, built from the original incorrect answer, never a generic re-quiz.
  - One generation produces ≤ 20 practice questions, from the oldest outstanding Mistakes first. The rest wait for a later round.
  - A Mistake whose material was removed is practised with its saved question and explanation, with nothing new generated. It clears normally.
  - A correct answer removes the Mistake from the count, and the indicator decrements only after the answer is saved. If saving fails, the Mistake stays outstanding.
  - A wrong answer keeps the Mistake outstanding.
  - Each practice question's feedback names its source.
  - After a round with Mistakes remaining, the session shows how many remain, and another round can start at once. "All cleared" shows only when none remain.
  - Ending part-way keeps cleared Mistakes cleared and the rest outstanding.
  - It follows the FR-26 lifecycle.
  - The original incorrect attempt and every review attempt stay stored after clearing or withdrawal, for as long as the Project exists. Permanent deletion of the Project or the Account deletes them.

## CAP-9 — Project archive and deletion

- **FR-23 Archive and restore** (UJ-2).
  - An archived Project can be read but not changed. That rules out:
    - chatting and generation
    - Mistake Review
    - upload and Material removal
    - Topic edits and rename
    - resuming a quiz
  - Archiving needs no confirmation and can be undone at once.
  - Archiving keeps Mistakes, lets running generation finish and save, and revokes the phone link.
  - Restore returns the Project to the active list exactly as it was.
- **FR-24 Deletion.**
  - Before deleting, the student confirms and is told the Project can be restored for 30 days and is then permanently deleted.
  - A Project in Deleted projects is read-only, like an archived one, and shows the days remaining.
  - Restore returns it, with everything in it, to the active list.
  - "Delete forever" needs a confirmation saying it can't be undone, and deletes the Project at once.
  - After 30 days, deletion happens automatically.
  - Permanent deletion, automatic or forever, removes everything in the Project (§5.4).
  - Deleting cancels the Project's running generation and revokes its phone link.
  - Deleting the open Project opens the most recent other active Project, or the start state if none remains.

## CAP-10 — Upload from phone

- **FR-21 Upload from phone** (UJ-4).
  - The link can only add Study Material to its one Project. It can read only the Project's name and whether a batch fits the daily image limit and the 10-file limit, never the file list.
  - It expires about 10 minutes after creation, on close on the computer, or on archive or delete, whichever comes first. An expired link can't send.
  - A batch becomes one Study Material using one slot, with no maximum number of photos.
  - A photo over 50 MB, or past 25 images per day, is declined individually and the rest go through. If none go through, nothing is created and no slot is used.
  - Before sending, the phone warns when the batch would exceed the daily image limit or the 10-file limit. The server re-checks both on receipt.
  - When some photos are unreadable, the Material is accepted with a warning naming those pages. When all are unreadable, it is rejected.
  - New material appears on the computer without a manual refresh.

## CAP-11 — Topics

- **FR-22 Topic detection and editing** (UJ-1, UJ-3, UJ-5).
  - **Detection:**
    - Topics appear only after extraction succeeds.
    - Detection yields about 1 Topic per 5 pages, with a minimum of 3 (at detection only) and a ceiling of 100 per Material.
    - A page is a PDF page, one slide, or one photo, and about 500 words of extracted text for .txt, .md, and .docx.
    - Above the ceiling, content is grouped under broader Topics, and no content is left out.
    - The server calculates and enforces the count and the ceiling; client values aren't trusted.
  - **Editing:**
    - Topics can be renamed, merged, deleted, and added.
    - Merging Topics of the same Material makes one Topic covering all their content.
    - A Material keeps at least one Topic; the last can't be deleted.
    - Edits affect only their own Material, never change the material itself, persist, and apply to every later scope choice.
  - **Use:**
    - Topic choice stays usable with up to 100 Topics per Material; grouping follows EXPERIENCE.md.
    - A student-added Topic absent from the material produces no fabricated content.

## CAP-12 — History and generation lifecycle

- **FR-25 History** (UJ-1, UJ-3, UJ-5).
  - One list per Project of chats, Quizzes, Flashcard sets, and Summaries, newest first and filterable by type.
  - A completed Quiz or Flashcard set reopens as read-only results. It can be run again as a new generation with the same count, Topics, and material, within the same limits.
  - Results from material removed later stay viewable. Running such an item again is unavailable, and the student is told why.
  - A Summary or chat reopens in full.
  - A Quiz left before its last question is an Unfinished Quiz and resumes at the next unanswered question.
  - A Flashcard set left part-way is saved as ended. It isn't resumable but can be run again.
  - In an archived or deleted Project, History is read-only: nothing can be resumed, continued, or run again until the Project is restored.
- **FR-26 Generation lifecycle.** Covers Quiz, Flashcards, Summary, and Mistake Review.
  - Generation continues when the student leaves the screen that started it, and it can be cancelled.
  - Cancelling stops generation and keeps the setup choices.
  - Generation that finishes elsewhere is saved, announced in the Project, and listed in History.
  - A failure keeps the setup choices, tells the student, and loses no saved work. An app restart mid-generation counts as a failure that can be retried (AD-20).
  - When the Project is archived, running generation still finishes and is saved. When the Project is deleted, it is cancelled.
  - **NFR:** each generation completes within 60 s for a single lecture-deck-sized upload.

## CAP-13 — Settings and account deletion

- **FR-27 Account settings.**
  - **Profile:**
    - An email Account can change its first name, which shows at once and persists.
    - A Google Account's name and picture follow Google and can't be edited.
  - **Password and sign-in methods:**
    - An Account with a password can change it without verification; the old password then stops working.
    - An unverified Account can request a new verification email until verified.
    - A verified email Account can link Google.
  - **Reachable from Settings:** interface language, deleting a Project, and deleting the Account.
- **FR-28 Account deletion.**
  - It needs a deliberate confirmation (stronger than one click) that names what is lost and says it can't be undone.
  - It is immediate and permanent: every Project, including Deleted projects, and everything in them, including Mistake history (§5.4).
  - The session ends, and the student sees confirmation.
  - The email can then register again.

## CAP-14 — Interface language

- **FR-29 Interface language** (UJ-1).
  - Every interface string, including errors and limit messages, exists in English and Norwegian (bokmål).
  - The student can switch at any time, including before signing in.
  - With no saved choice, the interface follows the browser language, with English as the fallback.
  - A chosen language is saved to the Account and persists.
  - Generated Study Content, practice, and chat answers follow the main language of the selected material, whatever the interface language.
  - FR-29 is done only after the team signs off the Norwegian strings in EXPERIENCE.md (PRD §9.3).

## Cross-cutting

- **§5.1 Sources:** every Quiz explanation, flashcard answer, summary section, practice feedback, and chat answer names its Study Material and, where available, the slide or page.
- **§5.2 Limits:** the server enforces every limit, each with a clear message in the interface language. No other daily limit exists.
- **§5.3 Data use:** uploaded material serves only its owner's own content, is never shared with other Accounts, and isn't retained by the AI provider (AD-3).
- **§5.4 Lifecycle:** removal, archive, soft delete, delete forever, and Account deletion behave as in CAP-3, CAP-9, and CAP-13. Permanent deletion covers files, extracted text, generated content, chats, and Mistakes, including their history.
- **SM-4 Grounding (gating):** sampled Quiz questions, Flashcards, Summaries, chat answers, and practice contain no unsupported claims, including image-sourced material, and each names a source that contains it. Saved items reused for removed material are judged as originally generated.
- **SM-5 No instruction needed (gating):** every user in the SM-1 cohort completes UJ-1 (sign up → upload → generate → quiz → score) without being told how.
- **SM-C1:** never shorten or skip Quiz explanations to gain generation speed.
- **SM-C2:** Mistakes withdrawn by removal, or hidden by archive or delete, don't count as Mistake Review follow-through.
- **Accessibility:** EXPERIENCE.md's Accessibility Floor binds V1.
- **Mock mode:** every criterion that involves the LLM is testable with `LLM_MODE=mock`, with no key and no paid calls (AD-4).
