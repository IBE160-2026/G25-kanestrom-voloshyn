---
title: 'Story 3.1b: The "quiz is ready" notice in the chat'
type: 'feature'
created: '2026-11-19'
status: 'done'
baseline_commit: '051639a31377eaaa80cb14f39ac1a456bfe299f9'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** If a student leaves the Quiz setup while a quiz is generating, the quiz is saved, but nothing tells them it is ready (FR-26, AD-20). This is the part of Story 3.1 that was split off on 2026-11-18.

**Approach:**
- **Backend:** `GET /api/projects/{id}/jobs` adds `topic_labels: list[str]` to each `quiz` job. These are the job's frozen focus labels; an empty list means "All topics".
  - Nothing else in the job API changes.
  - `POST /api/jobs/{id}/seen` already exists.
- **Project home** (the chat column):
  - On open, it reads the jobs. While any `quiz` job is `queued` or `running`, it polls every 2 s.
  - Each `completed` quiz job that hasn't been seen shows the Finished-generation message at the top of the chat column, newest first: "Your quiz on {topic} is ready · Open" / "Quizen din om {topic} er klar · Åpne" (EXPERIENCE.md L160).
  - "Open" marks the job seen and opens `/projects/:id/quizzes/:quiz_id`, using the job's `result_ref`.
  - A × ("Dismiss") marks it seen and removes the notice.
  - The notice sits in a polite live region and is not a chat message.
- **When the setup page is open:** it already marks the job seen when it finishes there, so no notice appears in that case.
- **{topic} text:**
  - one label → that label
  - two labels → "A and B"
  - three or more → "A and {n} more"
  - no labels → "all topics"
  - Copy decided by Cristoffer 2026-11-19: "all topics" / "alle emner"; "{a} and {b}" / "{a} og {b}"; "{a} and {n} more" / "{a} og {n} til". Dismiss label "Dismiss" / "Lukk".
- **Unseen failed or cancelled jobs** show no notice. They are left alone; the jobs list still returns them.

## Boundaries & Constraints

**Always:**
- Only `services/jobs` writes `generation_jobs`.
- Marking a job seen is allowlisted bookkeeping: it works in read-only Projects too.
- Polling stops when no quiz job is active, and when the page unmounts.
- Copy comes through i18n; styles use tokens only.

**Never:**
- No notice stored as a chat message.
- No notices for other job kinds (`material_processing` keeps its own handling).
- No toast outside the Project home.
- No chat features (Epic 4).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Finish while away | the student is on the chat when the job completes | the notice appears within one poll | N/A |
| Come back later | a completed, unseen job | the notice shows on opening the Project | N/A |
| Open | click "Open" | seen, then the Quiz page; the notice is gone on return | seen fails → still navigate; the notice may return once |
| Dismiss | click × | seen; the notice gone, and doesn't return | seen fails → the notice stays, and the next × tries again |
| Stayed on setup | finished while setup was open | no notice (already seen) | N/A |
| Labels | `[]` / `["Cells"]` / `["Cells","DNA"]` / 4 labels | "all topics" / "Cells" / "Cells and DNA" / "Cells and 3 more" | N/A |
| Failed while away | job `failed` | no notice | N/A |
| Read-only | archived Project with an unseen completed job | the notice shows; Open and Dismiss work | N/A |

</frozen-after-approval>

## Code Map

- `backend/app/api/jobs.py` -- `Job` (L26). Add `topic_labels: list[str] = []`, filled from `params["topic_labels"]` for `quiz` jobs. `db/jobs.py` `_COLUMNS` (L12) already includes `params`.
- `backend/tests/` -- extend the jobs list tests (or `test_quiz_generation.py`) for `topic_labels`.
- `frontend/src/pages/ProjectHome.jsx` -- the chat column, with the tools row around L214. Add a small `useQuizNotices(projectId)` hook (fetch, poll while active, mark seen) and a `ReadyNotice` component.
- `frontend/src/pages/QuizSetup.jsx` -- already calls seen on completion; keep it.
- `frontend/src/api/client.js`, `frontend/src/test/fakeApi.js` -- jobs list and seen. The fake must keep seen jobs out of the list.
- `frontend/src/i18n/*.json` -- the message, "Open", the dismiss label, and the topic joins.

## Tasks & Acceptance

**Execution:**
- [x] `backend/app/api/jobs.py` + a test -- `topic_labels` on quiz jobs.
- [x] `frontend/src/pages/ProjectHome.jsx`, a new hook and component, i18n, `fakeApi.js` -- the notices.
- [x] `frontend/src/pages/QuizNotice.test.jsx` -- appears after a poll when the job completes; shows on open for an unseen job; Open navigates and marks seen; × marks seen; no notice for failed jobs; the topic texts; polling stops; Norwegian.

**Acceptance Criteria:**
- Given a quiz generating, when the student goes back to the chat, then the notice appears without a reload once the job completes.
- Given a dismissed notice, when the Project is reopened, then it doesn't come back.

## Verification

**Commands:**
- `cd backend; uv run pytest` -- expected: all green with `LLM_MODE=mock`
- `cd frontend; npm test; npm run lint` -- expected: all green (from PowerShell)

## Implementation Notes

- The hook is `frontend/src/pages/useQuizNotices.js`, the component `frontend/src/components/ReadyNotice.jsx`. Open and × share one `markSeen`, which hides the notice only on success and never throws, so Open navigates either way.
- The live region is a `div` with `aria-live="polite"` (no `role="status"`), always rendered so arriving notices are announced and existing `getByRole('status')` tests are unaffected.
- The Project home now reads the jobs once on open, so `FilesPanel.test.jsx` counts its polls after that first read.
- Newest first sorts by `finished_at`, falling back to reversed list order.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | VG, EC, BH | a failed first jobs read is never retried | medium | `handle.active` stayed false, so no timer | patch |
| 2 | EC, BH | Open waits for seen; double click; failed seen brings the notice back | medium | `onOpen` awaited `markSeen` before `navigate` | patch — hide and navigate first |
| 3 | BH | focus falls to `<body>` after × | medium | the focused button is removed | patch |
| 4 | BH | "Open" marked only by colour | low | no underline until hover (WCAG 1.4.1) | patch |
| 5 | BH | model-made labels interpolated into `<Trans>` | low | markup-like text could be parsed | patch — plain text; test |
| 6 | EC, BH | null/undefined labels; fake yields `undefined` | low | no filter before the joins | patch |
| 7 | BH | malformed `topic_labels` breaks the jobs list | low | `list(labels)` and strict validation | patch — strings only |
| 8 | BH | `params` leak asserted for the first row only | low | test looked at `listed[0]` | patch |
| 9 | BH | "setup already marked seen" test only seeds the flag | medium | the setup page never ran in the test | patch |
| 10 | BH | jobs endpoint polled by two hooks | low | two light reads every 2 s only while both are active | reject |
| 11 | BH | planning files missing from the review diff | false | excluded on purpose; copy approved by Cristoffer | reject |
| 12 | BH | test file name differs from its subjects | low | naming only | reject |
