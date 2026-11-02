# Glossary

The terms every capability, story, and test uses (PRD §3, plus architecture terms where students or tests meet them). Limits are stated once, in SPEC.md Constraints and `acceptance-criteria.md`.

- **Account:** a student's identity, with a first name and one or more sign-in methods: email and password, a linked Google account, or both. At most one Account exists per email. An Account owns many Projects; a Project belongs to exactly one Account.
- **Project:** a named, persistent container for Study Materials and their Topics, the Study Content and chats generated from them, and the student's Mistakes. It is named by the system once from its first usable material (AD-14), and the student can rename it while it is active.
- **Active Project:** a Project that is neither archived nor in Deleted projects. Only an active Project can be changed: chatting, generation, upload, and edits.
- **Archived Project:** moved out of the active list without deleting anything. It is read-only until restored.
- **Deleted projects:** the group holding deleted Projects. They are read-only and restorable for 30 days, then permanently deleted. "Delete forever" deletes one at once.
- **Study Material:** one uploaded file (PDF, .docx, .pptx, .txt, .md, .jpg/.jpeg, .png, .heic), or one batch of phone photos sent together. Its state is *processing*, *ready* (fully or partly readable), or *rejected*. Processing material counts toward the Project's 10; rejected material never does.
- **Section:** an ordered, labelled unit of extracted text, such as a PDF page, a slide, about 500 words of a text document, or one photo (AD-5). It is an architecture term; students see its label as a source location, for example "Slide 7".
- **Topic:** a subject detected in one Study Material. The student can rename, merge, delete, or add Topics. Topics are the Selection Scope unit for Quiz and Flashcards (AD-21).
- **Selection Scope:** the material a feature works from.

  | Feature | Scope |
  | --- | --- |
  | Quiz, Flashcards | all Topics, or chosen Topics |
  | Summarize | one Study Material, whole or one Topic |
  | Ask AI | all Study Material, or one Study Material per chat |

- **Source:** the Study Material, and the page or slide where available, that an explanation, card, summary section, practice question, or chat answer is drawn from. Every output names one.
- **Study Content:** AI-generated output from a Selection Scope: a Quiz, a Flashcard set, or a Summary.
- **Quiz:** 5, 10, or 20 multiple-choice questions (4 options, 1 correct; AD-9), answered one at a time, with immediate sourced feedback and an end score. Each Quiz has one attempt; "Run again" is a new generation.
- **Unfinished Quiz:** a Quiz left before its last question. It resumes from the next unanswered question.
- **Flashcards:** 5, 10, or 20 question-and-answer cards, each marked known or not yet known. Not-yet-known cards return later in the same set. Flashcards never create Mistakes.
- **Summarize:** a summary of one Study Material, whole or one Topic, made of sections that each name their source.
- **Ask AI / Chat:** the Project's home view, where students ask free-form questions. A Project holds several chats, and each keeps its own scope.
- **History:** the per-Project list of chats, Quizzes, Flashcard sets, and Summaries, newest first and filterable by type.
- **Generation:** producing a Quiz, Flashcard set, Summary, or Mistake Review round as a background job (AD-20). It continues when the student leaves the screen, can be cancelled, and is announced in the Project when it is ready.
- **Mistake:** a Quiz question answered incorrectly, recorded with the Study Material it came from. It stays outstanding until it is cleared in Mistake Review, or until it is taken out of review when its material is removed.
- **Mistake Review:** student-initiated practice built from outstanding Mistakes, in rounds of at most 20.
- **Practice Question:** a multiple-choice question targeting one Mistake. When the Mistake's material was removed, the saved original question is reused instead.
- **Phone upload link:** a one-time, upload-only, short-lived link, shown as a QR code, that lets a phone send photos into one Project without logging in.
- **Interface language:** English or Norwegian (bokmål) for the app's own text. It never changes the language of generated content.
- **Settings:** where a student manages their Account, interface language, and data.
- **Mock mode:** `LLM_MODE=mock`, in which the LLM module returns deterministic, schema-valid output, so the app and tests run with no key (AD-4).
