---
title: 'Story 4.3: Summarize a file or one of its Topics'
type: 'feature'
created: '2026-11-23'
status: 'done'
baseline_commit: '2b09533861d35dd1d8e212a3a20d70433ae247af'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The student can't get a summary of their material (FR-15). The tool buttons row has no Summarize button.

**Approach:** Add the Summarize button and setup: pick one Ready file and, optionally, one of its Topics ("Whole file" is the default). "Make summary" runs a `summary` job through the existing lifecycle: progress steps, cancel, failure, and the finish notice. The result opens as a reading view in which every section shows its Source labels.

## Boundaries & Constraints

**Always:**
- Scope goes only through `topics.resolve_scope` (AD-7). Add a `{"material_id": …}` branch to it: all Sections of one Ready, non-removed Material of the Project, and `404 not_found` otherwise. Story 4.4's chat will reuse that branch. A Topic summary resolves `{"topic_ids": [topic_id]}`, and the Topic must belong to the chosen file (`404` otherwise).
- The request is `{material_id, topic_id: null|uuid}`. It calls `require_active` first, refuses `scope_too_large` over the budget, and freezes `{material_id, topic_id, file_name, section_ids, topic_labels}` into the job `params` and the summary's `generation_params`.
- The job steps are `reading` → `writing` → `checking`. The save plan aborts on cancel, on a deleted Project, or when a cited Material has been removed, exactly as `services/flashcards` does. A Retry is a new job.
- The gateway gets `summarize(sections, topic_labels)`, which returns a Pydantic `SummaryDraft{title, sections ≤ 8: [{heading, text, sections:[S-numbers]}]}`. It retries once, then raises `LLMOutputError`. The prompt forbids claims absent from the Sections, and asks for the material's main language whatever the UI language is. Checking drops uncited sections and those with a blank heading or text. Zero kept means `insufficient_material`. The mock fixture cites `S1…`.
- `summaries` and `summary_sections` are insert-only (AD-8). Each section stores `source_section_ids` and the `material_ids` derived from them.
- The UI reuses the Quiz/Flashcards lifecycle. Extract it from `GenerationSetup.jsx` into a shared hook or component; don't copy it. All Quiz and Flashcards tests pass unchanged.
- Existing copy comes from EXPERIENCE.md: "Summarize", "Make a summary", "Which file?", "Narrow to one topic (optional)", "Whole file", "Make summary", the Summary progress steps, "Cancelled. Your choices are kept.", "Saved to History", "← Back to chat", and the Inline error reassurance. The summary title and section text are the model's and are not translated.

- **Decision (Ihor, 2026-11-23):** new copy approved:
  - Failure: "We couldn't make your summary." / "Vi fikk ikke laget sammendraget ditt.", followed by the existing reassurance.
  - Finish notice: "Your summary of {file} is ready · Open" / "Sammendraget ditt av {file} er klart · Åpne".
  - View scope line: "Summary of {file} · whole file" or "Summary of {file} · {topic}" / "Sammendrag av {file} · hele filen" or "Sammendrag av {file} · {topic}".
  - The orchestrator adds the EXPERIENCE.md rows, the sign-off row (Ihor [x], Cristoffer [ ]) and the memlog entry. The implementer adds the catalogue keys.
- **Decision (Ihor, 2026-11-23, during implementation):** when a file is removed mid-run, the job ends `cancelled` through the shared runner, as Quiz and Flashcards do, and not with `material_removed`. The matrix row was corrected to match.
- **Decision (Ihor, 2026-11-23):** keep the full spec. It is one cohesive goal and over the token guideline.

**Never:** a Count picker; summaries across several files; editing or regenerating a summary in place; a History list (Epic 5); streaming.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Whole file | `{material_id: M, topic_id: null}` | `202 {job_id}`; the saved summary covers all of M's Sections | — |
| One Topic | `{material_id: M, topic_id: T}` with T in M | Only T's Sections; `topic_labels: [T.label]` | — |
| Topic of another file | T not in M | Nothing queued | `404 not_found` |
| File not Ready, removed, or foreign | M | Nothing queued | `404 not_found` |
| Over budget | the scope's `est_tokens` exceed the budget | Nothing queued | `422 scope_too_large` |
| Read-only Project | archived or deleted | Nothing queued | `409 project_read_only` |
| Uncited section | draft section that cites nothing valid | Dropped; the others are saved | — |
| Nothing usable | every section dropped | Job fails | `insufficient_material` |
| Model fails | provider error, or invalid output twice | Job fails | `llm_unavailable` / `llm_output_invalid`; Inline error, choices kept |
| Cancel while reading | cancel before the model call | No model call, nothing saved | Setup again, choices kept |
| File removed meanwhile | a cited Material removed before saving | Nothing saved; the job ends `cancelled`, as Quiz and Flashcards do (AD-20) | Setup shows "Cancelled. Your choices are kept." |
| Open the summary | GET the summary | `{id, title, file_name, topic_label, sections:[{heading, text, sources:[{label}]}]}` | Missing or foreign → `404` |

