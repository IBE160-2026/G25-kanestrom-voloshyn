---
title: "Reconciliation: PRD vs finalized UX (DESIGN.md + EXPERIENCE.md)"
created: 2026-10-14
purpose: Input to bmad-prd Update. Lists every approved UX scope change or requirement-level UX decision the PRD must absorb.
sources:
  - prd.md (status final, 2026-10-06) and .memlog.md
  - ../../ux-designs/ux-AI-StudyBuddy-2026-10-13/EXPERIENCE.md (status final, 2026-10-14) and .memlog.md
  - ../../briefs/brief-AI-StudyBuddy-2026-09-16/brief.md (status final)
---

# PRD ⇄ UX Reconciliation

Citation keys: **UXm-N** = line N of the UX `.memlog.md` (entries tagged `(override)` are approved scope changes); **EXP › Section** = EXPERIENCE.md section; **PRDm-N** = line N of the PRD `.memlog.md`. New FR numbers follow the numbering plan in §D.1.

Summary: **36 changes** (§A), **24 UI-only items** (§B), **10 conflicts** (§C).

---

## A. Change list

Proposed edits are written as capabilities. UI detail (labels, layout, keys, colors) stays in the UX spines.

### A.1 Account & authentication

| # | What changed | Source | PRD location | Proposed PRD edit |
|---|---|---|---|---|
| A1 | Sign in with Google alongside email + password. FR-1–FR-3 are kept, including password reset. | UXm-43 (override), UXm-71 (override, which replaces the earlier "Google only"); EXP › Scope Changes row "Sign in with Google…" | §4.1 Description, FR-1, FR-2, Glossary "Account", §10, §7.1 | **New FR-19 "Sign in with Google":** "A visitor can create an Account, or log in to one, with a Google account as an alternative to email and password." Amend the §4.1 Description: delete `[ASSUMPTION: email + password is the signup/login mechanism — no third-party sign-in (Google, and so on) specified or assumed for V1.]`. Amend the Glossary "Account" entry: "(credentials required)" → "(email and password, a linked Google account, or both)". |
| A2 | Account-linking rules: one Account per email. A Google sign-in whose email already has a password Account does not complete until the student logs in once with the password; after that, Google is linked and both methods work. A logged-in email Account can link Google from Settings. A Google account already linked to another Account is refused. Cancelled consent changes nothing. | UXm-108, UXm-117; EXP › State Patterns › Account; EXP › Notes for Architecture "Account identity and linking" | FR-1 Consequence 1, new FR-19, new FR-27 | FR-19 consequences: (a) "At most one Account exists per email address, whichever sign-in method created it." (b) "A Google sign-in whose email matches an existing email-and-password Account does not sign in. The student is told to log in once with the password, and after that login the Google identity is linked and either method reaches the same Account." (c) "A Google identity already linked to a different Account cannot be linked again; the student sees a clear error." (d) "Cancelling Google consent leaves the Account unchanged and shows no error." See conflict C4 (email verification). |
| A3 | Sign-up asks for a first name. Google accounts take first name (and photo) from the Google profile. | UXm-44 (override); EXP › Component Patterns › Create account screen, Google button | FR-1, FR-19 | Amend FR-1: "A visitor can create an Account with a first name, an email, and a password." Add to FR-19: "A Google-created Account takes its first name and profile picture from the Google profile." |
| A4 | Password minimum of 8 characters. | UXm-110 (2); EXP › State Patterns › Account "password too short" | FR-1 | Add an FR-1 consequence: "A password shorter than 8 characters is refused, and no Account is created until a valid one is entered." |
| A5 | Password reset hardening: the reply is identical whether or not the email has an Account, the link expires, and an expired link offers a new one. | UXm-110 (2), UXm-117; EXP › Notes for Architecture "Password reset" | FR-3, FR-3 Notes, §10 | Add FR-3 consequences: "The reset-request reply is identical whether or not the email belongs to an Account (no account enumeration)." "A reset link expires; opening an expired link lets the student request a new one." Convert the FR-3 Notes `[ASSUMPTION: reset works via a link emailed…]` to a confirmed decision, and remove it from §10. Clarify that reset applies to Accounts that have a password; a Google-only Account has none. |
| A6 | Log out, plus session expiry during use: after login the student returns to the same Project. | UXm-117; EXP › State Patterns › Account "Session expired during use (FR-2)"; Notes for Architecture "Session expiry" | FR-2 | Add FR-2 consequences: "A student can log out at any time; logging out ends the session immediately." "When a session expires during use, the next successful login returns the student to the Project they were in." |
| A7 | A returning sign-in lands on the last-opened Project (or, if that Project is archived, the most recent active one), not on a Project list. A student with no Projects lands on an empty Projects page. | UXm-69, UXm-117; EXP › IA table "Project home (chat)… a returning sign-in lands on the last Project"; State Patterns › Archived project | FR-2 Consequence 1, FR-8, UJ-2 | Amend FR-2 Consequence 1: "Correct credentials reach the student's own Project list, showing every Project…" → "Correct credentials open the student's most recently used active Project (or, with no Projects, a start state offering to create one). Every Project is listed and appears exactly as previously saved." |
| A8 | Settings: view account info (name, email, picture); email Accounts edit their first name in place; Change password; Link Google account; UI language; delete a project; delete the Account. Google Accounts show their profile data read-only. | UXm-45, UXm-67, UXm-71 (override), UXm-90 (6); EXP › IA › "Settings: one page, three sections" | New §4.9, new FR-27 | **New FR-27 "Account settings":** "A logged-in student can view their Account's name, email, and sign-in methods; change their first name (email-and-password Accounts); change their password (Accounts with a password); and link a Google account (FR-19)." Consequences: "Changing the password invalidates the old one." "A Google Account's name and picture follow the Google profile and are not editable in the app." |

