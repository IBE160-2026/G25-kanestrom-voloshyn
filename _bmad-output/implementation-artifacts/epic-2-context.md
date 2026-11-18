# Epic 2 Context: Projects and study material

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give the student a place for each course and get their material into it. A student can create, open, and rename Projects, accept a one-time privacy notice, upload documents and photos (each ending in a clear accept, warn, or reject outcome under server-enforced limits), get the Project auto-named, see and edit the Topics in each file, remove files, and find everything as they left it. Epic 2 also builds shared machinery later epics reuse: the Project read-only guard, the LLM gateway with deterministic mock mode, the extraction pipeline into Sections, the in-process job runner (`material_processing`), and the usage quota service. Progress: 2.1, 2.2 (+2.2b Files strip), 2.3, 2.4a (gateway and test mode), 2.4b (auto-naming), 2.6a (detect and show Topics), 2.6b (edit Topics), and 2.7 (remove a file) are done. Story 2.5 (photos of notes) is the only remaining story. FR-7 (2.5) is the second Extension in the cut order; cutting it removes image uploads, the image limit, and the JPG/PNG/HEIC mention in the `unsupported_file_type` text.

## Stories

- Story 2.1: Create, open, and rename Projects (done)
- Story 2.2: Upload documents and watch them get processed (done, incl. 2.2b)
- Story 2.3: See the privacy notice before my first upload (done)
- Story 2.4: My Project names itself from its first file (done, as 2.4a + 2.4b)
- Story 2.5: Upload photos of my notes (next)
- Story 2.6: See and edit the Topics in each file (done, as 2.6a + 2.6b)
- Story 2.7: Remove a file (done)

## Requirements & Constraints

- **Images:** JPG/JPEG, PNG, and HEIC with printed or handwritten text are accepted through the same upload flow as documents (one file per request, privacy gate, 50 MB, 10-slot cap). Once extracted, no feature treats an image Material differently from a text Material.
- **Image outcomes:** gateway legibility `readable` → Ready; `partial` → "Ready, partly unreadable"; `unreadable` or fewer than 50 extracted characters → Rejected with the "too blurry" reason.
- **Daily image limit:** 25 images per Account per calendar day in Europe/Oslo. The 26th is declined with its own message ("You've used today's 25 images. Try again tomorrow."). When 10 or fewer remain, the Limit notice shows "{n} images left today" near the upload action. Quotas apply in mock mode too.
- **Mock mode:** images in `test-data/` named `*-partial.*` or `*-unreadable.*` produce those outcomes; any other name is readable. All three outcomes must be testable with no key. Test images must be small and self-made.
- **Topics for images:** a photo counts as one page for the Topic target count; a single-Section Material still gets at least 3 Topics.
- **Always:** every limit is enforced on the server with its own message. Never log material text, prompts, tokens, image bytes, or keys.

## Technical Decisions

- **Upload pipeline for images:** validate type and size; reserve one `image_extraction` unit synchronously in the upload request, before storing; store the original; in one transaction lock the Project row, re-check slots, and insert the Material as `processing`. If that insert fails, delete the stored original and release the unit. Then enqueue `material_processing` and return `202`.
- **Extraction:** normalize every image to JPEG (HEIC via `pillow-heif`) inside the extraction layer, run via `asyncio.to_thread`. The whole image becomes one Section. Text comes from the gateway task `extract_image_text`, using `LLM_VISION_MODEL`, which returns a Pydantic model with the text and `legibility`. The integrity rule for images is a pure synchronous helper alongside the existing ones.
- **Job shape:** read transaction, then the LLM call with no connection held, then one save transaction (Sections, Topics, `ready`/`rejected`) under a lock on the Material row; nothing is saved if the Material was removed meanwhile. Auto-naming runs after that commit as for any file.
- **`services/usage` (new):** sole owner of `usage_counters`, keyed `(account_id, usage_day, kind)`, created through a migration. Interface: `reserve(kind) -> usage_day` (one atomic upsert incrementing only `WHERE count < limit`, else `QuotaExceeded(limit)`), `remaining(kind)`, `release(kind, usage_day)`. `usage_day` uses `QUOTA_TIMEZONE` (default `Europe/Oslo`). Release always uses the day `reserve` returned. Design it to also serve `ask_ai_message` (limit 50) in Epic 4.
- **When to release:** only after a provider error on the vision call, or when the vision call never happens (Material removed or job cancelled before extraction, or the insert failed). Invalid-output failures after the call do not refund. Jobs never reserve. Topic detection and naming are unmetered.
- **Removal hook:** Story 2.7 deliberately skipped image-unit release; 2.5 must wire `usage.release` into the removal/cancel path so a removed Reading… image whose vision call never ran gets its unit back.
- **Gateway rules:** `backend/app/llm/` stays the only `openai` importer; prompts in `llm/prompts/`, schemas in `llm/schemas.py`, fixtures in mock mode return through the same schema. Provider errors map to `llm_unavailable`; invalid output after one retry maps to `llm_output_invalid`.
- **Guards:** uploads call `projects.require_active` and the privacy check first; every query is scoped by `account_id`. Only `services/materials` writes Material status and only `services/jobs` writes `generation_jobs`. Schema changes go only through `supabase/migrations/`. API errors carry `code` + `params`.

## UX & Interaction Patterns

- **File row:** same states as documents: "Reading…" (pulsing dot, static under reduced motion), "Ready", "Ready, partly unreadable" with a muted note, or "Rejected" in the error colour with its reason. Updates live through the existing polling.
- **Unreadable image reason:** "This image is too blurry to read, so we can't study from it. A sharper photo in good light usually does the trick." (Norwegian in EXPERIENCE.md's strings table).
- **Limit notice:** "{n} images left today" with the singular "1 image left today", shown with the upload action at 10 or fewer remaining; the over-limit decline is a Rejected-style message naming the rule, and the file is not added.
- **Copy:** all strings come from EXPERIENCE.md's strings table into `en.json`/`nb.json` with plural forms; the Norwegian there is signed off and binding. Styles use only token variables.

## Cross-Story Dependencies

- 2.5 builds on done work: upload route, slot lock, job runner, restart sweep, polling, and extraction (2.2), the privacy gate (2.3), the gateway and mock mode (2.4a), Topic detection in the processing transaction (2.6a), and removal with job cancellation (2.7).
- The upload drop zone and file picker must start accepting image types; the `unsupported_file_type` text already lists JPG, PNG, and HEIC.
- Later epics: Epic 4's Ask AI reuses `services/usage` for the 50-message limit; Epic 6's phone upload reuses the image quota (reserve per photo POST, `images_left_today`), image normalization, `extract_image_text`, the integrity rules, and `material_processing`.
