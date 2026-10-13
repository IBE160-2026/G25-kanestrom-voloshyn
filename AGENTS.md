<!-- bmad:context -->
<!-- Verified 2026-10-13 against ab09ce3. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## AI Study Buddy

IBE160 group project (G25, Høgskolen i Molde, autumn 2026): a desktop web app where students upload their own study material and generate quizzes, flashcards, summaries, and grounded chat from it, with wrong answers feeding Mistake Review. No application code exists yet; the stack is undecided until `bmad-architecture` runs. Planning lives in `_bmad-output/planning-artifacts/`; human onboarding is `_bmad-output/PROJECT-CONTEXT.md`.

## Policy

- Never commit secrets — keys live only in `.env` (gitignored); add each new variable name, without a value, to `.env.example`.
- All LLM calls go through one dedicated module; nothing else calls a provider API or SDK. That module must have a mock mode with canned responses so the grader can run the app and tests with no key and no paid calls.
- Sample and test documents go in a dedicated test-data folder, never the repo root. Commit only small self-created or openly licensed files — never textbooks, course PDFs, or lecture slides.
- Never implement on `main` — use `feature/<name>` branches, merged only after testing and review.
- Commit messages in English, preferably `type: summary` (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`), saying what changes; the commit log is graded.
- English for code, identifiers, comments, tests, BMAD artifacts, and technical docs; `README.md` stays Norwegian.
- Never hand-edit `_bmad/`, `.claude/skills/`, or `.agents/skills/` — customize via `bmad-customize` or `_bmad/custom/`; install or update with `npx bmad-method`.
- Never silently edit a document marked `status: final` (brief, PRD). When work conflicts with a final requirement, explain the conflict, propose the change, and wait for explicit approval from Cristoffer or Ihor; until then implement the requirement as written.
- V1 is exactly Quiz, Flashcards, Summarize, Ask AI, Mistake Review, Saved Projects (PRD §7). Never build post-V1 items (spaced repetition, adaptive learning, progress tracking/analytics, cross-document linking, recommendations, exam planning) or requirements absent from the brief and PRD unless asked — propose them instead.
- Pick the simplest design that meets the PRD; no microservices or extra infrastructure. Installed tools (Node, Python, Docker, Supabase) are not decisions — framework, database, LLM provider, document processing, hosting, and mock-mode design are made in `bmad-architecture`, and technology choices stay out of the brief and PRD.
- Never claim AI Study Buddy is the first or only tool of its kind — NotebookLM, Quizlet, StudyFetch, Quizgecko, and Revisely exist. Differentiation is the focused workflow and integrated Mistake Review; never add a feature because a competitor has it.

## Where things are

- Product brief: `_bmad-output/planning-artifacts/briefs/brief-AI-StudyBuddy-2026-09-16/brief.md`
- PRD: `_bmad-output/planning-artifacts/prds/prd-AI-StudyBuddy-2026-10-06/prd.md` — cite requirements by ID (FR-n, UJ-n, SM-n).

## Running and verifying

- Run `_bmad/scripts/*.py` with `uv run`, e.g. `uv run _bmad/scripts/memlog.py append --workspace <dir> --type decision --text "..."`.
- TODO: app install, run, test, and mock-mode commands — add once `bmad-architecture` picks the stack.

## Conventions that differ from defaults

- In `_bmad-output/planning-artifacts/`: FR/UJ/SM IDs are global; after adding, removing, or renumbering one, update every cross-reference and recount (`grep -c "^#### FR-"`). Tag inferences `[ASSUMPTION: ...]` and index them in the doc's Assumptions section; tag deferred decisions `[NOTE FOR PM]`. Append each decision to the workspace's `.memlog.md` with `memlog.py`.

<!-- /bmad:context -->