### A.2 Projects & Study Material

| # | What changed | Source | PRD location | Proposed PRD edit |
|---|---|---|---|---|
| A9 | Delete a Project (from the project menu or from Settings › Your data). A confirmation names what is lost and states it is irreversible. Deletion cancels running generation. Afterwards the student lands on another Project or on the empty start state. | UXm-90 (4), UXm-102, UXm-110 (6), UXm-111; EXP › State Patterns › Destructive actions | New FR-24, §4.2 | **New FR-24 "Project deletion":** "A student can permanently delete a Project after an explicit confirmation that names what is lost (its Study Material, generated Study Content, and Mistakes) and states that the deletion cannot be undone." Consequences: "Deletion removes the Project's Study Material, Study Content, chat history, and Mistakes, including Mistake history." "Any generation running in that Project is cancelled." "Deleting the open Project opens the student's most recent other Project, or the start state if none remains." |
| A10 | Archive and restore Projects. Archiving needs no confirmation and offers Undo. An archived Project is read-only (chats, History, and files can be read; chat, generation, upload, removal, topic edits, rename, and quiz resume wait for Restore). Mistakes are kept but not surfaced. Running generation finishes and saves. An open phone link is revoked. Sign-in landing skips archived Projects. | UXm-112 (override), UXm-113–115, UXm-117; EXP › State Patterns › Archived project; Notes for Architecture "Archived projects" | New FR-23, FR-5, FR-6, FR-9, FR-8, Glossary | **New FR-23 "Project archive and restore":** "A student can archive a Project, which removes it from the active Project list into an archived list without deleting anything, and can restore it at any time." Consequences: "An archived Project's Study Material, Study Content, chat history, and History items can be read but not changed: no chatting, generation, upload, Study Material removal, topic edits, rename, or quiz resume until it is restored." "Archiving can be undone immediately." "Mistakes in an archived Project are kept; the Mistake indicator (FR-9) is not shown while it is archived and returns on restore." "Generation already running when a Project is archived finishes and is saved." "Archiving revokes any active phone upload link for that Project (FR-21)." See conflicts C6 and C7. |
| A11 | Phone upload via QR: a one-time, upload-only link scoped to the open Project. No login on the phone. Expires after about 10 minutes, or when the computer's QR dialog closes or the Project is archived. The link cannot read data. Arrivals show live on the computer. | UXm-46 (override), UXm-48, UXm-50, UXm-51, UXm-54; EXP › Component Patterns › Phone upload; State Patterns › Phone link; Notes for Architecture "Phone upload" | New FR-21, FR-6, FR-7, §6 Non-Goals | **New FR-21 "Upload from phone":** "From an open Project on the computer, a student can create a one-time upload link (shown as a QR code). Opening it on a phone lets the student take or choose photos and send them into that Project without logging in on the phone." Consequences: "The link can only add Study Material to that one Project; it cannot read or list any data." "The link expires about 10 minutes after creation, when the student closes it on the computer, or when the Project is archived, whichever comes first; an expired link cannot send." "Material sent from the phone appears in the Project on the computer without a manual refresh." See conflict C1. |
| A12 | One phone batch = one Study Material (for example, "Handwritten notes, 6 pages"). It counts as 1 of 10 files, and each photo counts toward the 25 images per day. A batch with some unreadable pages becomes one partly unreadable Study Material that names the failed pages. A fully unreadable batch is rejected. | UXm-49, UXm-89; EXP › State Patterns › Study Material, Phone link; Flow 4 | FR-21, FR-6, FR-7, Glossary "Study Material" | FR-21 consequences: "All photos sent together become one Study Material, counting as one of the Project's 10." "Each photo counts toward the daily image-extraction limit (FR-7, §5.2)." "If some photos are unreadable, the Study Material is accepted with a warning that names the unreadable pages; if all are unreadable, it is rejected (§5.1)." "The phone warns before sending when the batch would exceed the daily image limit or the Project's 10-file limit; the server re-checks both on receipt." Amend the Glossary "Study Material": "A file a student uploads…" → "A file, or a batch of photos sent together from a phone (FR-21), uploaded into a Project…". See conflict C8. |
| A13 | Slot counting: rejected files never count toward 10, and a file still processing ("Reading…") does count. A processing file that ends up rejected frees its slot. | UXm-37, UXm-81; EXP › State Patterns › Study Material "Counts toward 10" column; Notes for Architecture "Server-side limit re-check" | FR-6 Consequence 2 | Amend FR-6 Consequence 2: "A Project can hold up to 10 Study Materials simultaneously. Material still being processed counts toward the 10; rejected material never counts, and a processing file that is then rejected frees its slot. An upload that would exceed 10 is rejected with a clear message." |
| A14 | Student-initiated removal of Study Material: accepted files (with confirmation), files still processing (removal cancels processing), and rejected files (immediate). The slot frees. Study Content already generated from the file stays. The file's Mistakes stay active unless the student opts to remove them from review; their history is kept. | UXm-88, UXm-93 (override), UXm-94, UXm-95; EXP › Component Patterns › Remove file dialog; Notes for Architecture "File removal" | New FR-20, FR-6, FR-18, FR-12 | **New FR-20 "Study Material removal":** "A student can remove any Study Material from a Project, including one still being processed or one that was rejected." Consequences: "Removing accepted material requires confirmation; removing rejected material does not." "Removing material that is still processing cancels its processing." "The slot frees immediately and the count updates." "Study Content already generated from the removed material remains available." "The material's Mistakes stay outstanding by default; the student can choose, at removal, to take them out of the outstanding count, in which case their history is kept (FR-18)." "A failed removal leaves the material and its slot in place." Add an FR-12 consequence: "Each Mistake records which Study Material it came from." |
| A15 | AI topic detection per Study Material. The student can rename, delete, and add topics. Topics are the unit of Selection Scope. A hand-added topic not present in the material yields no content (Content Integrity). | UXm-25, UXm-26, UXm-29, UXm-30; EXP › Component Patterns › Topic chip; Notes for Architecture "Topic detection"; Scope Changes row "Editable AI-detected topics…" | New FR-22, Glossary "Selection Scope", new Glossary "Topic", FR-10, FR-13, FR-15, §5.1 | **New FR-22 "Topic detection and editing":** "After a Study Material is processed, the system detects the topics it covers and lists them with that material. The student can rename, delete, or add topics." Consequences: "Topics appear only after extraction succeeds." "Topic edits persist and are used by every later Selection Scope choice." "A student-added topic that does not appear in the material produces no fabricated content (§5.1)." Amend the Glossary "Selection Scope": "either the whole Project or a student-chosen topic/section within it" → "for Quiz and Flashcards: all topics, or one or more Topics; for Summarize: one Study Material, whole or narrowed to one of its Topics; for Ask AI: all Study Material or one Study Material (FR-16)." |
| A16 | Generated content follows the language of the uploaded material, not the UI language. | UXm-31; EXP › Foundation "Languages" | FR-29, §5.1 or FR-10/13/15/16 | FR-29 consequence: "Generated Study Content and chat answers are written in the language of the source Study Material, regardless of the UI language." |

