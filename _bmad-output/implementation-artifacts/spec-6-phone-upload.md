---
title: 'Stories 6.1 + 6.2: Upload photos from my phone'
type: 'feature'
created: '2026-11-19'
status: 'done'
baseline_commit: '595163b1e253bccc03a890d213e7bdb8820eaa83'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-5-upload-photos-of-my-notes.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Students can't send handwritten notes from their phone (FR-21, AD-24). Cristoffer decided on 2026-11-19 to build Stories 6.1 and 6.2 together, because 6.1 alone gives a phone page that can't send anything.

**Approach:**

**Data (one migration).** RLS is on for all tables, with anon and authenticated revoked.
- `phone_upload_links(id, token_hash unique, project_id, account_id, expires_at, revoked_at, created_at)`.
- `phone_batches(id, link_id, project_id, account_id, created_at, finalized_at, material_id)`.
- `phone_batch_photos(id, batch_id, position, storage_path, usage_day, size_bytes, created_at)`.
- `study_materials.file_type` also allows `phone_batch`.
- A new setting, `PHONE_LINK_TTL_SECONDS` (600). `APP_PUBLIC_URL` already exists.

**The link (6.1).** `POST /api/projects/{id}/phone-links`:
- Needs an active Project, a signed-in student and an accepted privacy notice (`privacy_notice_required` otherwise).
- Creates a random 32-byte token stored only as a SHA-256 hash, and returns `{link_id, token, expires_at}`.
- Revoking: the computer calls `DELETE /api/projects/{id}/phone-links/{link_id}` (allowlisted bookkeeping). As a fallback, `navigator.sendBeacon` posts `/api/phone/{token}/revoke`, because a beacon can't send a bearer token.
- `GET /api/config` adds `app_public_url`.

**`phone_link_auth` (AD-2),** used only for `/api/phone/{token}…`:
- Hashes the token and accepts only a link that isn't revoked or expired.
- Exception: finalize is allowed until 10 minutes after expiry.
- The Project must still be active.
- Any other case gets `410 link_expired`.

**Phone API (6.2):**
- `GET /api/phone/{token}` returns only `{project_name, images_left_today, slot_available, expires_at}`.
- `POST …/batches` creates a batch.
- `POST …/batches/{id}/photos` takes one image (jpg/png/heic, ≤ 50 MB) per request. It reserves one image unit (AD-12), stores the photo under the batch's staging path and adds a row. A photo over a limit is refused on its own (`quota_exceeded`, `file_too_large`, `unsupported_file_type`).
- `POST …/batches/{id}/finalize`:
  - Calls `materials.create_from_batch`, which takes one slot under AD-5's Project lock (`material_limit_reached` otherwise).
  - It creates the Material `phone_batch` named "Handwritten notes, {n} pages", in the Account's language (EXPERIENCE.md L278), and enqueues `material_processing`.
  - With no accepted photo it creates nothing and returns `422 insufficient_material`.
- **Phone batch processing (AD-6).** Each photo, in order, is normalized and run through `extract_image_text`, and becomes the Section "Page n". An unreadable photo becomes an empty page.
  - Every photo readable → Ready.
  - Some partial or unreadable → "Ready, partly unreadable", with `warning_pages` naming them.
  - None readable → Rejected (`unreadable`), using no slot.
  - Units are released as in Story 2.5: after a provider error, or when the vision call never ran.
  - Topics (2.6a) and naming (2.4b) work as for any file.
- **Cleanup.** An in-process hourly task (FastAPI lifespan: at startup, then hourly) deletes unfinalized batches past their window, deletes their staged photos and releases their units. It adds no new infrastructure.

**Computer (SPA).**
- "Upload from phone" appears in the Files panel and the empty-Project drop zone (EXPERIENCE.md L228, L232). It is disabled while the Project is read-only, and the privacy notice comes first if not yet accepted.
- It opens the QR dialog (L277): a QR code rendered in the browser with the spine's `qrcode` package from `{app_public_url}/u/{token}`, "Waiting for photos…" and the 10-minute line.
- While the dialog is open, the files list polls every 2 s (AD-20). Each arriving batch shows in the dialog with its file status, and "Files · n of 10" updates.
- Closing the dialog revokes the link.

