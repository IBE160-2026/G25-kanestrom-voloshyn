# User Journeys

These are the PRD's journeys (ids unchanged). They give the end-to-end flows that stories and demo scripts must reproduce. The persona throughout is Emma, a university biology student. Screen-level flows, states, and copy are in EXPERIENCE.md › Key Flows.

## UJ-1 — Turn a slide deck into graded practice (first visit)

- **Entry state:** not logged in.
- **Path:**
  1. Emma optionally switches the interface to Norwegian.
  2. She creates an Account with her first name, email, and password, or with Google.
  3. She creates a Project and uploads her lecture slides.
  4. The Project names itself from the content (for example "Biology — Cell Division") and lists the Topics it found.
  5. From the Project's chat she starts a Quiz and picks Topics and a count (5, 10, or 20).
  6. She answers questions drawn from her slides.
- **Climax:** each answer gets immediate feedback with a grounded explanation that names its source. At the end she sees her score and which answers were wrong.
- **Resolution:** her wrong answers are recorded as Mistakes. She wrote no questions herself.
- **Edge cases:**
  - Material too thin for a usable Quiz is processed with a warning, or rejected if it's mostly unusable. A rejected file uses no slot.
  - If she uploads the wrong file, she can remove it, even while it's processing.
  - If she leaves mid-quiz, her Mistakes so far stay recorded, and the Quiz waits in History to be resumed.
- **Realized by:** CAP-1, CAP-2, CAP-3, CAP-4, CAP-11, CAP-12, CAP-14.

## UJ-2 — Come back and clear mistakes (return visit)

- **Entry state:** Emma logs back in.
- **Path:**
  1. She lands on her last-opened Project, with her material, chats, and activity exactly as she left them.
  2. The Project shows "3 mistakes to review".
  3. She chooses to start Mistake Review.
- **Climax:** she practices questions built from the Quiz questions she got wrong, not a generic re-quiz.
- **Resolution:** her mistake count reflects what she has cleared. The app surfaces mistakes but never forces a review.
- **Edge cases:**
  - With zero outstanding Mistakes, there is no indicator.
  - If she stops part-way, cleared Mistakes stay cleared and the rest stay outstanding.
  - If Mistakes remain after a round of 20, she sees how many and can start another round.
  - An archived Project shows no indicator until it is restored.
- **Realized by:** CAP-1, CAP-2, CAP-8, CAP-9.

## UJ-3 — Refresh with Summarize, clarify with Ask AI

- **Entry state:** logged in, inside an existing Project.
- **Path:**
  1. Emma opens the Project on its chat.
  2. She starts Summarize and picks one Study Material, optionally narrowed to one Topic.
  3. She reads the summary.
  4. She returns to the chat and asks "What is the difference between mitosis and meiosis?"
  5. She gets a grounded answer and asks a follow-up.
- **Climax:** the follow-up resolves her confusion from her own course material, with each answer naming its source.
- **Resolution:** the chat and the summary are saved and listed in the Project's History.
- **Realized by:** CAP-6, CAP-7, CAP-11, CAP-12.

## UJ-4 — Get handwritten notes in from a phone

- **Entry state:** logged in on the computer with the Project open; not logged in on the phone.
- **Path:**
  1. Emma chooses to upload from her phone.
  2. She scans the QR code shown on the computer.
  3. The phone opens an upload page for that one Project, with no login.
  4. She photographs six pages, drops a blurry one, and sends the rest.
- **Climax:** without a refresh, the computer shows one new Study Material ("Handwritten notes, 5 pages") being read, and the file count goes up by one.
- **Resolution:** the notes work with every feature like any other file. Closing the upload dialog on the computer kills the phone link.
- **Edge cases:**
  - If one page is unreadable, the batch becomes one Study Material with a warning naming that page. If every page is unreadable, the batch is rejected and uses no slot.
  - If the batch would go past the daily image limit or the Project's 10 files, the phone warns before sending.
- **Realized by:** CAP-3, CAP-10.

## UJ-5 — Run through a flashcard set before class

- **Entry state:** logged in, inside an existing Project.
- **Path:**
  1. Emma starts Flashcards from the chat, keeps the default 10 cards, and picks two Topics.
  2. She reveals each answer and marks the card known or not yet known.
  3. Cards marked not yet known come back later in the same set.
- **Climax:** the set ends when every card is known, showing how many cards she did and how many needed a second try.
- **Resolution:** nothing is scheduled and nothing goes to Mistake Review. The set is saved in History and can be run again.
- **Realized by:** CAP-5, CAP-11, CAP-12.
