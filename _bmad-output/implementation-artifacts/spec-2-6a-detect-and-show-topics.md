---
title: 'Story 2.6a: Detect and show the Topics in each file'
type: 'feature'
created: '2026-11-18'
status: 'done'
baseline_commit: '7eb26fcad9a9fb99635203e80c642a43596a3a57'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Ready files have no Topics, so nothing can be scoped later. FR-22 and AD-21 require the server to detect them during processing, and the Files panel to list them. Cristoffer split Story 2.6 on 2026-11-18: this is 2.6a (detect and show); editing follows in 2.6b.

**Approach:**
- A migration adds `topics(id, material_id, label, group_label, position, origin auto|student)` and `topic_sections(topic_id, section_id)`. RLS is on and both are revoked from anon and authenticated, like `sections`.
- After the integrity check accepts a file, the processing job calls a new gateway task, `detect_topics`, with no transaction open. The save transaction then saves Sections, Topics, links, and `ready` together.
- The target count is `clamp(ceil(pages/5), 3, 100)`, computed by a pure server helper. "Pages" is the Section count for paged files and `ceil(words/500)` for the others.
- A gateway error fails the job. The existing terminal hook then rejects the file as `processing_failed`.
- `GET …/materials` returns each Material's `topics` (`id`, `label`, `group_label`, `position`) in order.
- The File row shows "{n} topics" for a Ready file. Below it, a read-only Topic list shows chips grouped by `group_label`:
  - Groups start collapsed above 20 Topics.
  - Group rows are buttons with `aria-expanded`, named "{chapter}, {n} topics".
  - The list scrolls and can be reached with the keyboard.
  - At 100 Topics, the note "Large file, some topics are grouped." shows below the list.

## Boundaries & Constraints

**Always:**
- Every Section is covered by at least one Topic, and the save never holds more than 100 Topics per Material.
- A Material is never `ready` without Topics. The Topics, links, Sections, and status save all-or-nothing.
- Tests run in `LLM_MODE=mock`.
- Logs never contain labels or text.
- Copy comes from EXPERIENCE.md (L142, L143, L145) through i18n, with plurals. Styles use tokens only.

