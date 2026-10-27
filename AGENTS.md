<!-- bmad:context -->
<!-- Verified 2026-10-27 against d6791ab. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## AI Study Buddy

IBE160 group project (G25, Høgskolen i Molde, autumn 2026): a desktop web app where students upload their own study material and generate quizzes, flashcards, summaries, and grounded chat from it, with wrong answers feeding Mistake Review. Stack (fixed by the architecture spine; no application code yet): FastAPI backend on Python/uv, React + Vite SPA in JavaScript, Supabase (Auth, Postgres, Storage), OpenRouter through the `openai` SDK, shipped as one Docker app container. Planning lives in `_bmad-output/planning-artifacts/`; human onboarding is `_bmad-output/PROJECT-CONTEXT.md`.

## Policy

- Never commit secrets — keys live only in `.env` (gitignored); add each new variable name, without a value, to `.env.example`.
- All LLM calls go through `backend/app/llm/` (AD-3); nothing else imports `openai` or calls a provider. Its mock mode (`LLM_MODE=mock`, AD-4) must let the grader run the app and tests with no key and no paid calls.
- Sample and test documents go in `test-data/`, never the repo root. Commit only small self-created or openly licensed files — never textbooks, course PDFs, or lecture slides.
- Never implement on `main` — use `feature/<name>` branches, merged only after testing and review.
- Commit messages in English, preferably `type: summary` (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`), saying what changes; the commit log is graded.
- English for code, identifiers, comments, tests, BMAD artifacts, and technical docs; `README.md` stays Norwegian.
- Never hand-edit `_bmad/`, `.claude/skills/`, or `.agents/skills/` — customize via `bmad-customize` or `_bmad/custom/`; install or update with `npx bmad-method`.
- Never silently edit a document marked `status: final` (brief, PRD, architecture spine). When work conflicts with a final requirement or AD, explain the conflict, propose the change, and wait for explicit approval from Cristoffer or Ihor; until then implement it as written.
- V1 is exactly Quiz, Flashcards, Summarize, Ask AI, Mistake Review, Saved Projects (PRD §7). Never build post-V1 items (spaced repetition, adaptive learning, progress tracking/analytics, cross-document linking, recommendations, exam planning) or requirements absent from the brief and PRD unless asked — propose them instead.
- Pick the simplest design that meets the PRD; no microservices, job queues, or extra infrastructure. Never introduce a technology the spine doesn't name — amend the spine through `bmad-architecture` instead; technology choices stay out of the brief and PRD.
- Never claim AI Study Buddy is the first or only tool of its kind — NotebookLM, Quizlet, StudyFetch, Quizgecko, and Revisely exist. Differentiation is the focused workflow and integrated Mistake Review; never add a feature because a competitor has it.

## Where things are

- Product brief: `_bmad-output/planning-artifacts/briefs/brief-AI-StudyBuddy-2026-09-16/brief.md`
- PRD: `_bmad-output/planning-artifacts/prds/prd-AI-StudyBuddy-2026-10-06/prd.md` — cite requirements by ID (FR-n, UJ-n, SM-n).
- Architecture spine: `_bmad-output/planning-artifacts/architecture/architecture-AI-StudyBuddy-2026-10-13/ARCHITECTURE-SPINE.md` — read it before creating or changing anything under `backend/`, `frontend/`, or `supabase/`; cite decisions by AD-n. The reasoning behind each AD is in that folder's `.memlog.md`.

## Running and verifying

- Run `_bmad/scripts/*.py` with `uv run`, e.g. `uv run _bmad/scripts/memlog.py append --workspace <dir> --type decision --text "..."`.
- TODO (planned in the spine, unverified until the scaffold exists): Python 3.14 via uv, Node ≥ 22.12. Grader run: `.env.example` → `.env`, `npx supabase start` (needs Docker), `npx supabase db reset`, `docker compose up`. Dev: `uv run uvicorn …` plus `npm run dev` (Vite proxies `/api`). Backend tests: `pytest` via `uv run`, always with `LLM_MODE=mock`, against local Supabase. Replace with verified commands on the first refresh after scaffolding.

## Conventions that differ from defaults

- In `_bmad-output/planning-artifacts/`: FR/UJ/SM IDs are global; after adding, removing, or renumbering one, update every cross-reference and recount (`grep -c "^#### FR-"`). Tag inferences `[ASSUMPTION: ...]` and index them in the doc's Assumptions section; tag deferred decisions `[NOTE FOR PM]`. Append each decision to the workspace's `.memlog.md` with `memlog.py`.
- Spine AD ids are permanent: amend a Rule in place or add the next AD-n; never renumber or reuse one.
- The browser uses Supabase only for auth; all app data goes through FastAPI `/api/*` (AD-1).
- Change the schema or storage bucket only through SQL in `supabase/migrations/`, never in the Supabase dashboard (AD-16).
- Only `services/mistakes` writes Mistakes and only `services/usage` touches quota counters; other services call them (AD-10, AD-12).
- Services take the request's `conn` and never commit; never call the LLM inside an open write transaction (AD-18).

<!-- /bmad:context -->
