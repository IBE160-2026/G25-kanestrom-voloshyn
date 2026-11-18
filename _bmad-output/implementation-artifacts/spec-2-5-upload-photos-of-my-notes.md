---
title: 'Story 2.5: Upload photos of my notes'
type: 'feature'
created: '2026-11-18'
status: 'done'
baseline_commit: 'cfc917d05a70633536df2687b68cb874a7232d45'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Students can't upload photos of paper notes (FR-7). The daily image limit and the usage service it depends on don't exist yet (AD-12).

**Approach:**
- **Migration:** add `usage_counters(account_id, usage_day date, kind, count)`, with primary key `(account_id, usage_day, kind)`. RLS is on, and anon and authenticated are revoked.
- **New `services/usage`,** the only code that touches this table:
  - `reserve(conn, account_id, kind) -> usage_day`: one upsert that increments only `WHERE count < limit`, else it raises `QuotaExceeded` (`429 quota_exceeded`, params `{limit}`).
  - `remaining(conn, account_id, kind)`.
  - `release(conn, account_id, kind, usage_day)`, which never goes below 0.
  - `usage_day` is today in `QUOTA_TIMEZONE` (default Europe/Oslo). The `image_extraction` limit is 25.
- **Upload** accepts `.jpg`/`.jpeg`, `.png`, and `.heic`:
  - Right after validation and before storage, one unit is reserved, and its `usage_day` goes into the job params.
  - If the request rolls back, the unit is released.
  - The 26th image today is refused with nothing stored.
- **Processing an image:**
  1. Normalize it to JPEG in a thread: `pillow`, with `pillow-heif` for HEIC.
  2. Call the new gateway task `extract_image_text(jpeg) -> {legibility: readable|partial|unreadable, text}` on `LLM_VISION_MODEL`, with no transaction open.
  3. Build one Section labelled "Image" from the Markdown text. Then Topics and the save work as for any file (2.6a).
  4. The verdict (AD-6): `readable` → Ready; `partial` → Ready, partly unreadable; `unreadable` or under 50 characters → Rejected (`unreadable`).
  - A file that can't be decoded is Rejected (`unparseable`).
  - Mock mode picks the fixture from the file name: `-partial.` or `-unreadable.`, else readable.
- **Release** happens only when the vision call fails with a provider error, or never starts. "Never starts" covers: removal or cancel before the call, a queued or interrupted job that never reached it, and a decode failure. A unit whose call started stays used. Removal (2.7) releases the unit of a queued image job.
- **`GET /api/usage`** returns `{images_left_today}`.
- **SPA:**
  - The picker and drop zone accept the image types.
  - A refused 26th image shows "You've used today's 25 images. Try again tomorrow." (EXPERIENCE.md L244).
  - When 10 or fewer images are left, the Limit notice "{n} images left today" shows by the Upload button (L249). It refreshes after each image upload.
  - Image rows show a JPG/PNG/HEIC tile. A rejected unreadable image shows the image copy (L237).

## Boundaries & Constraints

**Always:**
- Quotas also apply in mock mode.
- A unit is reserved exactly once per accepted image, and never by a job.
- An image Material is handled like any other Material after extraction (FR-7).
- Logs never contain image bytes or text.
- New settings go in `config.py` and `.env.example` without values: `LLM_VISION_MODEL`, `QUOTA_TIMEZONE`. The only new dependencies are `pillow` and `pillow-heif`.