**Never:**
- No edit routes or edit UI: rename, merge, delete, add, chip selection, and the Inline error belong to 2.6b.
- No `topics.resolve_scope` (that is Epic 3).
- No Topic count from the client.
- No new LLM setting except `LLM_CONTEXT_BUDGET_TOKENS`, which the spine names.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Short file, mock | 1 Section | 3 Topics; each links that Section | N/A |
| Typical, mock | 40-page PDF | 8 Topics; each Section covered once, in order | N/A |
| Ceiling, mock | 600 Sections | 100 Topics; all Sections covered; note shows | N/A |
| Words, not Sections | .md with 2,600 words in 4 Sections | 6 pages, target 3 (corrected by Cristoffer 2026-11-18) | N/A |
| Live output gaps | reply skips Sections or names unknown ids | unknown ids dropped; skipped Sections added to the Topic before them | invalid shape → retry → `LLMOutputError` |
| Detection fails | gateway raises | job failed; file Rejected (`processing_failed`); no Sections or Topics saved | existing terminal hook |
| Removed meanwhile | removed during detection | nothing saved (existing check) | N/A |
| Many Topics in the UI | 21+ Topics in groups | groups collapsed; Enter or Space toggles; `aria-expanded` follows | N/A |
| Reopen | Project reloaded | same Topics, same order | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/` -- new `…_topics.sql`, following the pattern of `20261117120000_study_materials.sql`: cascade from `study_materials`/`sections`, `unique (material_id, position)`, an index on `topic_sections(section_id)`.
- `backend/app/extraction/types.py` -- `Extracted.paged` decides how pages are counted. `extraction/text.py` `_words` counts words.
- `backend/app/llm/schemas.py`, `gateway.py`, `fixtures.py`, `prompts/` -- add `DetectedTopics{topics: [{label 1–100 chars, group_label|None, sections: [int ≥1]}], 1–100 items}`.
  - Add `Gateway.detect_topics(sections, target)`, using `label_sections` with S-numbers, `llm_text_model`, and the same `_run`.
  - Chunk when the estimated tokens (chars/4) exceed `LLM_CONTEXT_BUDGET_TOKENS`: give each chunk a proportional target, then offset and concatenate the results.
  - Mock: split the Sections into `target` contiguous runs, or cycle over them when there are fewer Sections than the target. Labels are "Topic {k}: {first Section label}". `group_label` is "Part {ceil(k/10)}" when target > 20, otherwise null.
- `backend/app/services/topics.py` (new) -- `target_count(extracted)` (pure). `detect(llm, extracted)`: call the gateway, then repair the result (drop unknown numbers, put each uncovered Section on the previous Topic, cut to 100) into drafts of S-indices. `save(conn, material_id, drafts, section_ids)`.
- `backend/app/db/topics.py` (new) -- `insert_many` and `list_for_materials(conn, material_ids)`, ordered by position.
- `backend/app/db/materials.py` `insert_sections` (L77) -- accept ids generated in Python, so the links can be built before the insert.
- `backend/app/services/materials.py` `processing_kind.run` -- after the verdict and before `save_ready` (about L208), `drafts = await topics.detect(llm, extracted)`. Inside `save_ready`, insert the Sections with ids, then `topics.save`, then `set_ready`. The `SavePlan`/`after_ready` naming stays as it is. `list_for_project` attaches `topics`.
- `backend/app/api/materials.py` `Material` (L25) -- add `topics: list[Topic] = []`.
- `backend/app/config.py`, `.env.example` -- add `llm_context_budget_tokens` (default 100000).
- `frontend/src/components/FileRow.jsx` -- the comment at L8 expects the count. Add a new `TopicList.jsx` with its module CSS.
- `frontend/src/i18n/en.json`, `nb.json` -- add `files.topics.count` (plural), `files.topics.grouped`, `files.topics.group`.
- `frontend/src/test/fakeApi.js` -- `finish()` can set `topics`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/20261118120000_topics.sql` -- the tables, constraints, and RLS.
- [x] `backend/app/llm/*`, `backend/app/config.py`, `.env.example` -- `detect_topics`, its schema, prompt, mock, chunking, and the budget setting.
- [x] `backend/app/services/topics.py`, `backend/app/db/topics.py`, `backend/app/db/materials.py`, `backend/app/services/materials.py`, `backend/app/api/materials.py` -- detection in the job, the atomic save, and topics in the list.
- [x] `backend/tests/test_topics.py` -- every backend matrix row: `target_count` cases, mock determinism, the repair of live gaps through a stubbed client, a failure leading to Rejected with nothing saved, chunking, and the list response.
- [x] `frontend/src/components/FileRow.jsx`, `TopicList.jsx`, i18n -- the count, the groups, collapse, keyboard use, and the note.
- [x] `frontend/src/components/TopicList.test.jsx` -- the count (with plural), ungrouped chips, collapsed above 20 with toggling, `aria-expanded`, the note at 100, nothing shown for Reading… or Rejected files, Norwegian.

**Acceptance Criteria:**
- Given a Ready file in mock mode, when the same file is uploaded twice, then both get identical Topic labels and Section links.
- Given a Rejected or Reading… file, when the row renders, then no Topic count or list shows.

## Design Notes

The repair is done by the server, not by retrying the model. A model that miscounts Sections must not get a good file Rejected; only output with the wrong shape fails, after one retry. The schema allows 1–100 Topics, and the prompt asks for exactly `target` (at least 3). The mock always meets the minimum of 3. A live reply with fewer Topics is kept rather than padded with made-up ones. Topics stay ordered by the first Section they cover.

## Verification