### A.3 Project home, Quiz, Flashcards, Summarize, Ask AI

| # | What changed | Source | PRD location | Proposed PRD edit |
|---|---|---|---|---|
| A17 | Ask AI chat is the Project home. Quiz, Flashcards, and Summarize launch from it and return to it. There is no tab row. | UXm-73 (override); EXP › IA "The chat is the project home"; Scope Changes row 1 | UJ-1 Path, UJ-3 Path, Glossary "Ask AI", §4.6 Description | No FR change: the IA stays in the UX spine. Amend UJ-1 and UJ-3 (§D.2). Add one sentence to the §4.6 Description: "Ask AI is the Project's home view; the other generation features start from it." |
| A18 | Quiz, Flashcards, Summarize, and chat are unavailable until the Project has at least one Ready Study Material. They are also unavailable while the Project is archived. | EXP › Component Patterns › Tool buttons row, Composer; State Patterns › Project and chat "Empty Project" | FR-10, FR-13, FR-15, FR-16 | Add one shared consequence to each (or once in §4.2): "Generation and chat are available only once the Project has at least one successfully processed Study Material, and not while the Project is archived (FR-23)." |
| A19 | Quiz length picker: 5, 10, or 20 questions, default 10, chosen before generation. 20 stays the cap. | UXm-87, UXm-91; EXP › Component Patterns › Count picker | FR-10, §5.2 | Amend FR-10: "…and generate a Quiz of 5, 10, or 20 questions (default 10) from it." Keep the consequence "no more than 20". |
| A20 | Flashcard set size picker: 5, 10, or 20 cards, default 10 (inside the 50 cap). | UXm-70, UXm-102; EXP › Count picker; Scope Changes row "Flashcard sets of 5, 10, or 20 cards" | FR-13, §5.2 | Amend FR-13: "…generate a Flashcard set of 5, 10, or 20 cards (default 10)…". Decide whether the §5.2 50-card cap stays as headroom or drops to 20 (Open Question Q6). |
| A21 | Too little material for the chosen count: the system offers the largest count the material supports instead of padding. This is not an error. | UXm-91, UXm-102; EXP › Component Patterns › Too-little-material note | FR-10, FR-13, §5.1 | Add to FR-10 and FR-13: "If the Selection Scope cannot support the requested count without fabrication, the student is told and offered the largest count it supports; the system never pads with unsupported items (§5.1)." |
| A22 | Topic-based scope for Quiz and Flashcards: "All topics" or **one or more** Topics. | UXm-25; EXP › Topic scope picker | FR-10, FR-13 | Amend FR-10 and FR-13: "a Selection Scope (the whole Project or a specific topic/section)" → "a Selection Scope (all Topics, or one or more Topics, FR-22)". |
| A23 | Summarize scope: pick exactly one Study Material, then optionally one of its Topics (default: whole file). | UXm-60; EXP › Component Patterns › Summarize setup | FR-15 | Amend FR-15: "A student can generate a summary of one Study Material, either whole or narrowed to one of its Topics (FR-22)." This replaces "or a chosen part of one". |
| A24 | Flashcards: "Not yet" cards return later in the same session until marked known. No Mistake is recorded, and nothing is scheduled. The end of a set reports cards done and how many needed a second try (no score). | UXm-70, UXm-74 (override); EXP › Component Patterns › Flashcard, Flashcard end screen | FR-14 | Rewrite FR-14: "…the student can mark the card as known or not yet known. Cards marked not yet known return later in the same session until marked known." Replace both consequences with: "Marking a card not yet known does not create a Mistake." "No spaced-repetition scheduling or due dates are created." "At the end of the set, the student sees how many cards were completed and how many needed more than one attempt." Change "Realizes UJ-2 (Mistake Review) via Flashcard-sourced Mistakes" to "Realizes UJ-5 (§D.2)". |
| A25 | Source attribution: every grounded output (chat answer, quiz feedback, flashcard back, summary section, Mistake Review item) names its source Study Material and location. | UXm-40; EXP › Component Patterns › Source label | FR-11, FR-14, FR-15, FR-16, FR-18 | Add the consequence: "Each [explanation / card answer / summary section / answer] identifies the Study Material, and where available the location within it (for example, slide or page), that it is drawn from." This makes "grounded" testable. The format "filename · slide N" stays UI-only. |