**Never:**
- No phone upload (Epic 6).
- No Ask AI quota (Epic 4).
- No OCR of PDF pages.
- Images are not kept after processing beyond the existing original-file rules.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Readable, mock | `notes-photo.png` | Ready, 1 Section "Image", ≥ 3 Topics; 1 unit used | N/A |
| Partial, mock | `notes-photo-partial.png` | Ready, partly unreadable | N/A |
| Unreadable, mock | `notes-photo-unreadable.png` | Rejected `unreadable`; unit stays used | N/A |
| HEIC | a `.heic` photo | normalized, then as above | undecodable → Rejected `unparseable`, unit released |
| 26th image today | 25 used today | `429 quota_exceeded {limit: 25}`; nothing stored or inserted | N/A |
| Parallel last unit | 24 used, 2 uploads at once | exactly one accepted | the other `429` |
| Upload rolls back | 11th file, or storage fails, after reserve | refused as before | unit released |
| Provider error | vision raises `ProviderUnavailable` | job failed → Rejected `processing_failed` | unit released |
| Removed while queued | image job still queued | removed (2.7) | unit released |
| Removed after the call | the vision call already ran | removed | unit stays used |
| New day | 25 used yesterday (Oslo) | today's upload accepted | N/A |
| Limit notice | 10 left / 11 left | "10 images left today" / nothing | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/` -- new `…_usage_counters.sql`, in the style of `20261118120000_topics.sql`.
- `backend/app/services/materials.py`:
  - `DOCUMENT_TYPES` (L50) gains the image types. `validate`/`upload` (L100-140) reserve after `validate` and before `storage.put`; `on_rollback` is already wired for cleanup.
  - In `processing_kind.run` (about L200), the image branch replaces `extraction.extract`. `remove` (about L160) releases for a queued image job.
- `backend/app/extraction/` -- add `images.py` with `normalize(data, file_type) -> jpeg bytes`, run via `asyncio.to_thread`. Decode errors raise `Unparseable`. Cap the long side at 2048 px.
- `backend/app/extraction/integrity.py` -- add a pure image verdict: legibility plus character count. `IMAGE_MIN_CHARS = 50` comes from a setting, like the other thresholds.
- `backend/app/llm/schemas.py`, `gateway.py`, `fixtures.py`, `prompts/extract_image_text.md`:
  - `ImageText`, and `extract_image_text(jpeg_bytes, file_name)`.
  - Live mode sends a base64 `data:image/jpeg` content part to `llm_vision_model`.
  - The mock looks only at `file_name`. Its readable fixture text must be at least 50 characters.
- `backend/app/services/jobs.py` -- `JobKind`/`SavePlan` and `on_terminal`. A vision-started marker must survive on the job row, so `on_terminal` and the restart sweep know whether to release. Use `progress_step='reading'`, set through `services/jobs` right before the call. Only `services/jobs` writes `generation_jobs`.
- `backend/app/services/usage.py` (new), `backend/app/api/usage.py` (new, registered in `main.py`), and `QuotaExceeded` mapped like other `AppError`s.
- `backend/app/config.py`, `.env.example` -- `llm_vision_model` (required in live mode, like `llm_text_model`), `quota_timezone`, `integrity_min_image_chars`.
- `backend/pyproject.toml` -- `pillow`, `pillow-heif` (pinned).
- `frontend/src/pages/useProjectFiles.js` -- `ACCEPT` (L15) and `precheck`, plus the usage fetch and refresh.
- `frontend/src/components/FilesPanel.jsx` -- the Limit notice by Upload.
- `frontend/src/components/FileRow.jsx` -- the image tiles (`TILE`) and the image reject copy.
- `frontend/src/i18n/*.json` -- `errors.quota_exceeded`, `files.limit.images` (plural), `files.reason.unreadable_image`.
- `frontend/src/test/fakeApi.js` -- `GET /api/usage` and image uploads.
- `test-data/notes-photo*.png` exist. Build a tiny HEIC in tests with `pillow-heif`; don't commit one.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/20261118140000_usage_counters.sql`, `backend/app/services/usage.py`, `backend/app/api/usage.py` -- the counter, the service, and the route.
- [x] `backend/app/extraction/images.py`, `integrity.py`, `backend/app/llm/*`, `config.py`, `.env.example`, `pyproject.toml` -- normalize, vision task, mock, verdict, settings.
- [x] `backend/app/services/materials.py`, `services/jobs.py` -- reserve in upload, the image processing branch, release paths, removal release.
- [x] `backend/tests/test_images.py` -- every backend matrix row, including the parallel last-unit race and the Oslo day boundary (inject the clock or the timezone).
- [x] `frontend` files above -- accept types, quota error, Limit notice, tiles, image reject copy.
- [x] `frontend/src/components/ImageUpload.test.jsx` -- 26th refused with the message; the notice at 10 but not 11, with the plural; image tile; unreadable copy; Norwegian.

**Acceptance Criteria:**
- Given mock mode and no key, when the three `test-data/notes-photo*.png` are uploaded, then they end Ready, Ready partly unreadable, and Rejected.
- Given an image Material Ready, when the Files panel lists it, then it shows Topics and edits like any other file.

## Verification

**Commands:**
- `npx supabase db reset` -- expected: migrations apply
- `cd backend; uv run pytest` -- expected: all green with `LLM_MODE=mock`
- `cd frontend; npm test; npm run lint` -- expected: all green (from PowerShell)

## Implementation Notes

- **Reserve in its own transaction.** `materials.upload` reserves through `pool` in a short transaction of its own, and registers `on_rollback` to release it. Reserving inside the request transaction would hold the counter row lock during `storage.put` and, together with removal (Project lock, then counter), could deadlock. The counter row is now always the last lock taken. `upload` gains a `pool` parameter, and the route passes `app.state.pool`.
- **Vision-call marker.** The marker is its own column, `generation_jobs.vision_started_at`, added in the usage-counters migration. `progress_step` keeps its old behaviour. The new `jobs.mark_vision_started` sets the marker right before the call. It refuses when a cancel was requested, and the handler then skips the call. The marker stays on the row after the job ends, so `on_terminal` and the restart sweep can tell whether the call started.
- **Release paths.** A provider error is released by the handler (`ProviderError`, so a 429 counts too), and the marker stays, so `on_terminal` doesn't release twice. A decode failure is released in the reject save. A queued job cancelled by removal is released in `materials.remove`, because `jobs.cancel_for_material` now returns those jobs. Every other path that never reached the call is released by `on_terminal`: a cancel before the call, a crash before it, or the restart sweep.
- **Job params.** An image job carries `{file_type, usage_day, file_name}`. Mock mode needs `file_name`.
- **Normalization.** Only the JPEG, PNG, and HEIF decoders run, and the decoded format must match the extension, else `unparseable`. Over 80 MP is refused as `unparseable`. EXIF orientation is applied, and transparency is flattened onto white.
- **Live config.** `LLM_VISION_MODEL` is required in live mode like `LLM_TEXT_MODEL`, so the live-gateway tests in `test_llm.py` and `test_topics.py` now pass it.
- **SPA.** `quota_exceeded` is a rule refusal, so it shows no "Try again". The usage is fetched again after each image upload, whether it was accepted or refused, and after removing a Reading… image. The supported-types caption now lists photos, using the approved copy in EXPERIENCE.md. A job that ends for an image Material, seen by polling, also refreshes the usage.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | BH, EC, VG | `progress_step` reused as the vision marker changed the job API for every kind | medium | `claim` stopped setting it; terminal paths stopped clearing it; `api/jobs.py` exposes it | patch — own `vision_started_at` column; old behaviour restored |
| 2 | BH, EC | Limit notice stale after later releases | medium | removal of a running image releases in the save step; provider and decode releases happen in the job | patch — refetch when an image job ends |
| 3 | VG, BH | release on a day other than today untested | medium | every release test used today's `usage_day` | patch — yesterday release test |
| 4 | BH | photo caption still lists documents only | medium | `files.types` unchanged while photos are accepted | patch — copy approved by Cristoffer, EXPERIENCE.md updated |
| 5 | BH | decoded format never checked against the extension | low | AD-6 rejects wrong content for its extension | patch — format check; test |
| 6 | EC | `warnings.catch_warnings` is process-global under threads | low | `normalize_sync` runs via `to_thread`, several jobs at once | patch — removed |
| 7 | BH, EC | bad `QUOTA_TIMEZONE` fails only on first use | low | no validator on the setting | patch — startup validator |
| 8 | BH | `ImageText.text` unbounded | low | the schema had no cap | patch — 20,000-character cap |
| 9 | BH | `quota_exceeded` params lack `kind` | low | Epic 4 reuses the code | patch — `kind` added |
| 10 | BH | image type list copied in the frontend | low | `FileRow`, `useProjectFiles` each had their own | patch — one export |
| 11 | BH | Limit notice not announced | low | plain `<p>` | patch — `role="status"` |
| 12 | BH | `await fetchUsage()` slows the upload queue | low | the `finally` awaited it per image | patch — not awaited |
| 13 | VG, BH | removal refresh and read-only notice untested | medium | no test removed an image or rendered read-only with a low count | patch — tests added |
| 14 | BH | test comment says 23:30 UTC, asserts 22:59/23:00 | low | `test_the_day_is_the_calendar_day_in_oslo` | patch |
| 15 | VG | pending `.jpeg` tile untested | low | cosmetic, short-lived row | defer |
| 16 | EC, VG, BH | provider error after a timeout or a retry refunds a billed call | false | AD-12 releases "after a provider error"; spec matrix row "Provider error" | reject |
| 17 | BH | provider-error release outside the terminal transaction | low | a failed release is logged; rare | reject |
| 18 | EC | crash after reserve leaves a unit used | low | needs a process crash inside one request | reject |
| 19 | EC | malformed `params.usage_day` | false | only the upload writes it, always ISO | reject |
| 20 | EC, BH | `_flatten` misses PA, tRNS, 16-bit PNG | low | rare for photos of notes; worst case a darker image or a rejection | reject |
| 21 | EC, BH | out-of-order usage fetches, midnight, other tabs | low | the notice is advisory; refreshed on the next upload or open | reject |
| 22 | BH | file name kept in live job params | low | already in `study_materials.file_name`; same table owner scope | reject |
| 23 | BH | quota refusal wins over read-only or slot refusals | low | AD-5 reserves at step 1; the unit is released on rollback | reject |