**Commands:**
- `npx supabase db reset` -- expected: the migrations apply cleanly
- `cd backend; uv run pytest` -- expected: all green with `LLM_MODE=mock`
- `cd frontend; npm test; npm run lint` -- expected: all green (run from PowerShell)

## Implementation Notes

- Matrix row "Words, not Sections" says "target 6", but the Intent's formula gives 6 *pages* and `clamp(ceil(6/5), 3, 100) = 3` Topics. The test asserts `page_count == 6` and `target_count == 3`, following the formula.
- Chunking runs only in live mode; mock mode derives the Topics from the whole Section list in one step, so its labels stay "Topic 1…n" and coverage stays contiguous (the matrix rows). Chunking is tested through the stubbed client.
- Repair also drops a Topic left with no known Section, and a reply where no Topic names a real Section raises `LLMOutputError` (the job fails, the file is Rejected `processing_failed`).
- `group_label` is required-but-nullable in `DetectedTopic`, so the JSON schema stays valid for strict structured output.
- The Topic list's scroll container is a focusable `region` named by the Topic count, so the keyboard can scroll it; its max height (5 × `--space-7`) is an assumption, as DESIGN.md leaves it open.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | EC | chunk reply numbers past its own chunk shift into the next chunk | medium | offset added to every number; repair only checks the file total | patch — filter per chunk; test added |
| 2 | BH, EC | chunked runs lose `group_label` (each chunk target ≤ 20) | medium | prompt's "more than 20 topics" rule saw only the chunk's share | patch — whole-file target in the prompt |
| 3 | BH, EC, VG | non-adjacent groups merge and reorder Topics; object keys like "constructor" | medium | `groupTopics` keyed a Map by label; `open` was a plain object | patch — consecutive runs keyed by index; test added |
| 4 | EC | blank `group_label` from a live model rejects the file | low | `TopicLabel` needs ≥ 1 char; one slip fails both attempts | patch — blank → null |
| 5 | BH, VG | private `_words` imported across modules | low | `services/topics` imported `app.extraction.text._words` | patch — public `count_words` |
| 6 | VG | no test that each Material's Topics stay with it in the list | medium | every list test had one Topic-bearing Material | patch — two-file + rejected test |
| 7 | VG | Topic order in the list not proven against storage order | low | insertion order equals position until 2.6b reorders | defer |
| 8 | BH, EC | the 100 cut piles overflow into the last Topic; chunk targets can sum past the target | low | only with chunking (> ~400k chars); coverage holds | reject |
| 9 | BH, EC | a single Section over the budget is sent whole | low | Sections are a page or ~500 words; the budget is 100k tokens | reject |
| 10 | BH, EC | no cancel check before or between detection calls | low | removal mid-processing is rare; the save step already discards | reject |
| 11 | BH, EC | grouped note shows on a flat 100-Topic list | false | EXPERIENCE.md L353: shown when the file reaches the ceiling; content is grouped into broader Topics either way | reject |
| 12 | EC, VG | mock with zero Sections emits empty `sections` | false | integrity rejects a file with no text, so a Ready file has ≥ 1 Section | reject |
| 13 | BH | `topic_sections` can link another Material's Section | low | no writer can do it in 2.6a; a guard for unbuilt edits | reject |
| 14 | BH | coverage invariant only a comment | low | enforced by `repair` and tested in the job test | reject |
| 15 | BH | budget ignores prompt and label overhead | low | overhead is small against 100k tokens | reject |
| 16 | BH | region `aria-label` repeats the visible count | low | a duplicate announcement, no wrong information | reject |
| 17 | BH | `detect_topics` not metered | false | AD-12: Topic detection and naming are unmetered | reject |
| 18 | BH | missing tests (group_label round trip, mock threshold 20/21, overlapping repair, missing `topics`) | low | covered by the fixture and list tests or unreachable (`topics` defaults to `[]`) | reject |
