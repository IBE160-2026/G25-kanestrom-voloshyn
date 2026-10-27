# User Journeys

These are the PRD's journeys (ids unchanged). They give the end-to-end flows that stories and demo scripts must reproduce. The persona throughout is Emma, a university biology student.

## UJ-1 — Turn a slide deck into graded practice (first visit)

- **Entry state:** not logged in.
- **Path:**
  1. Emma creates an Account.
  2. She creates a Project and uploads her lecture slides.
  3. The Project names itself from the content (for example "Biology — Cell Division").
  4. The Project view offers Quiz, Flashcards, Summarize, and Ask AI.
  5. She starts a Quiz and answers questions generated from her slides.
- **Climax:** each answer gets immediate feedback with an explanation grounded in her material. At the end she sees her score and which answers were wrong.
- **Resolution:** her wrong answers are recorded as Mistakes automatically. She wrote no questions herself.
- **Edge case:** material that can't support a usable Quiz is processed with a warning, or rejected if mostly unusable (Content Integrity). The student never sees an empty or broken Quiz.
- **Realized by:** CAP-1, CAP-2, CAP-3, CAP-4.

## UJ-2 — Come back and clear mistakes (return visit)

- **Entry state:** Emma logs back in a few days later.
- **Path:**
  1. She opens her Project list.
  2. She opens "Biology — Cell Division". Her material and earlier activity are exactly as she left them.
  3. The Project shows "3 mistakes to review".
  4. She chooses to open Mistake Review.
- **Climax:** she practices questions built from what she got wrong, not a generic re-quiz.
- **Resolution:** her mistake count reflects what she has cleared. The app surfaces mistakes but never forces a review.
- **Edge case:** a Project with zero Mistakes shows no indicator, never "0 mistakes to review".
- **Realized by:** CAP-1, CAP-2, CAP-5, CAP-8.

## UJ-3 — Refresh with Summarize, clarify with Ask AI

- **Entry state:** logged in, inside an existing Project.
- **Path:**
  1. Emma clicks Summarize and chooses one uploaded chapter as the scope.
  2. She reads the summary.
  3. She opens Ask AI and asks "What is the difference between mitosis and meiosis?"
  4. She gets an answer grounded in her material.
  5. She asks a follow-up question.
- **Climax:** the follow-up resolves her confusion using her own course material, not a generic web answer.
- **Resolution:** the conversation is saved with the Project for later.
- **Realized by:** CAP-6, CAP-7.
