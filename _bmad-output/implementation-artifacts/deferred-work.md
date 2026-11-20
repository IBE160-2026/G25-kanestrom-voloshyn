- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-runnable-app-skeleton.md`
  summary: Add an automated smoke check that the built Docker image serves the SPA at `/` (default `frontend_dist`, Dockerfile COPY layout, `parents[2]`).
  evidence: Review pass 1, finding #4. `create_app` only logs a warning when dist is missing, so a layout change would make the container serve the API only, with every pytest green. The check needs CI or a container harness, which doesn't exist yet.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-runnable-app-skeleton.md`
  summary: Replace AGENTS.md's TODO "Running and verifying" section with the verified commands from README (via `bmad-project-context` refresh).
  evidence: Review pass 1, finding #26. The scaffold now exists, and AGENTS.md says to replace the TODO on the first refresh after scaffolding. Include: `Accept: text/html` SPA fallback, compose URL overrides, and that Windows dev needs `uvicorn --reload` (psycopg async can't use the Proactor loop; finding #22).
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-create-account.md`
  summary: Story 1.3 part 2 — the verification email and link: `mailer.py` (aiosmtplib, Mailpit SMTP 54325 enabled in config.toml), `email_verifications` (32-byte token, SHA-256 hash, 24 h, single use, newer replaces older), sending from `after-sign-in` in `profiles.language`, `GET /api/auth/verify` → SPA "Your email is verified." / "This link has expired".
  evidence: Split from Story 1.3 by Ihor on 2026-11-12 (spec over 2,400 tokens). Decided already: Ihor approved drafting the email's subject and body in English and Norwegian (proposed), adding them to EXPERIENCE.md Strings by surface and the sign-off checklist; libraries `httpx2` + `aiosmtplib` are in the spine (with the AD-18 rule: send mail after commit).
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3b-email-verification.md`
  summary: Test that two overlapping first `after-sign-in` calls for one Account issue only one verification token and send one email (the profile-row lock in `issue_first`).
  evidence: Review pass 1, finding #11. Dropping `FOR UPDATE` in `profiles.lock_email_verified_at` fails no test. A deterministic test needs two pooled connections with interleaved transactions. The partial unique index added in the same review limits the damage to one live token.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3b-email-verification.md`
  summary: The expired-verification screen offers no way forward until Story 7.3 adds "Resend verification email" in Settings (EXPERIENCE.md › Email verification).
  evidence: Review pass 1, finding #12. The final UX doc expects a resend path; the epics place resend in Story 7.3. Make sure Story 7.3 links the expired screen to it.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-password-reset.md`
  summary: Test that a failing `accounts.find_for_reset` (DB lookup) in the reset background task still answers 202, logs "Password reset lookup failed" and logs no address.
  evidence: Review pass 1, finding #14. Removing the try/except, or logging the exception text, fails no test. Needs a failing-pool fixture.

## Deferred from: code review of spec-1-4-login-logout.md (2026-11-16)

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-login-logout.md`
  summary: Test that Login's "already signed in" redirect does not fire while a login is in flight (hold `hasSession()` pending, submit, let `signIn` succeed with `after-sign-in` pending, then resolve `hasSession` true; the route must stay `/` until `after-sign-in` settles).
  evidence: Code review pass 2, Verification Gap. Removing `&& !inFlight.current` in `Login.jsx` fails no test. Narrow window (slow `/api/config`); add when the Login tests are next touched.

## Deferred from: code review of spec-1-3-create-account.md (2026-11-16)

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-create-account.md`
  summary: A half-finished sign-up loses the first name: `signUp` succeeds, `after-sign-in` fails, the page is reloaded, and a resubmit says "duplicate"; no later step sends the name. Story 7.3 must let the student set it (FR-27), or Create account must treat "duplicate with a live session" as signed up.
  evidence: Code review pass 2, Blind Hunter and Edge Case Hunter. `signedUp` lives only in React state.