### A.4 Mistakes & Mistake Review

| # | What changed | Source | PRD location | Proposed PRD edit |
|---|---|---|---|---|
| A26 | Mistakes come from wrong Quiz answers **only**. Flashcard "Not yet" never records a Mistake. | UXm-74 (override); EXP › Scope Changes row 3 | §1 Vision ¶2, Glossary "Mistake", FR-9, FR-13, FR-14, §4.4 Description, §4.7 Description, §7.1, SM-2 | FR-9: "drawn from both Quiz and Flashcards" → "drawn from incorrect Quiz answers". Glossary "Mistake": delete ", or a Flashcard the student marks as not yet known". §1 ¶2: "incorrect quiz answers and flashcards marked as not yet known are captured as Mistakes" → "incorrect quiz answers are captured as Mistakes". §4.4 Description: delete "— and, like Quiz, a source of Mistakes for Mistake Review". FR-13: delete "(it is captured only as a Mistake Review feeder via FR-14)". §4.7 Description: "Closes the loop from Quiz and Flashcards" → "Closes the loop from Quiz". §7.1 Flashcards bullet: "self-assessment feeding Mistake Review" → "in-session self-assessment"; Mistake Review bullet: delete "drawing from both Quiz and Flashcard mistakes". SM-2: "(from Quiz or Flashcards)" → "(from Quiz)"; drop FR-14 from "Validates". See conflict C2. |
| A27 | The Mistake indicator is a card at the top of the Project home ("{n} mistakes to review · Start"). There is no tab. It is hidden while the Project is archived. **FR-17 still holds:** the session starts only on the student's action and is never automatic or pushed. | UXm-72 (override); EXP › Component Patterns › Mistakes card; Interaction Primitives "Never automatic" | FR-9, FR-17 | FR-17 needs no change; it holds exactly. FR-9: add the consequence "The indicator is not shown while the Project is archived (FR-23)" and amend Consequence 1 to "…appears whenever the outstanding count is greater than zero and the Project is active." The card versus tab placement stays UI-only. See conflict C6. |
| A28 | A Mistake leaves the outstanding count only once the correct review answer is saved. Stopping a review part-way keeps cleared items cleared and the rest outstanding. Review practice is built from the original Quiz mistake. | UXm-110 (1), UXm-39, UXm-79; EXP › Mistake Review session; Notes for Architecture "Mistake clearing" | FR-18 | Add FR-18 consequences: "A Mistake leaves the outstanding count only after the correct review answer has been saved; if saving fails, it stays counted." "Ending a review session part-way keeps every cleared Mistake cleared and every other Mistake outstanding." "Practice targets incorrect Quiz answers only (FR-12)." |
| A29 | Mistakes can also leave the outstanding count through the file-removal opt-out (A14). Deleting a Project or the Account deletes Mistake history. | UXm-93, UXm-95, UXm-110 (6); EXP › Remove file dialog; Confirm dialog (delete project/account) | FR-18 Consequence 2 | Amend FR-18 Consequence 2: "The historical record … remains stored even after the Mistake is cleared from the active count, or removed from it through FR-20, for as long as the Project exists. Deleting the Project (FR-24) or Account (FR-28) deletes it." See conflict C9. |

### A.5 History & generation lifecycle (new feature group §4.8)

| # | What changed | Source | PRD location | Proposed PRD edit |
|---|---|---|---|---|
| A30 | History: one list per Project of past chats, quizzes, flashcard sets, and summaries, newest first, filterable by type. A finished quiz or flashcard set reopens as read-only results with "do it again" (a fresh run that reuses its count, topics, and file). Summaries and chats reopen normally. | UXm-90 (1), UXm-92, UXm-102, UXm-117; EXP › Component Patterns › History; Notes for Architecture "History", "Do it again" | New §4.8, new FR-25, FR-8, FR-16 | **New FR-25 "History":** "A student can see every Study Content item and chat in a Project in one list, newest first, and filter it by type." Consequences: "A completed Quiz or Flashcard set reopens as its read-only results and can be regenerated as a fresh run with the same count, Topics, and Study Material." "A Summary or chat reopens in full." "In an archived Project, History is read-only." Link to FR-8: "Every previously generated Study Content item … is present" is realized through History. |
| A31 | Unfinished Quiz resume: a quiz left part-way is saved as "Unfinished · n of total" and resumes where it was left. Mistakes from questions already answered stay recorded. A flashcard set left part-way is stored as ended and is not resumable. | UXm-110 (5); EXP › State Patterns › Leaving part-way; Notes for Architecture "Partial runs" | FR-25, FR-11, FR-12, FR-8 | FR-25 consequences: "A Quiz left before the last question is saved with its progress and can be resumed from the next unanswered question." "A Flashcard set left part-way is saved as ended and is not resumable; it can be regenerated." Add an FR-12 consequence: "Mistakes from questions already answered stay recorded if the student leaves the Quiz part-way." |
| A32 | Generation (Quiz, Flashcards, Summary) continues when the student navigates away and can be cancelled. On completion while the student is elsewhere, a notice appears in the chat and the item is saved to History. Deleting the Project cancels generation; archiving lets it finish. | UXm-61, UXm-90 (2, 3), UXm-110 (6), UXm-117; EXP › State Patterns › Generating; Notes for Architecture "Generation across navigation" | New FR-26, FR-12 NFR | **New FR-26 "Generation lifecycle":** "Quiz, Flashcard, and Summary generation continues if the student leaves the setup screen, and the student can cancel it while it runs." Consequences: "Cancelling stops generation and keeps the student's setup choices." "Generation that finishes while the student is elsewhere is saved to History and announced in the Project." "A generation failure keeps the setup choices and loses no saved work." Optionally extend FR-12's 60-second NFR to Flashcards and Summary, because the UX applies "up to 60 seconds" to all three (EXP › State Patterns › Generating). |