**Phone page** `/u/:token` (public, mobile layout, no login; language from the browser like the sign-in pages):
- **Header:** "Uploading to {project}" and the countdown "Link expires in {n} min", then "{m}:{ss}" in the last minute (L279, L281).
- **Adding photos:** "Take photos" (`<input type="file" accept="image/*" capture="environment">`) and "Choose from gallery" (L280). Photos show as numbered thumbnails; × removes one and the pages renumber.
- **Sending:** "Send {n} photos" has no maximum and is disabled at zero.
- **Warnings before sending** (advisory):
  - more photos than images left today (L201)
  - the Project is full (L284)
  - a photo over 50 MB (L202)
  - the "{n} images left today" Limit notice when 10 or fewer are left
- **Send:** create the batch, upload each photo in its own request, then finalize. Photos refused one by one are skipped and the rest go through.
- **After sending:** "Your photos are in {project}. Your computer shows when they're ready." with "Send more" (L283).
- **Expired or revoked link:** "This link has expired. Scan a new code on your computer." with Send disabled (L282).
- **Plain HTTP only:** no HTTPS-only browser APIs, so a LAN demo works.

## Boundaries & Constraints

**Always:**
- The phone link can't read anything beyond the four fields, and can't act outside its batch.
- The token is never stored in plain text and never logged. The access-log redaction covers `/u/` and `/api/phone/` paths.
- Only `services/usage` touches quotas, only `services/materials` writes Material status, and only `services/jobs` writes `generation_jobs`.
- A photo is never counted twice. Every reserved unit is either used by a vision call or released.
- Copy comes from EXPERIENCE.md through i18n; styles use tokens only. Mock mode needs no key.

