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
- **Update started:** commit `a89ea05` logs the start of the spine Update. The branches `architecture-spine` and `feature/architecture-update` are deleted locally. `main` was pushed to GitHub (`22fc9f0..07e11db`).
- **Impact analysis:** a subagent analysis of the revised PRD and UX against the spine was still running at the end of the session. Report: `.../architecture-AI-StudyBuddy-2026-10-13/reviews/update-impact-2026-10-27.md`.

### Åpne punkter
- The spine and spec were written from the 18-FR PRD. The PRD was revised on 2026-10-14 to 29 FRs (FR-19 to FR-29: Google sign-in, phone upload, deletion, archive, history, generation lifecycle, settings, account deletion, interface language). The next step is a `bmad-architecture` Update (new decisions from AD-19, existing ids stable), then a `bmad-spec` update.
- Read the impact report `reviews/update-impact-2026-10-27.md` when it's ready, and make the decisions it raises.
- The managed AGENTS.md block doesn't point to the UX documents (`ux-designs/ux-AI-StudyBuddy-2026-10-13/`). Fix this on the next `bmad-project-context` refresh.
- The spec's open GDPR question is probably answered by FR-28 (account deletion). Confirm this during the spec update.

## 2026-11-02 kl. 14:22 — Ihvol100

### Oppgave
Update the architecture spine for the revised 29-FR PRD and Cristoffer's final UX (`bmad-architecture` Update, Coaching path), apply the PRD edits this required, and refresh AGENTS.md. Nothing was merged or pushed.

### Plan
- Work from the impact report `reviews/update-impact-2026-10-27.md` and go through decisions H1–H10 one at a time with Ihor.
- Distill the spine (AD-1 to AD-18 stable; AD-13 and AD-15 replaced; new AD-19 to AD-29), run the reviewer gate (four subagent lenses), and apply the fixes.
- `bmad-project-context` refresh of AGENTS.md, with the block shown and approved before writing.

### Resultat
- **Decisions**, all approved by Ihor and logged in the spine's `.memlog.md`:

  | Decision | Choice |
  | --- | --- |
  | FR-26 jobs | in-process background jobs in `generation_jobs`, with cancel (required by both PRD and UX) |
  | H1 Google | (b) verified Accounts are linked automatically; unverified Accounts are taken over |
  | H3 phone | (a) the link may read whether a batch fits the limits |
  | H4 file removal | (a) tombstone |
  | H5 capacity | (a) deterministic estimate before generating |
  | H6 data use | (a) ZDR, with a paid model and a spend cap |
  | H7 frontend | Cristoffer's mockups + DESIGN.md tokens, plain CSS, Radix |
  | H8 | a reset ends other sessions; Google owns the name |
  | H9 | the backend sends auth emails in the Account's language |
  | AD-29 | async for I/O, synchronous pure helpers, 3 concurrent jobs |

- **PRD edits (approved):** FR-19 (verified Account → automatic linking) and FR-21/§5.5 (the phone link reads whether the batch fits). Logged in the PRD memlog; `updated: 2026-11-02`.
- **Spine:** `status: final`, AD-1 to AD-29, binds FR-1 to FR-29.
  - The reviewer gate (reconcile, rubric, tech-currency, adversary) found about 20 high findings. All were fixed: job save transactions, Material state, one scope resolver, quota timing, the read-only guard, Supabase settings, and the CLI pin.
  - Supabase CLI 3.0 was released on 2026-11-02 and changes `db push`, so the CLI is pinned at 2.122.0.
  - Commit `46bd497` (spine + PRD + reviews).
- **AGENTS.md:** managed block refreshed (V1 = PRD §7.1, phone page, UX pointer, CLI pin, new cross-component rules; run commands still TODO). Commit `038d9b2`.
- **Branch:** `feature/architecture-update`, 2 commits ahead of `main`.

### Åpne punkter
- `spec-AI-StudyBuddy` still reflects the 18-FR PRD. It must be updated with `bmad-spec` to cover the 29-FR PRD and the spine AD-1 to AD-29.
- Cristoffer must approve updating EXPERIENCE.md: the "log in with your password once to link Google" state is out of date after the FR-19 edit (listed under Deferred in the spine).
- The spec's GDPR question is probably answered by FR-28 and §5.3/§9.2. Confirm this during the spec update.
