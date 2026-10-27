# Glossary

The terms every capability, story, and test uses. Limits are stated once, in SPEC.md Constraints and `acceptance-criteria.md`.

- **Account:** a student's registered identity (email + password). It is required to create or access Projects. One Account owns many Projects; a Project belongs to exactly one Account.
- **Project:** a named, persistent container holding one or more Study Materials, the Study Content generated from them, the Ask AI thread, and the student's Mistakes. The system names it automatically once from its first usable material (AD-14), and the student can rename it at any time.
- **Study Material:** a file uploaded into a Project: PDF, .docx, .pptx, .txt, .md, .jpg/.jpeg, .png, or .heic. The image formats cover photos of handwritten or printed notes; .heic is the iPhone camera default.
- **Section:** an ordered, labelled unit of extracted text from a Study Material, such as a page, slide, heading, or whole image (AD-5). Section is an architecture term; students see Section labels when choosing a scope.
- **Selection Scope:** the subset of a Project's material a generation feature works on: the whole Project, or a student-chosen topic or section within it. Technically, it is a set of Sections (AD-7).
- **Study Content:** AI-generated output derived from a Selection Scope: a Quiz, a Flashcard set, or a Summary.
- **Quiz:** a set of AI-generated multiple-choice questions (4 options, 1 correct; AD-9), answered one at a time with immediate feedback (correct or incorrect, plus a grounded explanation) and an end-of-quiz score.
- **Quiz Attempt:** one pass through a saved Quiz. Retaking a Quiz creates a new Attempt on the same questions; generating again creates a new Quiz (AD-8).
- **Flashcards:** a set of AI-generated question/answer cards, each of which the student can mark known or not yet known.
- **Summarize:** an AI-generated summary of a whole Study Material or a chosen part of one.
- **Ask AI:** free-form chat about a Project's material. By default it answers from the whole Project, and the student can narrow it to one Study Material. It is one persistent thread per Project (AD-15).
- **Mistake:** a Quiz question answered incorrectly, or a Flashcard marked "not yet known", recorded automatically against the Project. It stays outstanding until it is answered correctly in Mistake Review (AD-10).
- **Mistake Review:** a student-initiated practice session that generates targeted practice questions from a Project's outstanding Mistakes.
- **Practice Question:** a multiple-choice question generated during Mistake Review to target one Mistake (AD-11).
- **Mock mode:** `LLM_MODE=mock`, in which the LLM module returns deterministic, schema-valid fixtures, so the app and tests run with no key (AD-4).