**Never:**
- No sign-in on the phone, and no file list on the phone.
- No revoke on archive or delete: Stories 7.1 and 7.2 add that.
- No new copy.
- No new infrastructure (no cron, no workers).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create link | active Project, privacy accepted | 201 with token; hash stored; expires in 600 s | no privacy → `privacy_notice_required`; read-only → `409` |
| Phone GET | valid token | only the 4 fields | expired, revoked or unknown → `410 link_expired` |
| Send 3 photos, mock | `notes-photo.png`, `notes-photo-partial.png`, `notes-photo.png` | one Material "Handwritten notes, 3 pages", Ready, partly unreadable; page 2 named; 3 units used | N/A |
| All unreadable | only `*-unreadable.*` photos | Rejected, no slot | N/A |
| Over limit | 2 images left, 3 photos | 2 accepted, the 3rd refused `quota_exceeded`; finalize makes 2 pages | N/A |
| Too large | a 51 MB photo | that photo refused `file_too_large`; others go through | N/A |
| Project full | 10 files | finalize `material_limit_reached`; staged photos deleted, units released | N/A |
| No photo accepted | finalize with 0 accepted | nothing created | `422 insufficient_material` |
| Revoke | dialog closed (DELETE or beacon) | phone shows expired; uploads refused | `410` |
| Finalize after expiry | within 10 min after expiry | allowed | after → `410` |
| Never finalized | batch past its window | cleanup deletes photos, releases units, creates nothing | N/A |
| Live arrival | dialog open | the batch appears with its status; count +1 | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/` -- new `20261119160000_phone_upload.sql`, in the style of `20261118140000_usage_counters.sql`. Extend the `study_materials.file_type` check.
- `backend/app/auth.py` -- add `phone_link_auth`, next to `user_auth`, the only token parser (AD-2).
- `backend/app/main.py` -- `_TOKEN_QUERY` redaction (from 1.5) and the lifespan, where the hourly cleanup task goes (beside the restart sweep).
- `backend/app/services/materials.py`:
  - `_reserve_image`/`_release_image`/`_image_unit` (L181-200) and `read_image` (L269) are the single-image path; reuse them per photo. `create_from_batch` goes here.
  - `processing_kind` gains the `phone_batch` branch. It reads staged photos from storage, since the job has no in-memory payload.
- `backend/app/extraction/images.py`, `integrity.py` (`judge_image` L85) -- add a pure `judge_batch` (AD-6 phone row).
- `backend/app/services/usage.py` -- `reserve`/`release`/`remaining`.
- `backend/app/storage.py` -- the staging path `{account_id}/{project_id}/batches/{batch_id}/{photo_id}`.
- `backend/app/services/phone.py`, `db/phone.py`, `api/phone.py` (new), plus the link routes in `api/projects.py` or `api/phone.py`. `backend/tests/test_routes_guard.py`: allowlist the link DELETE, and phone routes use `phone_link_auth`.
- `backend/app/config.py`, `.env.example` -- `phone_link_ttl_seconds`. `api/config.py` gains `app_public_url`.
- `frontend/package.json` -- `qrcode@1.5.x` (named in the spine), pinned.
- `frontend/src/components/FilesPanel.jsx`, the drop zone, `PrivacyNotice.jsx` -- "Upload from phone", gated by the privacy notice like Upload.
- `frontend/src/components/QrDialog.jsx` (new, Radix Dialog like `RemoveFileDialog.jsx`).
- `frontend/src/pages/PhoneUpload.jsx` (new, public route in `routes.jsx`).
- `frontend/src/pages/useProjectFiles.js` -- poll while the dialog is open.
- `frontend/src/test/fakeApi.js` -- links, phone routes and batches.
- `frontend/src/i18n/*.json` -- the cited strings.

## Tasks & Acceptance

**Execution:**
- [x] Migration and settings -- the tables, the file type, the TTL, and `app_public_url` in config.
- [x] Backend -- `phone_link_auth`, the link routes and revoke (plus beacon), the phone API, `create_from_batch`, batch processing with `judge_batch`, the hourly cleanup, and redaction.
- [x] `backend/tests/test_phone_upload.py`, `test_routes_guard.py` -- every backend matrix row in mock mode.
- [x] Frontend -- the button, the QR dialog with live arrival and revoke on close, and the phone page.
- [x] `frontend/src/pages/PhoneUpload.test.jsx`, `frontend/src/components/QrDialog.test.jsx` -- countdown, thumbnails and renumbering, Send label, advisory warnings, partial refusals, sent and expired screens, the QR encoding the right URL, revoke on close, live arrival, Norwegian.

**Acceptance Criteria:**
- Given `APP_PUBLIC_URL` set to the PC's LAN address and the app bound to `0.0.0.0`, when Cristoffer scans the QR code with his phone on the same Wi-Fi, then the phone page opens over plain HTTP and the photos he sends appear on the computer without a refresh.
- Given the dialog is closed, when the phone tries to send, then it shows the expired message and nothing is stored.

## Verification

**Commands:**
- `npx supabase db reset` -- expected: migrations apply
- `cd backend; uv run pytest` -- expected: all green with `LLM_MODE=mock`
- `cd frontend; npm test; npm run lint` -- expected: all green (from PowerShell)

**Manual checks:**
- A real phone on the same Wi-Fi: scan, take two photos, send, and watch them arrive.

## Implementation Notes

- **Staging path.** Photos are staged at `{account_id}/{project_id}/phone/{batch_id}/{photo_id}`, the path AD-16 names, rather than the Code Map's `…/batches/…`. Both satisfy "the batch's staging path"; AD-16 is final, so it wins.
- **Extra photo columns.** `phone_batch_photos` also has `file_name` and `file_type` (the decoder needs the type; mock mode reads the outcome from the name, AD-4) and `unit_settled_at`. The last one is stamped right before a photo's vision call, or when its unit is given back. A null value means "still reserved", so the terminal hook, the restart sweep, and removal of a queued batch give back exactly the photos whose call never started. This mirrors 2.5's `vision_started_at`, but per photo.
- **Photos after processing.** A batch has no original. Its staged photos are deleted once the batch job ends (ready, rejected, failed, cancelled, or interrupted) and when its Material is removed. AD-5 says no feature reads originals after processing.
- **Finalize refused for a full Project.** `phone.finalize` catches `material_limit_reached`. It releases the units and deletes the batch in the same transaction, and the route returns the 409 envelope, so the discard commits. The staged photos are deleted after the commit.
- **Auth.** `phone_link_auth` (strict) and `phone_link_finalize_auth` (with the 10-minute grace) both live in `auth.py`. They look the link up by hash in SQL, comparing against `now()`, and join the Project to require it active. A revoked link is refused everywhere, finalize included. Phone mutations also call `projects.require_active`, with the lock order Project, then batch.
- **Revoke and cleanup (review fixes).** Revoking a link discards its open batches in the same transaction: their units come back, and their staged photos are deleted after the commit. The cleanup also takes batches of revoked links. It deletes links that expired more than a day ago, with their finalized batch and photo rows. Finalizing a batch the cleanup deleted after expiry answers `410 link_expired`. Before each photo's vision call, the batch job confirms that no cancel was requested and marks the photo's unit used, in one transaction.
- **Photo upload locking.** The batch is checked without a lock, then the unit is reserved in its own transaction (as in 2.5), and the photo is stored. Only then is the batch locked and checked again, and the row added. No row lock is held during the storage write.
- **Cleanup.** `phone.cleanup_forever` runs as an `asyncio` task in the lifespan, at startup and then hourly. It takes stale batches with `FOR UPDATE SKIP LOCKED`, so a concurrent finalize is never blocked.
- **Phone page.** The page uses `apiFetch(…, { auth: false })`. A photo over 50 MB isn't sent at all, because the server would refuse it. If no photo was accepted, finalize isn't called. The zero-photo Send label is "Send photos" / "Send bilder" (EXPERIENCE.md › Phone link › Zero photos; the Norwegian follows "Send {n} bilder"). The thumbnail × uses "Remove {n}" from the existing `files.remove.item`. The expired notice splits the approved sentence in two, as DESIGN.md › Expired notice does.
- **QR dialog.** The QR code is drawn as an SVG path from `QRCode.create`. Its colour comes from `currentColor`, so no hex value is needed (AD-28). The dialog fetches `/api/config` for `app_public_url`. Without it, the dialog shows the generic error, not a code built from the page's origin. An expired link is replaced while the dialog is open, and so is a link after a back-forward-cache restore; an expired link isn't revoked, so its finalize grace still holds. The phone page counts down on the server's clock, read from the `Date` header through `apiFetch`'s `onResponse`. It re-checks the link every 30 s and when the page becomes visible. A failed send keeps its open batch and its accepted photos for the retry. Its content mounts only while it is open, so each opening makes one link and revokes it on unmount. The drop zone reuses `login.or` for its "or".

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | BH, EC | closing the dialog mid-send strands accepted photos and units | medium | revoked links never cleaned before expiry + grace | patch — revoke discards open batches |
| 2 | BH, EC | a failed finalize re-uploads into a new batch (units twice) | medium | Send restarts from scratch | patch — reuse the batch |
| 3 | BH | link expiring mid-send skips the finalize grace | medium | `link_expired` aborts before finalize | patch |
| 4 | BH, EC | QR dialog keeps a dead code after expiry or bfcache restore | medium | no `expires_at` handling | patch — auto-renew |
| 5 | BH, EC | countdown trusts the phone clock | low | `Date.now()` vs server `expires_at` | patch — Date-header offset |
| 6 | EC | an idle phone never learns the link was revoked | medium | revoked set only on a 410 | patch — re-check every 30 s |
| 7 | BH | phone mutations skip `require_active` | medium | AGENTS.md / AD-22 | patch |
| 8 | VG | removal between vision start and settle gives back a used unit | low | two steps, not atomic | patch |
| 9 | BH | phone rows kept forever; cleanup index unused | low | no retention; index on the wrong column | patch |
| 10 | EC | finalize after cleanup answers 404 | low | batch gone | patch — 410 |
| 11 | EC | QR built from the computer's origin when config fails | medium | fallback to `window.location.origin` | patch — show error |
| 12 | BH | Referrer can leak the token | low | no Referrer-Policy on `/u/*` | patch |
| 13 | BH | duplicated helpers | low | four copies | patch |
| 14 | BH | "0 more photos" message | low | zero case | patch — `quota_exceeded` copy |
| 15 | VG, BH | missing tests (mid-read cancel, storage failure, cleanup start, concurrent finalize, phone_batch copy and usage, dialog errors, env-pinned TTL) | medium | none in the suites | patch |
| 16 | BH, EC | "10 minutes" copy vs the configurable TTL | low | default is 600 s; copy is approved | reject |
| 17 | BH | rejected batch copy talks about one image | low | needs new copy | defer to Cristoffer |
