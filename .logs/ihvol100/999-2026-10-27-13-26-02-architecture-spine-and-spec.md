# Architecture spine and spec

## 2026-10-27 kl. 13:26 — Ihvol100

### Oppgave
Create the V1 architecture spine with `bmad-architecture` (Coaching path), refresh the agent instructions, distill the spec with `bmad-spec`, then merge the work into `main` and clean up the branches. `bmad-ux` was started and then dropped.

### Plan
- `bmad-architecture`: settle the stack and decisions with the user, run the reviewer gate (four subagent lenses), and finalize the spine.
- `bmad-project-context`: refresh the managed AGENTS.md block and PROJECT-CONTEXT.md from the spine.
- `bmad-spec`: distill the final PRD into SPEC.md, with the spine as a companion.
- Merge `architecture-spine` into `main`, then start an Update of the spine for the revised PRD.

### Resultat
- **Spine:** `_bmad-output/planning-artifacts/architecture/architecture-AI-StudyBuddy-2026-10-13/ARCHITECTURE-SPINE.md`, `status: final`, with AD-1 to AD-18.
  - **Stack:** FastAPI (Python 3.14/uv) + React/Vite (JS) + Supabase (Auth, Postgres, Storage) + OpenRouter through the `openai` SDK, shipped as one Docker app container.
  - **Mock mode:** `LLM_MODE=mock` (AD-4).
  - **Content Integrity thresholds:** AD-6.
  - **Decision log:** memlog and reviewer reports in the same folder. Commit `3cfd2cc`.
- **AGENTS.md:** managed block refreshed with the stack, the planned run commands as TODOs, and cross-component rules. PROJECT-CONTEXT.md was updated (`3cfd2cc`) and later deleted, following main.
- **Spec:** `_bmad-output/specs/spec-AI-StudyBuddy/` with SPEC.md (CAP-1 to CAP-8), glossary, acceptance criteria and user journeys. Commit `40cfec7`.
- **bmad-ux dropped:** a finalized UX run (`ux-AI-StudyBuddy-2026-10-13`, by Cristoffer) already existed on main. The empty duplicate was removed in `2509b76`.
- **Merge:** `architecture-spine` was merged into `main` in `a596ad8`. Conflicts were resolved as follows:
  - CLAUDE.md has `@AGENTS.md` plus the sesjonslogg section.
  - PROJECT-CONTEXT.md stays deleted, as on main.
  - The AGENTS.md pointer was moved to the spec.
- **Update started:** commit `a89ea05` logs the start of the spine Update. The branches `architecture-spine` and `feature/architecture-update` are deleted locally. `main` is not pushed.
- **Impact analysis:** a subagent analysis of the revised PRD and UX against the spine was still running at the end of the session. Report: `.../architecture-AI-StudyBuddy-2026-10-13/reviews/update-impact-2026-10-27.md`.

### Åpne punkter
- The spine and spec were written from the 18-FR PRD. The PRD was revised on 2026-10-14 to 29 FRs (FR-19 to FR-29: Google sign-in, phone upload, deletion, archive, history, generation lifecycle, settings, account deletion, interface language). The next step is a `bmad-architecture` Update (new decisions from AD-19, existing ids stable), then a `bmad-spec` update.
- Read the impact report `reviews/update-impact-2026-10-27.md` when it's ready, and make the decisions it raises.
- The managed AGENTS.md block doesn't point to the UX documents (`ux-designs/ux-AI-StudyBuddy-2026-10-13/`). Fix this on the next `bmad-project-context` refresh.
- The spec's open GDPR question is probably answered by FR-28 (account deletion). Confirm this during the spec update.