### A.6 Settings, language, account deletion, cross-cutting (new feature group §4.9; §5, §6)

| # | What changed | Source | PRD location | Proposed PRD edit |
|---|---|---|---|---|
| A33 | Account deletion: a confirmation names what is lost and requires an explicit typed confirmation. It deletes all files, Mistakes, and generated material, ends the session, and shows a confirmation on the login screen. | UXm-45, UXm-62, UXm-67, UXm-110 (6); EXP › Confirm dialog (delete account); State Patterns › Destructive actions | New FR-28 | **New FR-28 "Account deletion":** "A student can permanently delete their Account and everything in it after an explicit, deliberate confirmation (stronger than a single click) that names what is lost and states that it cannot be undone." Consequences: "All Projects, Study Material, Study Content, chat history, and Mistakes, including Mistake history, are deleted." "The session ends and the student sees confirmation that the Account was deleted." "The email can then be used to register again." [last item: inferred, confirm] |
| A34 | Bilingual UI in English and Norwegian (bokmål), switchable before and after sign-in. The default follows the browser language and is saved once the student chooses. All UI strings exist in both languages. | UXm-31, UXm-32, UXm-62; EXP › Foundation "Languages"; Notes for Architecture "String externalization" | New FR-29, §4.9 | **New FR-29 "Interface language":** "The interface is available in English and Norwegian (bokmål). The student can switch language at any time, including before signing in." Consequences: "With no saved choice, the interface follows the browser language (English otherwise)." "A chosen language is saved to the Account and persists across sessions." "Every interface string, including errors and limit messages, exists in both languages." Plus A16. [The "English otherwise" fallback is inferred.] |
| A35 | Desktop-only stance gets one exception: the phone upload page. "Mobile" in the specs means a narrow desktop window; there is no full mobile layout. | UXm-46 (override), UXm-98; EXP › Foundation "Form factor"; Responsive & Platform | §6 Non-Goals bullet 4, §7.2 last bullet | Amend §6: "Not a mobile or native app — V1 is a desktop web app only." → "Not a mobile or native app. V1 is a desktop web app; the only phone surface is the single-purpose upload page reached by QR code (FR-21)." Amend §7.2 "mobile app" the same way. See conflict C1. |
| A36 | Data-use promise on the login screen: "Your files are only used to create your study material." This is a product commitment the PRD does not state anywhere. | UXm-69; EXP › Component Patterns › Login screen | New §5.3 (or §5.1 addendum) | **New §5.3 "Data Use":** "Uploaded Study Material is used only to generate that student's own Study Content and chat answers. It is not shared with other Accounts." [Confirm that the team can honor this with the chosen AI provider; flag to architecture.] Optional: add an Accessibility floor here (keyboard-operable study loop, WCAG 2.2 AA contrast, reduced motion), which the UX treats as binding (EXP › Accessibility Floor) but the PRD never requires. |

---

## B. UI-only items (deliberately left out of the PRD)

These stay in DESIGN.md and EXPERIENCE.md. The PRD gets at most a pointer.

1. Layout and IA mechanics: no tab row, the Files panel on the right, the Sidebar and Sidebar strip, the Files strip, the "← Back to chat" header, and the chat bar (Scope control and History link).
2. Placement of the Mistakes card and its "Start" button. Only the capability (indicator, student-initiated start) is in FR-9 and FR-17.
3. The "All cleared! Nice work." panel and its "Make a new quiz" action.
4. The Account menu, the avatar (photo versus initials), and the "Welcome, [first name]" greeting. The first-name data is in A3.
5. Overflow "···" menus and their contents and order.
6. The Undo message for archiving (6 seconds, bottom left, stays while focused). The undo capability itself is in FR-23.
7. Confirm-dialog mechanics: focus on Cancel, typing DELETE/SLETT, the red final button. FR-28 says only "deliberate confirmation".
8. Delete-project confirmation without typed text. Rejected-file Remove without confirmation: kept as an FR-20 consequence in capability terms only.
9. Keyboard shortcuts and key hints (1–4, Space, →, ←, Enter/Esc).
10. The visual system: dark theme, every color token, amber for mistakes versus red for errors, the red exceptions, typography, motion, and reduced motion.
11. Light mode as a stretch goal. Optionally list it under §7.2 as "theme options", but it is not a requirement.
12. All microcopy and the Norwegian term glossary. These are owned by the EXP Voice and Tone section. FR-29 requires only that both languages exist.
13. Progress-step labels, the skeleton loading state, and the "Study Buddy is thinking…" indicator.
14. The format of the "Too-little-material" note. The capability is in A21.
15. Phone page UI: thumbnails, × removal and renumbering, the countdown format (minutes, then seconds), the expired-notice copy, and the footer credit.
16. Sidebar and Files panel collapsed state saved per account or per Project. This is persistence of UI state, so it goes in an architecture note, not an FR.
17. The narrow-window (below 1024px) behavior and the 44×44px touch targets.
18. History filter labels, empty, loading, and error states, and the "Unfinished · n of total" label. The capability is in FR-25.
19. The empty Projects page ("Create your first project") and the empty-Project drop zone. A7 covers the start state in one clause.
20. The running-low notice at 10 or fewer remaining messages or images. The PRD already requires a clear message at zero (FR-7, FR-16). Promote this only if the team wants it testable.
21. The source-label format "filename · slide N". The capability is in A25.
22. Inline rename in the Sidebar row and the top bar. FR-5 already covers renaming.
23. The login screen layout, the EN | NO corner toggle, and the Google button styling.
24. The "Do it again" and "Make more cards" button names, and the flashcard end-screen copy.

