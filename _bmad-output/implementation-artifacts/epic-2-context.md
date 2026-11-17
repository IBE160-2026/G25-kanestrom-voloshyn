# Epic 2 Context: Projects and study material

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give the student a place for each course and get their material into it. A student can create, open, and rename Projects, accept a one-time privacy notice, and upload documents and photos, each ending with a clear accept, warn, or reject outcome under limits the server enforces. The Project names itself from its first file. The student can see and edit the Topics detected in each file, remove files, and find everything as they left it on return. Epic 2 also builds the shared machinery later epics rely on: the Project read-only guard, the LLM gateway with deterministic mock mode, the extraction pipeline that turns any file into Sections, the in-process job runner (first used for `material_processing`), and the usage quota service. FR-4 and FR-6 are Core and are never cut. FR-7 (images, Story 2.5) is the second Extension to cut if time runs out, and cutting it also removes image uploads and the image limit. Progress so far: 2.1, 2.2 (with split-off 2.2b, the Files strip), 2.3, and 2.4a (the LLM gateway and test mode) are done. Story 2.4's auto-naming remains as 2.4b.

## Stories

- Story 2.1: Create, open, and rename Projects
- Story 2.2: Upload documents and watch them get processed
- Story 2.3: See the privacy notice before my first upload
- Story 2.4: My Project names itself from its first file (split: 2.4a gateway, 2.4b naming)
- Story 2.5: Upload photos of my notes
- Story 2.6: See and edit the Topics in each file
- Story 2.7: Remove a file

## Requirements & Constraints

- **Naming:** a Project shows a placeholder until its first Material is Ready. It then gets a name derived from the content, once, and the name appears without a refresh. It never gets a static name like "Project 1". The auto-name never overwrites a student rename or an earlier auto-name. If naming fails, the file still becomes Ready and naming is retried after the next Ready file.
- **Images:** JPG, PNG, and HEIC with printed or handwritten text are extracted. After that, no feature treats an image Material differently. Outcomes: the gateway's `readable` verdict means Ready, `partial` means Ready, partly unreadable, and `unreadable` or fewer than 50 characters means Rejected. The limit is 25 images per Account per day (Europe/Oslo calendar day). The 26th image is declined with a clear message, and "{n} images left today" shows when 10 or fewer remain. Quotas also apply in mock mode.
- **Topics:** detected only after extraction succeeds. The target count is `clamp(ceil(pages/5), 3, 100)`. A page is a PDF page, a slide, or a photo, or about 500 words for .docx, .txt, and .md. Only the server computes the count. Every Section is covered, and above 100 the content is grouped under broader Topics, never dropped. A student can:
  - rename a Topic
  - merge Topics from the same file only
  - delete a Topic, never the last one
  - add a Topic, refused past 100

  Edits stay inside their Material and persist. A student-added Topic that the material doesn't cover must never lead to made-up content later.
- **Removal:** any Material in an active Project can be removed, including Reading… and Rejected ones. Ready files need confirmation, and Rejected files go at once. Removing a Reading… file cancels its processing. The slot frees at once, and generated content stays. A failed removal changes nothing and is reported.
- **Resume:** reopening a Project shows every non-removed file with its Topics as the student left them.
- **Always:** every limit is enforced on the server with its own message. Never log material text, prompts, tokens, or keys.

## Technical Decisions

- **Read-only guard:** every content mutation (upload, removal, Topic edits, rename) calls `projects.require_active` first. Every query is scoped by `account_id`. Any client-sent Material, Topic, or Job id is checked against the Project in the URL.
- **Auto-naming:** runs after the Material's ready commit through `projects.auto_name_if_unnamed` → `llm.name_project`. It writes with `UPDATE … SET name_source='auto' WHERE name_source IS NULL`. On failure the name stays NULL.
- **Processing job:** extract, then integrity, then Topics. The job saves Sections, Topics, and `ready`/`rejected` in one transaction under a lock on the Material row, and saves nothing if the Material was removed meanwhile. Only `services/materials` writes Material status, and only `services/jobs` writes `generation_jobs`. Blocking parsers run via `asyncio.to_thread`. Integrity rules and Topic counts are pure synchronous helpers.
- **Transactions:** never call the LLM inside an open write transaction. A job step is a read transaction, then the LLM call with no connection held, then a save transaction. Storage objects are deleted only after commit.
- **LLM gateway:** `backend/app/llm/` is the only `openai` importer. Each typed task returns a Pydantic model from `llm/schemas.py`, with prompts in `llm/prompts/`. Provider errors map to `llm_unavailable`, and invalid output (after one retry) maps to `llm_output_invalid`. Tasks this epic still adds:
  - `extract_image_text` uses `LLM_VISION_MODEL`.
  - `detect_topics` is one call per Material, chunked and merged above the context budget, and returns Topics with `section_ids` and `group_label`. Sections are labelled `S1…Sn` locally and mapped back to ids.
