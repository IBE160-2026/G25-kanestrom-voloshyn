---
title: 'Story 2.2: Upload documents and watch them get processed'
type: 'feature'
created: '2026-11-17'
status: 'ready-for-dev'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-1-create-open-and-rename-projects.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A Project can be created but holds nothing: there is no upload, no stored original, no extraction, and no background work. Every later feature needs Sections from the student's own documents (FR-6, §5.1, AD-5, AD-6, AD-20).

**Approach:**
- Upload one document per request to the Project. Validate it, store the original in the private `study-materials` bucket, insert a `processing` Material under a Project lock, enqueue a `material_processing` job, and return `202`.
- An in-process job runner (`services/jobs`) extracts the document to Sections off the event loop, applies AD-6's integrity rules, and saves the outcome.
- The Files panel lists the Project's files with live status, polling only while something is Reading….

## Boundaries & Constraints

**Always:**
- Types: PDF, .docx, .pptx, .txt, .md. Images are refused with `unsupported_file_type` until Story 2.5. Size ≤ 50 MB. ≤ 10 slot-holding Materials per Project (`removed_at IS NULL AND status IN ('processing','ready')`), re-checked under `SELECT … FOR UPDATE` on the Project row.
- Upload takes `ActiveProject`. `GET …/materials` and `GET …/jobs` are reads. `POST /api/jobs/{id}/seen` is bookkeeping (allowlisted). Every query is scoped by `account_id`.
- Only `services/materials` writes `study_materials.status`, and only `services/jobs` writes `generation_jobs`. No DB connection is held during extraction. Parsers run via `asyncio.to_thread`. Storage objects are deleted only after commit. No more than `JOBS_MAX_CONCURRENT` (default 3) jobs run at once.
- Reject reasons are codes the SPA translates: `unreadable` (below AD-6's thresholds), `unparseable` (corrupt, encrypted, or wrong content), `processing_failed`, and `interrupted`. A rejected Material keeps its file name and reason; its original is deleted.
- On startup, queued and running jobs become `failed` (`interrupted`), and their Materials become `rejected` (`interrupted`).
- Material text, keys, and tokens are never logged.
- Decided by Cristoffer on 2026-11-17:
  - The Files panel doesn't collapse in this story. The Files strip (collapse saved per Project, warning icon, starts collapsed below 1024 px) is split into Story 2.2b.
  - New copy is approved and added to EXPERIENCE.md as `[ASSUMPTION: copy, approved 2026-11-17 with Story 2.2]`:
    - Drop zone body: "Drop files here or browse. When a file is ready, you can ask about it and make quizzes, flashcards, and summaries." / "Slipp filer her eller velg fra maskinen. Når en fil er klar, kan du spørre om den og lage quizer, treningskort og sammendrag."
    - Types caption (drop zone and panel): "PDF, Word, PowerPoint, text, or Markdown · up to 50 MB each" / "PDF, Word, PowerPoint, tekst eller Markdown · opptil 50 MB hver"
    - Empty Files panel: "No files yet. Your notes will show up here." / "Ingen filer ennå. Notatene dine dukker opp her."
    - `unreadable`: "We couldn't read enough text in this file. It doesn't count toward your 10 files." / "Vi fikk ikke lest nok tekst i denne filen. Den teller ikke blant de 10 filene dine."
    - `unparseable`: "This file couldn't be opened. It may be damaged or password-protected." / "Filen kunne ikke åpnes. Den kan være skadet eller passordbeskyttet."
    - `interrupted` and `processing_failed`: "Reading stopped. Upload the file again." / "Lesingen stoppet. Last opp filen på nytt."

**Never:**
- No privacy notice (Story 2.3), auto-naming (2.4), images (2.5), Topics (2.6), or removal (2.7). No Redis, queue, worker, or cron. No LLM call.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Accept | `photosynthesis-lecture.pdf` | `202 {material, job_id}`; the row shows "Reading…", then "Ready" with no refresh | N/A |
| Warn | `integrity-warn.pdf` / `.pptx` / `.docx` / `.txt` | "Ready, partly unreadable" with its note; pages 2 and 4 named for paged files | N/A |
| Reject unreadable | `integrity-reject.pdf` / `.pptx` / `.docx` / `.txt` | "Rejected" with the `unreadable` text; the slot frees; the original is deleted | N/A |
| Reject corrupt | `integrity-reject-corrupt.pdf` | "Rejected" with the `unparseable` text | N/A |
| Unsupported | `unsupported-type.rtf`, or `.png` | `422 unsupported_file_type`; nothing stored | Inline error on the panel |
| Too large | 50 MB + 1 byte | `413 file_too_large`; nothing stored | Inline error |
| 11th file | 10 slot-holding files | `409 material_limit_reached`; a rejected file doesn't count | Inline error |
| Parallel at 9 | two uploads at once | exactly one `202`, one `409` (automated test) | N/A |
| Restart | a job running when the app stops | after restart: job `failed`/`interrupted`, file "Rejected" (`interrupted`) | N/A |
| Foreign or read-only Project | upload | `404 not_found` / `409 project_read_only` | Inline error |

</frozen-after-approval>

## Code Map

- `backend/app/main.py` lifespan L77-94 -- start the runner and the restart sweep after the pool opens; drain the runner before `pool.close()`.
- `backend/app/supabase_auth.py` -- `create_client` (5 s timeout: pass a longer per-request timeout for storage) and `_admin_headers` (secret key) to reuse in `storage.py`.
- `backend/app/api/deps.py` `ActiveProject`; `backend/tests/test_routes_guard.py` `ALLOWLIST` (add `POST /api/jobs/{job_id}/seen`).
- `backend/app/services/projects.py`, `db/projects.py` -- add a Project-row lock for the slot re-check (reuse `get_for_update`).
- `backend/app/config.py` -- add `jobs_max_concurrent=3`, `integrity_min_page_chars=20`, and the AD-6 thresholds as settings; list the names in `.env.example`.
- `backend/pyproject.toml` -- add `pdfplumber`, `markitdown[docx,pptx]`, and `python-multipart` (named in the spine; pinned).
- `supabase/config.toml` -- `[storage] file_size_limit = "50MiB"` already. Create the bucket in a migration.
- `frontend/src/api/client.js` `apiFetch` -- always JSON-encodes; let a `FormData` body pass raw, with no Content-Type.
- `frontend/src/pages/ProjectHome.jsx` -- the drop zone heading and the `files.header` count are hard-coded to 0. Replace them with real data.
- `test-data/README.md` -- one sample per AD-6 outcome and format; use them in backend tests.
- EXPERIENCE.md L219-230: Upload, statuses, warn note, upload errors. DESIGN.md L764-774: drop zone, Files panel, status dots.

## Tasks & Acceptance

**Execution:**
- [ ] `supabase/migrations/<ts>_study_materials.sql` -- `study_materials(id, project_id → projects cascade, account_id, file_name, file_type, size_bytes, status check, reject_reason check, warning bool, warning_pages int[], removed_at, created_at)`, `sections(id, material_id cascade, position, label, text, tsv tsvector generated with the 'simple' config, gin index)`, `generation_jobs` (AD-20 columns and checks), the private `study-materials` bucket, RLS on, and access revoked from the browser keys.
- [ ] `backend/app/storage.py` -- put and delete an object over httpx with the secret key; path `{account_id}/{project_id}/{material_id}/original`.
- [ ] `backend/app/extraction/` -- `pdf.py`, `office.py` (MarkItDown; slide split), `text.py` (headings, then ~500-word packing), `integrity.py` (pure AD-6 rules returning outcome, reason, and warning pages); `extract(path, type)` runs in `to_thread`.
- [ ] `backend/app/services/jobs.py`, `db/jobs.py` -- `enqueue`, the runner (semaphore, kept task refs), the save transaction locking the job and aborting on a removed Material or deleted Project, `sweep_interrupted`, `list_for_project` (active plus finished-unseen), `mark_seen`.
- [ ] `backend/app/services/materials.py`, `db/materials.py` -- `upload` (steps 1–4), the processing handler and save plan, `on_terminal`, `list_for_project`.
- [ ] `backend/app/api/materials.py`, `api/jobs.py` -- `POST/GET /api/projects/{project_id}/materials` (multipart field `file`), `GET /api/projects/{project_id}/jobs`, `POST /api/jobs/{job_id}/seen`.
- [ ] `backend/tests/` -- every matrix row using the `test-data/` files, the parallel-at-9 test, the restart sweep, the storage delete after reject, concurrency ≤ 3, and route-guard allowlist updates.
- [ ] `frontend/src/api/client.js` -- FormData passthrough plus a test.
- [ ] `frontend/src/pages/ProjectHome.jsx`, `components/FilesPanel.jsx`, `components/FileRow.jsx` + CSS -- Upload button, drag and drop on the drop zone and panel, sequential uploads, file rows with status dots and notes, "Files · n of 10", 2 s polling while any file is Reading…, and the Inline error for upload refusals.
- [ ] `frontend/src/i18n/en.json`, `nb.json` -- the existing EXPERIENCE strings plus the approved drafts; mirror the drafts into EXPERIENCE.md.
- [ ] Frontend tests -- the matrix rows on the SPA side, polling starting and stopping, keyboard upload, and both languages.

**Acceptance Criteria:**
- Given three files dropped at once, when they upload, then they go one after another and each row appears as "Reading…" at once.
- Given nothing is Reading…, then the SPA makes no polling requests.
- Given a reopened Project, then every non-removed file shows with its last status (FR-8).

## Verification

**Commands:**
- `npx supabase db reset` -- expected: migrations apply, and the bucket exists
- `cd backend; uv run pytest` -- expected: all green with `LLM_MODE=mock`
- `cd frontend; npm test; npm run lint; npm run build` -- expected: all green

**Manual checks:**
- In `docker compose up --build`: upload every `test-data/` document; see Reading… turn into Ready, Ready partly unreadable, or Rejected without a refresh; try an 11th file and an `.rtf`; restart the container mid-processing.

## Implementation Notes

## Spec Change Log

## Review Triage Log
