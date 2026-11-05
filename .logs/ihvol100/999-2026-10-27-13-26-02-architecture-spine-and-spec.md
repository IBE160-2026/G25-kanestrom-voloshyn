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
- **Spec updated with `bmad-spec`:** `spec-AI-StudyBuddy` re-derived for the 29-FR PRD and spine AD-1 to AD-29. It has 14 capabilities (CAP-1 to CAP-8 kept, CAP-9 to CAP-14 new). Acceptance criteria cover FR-1 to FR-29, checked mechanically. User journeys UJ-1 to UJ-5. DESIGN.md and EXPERIENCE.md are adopted companions. Self-validation passed both checks. The GDPR question was answered by FR-24, FR-28, §5.4, and AD-3 (ZDR), except for the privacy notice. Not committed yet.

- **Open items resolved (requested and approved by Ihor; not committed):**
  - **Privacy notice:** PRD FR-6 gains two consequences and §5.3 one sentence; spine AD-19 adds `privacy_notice_ack_at`, `POST /api/me/privacy-notice`, and `privacy_notice_required`; the UX adds a Privacy notice modal before the first upload (EXPERIENCE and DESIGN); spec CAP-3, acceptance criteria, and glossary updated.
  - **Google linking:** EXPERIENCE.md and DESIGN.md now match FR-19 (verified Account linked at once, no password step); the spine's AD-19 note and Deferred item are updated.
  - **Norwegian strings:** drafted for every V1 surface (142 rows, tagged proposed), plus the checklist `ux-designs/ux-AI-StudyBuddy-2026-10-13/norwegian-strings-signoff.md`. FR-29 is not marked complete.
  - **Checks:** 29 FRs, 14 CAPs, 29 ADs, spine lint clean, no stale Google phrases outside the memlog history, tables consistent.
- Open items committed in `d7ccb31`. Ihor marked the privacy notice and Google linking as resolved. FR-29 sign-off is an acceptance dependency that doesn't block the build.
- **Merge:** `feature/architecture-update` was merged into `main` (`d3ebf29`, merge commit) and pushed to GitHub (`2856d23..d3ebf29`).
- **`bmad-create-epics-and-stories`:** step 1 is done. `epics.md` holds the requirements inventory (not committed). In step 2, the proposed 7-epic structure waits for Ihor's approval.

### Åpne punkter
- Ihor and Cristoffer sign off the Norwegian strings in `norwegian-strings-signoff.md`; FR-29 is not complete until then.
- Approve the epic structure (7 epics) in `bmad-create-epics-and-stories` step 2, then create the stories.

## 2026-11-05 kl. 16:48 — Ihvol100

### Oppgave
Break V1 into epics and stories with `bmad-create-epics-and-stories`, and review the structure with Ihor before treating it as final. Nothing was merged or pushed.

### Plan
- Step 1: requirements inventory (29 FRs, 12 NFRs, architecture requirements, 17 UX-DRs) from the PRD, spine, UX, and spec.
- Step 2: an epic structure organized by user value, approved by Ihor (Ask AI kept in Epic 4).
- Step 3: draft stories one epic at a time, each approved by Ihor.
- Step 4: final validation, fixing forward dependencies.

### Resultat
- **`_bmad-output/planning-artifacts/epics.md`:** 7 epics and 32 stories with Given/When/Then criteria citing FR, CAP, and AD ids. It also has an FR coverage map and a "Done for every story" checklist. `stepsCompleted: [1, 2, 3, 4]`.
- **Validation:** all 29 FRs and 17 UX-DRs are covered. Four forward dependencies were fixed: Settings in the Account menu, the phone gate in 2.3, the Project home layout in 2.1, and the parallelism claim. Story 1.1 now cites NFR-12.
- **FR-29:** Story 7.5 carries the Norwegian sign-off as its only acceptance dependency; Story 1.2 explicitly has none.
- **Commit:** `db933d9` on `feature/epics-and-stories`.
- **Merge:** `feature/epics-and-stories` was merged into `main` (`b4fc494`) and pushed to GitHub, so Cristoffer can pull it. The local feature branch is deleted.
- **Not done:** deleting the remote branch `origin/design` (Cristoffer's, already fully merged into `main`) was blocked by the permission system, so it still exists on GitHub.

### Åpne punkter
- Ihor and Cristoffer sign off the Norwegian strings in `norwegian-strings-signoff.md` (the acceptance dependency of Story 7.5).
- Stories 1.1, 2.2, and 4.4 are large; split them if one development session turns out to be too little.
- Next step: `bmad-sprint-planning` (readiness check and sprint status file), then `bmad-build` story by story.

## 2026-11-05 kl. 16:56 — Ihvol100

### Oppgave
Run `bmad-sprint-planning`: check that the planning is ready to build, then generate the sprint status file from the epics.

### Plan
- Readiness gate: inventory brief, PRD, UX, spine, spec, and `epics.md`; check FR traceability, forward dependencies, open decisions, and conflicts.
- Generate `sprint-status.yaml` with the skill's `sprint_plan.py generate`.

### Resultat
- **Gate: PASS.** All 29 FRs map to stories. `epics.md` (2026-11-05) postdates every `status: final` document (2026-11-02). The PRD's only `[NOTE FOR PM]` (extraction thresholds) is resolved by AD-6. The 2026-11-02 review findings (job ownership, async runtime, takeover enforcement) are in the spine and in the stories. AD-13 and AD-15 are replaced and not cited.
- **`_bmad-output/implementation-artifacts/sprint-status.yaml`:** created with 7 epics and 32 stories, all `backlog`; the 7 retrospectives are `optional`. The two parser warnings are the document title and the "Epic List" heading, not missed epics.
- The status file is not committed yet (created on `main`).

### Åpne punkter
- Start `bmad-build` with Story 1.1 (scaffold) on a `feature/` branch.