---

## C. Conflicts

| # | PRD / Brief side (quoted) | UX side (quoted) | Note |
|---|---|---|---|
| C1 | Brief › Scope: "delivered as a desktop web app"; Brief › Solution: "It is a desktop web app: no install, just upload and go." PRD §6: "Not a mobile or native app — V1 is a desktop web app only." PRD §7.2: "Multi-user/shared Projects, mobile app (§6 Non-Goals)." | UXm-46 (override): "'Upload from phone'… scanning it opens a mobile upload page… Product otherwise stays desktop web." EXP › Foundation: "desktop web app, plus one phone surface: the phone upload page, reached by QR code. No full mobile layout." | This is a narrow exception, not a reversal. Reword §6 and §7.2 (A35). The brief's "no install" still holds. Record the deviation from the brief in the PRD memlog. |
| C2 | PRDm-23 (6): "Mistake Review now sources from BOTH Quiz and Flashcards -- added FR-14 flashcard known/not-yet-known self-assessment that feeds the same Mistake pool." FR-14: "Marking a card 'not yet known' automatically records a Mistake against the Project — the same pool Quiz mistakes feed into." Also §1 ¶2, Glossary "Mistake", FR-9 "drawn from both Quiz and Flashcards", FR-13 "captured only as a Mistake Review feeder via FR-14", §7.1, and SM-2 "(from Quiz or Flashcards)… Validates… FR-14". | UXm-74 (override): "Mistake Review draws from wrong Quiz answers ONLY. Flashcard 'Not yet' cards repeat within the session and never enter Mistake Review (amends FR-9, FR-14)." | This reverses an explicit PRD decision. It **realigns with the brief**, which says "When a student gets a quiz question wrong, AI Study Buddy remembers it" and "Complete a quiz and have incorrect answers remembered", with no flashcards. Every text edit is listed in A26. FR-13 then needs a UJ (UJ-5, §D.2). |
| C3 | PRD §4.1: "`[ASSUMPTION: email + password is the signup/login mechanism — no third-party sign-in (Google, and so on) specified or assumed for V1.]`" §10: "Account creation/login uses email + password; no third-party sign-in in V1." | UXm-43 and UXm-71 (override): "Sign-in: email+password account OR Sign in with Google (keeps PRD FR-1..FR-3 incl. password reset, plus Google)." | This contradicts an assumption, not a confirmed decision. Delete the assumption and add FR-19. |
| C4 | FR-1 Notes: "Email verification is optional for V1 — not required for an Account to function"; PRDm-23 (3): "email verification remains optional/not required"; §7.2: "Email verification… optional, not required for V1." | EXP › State Patterns › Account: "Google sign-in, email has a password account… After one password login, Google is linked… One Account per email." | **Security interaction.** Because email is unverified, anyone can register a password Account under someone else's email first. The real owner's Google sign-in is then blocked ("log in with your password once") behind a password they don't know: this is account pre-hijacking or lockout. Resolve in the PRD: require email verification before an email Account can link Google, or let a verified Google identity take over an unverified email Account (Q1). |
| C5 | Brief › Executive Summary: "Version 1 is intentionally narrow: six tightly integrated features and nothing more." PRD §1: "Version 1 is deliberately narrow — six integrated capabilities plus the account system needed to make 'saved and resumed' real." | New in the UX: Settings, archive/restore, project deletion, History, phone upload, topic editing, bilingual UI, Google sign-in, account deletion. | The six study capabilities are unchanged; the additions are supporting features. Amend §1 to "…plus the account, project-management, and upload supports needed to make 'saved and resumed' real". Watch the effect on course-project capacity. |
| C6 | FR-9 Consequence 1: "The indicator… appears whenever the outstanding count is greater than zero." | UXm-113: "No mistakes card while archived; mistakes are kept and return on restore." | The literal FR text is contradicted. Qualify it with "…and the Project is active" (A27). |
| C7 | FR-5: "A student can rename a Project at any time." FR-6: "added at any time (not only at creation)." | UXm-113 and EXP › State Patterns › Archived project: "Composer, tool buttons, uploads, file Remove, topic edits, rename, 'Do it again', and quiz resume wait for Restore." | The "at any time" wording breaks for archived Projects. Change it to "at any time while the Project is active (FR-23)". |
| C8 | Glossary "Study Material": "A file a student uploads into a Project". FR-6: "A single Study Material cannot exceed 50 MB". FR-7 is written per image ("For an uploaded .jpg/.jpeg, .png, or .heic Study Material…"). | UXm-49: "all photos sent together become ONE Study Material (e.g. 'Handwritten notes, 6 pages'), counting as 1 of 10 files; each photo still counts toward the 25 images/day." | One Study Material is no longer one file. Redefine it in the Glossary (A12), and state whether 50 MB applies per photo or per batch (Q3). |
| C9 | FR-18 Consequence 2: "The historical record of the original incorrect attempt, and of any review attempts, remains stored even after the Mistake is cleared from the active count." | EXP › Confirm dialog (delete project) and (delete account): the deletion names what is lost, "files, mistakes, generated material", and "can't be undone". | Retention was unconditional and is now bounded by deletion. Scope FR-18 to "for as long as the Project exists" (A29). |
| C10 | Glossary "Ask AI": "Chat history persists within its Project." FR-16: "Chat history persists within its Project and is available when the student resumes" (singular, one continuous history). | EXP › IA: History is "One list of past chats, quizzes, flashcard sets, and summaries"; History filter "Chats"; UJ-3 step 9: "older items sit behind 'History'". | It is unclear whether a Project now holds multiple chat conversations, and the UX does not specify how a new chat starts. This must be decided before FR-16 or FR-25 is final (Q2). |