## Deferred from: code review of spec-1-1-runnable-app-skeleton.md (2026-11-16)

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-runnable-app-skeleton.md`
  summary: A phone demo on the LAN needs `SUPABASE_PUBLIC_URL` and the Supabase redirect allow-list (`site_url`, `additional_redirect_urls` in `supabase/config.toml`) set to the LAN address as well as `APP_PUBLIC_URL`; `.env.example` and the README mention only `APP_PUBLIC_URL`.
  evidence: Code review pass 2, Blind Hunter, Edge Case Hunter and Verification Gap. `/api/config` hands the browser `SUPABASE_PUBLIC_URL` (default `127.0.0.1:54321`), which on a phone is the phone itself. Epic 6 (phone upload) is the first flow that needs it.
  resolved: 2026-11-16. README › «Mobil på lokalnettet» documents `APP_PUBLIC_URL`, `SUPABASE_PUBLIC_URL`, the Google-only redirect entry, the Windows network profile, and `--host` for dev mode; `.env.example` points there. Checked: the app (8000) and Supabase (54321) answer on the computer's LAN address with Docker Desktop's own firewall rules.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-create-open-and-rename-projects.md`
  summary: When archive and delete exist (Epic 7), show the state-specific read-only messages EXPERIENCE.md already has ("This project is archived/deleted. Restore it to make changes.") by sending `params: {state}` with `project_read_only`, instead of the generic "This project is read-only."
  evidence: Story 2.1 review pass 1, Blind Hunter. `ProjectReadOnly` sends empty params, and EXPERIENCE.md › Read-only project, blocked action has separate archived and deleted copy; the generic text can't be reached until Epic 7.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-upload-documents-and-watch-them-get-processed.md`
  summary: Story 2.2b — the Files panel collapses to the Files strip ("Show files"/"Hide files", "{n} of 10", warning icon when a file is partly unreadable or rejected), the collapse is saved per Project in `ui_prefs`, and it starts collapsed below 1024 px (UX-DR5, EXPERIENCE.md › Files strip).
  evidence: Split from Story 2.2 by Cristoffer on 2026-11-17 to keep the spec near the size limit; it is a separate shippable UI part on top of 2.2's Files panel.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-upload-documents-and-watch-them-get-processed.md`
  summary: Refuse oversized upload bodies before parsing (Content-Length / request-size cap), so a multi-GB body isn't received in full before the 413.
  evidence: Story 2.2 review pass 1 (Blind Hunter, Edge Case Hunter). python-multipart spools the whole part before the handler checks 50 MB.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-upload-documents-and-watch-them-get-processed.md`
  summary: Bound the in-memory job payloads (queue limit or spool to disk) and add a per-job timeout plus size limits for parsers (hanging PDFs, zip bombs).
  evidence: Story 2.2 review pass 1. Runner tasks hold up to 50 MB each while waiting for the semaphore; `asyncio.to_thread` can't be cancelled. Unverified at demo scale.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-upload-documents-and-watch-them-get-processed.md`
  summary: The approved `unsupported_file_type` text lists JPG, PNG, and HEIC, which are refused until Story 2.5; if 2.5 (FR-7) is cut, edit the text in both catalogues and EXPERIENCE.md.
  evidence: Story 2.2 review pass 1, Blind Hunter.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-upload-documents-and-watch-them-get-processed.md`
  summary: A queued job with `cancel_requested` is never finished by `Runner._steps` (claim returns None); finish it as cancelled and run its terminal hook when Story 2.7 adds `jobs.cancel_for_material`.
  evidence: Story 2.2 review pass 1, Edge Case Hunter. No cancel route exists in 2.2.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-see-the-privacy-notice-before-my-first-upload.md`
  summary: Story 6.1 must gate "Upload from phone" with the same Privacy notice and make new phone links fail with `privacy_notice_required` until it is accepted (AD-19, EXPERIENCE.md › Upload buttons).
  evidence: Story 2.3 review pass 1 (Blind Hunter). Story 2.3 gates the computer's Upload, browse, and drops only; the phone entry doesn't exist yet.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-4a-llm-gateway-and-test-mode.md`
  summary: Story 2.4b (the original Story 2.4) — after a Material commits as Ready, `projects.auto_name_if_unnamed` calls `llm.name_project` outside any write transaction and saves with `WHERE name_source IS NULL`; a failure leaves the name NULL and retries after the next Ready file; the SPA re-reads the Project (2 s, ≤ 30 s) so the name appears without a refresh (FR-4, AD-14).
  evidence: Split from Story 2.4 by Cristoffer on 2026-11-17 to keep each spec near the size limit; it builds on 2.4a's gateway and `name_project` task.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-4a-llm-gateway-and-test-mode.md`
  summary: Verify that the live gateway's `strict: true` json_schema (with `minLength`/`maxLength` from Pydantic) is accepted by the chosen `LLM_TEXT_MODEL` under `require_parameters` and `zdr`, before Story 2.4b relies on it.
  evidence: medium, unverified — strict structured-output modes may reject those keywords, which would surface as `llm_unavailable`; settle it with one real OpenRouter call (or strip the keywords from the sent schema and keep local validation).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-6a-detect-and-show-topics.md`
  summary: Story 2.6b (sprint key 2-6-see-and-edit-the-topics-in-each-file) — rename, merge (same file only, kept on the first Topic's id), delete (never the last), and add (refused past 100) Topics in an active Project, with `topic_last_cannot_delete`, `topic_limit_reached`, `topic_merge_cross_material`, chip interactions, and the Inline error (FR-22, AD-21).
  evidence: Split from Story 2.6 by Cristoffer on 2026-11-18 to keep each spec near the size limit; it builds on 2.6a's tables and read-only Topic list.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-6a-detect-and-show-topics.md`
  summary: Add a test that the materials list returns Topics in `position` order when storage order differs (Story 2.6b, once merge/delete/add change positions).
  evidence: Story 2.6a review (Verification Gap): insertion order equals position order today, so dropping `position` from the ORDER BY would pass every test.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-upload-photos-of-my-notes.md`
  summary: Test that a pending (still uploading) `.jpeg` row shows the JPG tile.
  evidence: Story 2.5 review (Verification Gap): only rows with `file_type` are rendered in tests; cosmetic on a short-lived row.
- source_spec: none
  summary: V2 idea (Cristoffer, 2026-11-18) — Ask AI model routing: a default model (e.g. `openai/gpt-4o-mini`) answers chat, and a small decision model (TypeSafe Jev 1.14 on OpenRouter, `typesafe/jev-1.14`) sends hard questions, or relevant questions needing knowledge beyond the material, to a stronger model.
  evidence: Post-V1 only. Needs (1) a PRD change, because FR-16 answers only from the student's material and outside knowledge is a product change to agree with Ihor; (2) an architecture-spine amendment through `bmad-architecture` (a new component in the AD-3 gateway); (3) confirmation that TypeSafe stores no data and supports `zdr`, as AD-3 requires. Until then, a stronger chat model can simply be set in `.env`.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-1a-set-up-and-generate-a-quiz.md`
  summary: Story 3.1b (sprint key 3-1-generate-a-quiz-from-my-topics) — when a Quiz finishes while the student is elsewhere, the notice "Your quiz on {topic} is ready · Open" appears in the chat; opening or dismissing it marks the job seen (FR-26, AD-20).
  evidence: Split from Story 3.1 by Cristoffer on 2026-11-18 to keep each spec near the size limit; it builds on 3.1a's generation job.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-1a-set-up-and-generate-a-quiz.md`
  summary: Add a Runner test that a shutdown `drain` cancelling a running generation job does not end it `cancelled` (the restart sweep fails it `interrupted`), plus the cancel-during-reading and cancel-at-return paths.
  evidence: Story 3.1a review (Verification Gap, Blind Hunter): only the student cancel while writing is tested; the `_interrupted` guard in `Runner._steps` could regress silently.