- **Mock fixtures:**
  - `extract_image_text` returns `partial` or `unreadable` for file names containing `-partial.` or `-unreadable.`, and `readable` otherwise.
  - `detect_topics` derives deterministic Topics from the Section count.
  - A single-Section Material still gets at least 3 Topics, which may share the Section.
- **Images:** images are normalized to JPEG, with HEIC through pillow-heif. One `image_extraction` unit is reserved atomically in the upload request, before storage, and jobs never reserve. `services/usage` (sole owner of `usage_counters`, keyed `(account_id, usage_day, kind)`) runs `reserve` as an upsert that increments only `WHERE count < limit`, else it raises `QuotaExceeded`. `release(kind, usage_day)` runs only after a provider error, or when the vision call never happens because the file was removed or cancelled first. Topic detection and naming are unmetered.
- **Topics schema:** `topics(id, material_id, label, group_label, position, origin auto|student)` and `topic_sections(topic_id, section_id)`, in the same processing transaction. A merge unions the Sections onto the first Topic's id. Errors: `422 topic_merge_cross_material`, `topic_last_cannot_delete`, `topic_limit_reached`.
- **Removal tombstone:** one transaction does all of this:
  - sets `removed_at`
  - empties each Section's text and `tsvector`, keeping the file name and Section labels
  - calls `jobs.cancel_for_material`
  - applies the Mistake choice (wired in Story 3.3)

  The original is deleted after commit, and an unused image unit is released. Removed Materials never appear in counts, scopes, capacity, or chat.
- **Mutability:** only the listed columns change:
  - `projects`: name, name_source
  - `study_materials`: status, reject_reason, warning, warning_pages, removed_at
  - `sections`: text and tsvector, once, on removal
  - `topics`: label, position, group_label

  Rows are deleted only through Topic delete or merge. Schema changes go only through `supabase/migrations/`.

## UX & Interaction Patterns

- **Naming:** the new name replaces the placeholder in the Sidebar and Top bar without a refresh.
- **File row:** shows its status ("Reading…" with a pulsing dot that stays static under reduced motion, "Ready", "Ready, partly unreadable" with a muted note, or "Rejected" in the error colour with its reason) and "{n} topics". It updates live.
- **Topic list:** chips per file. Click a chip to rename it (Enter saves). × deletes, and the last chip has no ×. "+ Add topic". Multi-select with Ctrl+click or Space, then "Merge", which opens the merged Topic for rename. Chapter groups collapse above about 20 and the list scrolls. Tab reaches each group row and chip, Enter or Space toggles a group, and groups carry `aria-expanded`. At the ceiling it shows "Large file, some topics are grouped." A failed edit shows the Inline error and leaves the Topics unchanged.
- **Remove file dialog:** opens from the row's "···" menu with "Remove {file name}?". Focus starts on Cancel, and the final "Remove" is the danger button. Reading… files get a short variant: "Reading stops and the file won't be added." Buttons are disabled while removing, and a failure keeps the dialog open with the Inline error. Rejected rows remove at once. The mistakes checkbox stays hidden until Story 3.3.
- **Copy:** all strings come from EXPERIENCE.md's strings table into `en.json`/`nb.json`, with plural forms. The Norwegian there is signed off and binding. For example: "You've used today's 25 images. Try again tomorrow."

## Cross-Story Dependencies

- The remaining stories build on code that is already done: the Project guard and route test (2.1), the upload route, job runner, restart sweep, polling, storage, and extraction (2.2), the privacy gate (2.3), and the gateway with mock mode (2.4a).
- 2.4b adds the first gateway caller. Story 2.5 adds `extract_image_text` and `services/usage`. Story 2.6 adds `detect_topics`, saved in the processing transaction.
- Story 2.7 uses `jobs.cancel_for_material` and `usage.release`. Its mistakes checkbox arrives in Story 3.3.
- Later epics: Epic 3 adds `topics.resolve_scope` on these Topics and Sections. Epic 6 reuses the privacy gate, the image quota, the integrity rules, and `material_processing`.