**Checked, not a conflict:**
- §7.2 "Spaced repetition scheduling": flashcard "Not yet" repeats only within the session, and the UX explicitly rules out scheduling and due dates (UXm-70). FR-14 should say so (A24).
- §6 "Not a note-taking or document-editing tool": topic editing changes metadata, not the Study Material. Add a clause to FR-22 if wanted.
- Brief › Solution "generate a **Quiz** from selected topics": the topics model (FR-22) fulfils this.
- Counter-metric SM-C1 is unaffected.

---

## D. Ripple effects

### D.1 FR numbering plan

**Recommendation: keep FR-1 through FR-18 unchanged and append FR-19 through FR-29 at the end of the global sequence.** Each new FR is placed physically inside its feature group, so reading order is no longer monotonic. Reason: EXPERIENCE.md and DESIGN.md cite FR-1 to FR-18 throughout (for example "FR-17 intact" and "(FR-18)"), and renumbering would silently break those references. Add one sentence to §0: "FR IDs are stable; FRs added in the 2026-10-14 update are numbered FR-19 onward and placed in their feature group."

| New FR | Title | Placed in |
|---|---|---|
| FR-19 | Sign in with Google (incl. linking rules) | §4.1, after FR-3 |
| FR-20 | Study Material removal | §4.2, after FR-9 |
| FR-21 | Upload from phone | §4.2 |
| FR-22 | Topic detection and editing | §4.2 |
| FR-23 | Project archive and restore | §4.2 |
| FR-24 | Project deletion | §4.2 |
| FR-25 | History (incl. unfinished Quiz resume, regenerate) | **new §4.8 History & Generation** |
| FR-26 | Generation lifecycle (background, cancel, notice) | §4.8 |
| FR-27 | Account settings (name, password, link Google) | **new §4.9 Settings & Language** |
| FR-28 | Account deletion | §4.9 |
| FR-29 | Interface language | §4.9 |

Amended in place (same ID): FR-1, FR-2, FR-3, FR-5, FR-6, FR-8 (realized via FR-25), FR-9, FR-10, FR-11, FR-12, FR-13, FR-14, FR-15, FR-16, FR-18. **FR-17 is unchanged.** It still holds: start only on the student's choice, from the card.

Alternative (not recommended): renumber everything in reading order (§4.1 FR-1–4, §4.2 FR-5–15, and so on). This gives a cleaner document, but the UX spines would then need a find-and-replace pass and every UXm reference would go stale.

### D.2 User Journey edits

The PRD UJs contain no "tab" wording. The edits are about home view, Mistake source, landing, and scope.

- **UJ-1:**
  - Path: "Creates an Account" → "Creates an Account (first name, email, and password, or Google)".
  - "the Project view offers Quiz, Flashcards, Summarize, and Ask AI → she starts Quiz" → "the Project opens on its Ask AI chat, from which she starts Quiz, picks Topics and a question count (5, 10, or 20)".
  - Resolution is unchanged.
  - Add edge cases: wrong file → she removes it, even while it is still processing (FR-20); she leaves mid-quiz → answered Mistakes stay and the quiz waits in History (FR-25); a rejected file does not use one of the 10 slots.
- **UJ-2:**
  - Path: "Opens her Project list → opens 'Biology — Cell Division,' where…" → "Logs in and lands on 'Biology — Cell Division' (her last-opened Project), where…".
  - Climax: "questions built specifically from what she previously got wrong" → "…from the Quiz questions she previously got wrong".
  - Add edge cases: stopping part-way keeps progress; an archived Project shows no indicator until restored.
- **UJ-3:**
  - Path: "clicks Summarize and chooses one uploaded chapter as the Selection Scope" → "starts Summarize from the chat and chooses one Study Material, optionally narrowed to one of its Topics".
  - "opens Ask AI" → "returns to the chat".
  - Resolution: "…saved with the Project…" → "…saved with the Project and listed in its History".
- **New UJ-4 (from EXP Flow 4):** phone upload of handwritten notes. Realized by FR-21, FR-7, and FR-6.
- **New UJ-5 (from EXP Flow 5):** a flashcard run. This gives FR-13 and FR-14 a journey; FR-13 currently says "no single UJ covers Flashcards standalone".
- **Optional UJ-6 (EXP Flow 6):** first sign-in with Google in Norwegian. Realized by FR-19 and FR-29. Alternatively, fold it into UJ-1 as an alternate path.

### D.3 Glossary