- source_spec: none
  summary: Story 7.2b — "Delete forever" (confirm dialog, `projects.purge`: cancel and wait for jobs, cascade delete, Storage prefix after commit) and the in-process 30-day purge task (startup, then hourly), with reads treating expired Projects as gone and a purge-vs-running-job test.
  evidence: Split from Story 7.2 by Cristoffer on 2026-11-19; 7.2a (soft delete and restore) ships on its own and deleted Projects simply stay until 7.2b.

- source_spec: `_bmad-output/implementation-artifacts/spec-7-2b-delete-a-project-forever.md`
  summary: A Storage delete that fails after a purge (or a material removal) commits is logged and never retried, leaving orphaned objects under `{account_id}/{project_id}/`.
  evidence: `storage.delete_prefix` and `storage.delete` swallow failures by design (AD-16 orders Storage after the DB commit); a periodic orphan-prefix sweep in the hourly task would settle it.

- source_spec: none
  summary: Story 7.3b — Settings › "Link Google account" (linkIdentity, backend removes an unverified link with email_not_verified, "already linked" error, cancelled consent) and "Verify your email first" + "Resend verification email" (new 24 h link, older ones invalidated, "We've sent a new link. It works for 24 hours.").
  evidence: Split from Story 7.3 in the unattended run on 2026-11-20 because the full story was far over the spec size limit; 7.3a (the Settings page) ships alone.

- source_spec: `_bmad-output/implementation-artifacts/spec-7-3a-settings-page.md`
  summary: Every current-password check signs in from the backend's one IP, so all students share Supabase's per-IP sign-in limit (`sign_in_sign_ups = 30`); add a per-Account attempt limit or forward the client IP.
  evidence: Review of 7.3a (BH, VG, EC); 7.3a only maps the resulting 429 to `too_many_attempts`.
- source_spec: `_bmad-output/implementation-artifacts/spec-7-3a-settings-page.md`
  summary: Story 7.3b must set a Google-linked Account's first name from the Google profile on linking, since Settings shows it read-only as "from your Google account".
  evidence: Review of 7.3a: `fill_unset` only fills an unset name.

- source_spec: `_bmad-output/implementation-artifacts/spec-7-4-delete-my-account.md`
  summary: Account deletion goes on to delete the auth user even when `storage.delete_prefix` failed (errors are swallowed), so the student's files can outlive the Account with no retry.
  evidence: Review of 7.4 (EC, BH); same root as the 7.2b Storage-retry entry — have `delete_prefix` report failure, or sweep orphaned prefixes in the hourly task.