</frozen-after-approval>

## Code Map

- `backend/app/services/topics.py::resolve_scope` (line ~281) -- add the `material_id` branch. `db/topics.py` has `scope_sections_all` / `scope_sections_of`; add a per-Material query beside them.
- `backend/app/services/flashcards.py` -- the template for request, kind, save plan and abort rules. A summary has no count, so skip the `COUNTS` check. It imports `INSUFFICIENT_MATERIAL, LLM_*`, `_Section` from `services/quiz`; do the same.
- `backend/app/llm/{schemas,gateway,fixtures,__init__}.py`, `llm/prompts/generate_flashcards.md` -- add `summarize` the same way.
- `backend/app/api/flashcards.py` -- the template for the router. `api/jobs.py::LABELLED_KINDS` (line 27): add `summary`, and also expose `file_name` from `params` for `summary` jobs (a new optional `file_name` field).
- `backend/app/main.py` -- register the router and the `summary` kind.
- `backend/app/db/sections.py::source_labels` -- the labels.
- `frontend/src/pages/GenerationSetup.jsx` -- the lifecycle to extract: resuming an active job, polling (`POLL_MS`), `settle`, `make`, `cancel`, failure with `RULES`, and `GenerationProgress`. `generationKinds.js` -- add a `SUMMARY` kind.
- `frontend/src/pages/ProjectHome.jsx` (~line 336, 382-390) -- the Summarize button (same disabled rules) and the notice Open → `/projects/:id/summaries/:ref`. `useQuizNotices.js:16` -- KINDS. `components/ReadyNotice.jsx` -- `summary.notice` with `<file>`.
- `frontend/src/components/FileRow.jsx`, `TopicList.jsx`, `topicGroups.js` -- reuse the file metadata and the Topic grouping and collapse rules in the setup.
- `frontend/src/routes.jsx`, `test/fakeApi.js`, `i18n/en.json` / `nb.json`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/20261123140000_summaries.sql` -- `summaries(id, account_id → profiles cascade, project_id → projects cascade, job_id unique → generation_jobs set null, generation_params jsonb, title, created_at)`, with an index on `(project_id, created_at)`. `summary_sections(id, summary_id cascade, position 0–7, heading, text, source_section_ids uuid[] ≥ 1, material_ids uuid[] ≥ 1, unique(summary_id, position))`. RLS on; revoke `anon` and `authenticated`.
- [x] `backend/app/services/topics.py` + `db/topics.py` -- the `material_id` scope branch.
- [x] `backend/app/llm/*` -- `summarize`, `SummaryDraft`, a fixture, and `prompts/summarize.md`.
- [x] `backend/app/services/summaries.py`, `db/summaries.py`, `api/summaries.py` -- `POST /api/projects/{id}/summaries` (202) and `GET /api/projects/{id}/summaries/{summary_id}`; the `summary` job kind; `main.py`; `api/jobs.py`.
- [x] `backend/tests/test_summaries.py` -- every matrix row, the `material_id` scope branch, the prompt keeping focus labels in the user message, and the language instruction present. Add the route guard to `test_routes_guard.py`.
- [x] `frontend/src/pages/` -- the extracted lifecycle; `SummarizeSetup.jsx` (a radio list of Ready files with the first preselected, then Topic chips led by "Whole file" that follow the file; arrow keys inside the radio groups); `SummaryView.jsx` + CSS; the ProjectHome button and notice; routes `/projects/:id/summarize` and `/projects/:id/summaries/:summaryId`.
- [x] `EXPERIENCE.md`, `norwegian-strings-signoff.md`, UX `.memlog.md` -- the approved strings (written by the orchestrator).
- [x] `frontend/src/pages/SummarizeSetup.test.jsx`, `SummaryView.test.jsx` -- choosing a file resets the Topic to "Whole file"; nothing is sent before "Make summary"; the request body; progress, cancel and failure keep both choices; the notice and Open; the view's scope line, sections and Source labels; "← Back to chat"; a missing summary; Norwegian.

**Acceptance Criteria:**
- Given an active Project with a Ready file, when the student opens Summarize from the tool buttons row, then the setup shows "Which file?" and "Narrow to one topic (optional)" with "Whole file" selected, and nothing generates until "Make summary".
- Given the summary is saved, when the student reads it, then each section shows its Source labels, and the page ends with "Saved to History" and "← Back to chat" (primary).
- Given the Project is archived or deleted, or has no Ready file, then the Summarize button is disabled, like the other tool buttons.

## Design Notes

The setup mirrors DESIGN.md › Summarize setup: file rows with a radio, a file-type tile, the name and muted metadata; the selected row uses the primary border on `primary-subtle`. The view is a reading column at `reading-width` with `body-reading` text. The model writes the summary title; the scope line above it is UI copy.

## Verification

**Commands:**
- `cd backend && LLM_MODE=mock uv run pytest -q` -- expected: all pass
- `cd frontend && npx vitest run && npm run lint` -- expected: all pass, lint clean
- `npx supabase db reset` -- expected: the new migration applies

## Implementation Notes

- The lifecycle extracted from `GenerationSetup.jsx` is `pages/useGenerationJob.js` (resume, polling, `settle`, `make`, `cancel`, failure with `RULES`, focus) plus `pages/GenerationJobProgress.jsx` (the Progress steps with Cancel and the cancel error). Quiz, Flashcards, and Summarize all use them.
- One existing Flashcards test changed: `FlashcardSetup.test.jsx` asserted the tool buttons row is exactly `[Quiz, Flashcards]`; it now expects `[Quiz, Flashcards, Summarize]`, as the acceptance criteria require. No other Quiz or Flashcards test changed.
- "File removed meanwhile" follows `services/flashcards` and the shared runner: the job ends `cancelled` with nothing saved (no `material_removed` error code), as the Boundaries ask ("exactly as `services/flashcards` does").
- The Topic-belongs-to-file check is in `services/summaries.request` (a `db/topics.get` read); the scope itself is resolved only through `topics.resolve_scope` (`{"material_id"}` or `{"topic_ids": [T]}`).

- Review fixes (pass 1): a resumed job restores its file and Topic (matched by frozen file name and label); files are read again after a cancel or failure; a group holding the selected Topic stays open; the Summary title takes focus on open; plus new tests for browser-key lockout, zero-Section file, direct material scope, `Job.from_row`, malformed `topic_id`, `scope_too_large`, and SummaryView "Try again".
- Verified: pytest 965/965; Vitest 936/936; lint clean; `npx supabase db reset` OK.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-11-23): Blind Hunter (BH), Edge Case Hunter (EC), Verification Gap (VG).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | BH/EC: a resumed job doesn't restore its file or Topic, so cancel or retry uses the defaults | medium | the resume effect only calls `setRunning(job.file_name)`; `fileId`/`topicId` stay null | patch (match by `file_name` and label, frontend only) |
| 2 | EC: a file removed mid-run stays selectable after the cancel | medium | `/materials` is fetched once on mount; a cancel returns to setup with the stale list, then `not_found` | patch |
| 3 | BH/EC: a selected Topic in a collapsed group isn't rendered | low | `open.get(key) ?? !collapsed` hides the checked radio; a direct one-expression fix | patch |
| 4 | BH: focus lost when the Summary view opens | medium | `settle` navigates with `replace`; the view never focuses anything (EXPERIENCE › Accessibility) | patch |
| 5 | VG: summary tables have no browser-key lockout test | medium (pre-verified gap) | no privilege or RLS test names `summaries`/`summary_sections` | patch |
| 6 | VG: SummaryView "Try again" after a failed read untested | medium (pre-verified gap) | only `not_found` (no button) is tested | patch |
| 7 | BH: missing tests (zero-Section file 422, direct `material_id` scope, `Job.from_row` `file_name`, malformed `topic_id`) and a weak `<=` assertion | low | direct test additions | patch |
| 8 | BH: no refused-POST (`scope_too_large`) frontend test | low | every failure test fails a queued job; the fake can't refuse | patch |
| 9 | BH/EC: the same resume gap in Quiz and Flashcards setup | maybe-false → medium unverified | `GenerationSetup.jsx` resume doesn't restore topics either; it predates this story | defer |
| 10 | BH: epic-4-context.md says the summary strings are missing; spec and sprint status disagree | false | a cache recompiled at the next story's step-01 (EXPERIENCE.md is newer); step-05 sets the sprint entry to `review` | reject |
| 11 | BH: `ready_material` read twice; dead branch comment | low | efficiency and clarity only; harmless inside one transaction | reject |
| 12 | BH: `resolve_scope` silently picks one branch for a mixed scope | low | every caller builds a single-key scope; no API path sends a mixed one | reject |
| 13 | BH: no length cap on a section's heading or text | low | needs a runaway model reply; adding caps adds validation | reject |
| 14 | BH: an "S4" citation string fails the whole draft | false | the same `list[int]` schema as Quiz and Flashcards drafts; the structured-output schema asks for ints | reject |
| 15 | BH: the generating header names only the file | low | cosmetic; no approved copy for a Topic variant of the header | reject |
| 16 | BH/EC: `file_name` falls back to "" | false | `request` always freezes `file_name` in params; there's no path without it | reject |
| 17 | BH: `RULES` still lists `material_removed`; fixture constant name | low | harmless; other kinds share the set | reject |
| 18 | EC: a model call with empty Sections | low | Sections of a cited file are never deleted short of Project deletion, which aborts the save; same as flashcards | reject |
| 19 | EC: the fake 404s when `topic_id` is omitted | false | the client always sends `topic_id` (null for "Whole file") | reject |
| 20 | EC: claim "Quiz and Flashcards tests unchanged" vs the edited FlashcardSetup assertion | low | the tool-row assertion had to include the AC-required Summarize button; disclosed in Implementation Notes | reject |