Add:
- **Topic:** a subject the system detects in a Study Material, which the student can rename, delete, or add; the unit of Selection Scope (FR-22).
- **Archived Project:** a Project removed from the active list without deletion; read-only until restored (FR-23).
- **History:** the per-Project list of past chats, Quizzes, Flashcard sets, and Summaries (FR-25).
- **Phone upload link:** a one-time, upload-only, short-lived link, shown as a QR code, that lets a phone send photos into one Project without logging in (FR-21).
- **Unfinished Quiz:** a Quiz left before its last question, saved and resumable (FR-25).
- **Interface language:** English or Norwegian (bokmål) for the UI; it does not change the language of generated content (FR-29).
- Optionally **Settings**.

Amend:
- **Account:** sign-in methods; first name.
- **Study Material:** file or phone batch.
- **Selection Scope:** Topic-based; per-feature rules (A15).
- **Flashcards:** in-session "not yet" repeat; no Mistakes.
- **Mistake:** Quiz only; outstanding versus history; removal opt-out.
- **Ask AI:** the Project's home view; the UI calls it "Chat" (EXP term map).
- **Summarize:** one Study Material, whole or one Topic.

### D.4 Assumptions Index (§10)

- **Delete** "§4.1 — Account creation/login uses email + password; no third-party sign-in in V1." It is superseded by FR-19.
- **Convert to decisions and remove:** "§4.1 (FR-3 Notes) — Password reset… emailed reset link". The UX confirms an emailed, expiring link (UXm-110).
- **Re-confirm, then remove:** both §5.2 "per Account" assumptions (Ask AI 50 per day, OCR 25 per day). EXP › State Patterns › Daily limits states "per Account per day" for both, but that restates the PRD and is not a new user decision.
- **Keep:** the FR-12 60-second target and the SM-1 cohort of 5.
- **Add:**
  - Phone link lifetime "about 10 minutes" is a round number (FR-21).
  - Data-use promise (§5.3) is achievable with the chosen AI provider.
  - Account deletion frees the email for re-registration (FR-28).
  - Interface falls back to English when the browser language is neither English nor Norwegian (FR-29).
  - A Project deletion lands on the most recent other Project (FR-24).

### D.5 Success Metrics

- **SM-2:** "(from Quiz or Flashcards)" → "(from Quiz)". Remove FR-14 from "Validates" and add FR-27 if wanted. (A26)
- **SM-3:** extend resume integrity to History items, unfinished-Quiz resume, and restoring an archived Project unchanged. Add FR-23 and FR-25 to "Validates".
- **SM-1:** the image-based upload may be direct or by phone. Optionally add FR-21 and FR-22 to "Validates".
- **SM-5:** UJ-1 now includes first name or Google sign-in and the count picker. No metric change, but re-test against the new path.
- **Optional new counter-metric SM-C2:** "Do not count Mistakes removed through file removal (FR-20) or hidden by archiving (FR-23) as review follow-through." This keeps SM-2 honest.

### D.6 MVP Scope (§7)

- **§7.1, add bullets:**
  - Google sign-in and linking (FR-19).
  - Study Material removal, phone upload, topics, archive, and project deletion (FR-20–FR-24).
  - History and generation lifecycle (FR-25, FR-26).
  - Settings, account deletion, and English/Norwegian interface (FR-27–FR-29).
  - Update the range "FR-4–FR-9", and the Flashcards and Mistake Review bullets (A26).
- **§7.2, add:**
  - Resuming a Flashcard set left part-way.
  - Profile-photo upload (email Accounts show initials).
  - Interface languages beyond English and Norwegian.
  - Light theme (UX stretch goal).
  - User-chosen theme colors (UXm-45: "deferred to V2").
  - Full mobile layout. Reword "mobile app" (A35).

### D.7 Open Questions (§9, replacing "None…")

1. **Email verification versus Google linking (C4).** Require verification before linking, or let a verified Google identity claim an unverified email Account?
2. **One chat or many per Project (C10).** If many, how does a new chat start, and what does FR-16 "chat history persists" mean?
3. **Phone batch limits.**
   - Is there a maximum number of photos per batch?
   - Does 50 MB apply per photo or per batch?
   - If a batch would push past 25 images per day, is the whole batch declined, or only the photos over the limit?
4. **Account and Project deletion.** Hard delete immediately, including stored files and AI-provider copies, or a grace period? This also affects the §5.3 data-use promise.
5. **Mistake Review generation cost.** §5.2 caps Quiz, Flashcards, Ask AI, and OCR, but not Mistake Review practice generation or "do it again" regenerations. Should those count toward or have their own cap?
6. **Flashcard cap.** The picker maximum is 20, but §5.2 allows 50. Keep 50 as headroom (for example for future sizes), or lower the cap to 20 so the stated rationale ("covers a full topic/section") matches the product?
7. **Topic limits.** Is there a maximum number of topics per Study Material or per Project, and is a topic edit limited to its own file?
8. (Carried from UX, not PRD-blocking.) Team sign-off on the Norwegian strings tagged (proposed). FR-29 depends on it for completeness.

### D.8 Other housekeeping

- Frontmatter: set `updated: 2026-10-14`, add the UX spines to the sources, and consider `status: final` → re-finalize after the update.
- §0: add the FR-ID stability note (D.1).
- §1 ¶2: Mistake wording (A26). ¶3: scope sentence (C5).
- §2.2 Non-Users: no change.
- PRD memlog: log one `(change)` entry per accepted row in §A, citing the UXm line, and one entry recording the C2 reversal of PRDm-23 (6).
