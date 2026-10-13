---
title: "Experience: AI Study Buddy"
status: final
created: 2026-10-13
updated: 2026-10-14
sources:
  - ../../prds/prd-AI-StudyBuddy-2026-10-06/prd.md
  - ../../briefs/brief-AI-StudyBuddy-2026-09-16/brief.md
---

# Study Buddy — Experience Spine

How Study Buddy behaves. Visual identity lives in [DESIGN.md](DESIGN.md); this spine references its tokens in braces, as in `{colors.primary}`. Product requirements live in the PRD and are referenced by ID (FR-N, UJ-N), not restated. Mocks in `mockups/` illustrate this spine; **the spines win on conflict with any mock.**

Each rule is stated once, in the section that owns it; other sections point to it by component or section name. This spine changes the information architecture and adds scope beyond the PRD. See [Scope Changes vs PRD](#scope-changes-vs-prd).

## Foundation

- **Form factor:** desktop web app, plus one phone surface: the phone upload page, reached by QR code. No full mobile layout. "Mobile" in these specs means a narrow desktop window (see Responsive & Platform).
- **UI system:** none named. Components are specified in DESIGN.md Components and below.
- **Visual reference:** DESIGN.md. Dark theme in V1; light mode is a stretch goal, enabled by keeping every color a token.
- **Languages:** UI in English and Norwegian (bokmål), switchable. The default follows the browser language and is saved once the student chooses. Generated study content follows the language of the uploaded material, not the UI language.
- **Posture:** calm and focused, no gamification. Warmth lives in microcopy.
- **Sample data:** names, project titles, file names, and counts in the mocks are sample data; in the app they come from the account.

**PRD term → UI term:**

| PRD term | UI term |
|---|---|
| Study Material | File (the "Files" panel) |
| Study Content | Generated material: quizzes, flashcard sets, summaries |
| Mistake indicator (FR-9) | Mistakes card |
| Ask AI | Chat |

## Information Architecture

**The chat is the project home.** A persistent left Sidebar lists Projects, with archived Projects in a collapsed group at the bottom; it collapses to the Sidebar strip. Opening a Project shows the chat (Ask AI) with a collapsible Files panel on the right. Quiz, Flashcards, and Summarize open from buttons in the chat, and every activity returns with "← Back to chat". There is no tab row. Mistake Review starts from a card at the top of the chat. The Account menu sits top right on every signed-in page.

| Surface | Reached from | Purpose | FR | Scope |
|---|---|---|---|---|
| Login | Signed-out entry | Sign in with Google, or email and password | FR-2 | Amended (Google) |
| Create account | Login, "Create account" | Email account (first name, email, password) or Google | FR-1 | Amended (Google, first name) |
| Password reset | Login, "Forgot password?" | Request link, set new password | FR-3 | As PRD |
| Projects page (empty) | First sign-in with no Projects; after deleting the last Project | "Create your first project" | FR-4 | New state |
| Sidebar | Every signed-in desktop page | Project list, "+ New project", per-project "···" menu, Archived group, collapse button | FR-4, FR-5, FR-8 | Amended (rename in sidebar, archive, delete project) |
| Sidebar strip | Left edge, Sidebar collapsed | Expand and "+ New project" buttons | FR-4 | New (UI behavior) |
| Archived group | Sidebar bottom, above "+ New project" | "Archived (n)" list of archived Projects | — | New |
| Project home (chat) | Sidebar; a returning sign-in lands on the last Project | Grounded chat, Scope control, History link, tool buttons, Mistakes card, inline Project rename | FR-4, FR-5, FR-8, FR-9, FR-16 | Amended (IA: chat is home) |
| Archived project | Archived group, or archiving the open Project | Read-only project home with the Archived banner | — | New |
| Mistakes card | Top of the chat when active mistakes > 0 | "{n} mistakes to review · Start" | FR-9, FR-17 | Amended (no tab, Quiz-only) |
| Files panel | Right of the project home; collapses to the Files strip | "Files · n of 10", file statuses, editable topics, per-file "···" menu, Upload, Upload from phone | FR-6, FR-7, FR-10, FR-13 | Amended (topics, phone, remove) |
| Remove file dialog | File row "···" → Remove | Confirm removing a file; optionally remove its mistakes from review | FR-6, FR-18 | New |
| Quiz | Tool button "Quiz" | Pick topics and 5 / 10 / 20 questions (default 10), answer with feedback, score | FR-10, FR-11, FR-12 | Amended (count picker) |
| Flashcards | Tool button "Flashcards" | Pick 5 / 10 / 20 cards (default 10) and topics, flip, "Got it" / "Not yet" | FR-13, FR-14 | Amended (no mistakes) |
| Summarize | Tool button "Summarize" | Pick a file, optionally one of its topics, read the summary | FR-15 | As PRD |
| Mistake Review session | Mistakes card "Start" | Targeted practice from wrong Quiz answers | FR-9, FR-17, FR-18 | Amended (Quiz-only) |
| History | History link in the chat bar | One list of past chats, quizzes, flashcard sets, and summaries | FR-8, FR-16 | Amended (one list) |
| Account menu | Top right, every signed-in page | Settings, Language, Log out | — | New |
| Settings | Account menu | Account, Language, Your data | New (adjacent to FR-3) | New |
| Confirm dialog (delete project) | Sidebar "···" → Delete project (active or archived); Settings › Your data › "Delete a project" → Delete | Confirm deleting one Project | — | New |
| Confirm dialog (delete account) | Settings › Your data | Confirm deleting the account | — | New |
| QR dialog | Files panel or empty-project drop zone, "Upload from phone" | QR for the open Project, live arrival status | FR-6, FR-7 | New |
| Phone upload page | Scanning the QR code | Take or pick photos, send into the Project | FR-6, FR-7 | New |

**Menu contents, in order:**

- **Account menu:** Settings · Language (English / Norsk) · divider · Log out.
- **Sidebar project "···" menu:** Rename · Archive · Delete project. Archived Project: Restore · Delete project.
- **File row "···" menu:** Remove.

**Settings: one page, three sections.**

1. **Account:** name, email, picture, Log out. Google accounts show the Google name, email, and picture read-only. Email accounts show initials, can edit their name in place, and offer "Change password" and "Link Google account".
2. **Language:** English / Norsk.
3. **Your data:** "Delete a project" lists the Projects, each with a Delete action that opens the Confirm dialog (delete project); "Delete my account and all my files" opens the Confirm dialog (delete account).

**Selection Scope:** Quiz and Flashcards scope by AI-detected topics or all topics. Summarize: pick a file, then optionally narrow to one of its topics. Chat: all materials (default) or one file (FR-16).

→ Composition reference: [`mockups/key-project-home.html`](mockups/key-project-home.html).

## Voice and Tone

Microcopy. Brand posture lives in DESIGN.md Brand & Style. Warm and encouraging, never gamified. Plain, short sentences. Every string exists in English and Norwegian.

| Do | Don't |
|---|---|
| Frame a wrong Quiz answer as something to review: "Not quite" / "It stays in your review." | "Wrong!", "You failed" |
| Invite review without pressure: "Practice them whenever you're ready." [ASSUMPTION: from mock] | Push or nag the student into Mistake Review (FR-17) |
| Explain what happened and what helps: "This image is too blurry to read, so we can't study from it. A sharper photo in good light usually does the trick." [ASSUMPTION: from mock] | Generic errors without a next step |
| Say what was kept: "Everything we could read is ready to study." [ASSUMPTION: from mock] | Hide that extraction was incomplete |
| Point answers at their source: "filename · slide N" | Present answers with no link to the material |
| Keep flashcard results factual: "{n} cards done. {m} needed a second try" | Scores, streaks, due dates, or "next review" language |
| State failures briefly and calmly: "Sign-in didn't work. Try again." | Technical error codes or blame |
| Celebrate a finished review calmly: "All cleared! Nice work." | Confetti, badges, or "Perfect score!" language |
| Say what stays when something is removed: generated material stays, mistakes stay unless the student opts out | Remove data silently or without saying what is kept |
| Keep password-reset replies the same whether or not the email has an account | Reveal whether an email is registered |

**Bilingual terms (confirmed).** This table becomes the binding glossary once the team signs off the (proposed) strings (see Open Questions). Use these terms consistently in buttons, headings, and Settings. The team writes the remaining Norwegian strings and follows this glossary.

| English | Norwegian (bokmål) |
|---|---|
| Not quite | Ikke helt |
| It stays in your review. | Den ligger fortsatt i repetisjonen din. |
| Mistake Review | Repetisjon av feil |
| {n} mistakes to review (Mistakes card) | Du har {n} feil å repetere |
| All cleared! Nice work. | Alt er repetert! Bra jobba. |
| Type DELETE to confirm | SLETT is the word to type in Norwegian |
| Language labels | "English" and "Norsk", each in its own name, in every UI language |
| Login toggle | EN \| NO |

**Strings by surface.** English labels marked [ASSUMPTION] are not yet confirmed; every Norwegian string marked (proposed) still needs the team's check against the glossary.

| Surface | English | Norwegian (bokmål) |
|---|---|---|
| Count picker, Quiz | "How many questions?" · "Make {n} questions" [ASSUMPTION: from mock] | Hvor mange spørsmål? · Lag {n} spørsmål (proposed) |
| Count picker, Flashcards | "How many cards?" · "Make {n} cards" [ASSUMPTION: from mock] | Hvor mange kort? · Lag {n} kort (proposed) |
| Too-little-material note, Quiz | "There's only enough material for {n} questions." + "Make {n} instead" [ASSUMPTION: copy not confirmed] | Det er bare nok stoff til {n} spørsmål. · Lag {n} i stedet (proposed) |
| Too-little-material note, Flashcards | "There's only enough material for {n} cards." + "Make {n} instead" [ASSUMPTION: mirrors the Quiz note] | Det er bare nok stoff til {n} kort. · Lag {n} i stedet (proposed) |
| Quiz feedback, next | "Next question" · Mistake Review: "Next mistake" | Neste spørsmål · Neste feil (proposed) |
| Quiz feedback, last question | "See results" | Se resultatet (proposed) |
| Progress steps, Quiz | "Reading your material → Writing questions → Checking answers" | Leser stoffet ditt → Skriver spørsmål → Sjekker svarene (proposed) |
| Progress steps, Flashcards | "Reading your material → Writing cards → Checking sources" | Leser stoffet ditt → Skriver kort → Sjekker kildene (proposed) |
| Progress steps, Summary | "Reading your material → Writing the summary → Checking sources" | Leser stoffet ditt → Skriver sammendraget → Sjekker kildene (proposed) |
| Progress steps, Mistake Review start | "Looking at your mistakes → Writing practice questions" | Ser på feilene dine → Skriver øvingsspørsmål (proposed) |
| Summarize setup | "Make a summary" · "Which file?" · "Narrow to one topic (optional)" · "Whole file" · "Make summary" [ASSUMPTION: from mock] | Lag et sammendrag · Hvilken fil? · Begrens til ett emne (valgfritt) · Hele filen · Lag sammendrag (proposed) |
| Summary view, end | "Saved to History" [ASSUMPTION: from mock] | Lagret i historikken (proposed) |
| History, reopened quiz or flashcard set | "Do it again" | Gjør den igjen (proposed) |
| History, unfinished quiz | "Unfinished · {n} of {total}" | Ikke fullført · {n} av {total} (proposed) |
| Files panel header | "Files · {n} of 10" | Filer · {n} av 10 (proposed) |
| Files strip count | "{n} of 10" | {n} av 10 (proposed) |
| History link and title | "History" | Historikk (proposed) |
| History filter | "All" · "Chats" · "Quizzes" · "Flashcards" · "Summaries" [ASSUMPTION: from mock] | Alle · Samtaler · Quizer · Kort · Sammendrag (proposed) |
| History, empty | "Nothing here yet" | Ingenting her ennå (proposed) |
| History, loading (screen reader) | "Loading history" [ASSUMPTION: from mock] | Laster historikk (proposed) |
| History, error | "We couldn't load your history." + "Try again" [ASSUMPTION: follows the network-error pattern] | Vi fikk ikke lastet historikken din. · Prøv igjen (proposed) |
| Inline error, reassurance | "Nothing you've made is lost." [ASSUMPTION: from mock] | Ingenting du har laget, er borte. (proposed) |
| Chat, pending answer | "Study Buddy is thinking…" | Study Buddy tenker … (proposed) |
| Finished-generation message | "Your quiz on {topic} is ready · Open" | Quizen din om {topic} er klar · Åpne (proposed) |
| File menu trigger, accessible name | "More options for {file name}" [ASSUMPTION] | Flere valg for {file name} (proposed) |
| File menu item | "Remove" | Fjern (proposed) |
| Remove file dialog, title | "Remove {file name}?" [ASSUMPTION] | Vil du fjerne {file name}? (proposed) |
| Remove file dialog, body | "Quizzes, flashcards, and summaries made from this file stay. Its mistakes stay in your review." [ASSUMPTION: wording; meaning confirmed] | Quizer, kort og sammendrag laget fra denne filen blir liggende. Feilene fra den ligger fortsatt i repetisjonen din. (proposed) |
| Remove file dialog, checkbox | "Also remove its mistakes from my review" [ASSUMPTION: wording; meaning confirmed] | Fjern også feilene fra repetisjonen min (proposed) |
| Remove file dialog, Reading… | "Reading stops and the file won't be added." [ASSUMPTION] | Lesingen stopper, og filen blir ikke lagt til. (proposed) |
| Remove file dialog, buttons | "Cancel" · "Remove" | Avbryt · Fjern (proposed) |
| Remove failed | "We couldn't remove the file." + "Try again" [ASSUMPTION: follows the network-error pattern] | Vi fikk ikke fjernet filen. · Prøv igjen (proposed) |
| Sidebar project menu | "Rename" · "Archive" · "Delete project" | Gi nytt navn · Arkiver · Slett prosjekt (proposed) |
| Archived project menu | "Restore" · "Delete project" | Gjenopprett · Slett prosjekt (proposed) |
| Archived group | "Archived ({n})" | Arkivert ({n}) (proposed) |
| Undo message, archive | "{project} archived · Undo" | {project} er arkivert · Angre (proposed) |
| Archived banner | "Archived · Restore" | Arkivert · Gjenopprett (proposed) |
| Sidebar, collapse and expand | "Hide projects" · "Show projects" [ASSUMPTION: accessible names and tooltips mirror the Files strip] | Skjul prosjekter · Vis prosjekter (proposed) |
| Sidebar strip, new project tooltip | "New project" [ASSUMPTION] | Nytt prosjekt (proposed) |
| Settings, Delete a project | "Delete a project" · "Delete" | Slett et prosjekt · Slett (proposed) |
| Files strip, expand and collapse | "Show files" · "Hide files" [ASSUMPTION: accessible names from mock] | Vis filer · Skjul filer (proposed) |
| Files strip, warning icon | "A file needs your attention" [ASSUMPTION] | En fil trenger oppmerksomheten din (proposed) |
| All cleared, actions | "Make a new quiz" · "← Back to chat" | Lag en ny quiz · ← Tilbake til chatten (proposed) |
| Mistake Review, saved line | "Your progress is saved." | Fremgangen din er lagret. (proposed) |
| Create account, duplicate email | "An account with this email already exists. Log in instead?" | Det finnes allerede en konto med denne e-postadressen. Vil du logge inn i stedet? (proposed) |
| Password reset, requested | "If an account exists, we've sent a link" | Hvis kontoen finnes, har vi sendt en lenke (proposed) |
| Password reset, expired link | "This link has expired" · "Send a new link" | Denne lenken er utløpt · Send en ny lenke (proposed) |
| Session expired, login screen | "You've been signed out. Log in to continue." | Du er logget ut. Logg inn for å fortsette. (proposed) |
| Link Google account, already linked elsewhere | "This Google account is already linked to another Study Buddy account." | Denne Google-kontoen er allerede koblet til en annen Study Buddy-konto. (proposed) |
| Google sign-in, existing email account | "You already have an account with this email. Log in with your password once to link Google." | Du har allerede en konto med denne e-postadressen. Logg inn med passordet ditt én gang for å koble til Google. (proposed) |
| Account deleted, login screen | "Your account and files have been deleted." | Kontoen din og filene dine er slettet. (proposed) |

## Component Patterns

Behavioral. Visual specs live in DESIGN.md Components, which uses the same component names in the same groups. DESIGN.md rows marked *(visual only)*: Button (primary), Button (ghost), Button (danger), Auth panel. Strings cited here are translated in Strings by surface.

**Shared**

| Component | Use | Behavioral rules |
|---|---|---|
| Focus ring | Every focusable element | Shown on keyboard focus; never removed. |
| Overflow menu | File rows, sidebar project items | Opens on click, Enter, or Space; Esc closes it and returns focus to the "···" trigger [ASSUMPTION: focus return from mock]. Items (IA › Menu contents) are normal text; only the final button of the dialog they open is Button (danger). |
| Key hint | Quiz, Flashcards, Mistake Review buttons | Shows the shortcut on the control it triggers. Desktop only. |
| Source label | Chat, Quiz, Flashcards, Summarize, Mistake Review | "filename · slide N". |
| Progress bar | Quiz, Flashcards, Mistake Review | Advances with each question, card, or mistake. |
| Progress steps | Quiz, Flashcards, Summary generation; Mistake Review start | Per-activity step labels with Cancel. The student can leave (State Patterns › Generating). Cancel returns to setup with choices kept; from the Mistake Review start, to the chat [ASSUMPTION]. |
| Skeleton | Project cold-load; History loading | Holds the shape of the chat thread and Files panel, or the History list, until content arrives. Static: no shimmer. |
| Inline error | Network or AI failure (generation, History, remove file, Mistake Review) | Message, the reassurance "Nothing you've made is lost.", and "Try again", which takes focus. Choices and saved work are kept. |
| Undo message | After archiving a Project | "{project} archived · Undo"; Undo restores the Project immediately. Shows at the bottom left of the main area for 6 seconds, and stays while hovered or focused. |
| Empty state | Projects page (empty), empty Project, empty Files panel, empty History | Heading, one calm sentence, one action. No illustration. |
| Modal dialog | All dialogs | One level deep. Confirm dialogs open with focus on Cancel, so Enter or Esc is always safe [ASSUMPTION: from mock]. Esc, Close, or Cancel dismisses without change. On close, focus returns to the opener; if the opener is gone (after a delete), to the main heading of the landing page. |
| Checkbox and radio | Remove file dialog; Summarize setup; Count picker | Checkbox toggles with Space. Radio groups: arrow keys move between options; Tab leaves the group [ASSUMPTION: standard radio-group keys]. |

**Shell**

| Component | Use | Behavioral rules |
|---|---|---|
| Sidebar | Every signed-in desktop page | Lists active Projects; each opens its chat home as left (FR-8). "+ New project" creates an empty Project with a placeholder name (FR-4). "Hide projects" collapses it to the Sidebar strip (State Patterns › Sidebar). The Overflow menu trigger shows on hover and focus, and always on the open Project. **Rename:** the row becomes an inline Text input; Enter saves, Esc cancels (FR-5). **Archive:** immediate, no confirmation; shows the Undo message. **Delete project:** opens the Confirm dialog (delete project). |
| Sidebar strip | Left edge, Sidebar collapsed | `{spacing.sidebar-collapsed-width}` wide (about 56px) [ASSUMPTION: logged as assumption]. "Show projects" expand button and a "+ New project" icon button (as in the Sidebar), each with a tooltip on hover and keyboard focus. The project list and Archived group stay hidden until expanded. |
| Archived group | Sidebar bottom, above "+ New project" | "Archived (n)", collapsed by default; selecting it expands the list. An archived Project opens read-only with the Archived banner. Absent when nothing is archived [ASSUMPTION]. |
| Top bar | Every signed-in desktop page | Click the Project name to rename inline; Enter saves, Esc cancels (FR-5). Not while archived. |
| Archived banner | Top of the chat column, archived Project | "Archived · Restore"; Restore is the primary button (State Patterns › Archived project). |
| Account menu | Top right | Opens from the avatar or "Welcome, [first name]". Log out is immediate, with no confirmation. |
| Avatar | Account menu, Settings | Google accounts: profile photo. Email accounts: initials. |
| Language switch | Account menu, Settings | Switches the UI language immediately and saves it. Generated content keeps its own language. |

**Chat (project home)**

| Component | Use | Behavioral rules |
|---|---|---|
| Mistakes card | Top of the chat | Only when active mistakes > 0 (State Patterns › Project and chat). The session starts only on Start (FR-17). Counts wrong Quiz answers only. Hidden while archived; returns on Restore. |
| Chat bar | Above the thread | Scope control (left), History link (right). |
| Scope control | Chat bar | "All materials" (default) or "One file", which opens a file picker. Narrowing persists until broadened (FR-16). |
| History link | Chat bar | Opens History in place of the chat. |
| Chat message | Thread | Grounded answers with Source labels. Pending: "Study Buddy is thinking…" with animated dots (static under reduced motion); Send disabled until the full answer appears. Saves with the Project (FR-16). When generation finishes while the student is elsewhere: "Your quiz on {topic} is ready · Open", and the item is saved to History. |
| Tool buttons row | Above the composer | Quiz, Flashcards, Summarize; each opens its setup. Disabled until a file is Ready, and while archived. |
| Composer | Bottom of the chat | Type and send. Disabled until a file is Ready, while an answer is pending, and while archived. Shows the Limit notice. |
| Limit notice | Composer; image uploads; phone page | State Patterns › Daily limits. |
| Upload drop zone | Empty Project chat area | Drag and drop or browse; includes "Upload from phone". Replaced by the chat once a file is Ready. |

**Files panel**

| Component | Use | Behavioral rules |
|---|---|---|
| Files panel | Right of the chat | Collapses to the Files strip. Header "Files · n of 10". Accepts drag and drop [ASSUMPTION: drop-on-panel from mock hint]. Archived: files can be read, not uploaded, removed, or retopiced. |
| Files strip | Files panel collapsed | Files icon and "n of 10"; a warning icon when any file is partly unreadable or rejected, so a problem file is never hidden. The collapsed or expanded choice is saved to the account per Project. Below 1024px the panel always starts collapsed, overriding a remembered "expanded". Instant under reduced motion. |
| Upload buttons | Files panel; Upload drop zone | "Upload" opens the file picker (FR-6 types, 50 MB each). "Upload from phone" opens the QR dialog. Disabled while archived. |
| File row | Files panel | Shows File status. Non-rejected rows have an Overflow menu (Remove). Rejected rows offer Remove directly: immediate, no confirmation. |
| File status | File row, QR dialog | Reading…, Ready, Ready (partly unreadable), Rejected (State Patterns › Study Material). |
| Topic chip | Under each file | AI-detected topics. Click to rename (Enter saves), × deletes, "+ Add topic" adds. Topics feed Quiz, Flashcards, and Summarize scope. |
| Remove file dialog | File row "···" → Remove | Generated material from the file stays; its mistakes stay in review unless the unchecked checkbox is checked, which removes them from the active count and keeps their history (FR-18). Hidden when the file has no mistakes [ASSUMPTION: logged as assumption]. Final "Remove" is Button (danger). For a Reading… file the dialog is short, and removing cancels processing. Either way the slot frees immediately. Buttons disable while removing; on failure the dialog stays open with an Inline error and the file keeps its slot. |

**Activities**

| Component | Use | Behavioral rules |
|---|---|---|
| Activity header | Every activity and History | "← Back to chat" always present (State Patterns › Leaving part-way). |
| Topic scope picker | Quiz and Flashcards setup | "All topics" or one or more detected topics (FR-10, FR-13). |
| Count picker | Quiz and Flashcards setup | 5, 10, or 20 questions or cards; default 10; chosen before starting. The primary button names the count ("Make {n} questions", "Make {n} cards"). |
| Too-little-material note | Quiz and Flashcards setup | Material too thin for the count: a muted note under the Count picker offers the largest workable count (any number) as a one-click action. Not an error; never `{colors.error}`. |
| Summarize setup | Summarize | Pick exactly one file, then optionally one of its topics ("Whole file" default; choices follow the file). Nothing generates until "Make summary". No Count picker. On failure, the Inline error keeps both choices. |
| Answer option | Quiz, Mistake Review | Keys 1–4 or click; one answer per question. After answering: the wrong pick reads "Your answer" in `{colors.mistake}`, the correct one "Correct answer" in `{colors.correct}`, others dim. |
| Feedback panel | Quiz, Mistake Review | Appears immediately after answering (FR-11). Wrong: "Not quite" + "It stays in your review." + grounded explanation + Source label; Quiz records the mistake automatically (FR-12). Right in Mistake Review: confirms the clear. The primary button reads "Next question" (→), "Next mistake" in Mistake Review, and "See results" after the last question. No auto-advance. |
| Score summary | End of Quiz | Score, missed questions with both answers (FR-11), a note that they stay in review on the Mistakes card, "← Back to chat" (primary) and "New quiz". Saved to History. [ASSUMPTION: "New quiz" and note copy from mock] |
| Flashcard | Flashcards session | One card at a time. Click, tap, or Space flips; then "Got it" or "Not yet", which returns the card later in the session. No Mistake recorded; no spaced repetition or scheduling. Progress "n of {total}". "Stop for now" always available. |
| Flashcard end screen | End of a set | "{n} cards done. {m} needed a second try", with "Make more cards" (primary) and "← Back to chat". Saved to History. |
| Summary view | Summarize | Reading screen with Source labels per section. No claims absent from the material (FR-15). In the material's language. Ends with "Saved to History" and "← Back to chat". |
| Mistake Review session | Mistakes card | Progress steps while practice questions generate (FR-18). Wrong Quiz answers only. Shows the original mistake, then a targeted practice question. Progress "n of m cleared"; a mistake leaves the count only once its answer is saved. "← Back to chat" and "Stop for now" return to the chat with "Your progress is saved."; remaining mistakes stay. |
| All cleared panel | End of Mistake Review | Only when the last active mistake clears and is saved; never after "Stop for now" or "← Back to chat". "All cleared! Nice work.", with "Make a new quiz" (primary; opens Quiz setup [ASSUMPTION]) and "← Back to chat". The Mistakes card is gone. |

**History**

| Component | Use | Behavioral rules |
|---|---|---|
| History filter | Top of History | Filters by All, Chats, Quizzes, Flashcards, Summaries. Usable while loading and when empty. Keyboard reachable. |
| History row | History list | Newest first. A finished quiz or flashcard set opens as read-only results with "Do it again", which reuses its count, topics, and file and starts generating (Progress steps). An unfinished quiz ("Unfinished · {n} of {total}") resumes where left. Summaries and chats open normally. Archived Project: read-only; "Do it again" and resuming need Restore. |

**Sign-in and Settings**

| Component | Use | Behavioral rules |
|---|---|---|
| Projects page (empty) | First sign-in with no Projects; after deleting the last Project | "Create your first project" creates an empty Project and opens it. |
| Login screen | Signed-out entry | Wordmark, "Study from your own notes, with sources", "Sign in with Google", email and password with "Log in", "Forgot password?", "Create account", privacy line "Your files are only used to create your study material.", EN \| NO toggle. |
| Google button | Login, Create account | Starts Google sign-in; takes first name and photo from the profile. An email that already has a password account does not complete sign-in (State Patterns › Account). |
| Text input | Every text field, including the composer and inline renames | Keyboard shortcuts are disabled while focus is in a text input. |
| Language toggle (login) | Login, Create account, Password reset | The Language switch, before sign-in. |
| Error line | Login, Create account | Above the buttons after failure or cancel; buttons stay active, the typed email stays, and focus returns to the form [ASSUMPTION: kept email and focus return from mock]. Announced to assistive technology. |
| Create account screen | Login, "Create account" | First name, email, password (at least 8 characters), or "Sign in with Google". Success lands on the Projects page (empty). Errors: State Patterns › Account. |
| Password reset screens | Login, "Forgot password?" | Email request, then the emailed link opens a new-password screen (FR-3). States: State Patterns › Account. |
| Settings section | Settings | Layout: IA › Settings. After linking Google, both sign-in methods work; link errors in State Patterns › Account. Log out is immediate, with no confirmation. |
| Confirm dialog (delete project) | Sidebar "···" menu; Settings › Your data | Names the Project and what is lost (its files, mistakes, generated material) and that it can't be undone; final "Delete project" is Button (danger). No typed DELETE. Confirming cancels any generation in that Project. Landing: State Patterns › Destructive actions. |
| Confirm dialog (delete account) | Settings › Your data | Names what is lost (files, mistakes, generated material) and that it can't be undone; requires typing DELETE (SLETT in Norwegian). The Button (danger) stays disabled until the word matches. Cancel is always safe. |

**Phone upload**

| Component | Use | Behavioral rules |
|---|---|---|
| QR dialog | Project home | One-time, upload-only link for the open Project. Shows "Waiting for photos…" and each arriving batch with its status, live. Closing ends the link (State Patterns › Phone link). |
| Phone action button | Phone page | "Take photos" opens the camera; "Choose from gallery" opens the picker. Photos join the thumbnail strip. |
| Photo thumbnail | Phone page | Numbered pages. × removes a photo immediately, no confirmation; pages renumber. |
| Phone send button | Phone page | Live count ("Send {n} photos"). Disabled at zero photos and after expiry. Sends all photos as one Study Material. Warns first if the batch exceeds today's image limit or the Project has 10 files. |
| Link countdown | Phone page | "Link expires in N min", updated each minute; seconds in the last minute. |
| Expired notice | Phone page, after expiry | "This link has expired. Scan a new code on your computer." Send disabled; thumbnails stay, dimmed. |
| Phone footer credit | Phone page | The footer credit, shown small. Static text. |

## State Patterns

**Study Material (FR-6, FR-7, PRD §5.1 Content Integrity)**

| State | Treatment | Counts toward 10 |
|---|---|---|
| Reading… | Uploading or extracting; pulsing status dot. | Yes |
| Ready | "Ready". | Yes |
| Ready, partly unreadable | Muted note saying what may be missing and that the rest is ready. A phone batch with unreadable pages takes this state as a whole; the note names the failed pages, and the others are usable. | Yes |
| Rejected (unreadable) | `{colors.error}` status and note saying why and what helps; Remove is immediate. A Reading… file that ends up rejected frees its slot. | No |
| Rejected (unsupported type, over 50 MB, 11th file, 26th image today) | `{colors.error}` message naming the rule (FR-6, FR-7). Not added. | No |
| Removed | Via the Remove file dialog. The row leaves, the slot frees, "n of 10" updates. Generated material stays. | No |

**Account (FR-1, FR-2, FR-3).** Messages show in the Error line unless stated.

| State | Treatment |
|---|---|
| Create account, duplicate email | "An account with this email already exists. Log in instead?"; "Log in" goes to the Login screen (FR-1). |
| Create account, password too short | At least 8 characters; no account until it is. [ASSUMPTION: message shown in the Error line; copy not confirmed] |
| Sign-in failure or cancel | "Sign-in didn't work. Try again." (`{colors.error}`); buttons stay active. |
| Invalid email login | Generic invalid-login message (FR-2). |
| Google sign-in, email has a password account | "You already have an account with this email. Log in with your password once to link Google." [ASSUMPTION: shown in the Error line]. After one password login, Google is linked and both methods work. One Account per email (FR-1). |
| Password reset requested | "If an account exists, we've sent a link", whether or not the account exists. |
| Reset link opened | New-password screen. |
| Reset link expired | "This link has expired" with "Send a new link". |
| Password reset saved | The old password stops working; the student logs in with the new one (FR-3). |
| Account deleted | Login screen: "Your account and files have been deleted." |
| Session expired during use (FR-2) | Login screen: "You've been signed out. Log in to continue." Sign-in returns to the same Project. |
| Log out | Immediate; the Login screen opens. [ASSUMPTION: lands on the Login screen] |
| Link Google account, already linked elsewhere | `{colors.error}` message in Settings: "This Google account is already linked to another Study Buddy account." |
| Link Google account, consent cancelled | No change, no error. |

**Project and chat**

| State | Treatment |
|---|---|
| No Projects (first sign-in, or last Project deleted) | Projects page (empty). |
| Project cold-load | Skeleton chat thread and Files panel. |
| Empty Project | Placeholder name (FR-4). The chat area is the Upload drop zone ("Upload your notes to start", "Upload from phone"). Composer and tool buttons disabled. "Files · 0 of 10". No Mistakes card. |
| First file Ready | The Project name generates from the material (FR-4); topics appear; composer and tool buttons enable. |
| Mistakes > 0 | Mistakes card (not in an archived Project). |
| Mistakes = 0 | No card, never "0 mistakes", no empty review screen. |
| Review answer correct | The mistake leaves the active count once saved; history is kept (FR-18). |
| Review answer wrong | "Not quite" / "It stays in your review." in `{colors.mistake}`; the mistake stays active (FR-18). |
| Last mistake cleared | All cleared panel; the card disappears. |
| File removed, "also remove its mistakes" checked | Those mistakes leave the active count; history is kept (FR-18). Unchecked (default): they stay. |

**Sidebar**

| State | Treatment |
|---|---|
| Expanded | Project list, Archived group, "+ New project", "Hide projects". |
| Collapsed | Sidebar strip; the main column takes the freed width. |
| Returning | Opens as last left; the choice is saved to the account. |
| Narrow window (below 1024px) | Starts collapsed; the student can expand it. |
| Reduced motion | Expands and collapses instantly. |

**Archived project**

| State | Treatment |
|---|---|
| Archive | From the Sidebar "···" menu, no confirmation. Moves into the Archived group; the Undo message appears. |
| Undo | Returns to the active list as it was. |
| Archiving the open Project | Stays open, read-only, with the Archived banner. [ASSUMPTION: logged as assumption] |
| Archived, open | Read-only: chats, History, and files can be read. Composer, tool buttons, uploads, file Remove, topic edits, rename, "Do it again", and quiz resume wait for Restore. No Mistakes card; mistakes are kept. |
| Restore | From the Archived banner or the "···" menu. Returns to the active list; chat, activities, and uploads re-enable; the Mistakes card returns when active mistakes > 0. |
| Delete an archived Project | Same Confirm dialog (delete project). |
| Archiving while generating | Generation finishes and saves to History (also in Generating). |
| Archiving with an open phone link | The phone link closes. |
| Returning sign-in, last Project archived | Lands on the most recent active Project. |

**Daily limits (chat 50 messages, image extraction 25 images, per Account per day)**

| State | Treatment |
|---|---|
| More than 10 remaining | No counter. |
| 10 or fewer remaining | Notice near the action: "{n} messages left today"; same for images (upload and phone page). |
| 0 remaining | `{colors.error}` message; the action is declined (FR-16, FR-7). |

**Generating (Quiz, Flashcards, Summary, Mistake Review start; up to 60 seconds)**

| State | Treatment |
|---|---|
| In progress | Progress steps with Cancel. |
| Student leaves | Quiz, Flashcards, and Summary generation continues; on finish, the Chat message notice appears and the item is saved to History. |
| Cancel | Stops; back to setup with choices kept. |
| Failure (Quiz, Flashcards, Summary) | Inline error on the setup; choices stay. |
| Mistake Review start failure | Inline error; the card count is unchanged. |
| Mistake Review answer-save failure | Inline error; the mistake stays counted until saved. |
| Project deleted while generating | Generation is cancelled. |

**Leaving part-way**

| Activity | What happens |
|---|---|
| Quiz | Mistakes from answered questions stay recorded (FR-12). Saved in History as "Unfinished · {n} of {total}"; resumable. |
| Flashcards | "Stop for now" or "← Back to chat" ends the set. Not resumable; in History with "Do it again". |
| Mistake Review | Cleared mistakes stay cleared; the rest stay on the card. "Your progress is saved." |
| Summarize, during generation | Generation continues. |

**Edge states by surface.** Error cells use the Inline error unless stated.

| Surface | Empty | Loading | Error | Narrow window (below 1024px) |
|---|---|---|---|---|
| Count picker (Quiz, Flashcards) | Never empty: Quiz and Flashcards stay disabled until a file is Ready. Thin material: Too-little-material note. | Renders with setup; Progress steps follow. | Generation failure; choices stay. | Three options stay in one row in the setup column. |
| History | "Nothing here yet", filter visible; same line for a filter with no matches. [ASSUMPTION: no-match line] | Static skeleton rows; the filter is usable. [ASSUMPTION: from mock] | "We couldn't load your history." with "Try again"; "← Back to chat" stays. | Full main-column width; the filter wraps. |
| File "···" menu and Remove file dialog | Rejected rows have no menu (File row). | Reading… file: Remove file dialog. | Remove fails: Remove file dialog. | Targets stay at least 44×44px; the dialog fits the window width. [ASSUMPTION: dialog sizing] |
| Files strip | "0 of 10", no warning icon. | Reading… files count; no extra indicator. [ASSUMPTION] | A partly unreadable or rejected file shows the warning icon; expanding shows which. | Starts collapsed (Files strip). |
| All cleared panel | Unreachable with zero mistakes. | Appears once the final answer is saved. | Final save fails: Inline error; the panel waits for the save; nothing saved is lost. | Same panel at the available width; actions stack if needed, "Make a new quiz" first. [ASSUMPTION] |

**Errors:** network or AI failure → Inline error with "Try again"; nothing already saved is lost. Sign-in and account errors → Account.

**Phone link**

| State | Treatment |
|---|---|
| Active | PC: QR and "This code works for 10 minutes and stops when you close this window." [ASSUMPTION: copy from mock] Phone: Link countdown. |
| Last minute | Countdown in seconds ("Link expires in 0:42" format), still muted. |
| Waiting | QR dialog: "Waiting for photos…". |
| Batch arrived | QR dialog and Files panel show one new Study Material ("Handwritten notes, {n} pages") with its status, live; "Files · n of 10" updates. |
| Sent | The phone confirms the photos are in the Project and the computer will show when they are ready; "Send more" while the link is valid. [ASSUMPTION: from mock] |
| Zero photos | "Send photos" disabled. |
| Over limit | The phone warns before sending (images left today, or 10 files). Advisory; the server re-checks. |
| Expired (about 10 minutes, QR dialog closed, or Project archived) | Expired notice. Muted, not `{colors.error}`. |

**Destructive actions.** Dialog contents are in Component Patterns; this table adds where the student lands.

| Action | Confirmation | Lands on |
|---|---|---|
| Delete the open Project | Confirm dialog (delete project) | The most recent other Project, or the Projects page (empty) if none is left. Running generation is cancelled. |
| Delete another Project | Confirm dialog (delete project) | The current page. [ASSUMPTION] Running generation is cancelled. |
| Delete account | Confirm dialog (delete account) | Login screen with "Your account and files have been deleted." |
| Remove a file | Remove file dialog | The Files panel, slot freed. |
| Remove a Rejected file | None; immediate | The Files panel. |
| Remove a phone thumbnail | None; immediate | The phone page, renumbered. |
| Archive a Project | None; Undo message | The current page; an open Project stays open read-only. |
| Log out | None; immediate | Login screen. |

## Interaction Primitives

**Keyboard shortcuts** (desktop only, shown as Key hints, hidden on touch devices; disabled while focus is in a Text input):

| Activity | Key | Action |
|---|---|---|
| Quiz, Mistake Review | 1–4 | Choose answer |
| Quiz, Mistake Review | → | "Next question" or "Next mistake" [ASSUMPTION: → from mock and the earlier "arrows to move" decision] |
| Flashcards | Space | Flip |
| Flashcards | → | Got it |
| Flashcards | ← | Not yet |
| Top bar title, sidebar rename | Enter / Esc | Save / cancel rename |
| Overflow menu ("···") | Enter or Space / Esc | Open / close |
| Sidebar collapse and expand buttons, Files strip buttons | Enter or Space | Collapse / expand |

Flashcard keys are language-independent.

**Tab order.** The Overflow menu, History filter, Count picker, Archived group, Sidebar collapse button, Sidebar strip buttons, and Files strip buttons are reachable by Tab. Dialog focus: Modal dialog.

**Motion.** Subtle transitions only, neither static nor flashy: the flashcard flip, the quiz answer reveal, moving between the chat and activities, and the Files panel and Sidebar expanding or collapsing. No celebratory animation, including on the All cleared panel.

**Reduced motion.** When the operating system requests it, transitions become instant (including the Files panel and Sidebar), the Reading… pulse becomes a static dot with its label, the "thinking" dots are static, and skeletons never shimmer.

**Live updates.** The QR dialog, Files panel, and Files strip update without refresh while a phone link is active and while files move from Reading… to a final status.

**Never automatic.** Mistake Review starts only from Start (FR-17). The All cleared panel appears only after the student clears the last mistake. A Quiz never auto-advances.

## Accessibility Floor

Behavioral. Visual contrast lives in DESIGN.md Colors (all text colors pass WCAG AA on `{colors.background}` and `{colors.surface}`; light text on indigo is banned).

- **Non-text contrast (WCAG 2.2 SC 1.4.11):** a boundary or state indicator that is the only way to see a control reaches at least 3:1 against its background. Text inputs, checkboxes, radios, and Count picker options use `{colors.border-control}` (ratios in DESIGN.md Colors). Decorative lines are exempt.
- **Keyboard:** every interactive element is reachable by Tab and shows the `{components.focus-ring}`. The study loop is fully keyboard-operable (Interaction Primitives).
- **Not color-only:** file status, answer feedback, mistakes, archived state, and limits always carry a text label; the red Remove button is labeled with a word.
- **Mistakes use `{colors.mistake}`, not red,** so a wrong answer is not presented as an error.
- **Screen readers:** the Feedback panel, progress changes, Progress steps, the pending chat answer, and the Undo message use a polite live region; the Error line and Inline errors are alerts. [ASSUMPTION: from mock (`aria-live="polite"`, `role="alert"`)]
- **Targets at least 44×44px:** phone page controls (including the thumbnail ×), the Overflow menu trigger and items, and the Sidebar collapse, expand, and "+ New project" buttons.
- **Sidebar collapse:** the collapse and expand buttons carry `aria-expanded` and the accessible names "Hide projects" and "Show projects"; the icon-only "+ New project" button is named "New project". Tooltips also show on keyboard focus.
- **Files strip:** the warning icon has a text name, and "n of 10" stays visible.
- **Narrow window:** History, the Count picker, the Remove file dialog, and the All cleared panel stay keyboard operable.
- **Remove file dialog:** the checkbox starts unchecked and has a visible text label.
- **No hover-only affordances on touch:** the Log out red hover does not apply, and the sidebar "···" trigger also appears on keyboard focus and always on the open Project.
- **Focus is never lost:** Modal dialog. The Undo message stays while focused, so a keyboard user can reach "Undo".
- **Reduced motion** is respected (Interaction Primitives).

## Key Flows

### UJ-1. Emma turns a slide deck into graded practice in minutes.

Emma, university biology student, first visit.

1. On the Login screen, Emma selects "Create account" and enters her first name, email, and password (or uses "Sign in with Google", which takes her name from the profile).
2. She lands on the Projects page (empty) and selects "Create your first project".
3. The empty Project shows "Upload your notes to start". She drops her lecture slides on it; the file shows "Reading…", then "Ready".
4. The Project name generates from the material, topics appear, and the composer and tool buttons enable.
5. She selects Quiz, picks topics, and chooses 5, 10, or 20 questions (10 is preselected); the Too-little-material note appears if needed. Progress steps show while it generates.
6. She answers with number keys and moves on with "Next question" (→); the last question shows "See results".
7. **Climax:** each answer gets immediate feedback. A wrong pick shows "Not quite" / "It stays in your review.", an explanation grounded in her slides, and a Source label. At the end she sees her score and missed questions.
8. Her wrong answers are recorded automatically. Back in the chat, the Mistakes card sits at the top.

Failure paths:

- Email already registered → duplicate-email message (FR-1).
- Unreadable material → partly unreadable, or rejected without counting toward 10 (FR-7, §5.1). No empty or broken quiz is generated.
- Generation fails → Inline error. Cancel → setup, choices kept.
- Wrong file → she removes it from its "···" menu, even while Reading….
- She leaves mid-quiz → answered mistakes stay; the quiz waits in History as "Unfinished · {n} of {total}".

→ [`mockups/key-project-home.html`](mockups/key-project-home.html), [`mockups/key-quiz-feedback.html`](mockups/key-quiz-feedback.html)

### UJ-2. Emma comes back and clears her mistakes.

Emma, a few days later, logs back in.

1. Emma lands on her last Project exactly as she left it (FR-8), or on her most recent active Project if she archived it.
2. The chat shows "{n} mistakes to review · Start".
3. She selects Start; Progress steps show while practice questions generate.
4. **Climax:** she practices questions built from her wrong Quiz answers, each with the original mistake as context. A correct answer clears it: "1 of {m} cleared".
5. She can stop any time ("Stop for now" or "← Back to chat"); the app says progress is saved, and the card shows the lower count.
6. She clears the last one and sees "All cleared! Nice work."; back in the chat, the card is gone.

Failure and edge paths:

- Practice questions fail to generate → Inline error; the card count is unchanged.
- A clear fails to save → Inline error; the mistake stays counted until saved.
- Wrong review answer → "Not quite" / "It stays in your review."; the mistake stays.
- Never "0 mistakes to review" (FR-9); never "All cleared! Nice work." after "Stop for now".

→ [`mockups/key-mistake-review.html`](mockups/key-mistake-review.html)

### UJ-3. Emma refreshes a topic with Summarize, then clarifies it with Ask AI.

Emma, preparing for a lecture review session, inside her Project.

1. Emma opens the Project; the chat is home.
2. She selects Summarize, picks one file as the Selection Scope, optionally one of its topics, and selects "Make summary".
3. She reads the summary, each section with Source labels.
4. She spots a concept she still doesn't understand and selects "← Back to chat".
5. With "All materials" as scope, she asks how two concepts differ; "Study Buddy is thinking…" shows until the answer is ready.
6. The answer is grounded in her material, with Source labels.
7. She asks a follow-up.
8. **Climax:** the follow-up resolves her confusion from her own course material, cited by file and slide, not a generic web answer.
9. The chat saves with the Project; older items sit behind "History" (History row).

Failure paths:

- Summary generation fails → Inline error on the setup, file and topic kept.
- 10 or fewer messages left → "{n} messages left today" under the composer; at zero the message is declined (FR-16).

→ [`mockups/key-summary.html`](mockups/key-summary.html) (Summarize setup, Summary view, generating, error), [`mockups/key-project-home.html`](mockups/key-project-home.html) (chat)

### Flow 4 — Emma uploads handwritten notes from her phone.

Emma, at her desk with her Project open and paper notes beside her.

1. In the Files panel, Emma selects "Upload from phone"; the QR dialog shows "Waiting for photos…".
2. She scans the code. The phone page opens with no login and shows the Project name.
3. She taps "Take photos" and photographs her pages. She removes a blurry thumbnail with ×; the pages renumber. The send button shows the live count; the Link countdown runs.
4. She taps Send; the phone confirms the photos are in her Project.
5. **Climax:** on the computer, without refreshing, the dialog and Files panel show one new Study Material ("Handwritten notes, {n} pages") moving to its status, and "Files · n of 10" goes up by one. Each photo counts toward her 25 images per day.
6. She closes the dialog; the phone link stops working.

Failure paths:

- The link expires first → Expired notice; Send disabled.
- Over the image limit or at 10 files → the phone warns before sending.
- An unreadable page → one "Ready, partly unreadable" Study Material naming the failed pages.
- An entirely unreadable batch → Rejected; does not count toward 10 (FR-7).

→ [`mockups/key-phone-upload.html`](mockups/key-phone-upload.html)

### Flow 5 — Emma runs through a flashcard set.

Emma, inside her Project, ten minutes before class.

1. She selects Flashcards, keeps the default 10 cards, picks two topics, and starts (the Too-little-material note applies as in Quiz). Progress steps show.
2. A card shows the term. She presses Space to flip; the back shows the answer and its Source label.
3. She presses → for "Got it" or ← for "Not yet"; "Not yet" cards come back later in the session.
4. **Climax:** the set ends with "{n} cards done. {m} needed a second try". No score, streak, or next-review date, and nothing added to Mistake Review.
5. She selects "Make more cards" or "← Back to chat". "Stop for now" was available throughout.

Failure paths:

- Generation fails → Inline error on the setup, choices kept.
- She stops part-way → not resumable; the set appears in History with "Do it again".

→ [`mockups/key-flashcards.html`](mockups/key-flashcards.html)

### Flow 6 — Emma signs in for the first time with Google.

Emma, new to Study Buddy, on her laptop.

1. The Login screen opens in her browser's language; she switches to NO with the corner toggle.
2. She selects "Sign in with Google" and completes Google's consent.
3. **Climax:** she lands on the Projects page (empty), greeted by first name ("Welcome, [first name]"), with "Create your first project".
4. Later, in Settings, she sees her Google name, email, and picture read-only.

Failure paths:

- She cancels or sign-in fails → "Sign-in didn't work. Try again."; both ways in stay active.
- Her Google email already has a password account → the account-linking message; after one password login, Google is linked to that Account and both methods work.

→ [`mockups/key-login.html`](mockups/key-login.html), [`mockups/key-settings.html`](mockups/key-settings.html)

## Responsive & Platform

| Context | Behavior |
|---|---|
| Desktop browser, normal width (1024px and wider) | Full layout: Sidebar and Files panel expanded or collapsed as last left (the Files panel per Project); top bar with "Welcome, [first name]" and avatar. |
| Narrow desktop window (below 1024px) | What "mobile" means here. The Account menu shows the avatar only. The Sidebar and Files panel start collapsed (State Patterns › Sidebar; Files strip). History, the Count picker, the "···" menus, the Remove file dialog, and the All cleared panel all work. No full mobile layout. |
| Phone | Only the phone upload page, reached by QR code, with the footer credit shown small at the bottom. |
| Touch devices | No hover states relied on; Log out stays normal text; Key hints hidden; target sizes per Accessibility Floor. |

## Inspiration & Anti-patterns

- **Referenced — mindgrasp.ai (AI study buddy page):** content patterns only (LMS-import framing, condensed-notes framing, comparison table, benefit-led copy). No visual palette or type was taken from it.
- **Rejected — tab row per tool:** replaced by the chat as home, with activities that return to it.
- **Rejected — gamification:** no badges, streaks, points, levels, or confetti (brief out-of-scope).
- **Rejected — spaced repetition and scheduling in flashcards:** no due dates (brief out-of-scope).
- **Rejected — illustrations and mascots:** empty states and confirmations are text only.
- **Rejected — red for mistakes:** amber keeps wrong answers in "review this" territory.
- **Rejected — pushed review:** Mistake Review is never automatic or nagging (FR-17).

## Scope Changes vs PRD

These decisions extend or change the PRD. Update it through `bmad-prd` Update or `bmad-correct-course`. Details live in the sections named.

| Change | Affects | Note |
|---|---|---|
| Chat (Ask AI) is the project home; Quiz, Flashcards, Summarize open from chat buttons; no tab row; Files in a right panel | UJ-1 step 4, UJ-3, FR-16 | [NOTE FOR PM] |
| Mistake Review has no tab; entry is the Mistakes card | FR-9, FR-17 | [NOTE FOR PM] |
| Mistakes come from wrong Quiz answers only; flashcard "Not yet" repeats in-session and never records a Mistake | FR-9, FR-14 | [NOTE FOR PM] |
| Flashcard sets of 5, 10, or 20 cards (default 10, within the 50 cap); "Got it" / "Not yet"; Too-little-material note | FR-13, FR-14 | [NOTE FOR PM] |
| Quiz length of 5, 10, or 20 questions (default 10; 20 is the PRD maximum); Too-little-material note | FR-10 | [NOTE FOR PM] |
| Accepted files can be removed with confirmation; the slot frees; generated material stays; mistakes stay unless the student opts out (Remove file dialog) | FR-6, FR-9, FR-18 | [NOTE FOR PM] |
| One History list behind one History link, filterable by type; read-only results with "Do it again"; unfinished quizzes resumable (History row) | FR-8, FR-16 | [NOTE FOR PM] |
| Finished generation posts a quiet chat message and saves to History | FR-8 | [NOTE FOR PM] |
| Mistake Review ends with "All cleared! Nice work." after the last clear | FR-9, FR-18 | [NOTE FOR PM] |
| Delete a project from the sidebar "···" menu; rename inline in the sidebar and top bar; email accounts can edit their name | FR-5, New | [NOTE FOR PM] |
| **Archive projects:** no confirmation, Undo message, "Archived (n)" group, read-only until Restore, mistakes kept but no Mistakes card while archived; Restore and Delete project from the archived menu (State Patterns › Archived project) | FR-4, FR-8, FR-9 | [NOTE FOR PM] |
| A phone batch with an unreadable page becomes one "Ready, partly unreadable" Study Material naming the failed pages | FR-7 | [NOTE FOR PM] |
| Sign in with Google alongside email and password (FR-1 to FR-3 kept, including password reset); a Google sign-in whose email has a password account links after one password login | FR-1, FR-2 | [NOTE FOR PM] |
| Sign-up asks for first name; Google accounts take it from the profile | FR-1 | [NOTE FOR PM] |
| Settings page (Account, Language, Your data) with Change password, Link Google account, delete project, and delete account | New (adjacent to FR-3) | [NOTE FOR PM] |
| Upload from phone via QR code; the phone page is a mobile surface in a desktop product; one batch = one Study Material | FR-6, FR-7, brief "desktop web app" | [NOTE FOR PM] |
| Bilingual UI: English and Norwegian (bokmål) | New | [NOTE FOR PM] |
| Account menu with avatar and "Welcome, [first name]" | New | [NOTE FOR PM] |
| Editable AI-detected topics as the Selection Scope unit | FR-10, FR-13, FR-15 | [NOTE FOR PM] |
| Light mode as a stretch goal | New | [NOTE FOR PM] |

## Notes for Architecture

| Topic | Note |
|---|---|
| [NOTE FOR ARCHITECTURE] Account identity and linking | One Account per email (FR-1). A Google sign-in matching an email-and-password Account links to it after one password login (State Patterns › Account); Settings › "Link Google account" links explicitly. |
| [NOTE FOR ARCHITECTURE] Password reset | Emailed, expiring link (FR-3). The request reply is identical whether or not the Account exists (no account enumeration). Expired links show an expired state. |
| [NOTE FOR ARCHITECTURE] Topic detection | Runs after extraction; topics are stored per Study Material and can be renamed, deleted, and added. A hand-added topic is a label that scopes generation within the Project's material; Content Integrity still applies (no content if the topic isn't in the material). |
| [NOTE FOR ARCHITECTURE] Phone upload | One-time, short-lived (about 10 minutes), upload-only token scoped to one Project, unable to read data, revoked when the PC dialog closes. Live push to the PC (WebSocket, SSE, or polling). Assembles several images into one Study Material. |
| [NOTE FOR ARCHITECTURE] Server-side limit re-check | At upload, re-check the 25 images per day and the 10-file cap. The file count includes files in Reading…; a rejection frees the slot. The phone warning is advisory. |
| [NOTE FOR ARCHITECTURE] String externalization | All UI strings externalized for English and Norwegian, with dynamic counts ("Du har {n} feil å repetere"). |
| [NOTE FOR ARCHITECTURE] Content Integrity thresholds | The PRD sets no confidence thresholds between Ready, partly unreadable, and Rejected; the UI only represents the three states. |
| [NOTE FOR ARCHITECTURE] Generation across navigation | Quiz, Flashcards, and Summary generation continues when the student leaves, and can be cancelled. Deleting a Project cancels its running generation. Mistake Review practice questions generate after Start (FR-18). |
| [NOTE FOR ARCHITECTURE] Mistake clearing | A mistake leaves the active count only once the correct review answer is saved. |
| [NOTE FOR ARCHITECTURE] Partial runs | A part-way quiz is stored with its answered questions and resumable from History; mistakes are recorded as they happen (FR-12). A part-way flashcard set is stored as finished with "Do it again", not resumable. |
| [NOTE FOR ARCHITECTURE] Archived projects | Per-Project archived state. Read-only rules in State Patterns › Archived project; mistakes are kept but excluded from the Mistakes card. Archiving lets running generation finish and save, revokes the Project's phone link, and removes the Project from the sign-in landing. |
| [NOTE FOR ARCHITECTURE] Session expiry (FR-2) | The next sign-in returns the student to the Project she was in. |
| [NOTE FOR ARCHITECTURE] Theming | Every color is a token so a light theme can be added later. |
| [NOTE FOR ARCHITECTURE] File removal | Removing a Reading… file cancels upload and extraction server-side and frees the slot immediately. Generated material stays. Mistakes stay active unless the student opts out; then they leave the count with history kept (FR-18). The server must know each mistake's source file. |
| [NOTE FOR ARCHITECTURE] History | One list per Project across all item types, newest first, filterable by type. Background-finished generation posts a chat message and adds the item. |
| [NOTE FOR ARCHITECTURE] Panel state | The Files panel's collapsed or expanded choice is saved to the account per Project; the Sidebar's choice is saved to the account. A narrow window starts both collapsed. |
| [NOTE FOR ARCHITECTURE] "Do it again" | A fresh run reuses the stored count, topics, and file of the original quiz or flashcard set. |

## Open Questions

1. **Norwegian strings (pending team action):** Team sign-off of every Norwegian string tagged (proposed); the Voice and Tone term table becomes the binding glossary once signed off.
