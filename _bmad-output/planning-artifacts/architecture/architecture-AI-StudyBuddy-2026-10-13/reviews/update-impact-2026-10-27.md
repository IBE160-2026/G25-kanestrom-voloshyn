---
title: "Architecture update impact: PRD 2026-10-14 (29 FRs) + final UX vs. spine AD-1..AD-18"
type: review
created: 2026-10-27
inputs:
  - ../ARCHITECTURE-SPINE.md (status final, binds FR-1..FR-18)
  - ../../../prds/prd-AI-StudyBuddy-2026-10-06/prd.md (status final, updated 2026-10-14)
  - ../../../prds/prd-AI-StudyBuddy-2026-10-06/.memlog.md
  - ../../../ux-designs/ux-AI-StudyBuddy-2026-10-13/EXPERIENCE.md, DESIGN.md (final)
  - ../../../consistency-check-2026-10-14.md
---

# Architecture update impact — 2026-10-27

The spine was distilled from the 18-FR PRD of 2026-10-06. The PRD now has 29 FRs and absorbs the finalized UX. **Five spine pillars no longer hold as written:**

1. synchronous work (AD-13)
2. Section-id Selection Scope (AD-7)
3. one chat thread (AD-15)
4. immutability with no deletion (AD-8, Deferred)
5. Mistakes from flashcards (AD-10/11)

**Auth also changes sharply** (AD-1, AD-2): Google, verification, linking, takeover, and account deletion.

Everything else (gateway, mock mode, integrity thresholds, quotas, one image/one origin, plain SQL, migrations) survives with extensions.

Constraint applied to every option below: 2 students, FastAPI + React/Vite + Supabase + OpenRouter, simplest design, **no extra infrastructure** (no Redis, Celery, separate worker, websocket server, or cron host) per AGENTS.md.

Notation:
- "**Strains**": the AD can be kept with an amendment.
- "**Contradicts**": the AD's rule must change.
- Claims about Supabase/OpenRouter behaviour marked **[verify]** come from memory and must be checked against current docs before the AD is written.

---

## 1. Requirement-by-requirement impact

### 1.A New FRs (FR-19 … FR-29)

#### FR-19 — Sign in with Google (linking, takeover)

**Requirement:** Google can create an Account or log in. Testable consequences:
- One Account per email.
- If the Google email matches a **verified** password Account, Google sign-in does **not** sign in at once. The student must log in once with the password, and Google is linked after that.
- If it matches an **unverified** password Account, Google **takes over** that Account: the old password stops working, **every earlier session ends**, and a one-time notice is shown.
- Linking requires a verified email.
- A Google identity already linked elsewhere gets an error.
- Cancelling consent changes nothing.

**(a) ADs affected**
- **AD-1 (strains):** "The SPA uses `supabase-js` only for sign-up, login, logout, password reset, and reading its session token." The list now also needs `signInWithOAuth`, `linkIdentity`, and an OAuth callback route.
- **AD-2 (contradicts):** "email confirmations **off** (FR-1: verification optional…)". With confirmations off, Supabase auto-confirms every sign-up **[verify]**. Every Account would then count as "verified", which defeats the takeover rule and the verify-before-link gate.
- **AD-2 (strains):** "Exactly one FastAPI dependency…": takeover and linking need server-side admin actions (Supabase secret key).

**(b) New decision:** "AD-19 Account identity". It covers:
- where the "verified" flag lives
- how the PRD's link-after-password-login rule is implemented given Supabase's own identity-linking behaviour
- how takeover clears the password and ends sessions

**(c) Options**

1. **Supabase automatic identity linking, accepted as-is.** Supabase links an OAuth identity to an existing user with the same email automatically, with protections for unconfirmed emails **[verify exact current behaviour]**. This is the least code, but it signs the student in at once for a verified Account. That **violates FR-19** ("does not sign in at once… log in once with the password"). It would need a PRD amendment.
2. **Manual linking plus a backend post-sign-in check.** Enable `enable_manual_linking`. After every OAuth callback, the SPA calls `POST /api/auth/after-sign-in`, and the backend inspects `auth.identities`:
   - (i) An identity auto-linked to a verified password Account with no `link_confirmed` flag: unlink it (admin API), revoke the session, and return `google_link_requires_password`. After the next password login, the SPA calls `linkIdentity()`.
   - (ii) An unverified password Account: set a random password via the admin API, delete every other `auth.sessions` row (AD-2 already reads `auth.sessions`), and set `profiles.notice_google_takeover = true`.

   This meets the PRD exactly. It is moderate code and hard to test without real Google credentials. The rules can be unit-tested against seeded `auth.identities` rows.
3. **Drop Google from V1.** This needs a PRD change to a `status: final` doc and approval from Cristoffer or Ihor.

**Recommendation:** option 2, if the team keeps FR-19 as written. Otherwise ask for a PRD amendment that accepts Supabase's automatic linking for *verified* emails. Both Google and the Account then prove the address, so security is equivalent, and that is the cheapest route. **Human decision (H1).**

**Also needed**
- `GET /api/config` gains `google_enabled`. The grader has no Google OAuth client, so the button must hide when it is not configured (AGENTS.md: the grader runs with no keys).
- Google client id and secret go in `.env`, and `supabase/config.toml` reads them with `env()`.

#### FR-20 — Study Material removal (including Reading… and Rejected files)

**Requirement:**
- Remove with confirmation; removing a rejected file needs no confirmation.
- Removing a processing file **cancels processing**.
- The slot frees immediately.
- **Generated content stays in History.**
- Mistakes stay outstanding by default and are practised from their saved question. They can optionally be "taken out of review", with history kept.
- A failed removal changes nothing.

**(a) ADs affected**
- **Deferred (contradicts):** "Deleting Projects or Materials: not in the PRD, so a full Project (10 Materials) stays full in V1."
- **AD-8 (contradicts):** "These are insert-only: … Sections." and "The only mutable data is `projects.name`/`name_source` … and the Mistake lifecycle."
- **AD-5 (contradicts):** the upload order inserts the Material row only after extraction (step 4). A "processing" Material that counts toward the 10 and can be cancelled therefore does not exist.
- **AD-13:** a synchronous request has no cancellable server state.
- **AD-10 (strains):** the lifecycle has only `cleared_at`; it needs a `withdrawn_at` state.
- **AD-11 (contradicts) for removed material:** "The source text comes from the item's own `source_section_ids`." FR-18 now says nothing new is generated for such Mistakes: the saved original Question *is* the practice item.

**(b) New decisions**
- What "removed" means physically (tombstone vs. hard delete).
- How generated items keep their Source labels after removal.
- Material processing state (see FR-26/AD-13).

**(c) Options**

1. **Tombstone (recommended).** Set `study_materials.removed_at`. Delete the original from Storage. Null out the Section text and `tsvector`, but keep the Section rows' `label` and the Material's file name, so old quizzes and summaries still render "file · slide N". Removed Materials are excluded from counts, scopes, chat, and "Do it again". This is simple and consistent with "Study Content stays viewable".
2. **Hard delete with denormalized labels.** Copy each source label into every generated item at generation time, then delete the Material and its Sections. This is cleaner for privacy but needs more schema, and every generated item duplicates labels.
3. **Soft delete keeping the text.** This is the simplest, but it keeps the student's text after they "removed" it. That is questionable against the user's intent and §5.4 ("The material is removed at once").

**Mistakes**
- Add `mistakes.withdrawn_at`. `outstanding_count` excludes withdrawn rows. AD-10's unique index becomes `WHERE cleared_at IS NULL AND withdrawn_at IS NULL`.
- In AD-11, when a Mistake's material is removed, `review` serves the original `quiz_question` as the practice item (re-shuffled or as-is), with no LLM call. This needs a rule: **the Material a Mistake "comes from".** A Quiz question may cite Sections from two Materials.
  - Obvious answer: store `material_ids` (derived from `source_section_ids`) on the question.
  - The Mistake counts as "from" every one of them.
  - The removal checkbox affects Mistakes whose questions cite the removed Material.
  - Practice regenerates only while *all* cited Materials remain.

#### FR-21 — Upload from phone (QR, no login)

**Requirement:**
- A one-time link, shown as a QR code, that can only add material to one Project and read **only the Project name**.
- Expires after ~10 min, when the student closes the dialog, or when the Project is archived or deleted.
- A batch of photos becomes **one Study Material** (one slot), with no maximum number of photos.
- 50 MB per photo, and 25 images/day counted per photo. A photo past either limit is declined individually.
- The phone **warns before sending** about the image limit and the 10-file limit; the server re-checks.
- Per-page warning when some photos are unreadable; rejection when all are.
- The computer shows the new material **without refresh**.

**(a) ADs affected**
- **AD-2 (contradicts):** "Exactly one FastAPI dependency (`app/auth.py`) turns a bearer token into `account_id`." The phone has no Supabase session.
- **AD-5 (contradicts):** "**One file per upload request**" and "image → whole image, one Section". A batch is many images forming one Material.
- **AD-6 (strains):** the image row is per image; a batch-level rule (some unreadable → warn and name the pages; all → reject) is missing.
- **AD-13 (contradicts):** "A … polling protocol appearing in one feature and not others": live arrival needs push or poll.
- **AD-17 (strains):** the QR needs an absolute URL the phone can reach. Locally, `localhost` is not reachable from a phone, so a `APP_PUBLIC_URL` setting and LAN binding are needed.

**(b) New decision:** "AD-24 Phone upload capability link".

**(c) Options**

- **Token**
  - **Recommended:** random 32-byte token, stored hashed in `phone_upload_links(project_id, account_id, expires_at, revoked_at)`, with a second, narrowly scoped dependency `phone_link_auth` that can call only `materials.add_phone_photo` and `projects.get_name`. Amend AD-2 to "exactly two dependencies".
  - Alternative: a signed JWT with no table. Revocation on close/archive/delete then needs a table anyway, so it gains nothing.
- **Batch transport**
  - **Recommended:** `POST /api/phone/{token}/batches` → `batch_id`, then one `POST …/batches/{id}/photos` per photo (each ≤ 50 MB, reserving one image quota unit, declined individually), then `POST …/finalize`. Finalize creates the Material with one Section per photo ("Page n") and runs the batch integrity rule. This keeps the one-file-per-request property and bounded request bodies, and gives a natural place for per-photo declines.
  - Alternative: one multipart request with every photo. An unbounded body (no photo cap × 50 MB) breaks host limits.
- **Slot timing:** the batch should take a "processing" slot at the first accepted photo, or at finalize. Recommended: at finalize under the AD-5 `FOR UPDATE` lock. The pre-send warning is advisory.
- **Live updates on the PC**
  - **Recommended:** short polling (`GET /api/projects/{id}/materials` every 2–3 s while the QR dialog is open or any Material is `processing`).
  - Alternatives: SSE, which is more code and needs an unbuffered host; or Supabase Realtime, which contradicts AD-1's "browser touches Supabase only for auth".
- **Pre-send warnings vs. "reads only the Project name":** see §3 conflict C-1.
- **Mock mode:** photos from phones are named `IMG_xxxx.jpg` and so get the `readable` fixture. Testing needs the AD-4 markers, applied by a desktop browser opening the phone URL with `-partial`/`-unreadable` files.

#### FR-22 — Topic detection and editing

**Requirement:**
- Topics appear after extraction: about 1 per 5 pages, minimum 3 (at detection only), ceiling 100. A page is a PDF page, one slide, one photo, or about 500 words for .txt/.md/.docx.
- Above the ceiling, content is grouped and never dropped.
- The count is server-calculated.
- Rename, merge, delete (down to 1, never the last), or add.
- Edits affect only their own Material and persist.
- Topics are the Selection Scope unit for Quiz and Flashcards, and an optional narrowing for Summarize.
- A student-added Topic absent from the material yields no fabricated content.
- Pickers handle up to 100 topics, grouped by chapter or section.

**(a) ADs affected**
- **AD-7 (contradicts):** "Every generation request carries one scope shape: `{"section_ids": [...]}`, or `{"whole_project": true}`".
- **AD-5 (strains):** ".txt | whole file" and ".docx/.md | first-level heading". A 20-page .txt is one Section but needs about 4 topics, so Topic → Section mapping is too coarse.
- **AD-8 (contradicts):** "The only mutable data is …". Topics are mutable.
- **AD-3 (strains):** a new gateway task is needed.

**(b) New decisions:** "AD-21 Topics":
- the data model
- how detection maps topics to text
- how large files are detected within the context budget
- what a hand-added topic scopes to
- what generated artifacts store as their scope (topics change later)

**(c) Options**

- **Text granularity:** for non-paged formats, split Sections into ~500-word chunks inside headings, so "page" equals Section for every format.
  - Benefits: one Topic count formula, finer Topic → Section mapping, and better Ask AI full-text retrieval.
  - Cost: an AD-5 table change only.
  - Recommended.
- **Topic model:** `topics(id, material_id, label, group_label, position, origin auto|student)` plus `topic_sections(topic_id, section_id)`, many-to-many. Merge = union of the sections. Delete = remove the row (refused when it is the last one). Add = a label with no sections.
- **Detection**
  - (i) **One `detect_topics` gateway call per Material.** The server computes the target count `clamp(ceil(pages/5), 3, 100)` and sends Section ids and labels plus text. The model returns topics with `section_ids`, `group_label` (chapter), and a validation that every Section is covered. **Recommended.**
  - (ii) Chunked or hierarchical detection for files over the context budget (500 pages): detect per chunk, then merge or group down to the target. More code; needed only past the budget.
  - Lean: (i) plus a simple chunk fallback.
  - Single-page Materials (one photo or one slide) still need ≥ 3 topics. All three map to the same Section, and the topic label acts as a focus instruction.
- **Scope shape (replaces AD-7):**
  - Quiz/Flashcards `{"topic_ids":[…]}` or `{"all_topics": true}`.
  - Summarize `{"material_id":…, "topic_id": null|…}`.
  - Chat `{"material_id": null|…}`.
  - The backend expands a scope to Section ids plus topic labels. Section-labelled grounding (AD-3) is unchanged, and the prompt adds "focus on these topics; if a topic is not in the material, produce nothing for it".
  - A student-added topic expands to the whole Material's Sections plus the focus instruction. Content Integrity is then enforced by "fewer/zero items is valid" (AD-3), shown as the Too-little-material note.
- **Stored scope on artifacts:** store `topic_ids`, a snapshot of `topic_labels`, and the resolved `section_ids`. "Do it again" (FR-25) re-resolves `topic_ids`. A topic deleted since then falls back to the stored `section_ids`, and is unavailable if the Material was removed.
- **Ceiling on student "add":** refuse adds over 100 (`422 topic_limit_reached`). The PRD says the server enforces the ceiling. Obvious.
- **Mock:** derive topics deterministically ("Topic k" round-robin over Sections) instead of from static fixtures, because the count depends on file length.

#### FR-23 — Archive and restore

**Requirement:**
- An archived Project is read-only: no chat, generation, review, upload, removal, topic edits, rename, or quiz resume.
- Archiving needs no confirmation and can be undone.
- Mistakes are kept, and the indicator is hidden.
- **Running generation finishes and saves.**
- The phone link is revoked.
- Restore returns the Project exactly as it was.

**(a) ADs affected**
- **AD-8 (strains):** the mutable-data list.
- **AD-2 (strains):** scoping is by `account_id` only, with no state guard.
- **AD-13:** "finishes while archived" assumes background work.

**(b) New decision:** "AD-22 Project lifecycle state and read-only guard".

**(c) Options:**
- **Recommended:** `projects.archived_at` and `projects.deleted_at` columns, plus one service function `projects.require_active(conn, account_id, project_id)` → `409 project_read_only`, called by every mutating service. A test asserts that every mutating route calls it.
- Alternative: a Postgres trigger rejecting writes on child tables. It is harder to give friendly errors, and background job saves must bypass it (FR-23 "finishes and is saved").

#### FR-24 — Project deletion (Deleted projects, 30 days, purge)

**Requirement:**
- A soft delete to Deleted projects for 30 days, read-only, showing days left.
- Restore goes to the active list.
- "Delete forever" deletes at once, after confirmation.
- **Automatic permanent deletion after 30 days**, removing files, text, content, chats, and Mistakes.
- Deleting **cancels running generation** and revokes the phone link.
- After deleting the open Project, the student lands on the most recent other active Project.

**(a) ADs affected**
- **AD-8 (contradicts):** "Answer records are insert-only, never updated or deleted".
- **Deferred (contradicts):** "Deleting Projects… not in the PRD".
- **AD-13:** cancellation needs a server-side job.
- **AD-16 (strains):** the storage prefix `{account_id}/{project_id}/…` already makes prefix deletion easy (good).

**(b) New decision:** the purge mechanism with no extra infrastructure.

**(c) Options**

1. **In-process periodic task (recommended).** A FastAPI lifespan `asyncio` task runs `projects.purge_expired()` on startup and then hourly:
   - deletes the Storage prefix through `storage.py`
   - then `DELETE FROM projects` (FK `ON DELETE CASCADE` to everything)

   Reads also treat `deleted_at < now() - 30 days` as gone, so a sleeping host never shows an overdue Project. This keeps the work in one process and uses the same code as "Delete forever" and account deletion.
2. **`pg_cron` in Supabase.** It is available locally and on the free plan **[verify]**, but SQL cannot properly delete Storage objects (direct `storage.objects` deletes are blocked or leave the files behind **[verify]**). It would need a second path for files.
3. **An external cron or Edge Function.** This is extra infrastructure and is rejected.

**AD-8 amendment:** artifacts and answers are never *updated*. They are deleted only by Project/Account purge (and Material removal as in FR-20).

**Purge without a user token:** purge runs without `account_id` from a request. AD-2's "every repository function … takes `account_id`" needs an explicit system-context exception limited to `purge`.

#### FR-25 — History

**Requirement:**
- One list per Project of chats, Quizzes, Flashcard sets, and Summaries, newest first, filterable by type.
- Completed Quizzes and sets reopen read-only and can be **run again as a new generation** with the same count, topics, and material.
- Running again is unavailable when the source was removed.
- An **Unfinished Quiz resumes** from the next unanswered question.
- A Flashcard set left part-way is saved as ended.
- History is read-only when the Project is archived or deleted.

**(a) ADs affected**
- **AD-8 (strains):** "Retaking a Quiz creates a new Quiz Attempt against the same saved Questions." The PRD no longer has a retake on the same questions. "Run again" is a new generation.

**(b) New decision:** "AD-28 History and runs".

**(c) Options**
- **History query**
  - **Recommended:** a `UNION ALL` read over `chats`, `quizzes`, `flashcard_sets`, `summaries` in `db/history.py`, with keyset pagination by `created_at`. Endpoint: `GET /api/projects/{id}/history?type=`.
  - Alternative: a `history_items` table written by each service, which is one more write path to keep consistent.
- **Quiz state:** simplify to **one attempt per Quiz**. "Unfinished" means answered < total, and resume returns the first unanswered question. AD-9's answer idempotency already supports this.
- **Flashcard runs:** `flashcard_sets.ended_at`, with insert-only marks per card. The end screen counts cards marked more than once. "Left part-way" sets `ended_at` on leave, or lazily when the next set is opened.
- **"Do it again":** store `generation_params` (count, scope) on the artifact and reuse them.

#### FR-26 — Generation lifecycle (background, cancel)

**Requirement:**
- Quiz, Flashcard, Summary, and Mistake Review generation **continues when the student leaves the screen**, and **can be cancelled**.
- Generation that finishes elsewhere is saved and **announced in the Project**.
- A failure keeps the setup choices.
- Archiving lets it finish; deleting cancels it.
- 60 s target per generation.

**(a) ADs affected**
- **AD-13 (contradicts directly):** "Uploads … and generation requests finish their work before returning the saved result. The SPA shows a blocking progress state." Its *Prevents* clause, "A job queue, worker process, or polling protocol appearing", is exactly what FR-26, FR-20 (cancel processing), and FR-21 (live arrival) now need.
- **AD-18 (strains):** "Services never open connections or commit": a background job has no request transaction.

**(b) New decision:** "AD-19/20 Background jobs", which supersedes AD-13. The same mechanism should cover Material processing (extraction → integrity → topics → naming), so that "Reading…" is real persisted state.

**(c) Options**

1. **Synchronous request owned by an app-level SPA store, plus a cancel flag.** The request survives route changes inside the SPA (not a tab close). Cancel = `POST /api/generations/{client_id}/cancel` sets a flag, and the service discards the result before saving. This is the least change from the current spine, but:
   - a refresh or tab close loses the "announce" (the result still saves, because the server keeps running);
   - Material processing still cannot be shown across tabs or devices (phone batch, FR-21);
   - long uploads keep ≥ 90 s host timeouts.
2. **In-process background jobs (recommended).**
   - A `jobs` table: `(id, account_id, project_id, kind, params, status queued|running|succeeded|failed|cancelled, result_ref, error_code, created_at, finished_at, seen_at)`.
   - `POST` returns `202 {job_id}`, and the work runs as an `asyncio` task in the FastAPI process (`services/jobs` with its own connection and transactions).
   - The SPA polls `GET /api/projects/{id}/jobs?active=1` every 2 s while anything is running (the same poll serves FR-21 live arrival).
   - Cancel sets `cancel_requested`. The task checks it before each step and before saving, and calls `task.cancel()` on the in-flight LLM call.
   - At startup, `running` jobs from a previous process are marked `failed` ("Try again").
   - Archive lets the job finish (the save path skips `require_active`); delete and account deletion cancel the Project's jobs.

   This needs no new infrastructure. It requires a single app instance (or `uvicorn --workers 1`), which is fine for a course demo.
3. **A real queue (arq/RQ + Redis, Celery).** This is extra infrastructure and is rejected by AGENTS.md.

"**Announced in the Project**": render the "Your quiz on {topic} is ready · Open" notice from finished, unseen jobs (`seen_at IS NULL`). Do not insert it into `chat_messages`, which keeps AD-15/AD-26 thread semantics clean. This is the obvious answer, unless the team wants the notice to persist in the chat transcript (see §3 C-4).

**Mock mode:** jobs run identically. Add an optional `LLM_MOCK_DELAY_MS` so tests and the grader can see progress and exercise cancel.

#### FR-27 — Account settings

**Requirement:**
- View and manage first name, email, picture, and sign-in methods.
- An email Account can edit its name.
- An Account with a password can change it without a verified email.
- Resend verification while unverified.
- Link Google once verified.
- A Google Account's name and picture follow Google and are read-only.
- Language, delete a Project, and delete the Account are reachable from Settings.

**(a) ADs affected**
- **Spine ER note (contradicts):** "`ACCOUNT` is Supabase's `auth.users`. The app adds no account table."
- **AD-1 (strains):** password change through `supabase.auth.updateUser` is a browser-to-Supabase write.

**(b) New decision:** a `profiles` table (part of AD-19).
- **Columns:** `account_id` PK FK `auth.users ON DELETE CASCADE`, `first_name`, `language`, `email_verified_at`, `notice_google_takeover`, `ui_prefs jsonb` (Sidebar and per-Project Files-panel collapse, from EXPERIENCE › Notes "Panel state"), `last_project_id`.
- **Change password:** either `supabase.auth.updateUser({password})` from `auth/` (added to AD-1's allowed list; Supabase may require reauthentication when `secure_password_change` is on **[verify]**), or a backend endpoint using the admin API. Recommended: supabase-js, with the AD-1 list amended.

**Open product nit:** may an Account that has *both* methods edit its name? The PRD memlog defers this to team/UX. **Human decision (H8, small).**

#### FR-28 — Account deletion

**Requirement:** immediate, permanent deletion of every Project, including those in Deleted projects, and all their content, after a strong confirmation. The session ends, and the email becomes free.

**(a) ADs affected:** AD-1/AD-2 (the browser can't delete a user; this needs the secret key). AD-8 (no deletion). The "no account table" note.

**(b)/(c) Decision (obvious):** `DELETE /api/me`, in this order:
1. cancel jobs
2. delete the Storage prefix `{account_id}/`
3. `auth.admin.deleteUser`, with app tables cascading through FKs to `auth.users`

Then the SPA signs out. Deleting the Supabase user frees the email **[verify]**. Reuse the FR-24 purge code.

#### FR-29 — Interface language (EN / NB)

**Requirement:**
- Every interface string, **including errors and limit messages**, exists in both languages.
- Before sign-in, the language follows the browser, with English as fallback.
- The choice is saved to the Account.
- **Generated content follows the material's main language**, not the UI language.

**(a) ADs affected:** Consistency Conventions › API shape (strains): "`{"error": {"code": …, "message": "<student-readable text>"}}`". A single server-written message can't be bilingual.

**(b) New decision:** "AD-27 i18n ownership".

**(c) Options**

1. **The SPA owns every string (recommended).**
   - The server returns stable `code` plus `params` (for example `{"limit": 50}`). `message` becomes an English developer fallback, never shown.
   - Use `react-i18next` (or a ~50-line dictionary helper with `Intl.PluralRules`; NB plural rules are simple) and JSON catalogues `en.json` / `nb.json`.
   - Before sign-in, use `localStorage` plus `navigator.language`. After sign-in, use `profiles.language` (`PATCH /api/me`).
2. **Server localizes by `Accept-Language`.** This duplicates catalogues in Python and JS. Rejected.

**Generated language:** gateway prompts say "write in the main language of the supplied material". There is no language detection step, and mock fixtures stay English. The PRD memlog lists "Ask AI language: question vs. material" as deferred, but FR-29's text now decides it (material). Obvious.

**Emails:** Supabase auth email templates are per project, not per user. They can branch on user metadata in Go templates **[verify]**. Emails are arguably not "interface". **Small human decision (H9):** bilingual emails, or English or Norwegian only.

### 1.B Changed existing FRs, limits, constraints, and non-goals

| Item (PRD now) | Spine assumption | Impact |
|---|---|---|
| **FR-1:** email verification by an emailed link **valid 24 h**, resendable, required only for Google linking. | AD-2 sets "email confirmations **off**", and verification is out of the picture. | **Contradicts AD-2.** With confirmations on, Supabase blocks password login until confirmation **[verify]**, which violates "verification not required to use the Account". With them off, everyone is auto-verified. So verification must be **app-level**. **Options:** (1) a backend-owned token table `email_verifications(token_hash, account_id, expires_at)`: the backend sends mail over SMTP (Mailpit locally at `:54325`, the same SMTP provider in the cloud) and `GET /api/auth/verify?token=` sets `profiles.email_verified_at`. Exact control of the 24 h lifetime. **Recommended.** (2) reuse Supabase's magic link (OTP) as proof of ownership: no backend SMTP, but Supabase's email OTP expiry is **one setting** shared with password recovery (max 24 h **[verify]**), and FR-3 needs 1 h, so the two collide. Option 1 avoids that. **Human-visible, but the answer is obvious once the Supabase limits are verified.** |
| **FR-2:** Google login; land on the **most recently used active** Project; after session expiry, return to the same Project. | No "last used" state. | Add `profiles.last_project_id` (or `projects.last_opened_at`) and `chats.last_opened_at` (EXPERIENCE: "opens the chat the student was last in"). This is mutable data, so the AD-8 list grows. Expiry return: the SPA keeps its intended route in `sessionStorage` across the login redirect. Obvious. |
| **FR-3:** reset link **1 h, single-use, newer invalidates older**; works whether or not verified; **only for Accounts with a password**. Google-only Accounts have none, and "adding a password to a Google account" is out of scope (§7.2). | AD-1: the SPA does reset through supabase-js. | Supabase recovery would let a Google-only user *set* a password through the reset flow, adding a password to the Google Account, which §7.2 excludes **[verify]**. **Decision:** route the reset request through the backend, `POST /api/auth/password-reset`. It answers identically whatever happens, and triggers Supabase recovery only when the user has an `email` identity. Set the Supabase recovery expiry to 3600 s. Single use and "newer replaces older" are Supabase's behaviour (one recovery token per user **[verify]**). Amend AD-1's list. Also decide whether a reset ends other sessions (PRD memlog deferred). Recommend yes, by deleting other `auth.sessions` rows, which fits FR-19's takeover handling. **Small human decision (H8).** |
| **FR-4:** auto-naming runs "only after extraction succeeds". | AD-14 is unchanged in intent. | Naming moves into the background processing job (after topics). AD-14 survives; only its trigger point changes. Obvious. |
| **FR-5:** rename "to any text"; not while archived or deleted. | AD-14 trims, rejects blank, and caps at 100 characters. | Mild strain ("any text"). Keep the trim, blank rejection, and 100-character cap as defensive limits, and add the `require_active` guard. Obvious (or confirm in passing). |
| **FR-6:** multiple files; **processing material counts toward 10**; a processing file that is then rejected frees its slot; the server enforces 10 and 50 MB. | AD-5 inserts the Material only after a successful extraction; AD-6 "A rejected file is not stored". | **Contradicts AD-5/AD-6.** **New pipeline:** (1) synchronous validation of type and ≤ 50 MB (`unsupported_file_type`, `file_too_large`); (2) store the original; (3) a transaction with `FOR UPDATE` that re-checks `count(status IN (processing, ready)) < 10` and inserts the Material `status=processing`; (4) return `202` and run the job: extract → integrity → topics → name. A rejection sets `status=rejected` with a reason and deletes the original. The row stays so the UI can show the Rejected row with Remove (EXPERIENCE › Study Material). Rejected rows don't count. Cancel (FR-20) = mark the job cancelled and delete the row and the object. |
| **FR-7:** 25 images/day **including each phone photo**; thresholds still deferred. | AD-6, AD-12. | AD-12 is unchanged: reserve per photo. AD-6 gains a batch rule: a batch is accepted when every photo is readable, accepted with a warning that names the pages when some are partial or unreadable, and rejected when all are unreadable. Unreadable photos inside an accepted batch become pages with no text. **Obvious.** AD-6 still resolves the `[NOTE FOR PM]`. The PRD §9.1 note can be closed by citing AD-6. |
| **FR-8:** resume includes the Unfinished Quiz and every chat through History. | AD-8. | Covered by FR-25/AD-28. |
| **FR-9:** indicator hidden while archived or deleted. | AD-10 `outstanding_count`. | `outstanding_count` excludes withdrawn Mistakes (FR-20). The API returns the count with the project state, and the SPA hides it. Obvious. |
| **FR-10:** scope = **Topics**; **5 / 10 / 20** questions (default 10); a scope too thin is "told and **offered the largest count it supports**"; never padded. UX: the Too-little-material note appears in *setup, before* generating, and the primary button is disabled until it fits. | AD-7 Section-id scope; AD-3 "Fewer items than requested is a valid result". | Scope: see FR-22. **New decision: capacity estimate.** **Options:** (1) a deterministic heuristic from scope size, `GET /api/projects/{id}/capacity?scope=…` → `{max_questions, max_cards}` (for example, about 1 question per N words or Section, at least 1 per Section, configurable). No LLM cost, instant. **Recommended.** (2) an LLM preflight call: accurate, but doubles latency and cost. (3) no preflight: generate, and if the model returns fewer, save what it returned and say "only {n} were possible". Cheapest code, but it differs from the UX note's position. Keep (3) as the safety net behind (1), since the model can still return fewer. **Human decision (H5)**, because it changes the UX timing if (3) is chosen alone. |
| **FR-11:** every explanation **names its source** (file · slide/page). | Deferred: "Showing answer sources in the UI: … post-V1 unless a story asks." | **Contradicts the Deferred item.** Source labels are now required everywhere (§5.1). The data already exists (AD-7 `source_section_ids` plus Section `label`), so the API joins labels into payloads. Obvious. |
| **FR-12:** a Mistake records "which Study Material it came from, with the question and explanation as shown"; recorded at answer time. | AD-10. | Store `material_ids` on the question (see FR-20). Question and explanation are immutable (AD-8), so referencing them is enough. Obvious. |
| **FR-13:** Flashcards 5/10/20, **cap 20** (was 50); scope = Topics. | AD-12: "≤ 50 flashcards". | **Contradicts the AD-12 clause.** Change to 20. The PRD memlog requires the value 50 to appear nowhere for flashcards. Obvious. |
| **FR-14:** "Not yet" **creates no Mistake**; cards return in the same set; end shows done and "needed more than one attempt"; no score. | AD-10: "`flashcards` calls it when a card is marked 'not yet known', as FR-14 already requires"; `source_type` is `quiz_question` or `flashcard`. AD-11's PracticeTarget card variant. | **Contradicts AD-10 and AD-11.** Remove the flashcard caller, the `flashcard` source_type, and the card PracticeTarget. Mistakes come from Quiz only. Obvious. |
| **FR-15:** Summarize = **one Material**, whole or one Topic; each summary section names its source. | AD-7: any Section set or the whole Project. | Scope shape as in FR-22. The `summarize` schema must return sections, each with `source_section_ids` (AD-3 schema change). Obvious. |
| **FR-16:** **several chats per Project**; scope per chat (narrowing persists for that chat); each chat persists and can be continued; 50 msgs/day across all chats. **NFR: first words ≤ 5 s, complete ≤ 15 s (streaming).** | **AD-15 (contradicts):** "Each Project has one ordered sequence of `chat_messages`". AD-3: "Each task returns a Pydantic model …, never raw text". AD-18: one request transaction. AD-13: blocking. | **New decision "AD-26 Chats and streaming."** Data: `chats(id, project_id, current_scope, created_at, last_opened_at)`; messages FK `chat_id`. Each message still stores its scope. **Streaming options:** (1) `StreamingResponse` with `text/event-stream` from FastAPI, read with `fetch` plus a ReadableStream (EventSource can't send a bearer token or POST), with events `delta` and `done{message_id, sources}` / `error{code}`. **Recommended.** (2) no streaming, with a full answer under 15 s, which fails the 5 s first-words NFR. (3) WebSocket: extra protocol and auth path. **Gateway:** add `answer_chat_stream()`, which yields text deltas. Citations go inline as `[S:<section_id>]` markers, parsed and validated at the end into `sources`. This is an explicit AD-3 exception, still the only `openai` importer. Mock mode streams the fixture in chunks. **AD-18 amendment:** for streaming, do not hold a DB connection during the stream. Reserve quota in transaction 1, stream, then insert the user and assistant messages in transaction 2; on failure, release the quota. The host must not buffer SSE (a hosting constraint). |
| **FR-17/FR-18:** quiz-only targets; ≤ 20 per round, oldest first; **removed-material Mistakes practised from the saved original question, nothing generated**; a clear decrements only after save; round-done flow; follows FR-26. | AD-11: "generates the rest in **one batched** `generate_practice` call"; AD-13 synchronous. | AD-11 survives for normal Mistakes. Add: the targets of removed-material Mistakes reuse the original question (no LLM), and the round becomes a background job (FR-26). Obvious. |
| **§5.1 Sources** apply to Ask AI and Mistake Review feedback as well. | AD-3 already requires citations. | Covered. Ensure every schema (practice, summary sections, chat) carries `source_section_ids`. |
| **§5.2 limits:** quiz 20, flashcards **20**, practice 20, chat 50/day, images 25/day (per photo), 10 materials (processing counts), 50 MB per file **and per photo**, **topics ≤ 100 per material**. | AD-12 lists 20 and 50, and leaves practice to AD-11. | Update AD-12's per-request list to 20/20/20 and add the topics ceiling. "No other daily limit exists": topic detection and naming calls are unmetered. Note the cost risk for 500-page files. |
| **§5.3 Data use** and **§9.2** (deletion must reach provider copies). | AD-3 sends `provider.data_collection: "deny"`. | Strengthen with OpenRouter's zero-data-retention routing (`provider.zdr: true` or the account-level ZDR setting **[verify]**). Then "permanent deletion reaches provider copies" holds because none are kept. Free models may not be available under ZDR, which affects the Deferred OpenRouter account strategy. **Human decision (H6)**, tied to the model and budget choice. |
| **§5.4 lifecycle** | AD-8 "insert-only… never deleted". | See FR-20/24/28. AD-8 is rewritten as "never updated; deleted only by removal tombstoning, Project purge, or Account deletion". |
| **§5.5** security list | AD-2. | Covered by AD-19 (identity) and AD-24 (phone link). The phone link reads only the Project name (but see §3 C-1). |
| **§6 non-goal changed:** "desktop web app; the only phone surface is the single-purpose upload page reached by QR code". | Spine implicitly desktop only. | One mobile-layout page in the SPA (`/u/:token`), public (no `supabase-js` session), plus `APP_PUBLIC_URL`. See FR-21. |
| **§7.2 additions:** no Flashcard resume, no profile-photo upload, no password on Google Accounts, no email change, only EN/NB, **no light theme**. | — | Constraints for AD-19 (block password-setting on Google-only Accounts; don't expose `updateUser({email})`) and the theming tokens. |
| **SM-2** (≥ 50 % start a review within 7 days) | — | Computable by SQL from `mistakes.created_at` and the review round's `created_at`. **No analytics UI** (AGENTS.md bans progress tracking). Obvious. |

---

## 2. UX decisions with architectural impact

| UX decision (EXPERIENCE/DESIGN) | Architectural impact and recommendation |
|---|---|
| **UI system: "none named"** (EXPERIENCE › Foundation); components hand-specified in DESIGN.md. | Spine Deferred: "UI design, styling approach, component library, client routing library: owned by `bmad-ux` and the first frontend story." UX chose **no library**. **Options:** (1) plain CSS with CSS custom properties generated from DESIGN.md's token frontmatter (`tokens.css`), plus CSS Modules per component. Closest to the spec, nothing to fight. **Recommended.** (2) Tailwind with the tokens mapped into the theme: fast, but a second vocabulary for the tokens. (3) Radix primitives (unstyled) only for Dialog, Menu, and Checkbox, to get the focus trap, Esc, and focus-return rules (EXPERIENCE › Modal dialog, Overflow menu) right cheaply. **Recommended in combination with (1)**: the accessibility floor is strict. **Human decision (H7).** |
| **Dark theme only; every colour a token** so light can come later; light theme out of V1 (§7.2). | Tokens as CSS variables on `:root`; no theme switcher and no `prefers-color-scheme` handling. Obvious. |
| **Inter font** with a system fallback stack. | Where it loads from: (1) bundle `@fontsource-variable/inter` through npm: offline-safe for the grader, no third-party request (fits the §5.3 privacy tone). **Recommended.** (2) Google Fonts `<link>`: a third-party request and a GDPR question in Norway. Obvious. |
| **Icons** (Files strip icon, warning icon, "···", ×) — no set named. | `lucide-react` or inline SVGs. Trivial; decide in the first frontend story. |
| **Routing:** chat as project home, activities with "← Back to chat", History "in place of the chat", Settings page, login, create account, reset screens, phone page reached by URL. | Pick **react-router** (data-router mode not required). Implied routes: `/login`, `/signup`, `/reset`, `/reset/confirm`, `/auth/callback` (OAuth), `/verify-email`, `/projects`, `/projects/:pid` (current chat), `/projects/:pid/chats/:cid`, `/projects/:pid/history`, `/projects/:pid/quiz/new` and `/projects/:pid/quizzes/:qid`, the same for flashcards and summaries, `/projects/:pid/review`, `/settings`, and the public `/u/:token`. AD-17's SPA fallback already covers deep links. Supabase redirect URLs must include `/auth/callback` and the reset route per environment (AD-2). |
| **i18n:** EN and NB (bokmål); EN \| NO toggle before sign-in; language saved to the account; dynamic counts; typed confirmation word DELETE/SLETT. | AD-27 (§1 FR-29): SPA catalogues and `code`+`params` errors. Norwegian strings still need team sign-off (PRD §9.3); this blocks FR-29 "done", not the architecture. |
| **Generation progress:** step labels ("Reading your material → Writing questions → Checking answers") with Cancel; leaving allowed; a finished generation posts "Your quiz on {topic} is ready · Open"; Mistake Review start uses the same rules. | Jobs (§1 FR-26) need a `progress_step` field the job updates (`reading`, `writing`, `checking`), so the steps reflect real state and are not a client-side animation. Announcement from unseen finished jobs. A global SPA "jobs" store polls while any job is active. |
| **Chat streaming:** "Study Buddy is thinking…" until the first words; an explicit completion signal re-enables Send and fires one screen-reader announcement. | SSE with a `done` event (§1 FR-16). |
| **Live updates:** the QR dialog, Files panel, and Files strip update without refresh while a phone link is active and while files are Reading…. | Polling of `materials` and `jobs` (§1 FR-21/FR-26). One polling hook, active only while something is pending. |
| **Phone page:** mobile layout, "Take photos" (camera) / "Choose from gallery", thumbnails with ×, countdown (minutes, then seconds), expired notice, warnings before send, "Send more" while valid. | `<input type="file" accept="image/*" capture="environment">` (works over plain HTTP on the LAN; `getUserMedia` would need HTTPS). Countdown from `expires_at` returned by the token endpoint. HEIC from iPhones is normalized server-side (AD-5, pillow-heif), so the client sends originals. The local demo needs the container reachable from the phone (`0.0.0.0` bind, `APP_PUBLIC_URL=http://<lan-ip>:port`). Generate the QR client-side (`qrcode` npm). |
| **QR dialog close ends the link.** | `DELETE /api/projects/{pid}/phone-links/{id}` on close, plus `navigator.sendBeacon` on page unload, plus the 10-minute expiry as a backstop. |
| **Files panel and Sidebar collapse state "saved to the account"** (per Project for Files). | Server-side `profiles.ui_prefs` (jsonb) through `PATCH /api/me/prefs`, not localStorage (the UX says "to the account"). Small, but it is new API surface. |
| **Returning to a Project opens the chat last in**; sign-in lands on the last Project. | `last_project_id` and `chats.last_opened_at` (§1 FR-2). |
| **Settings:** Account (edit name, Change password, Link Google / "Verify your email first" + Resend), Language, Your data (list Projects with Delete; delete account with typed DELETE). | `GET/PATCH /api/me`, `POST /api/me/verification`, `POST /api/auth/after-sign-in`, `DELETE /api/me`. Change password through supabase-js (AD-1 amendment). |
| **Sidebar groups:** active, "Archived (n)", "Deleted projects (n)" with "{n} days left"; Undo after archive (6 s). | `GET /api/projects` returns every state with `archived_at`, `deleted_at`, and `purge_at`. Undo = `POST /restore`. |
| **Topic list:** grouped by chapter or section, collapsed above about 20, Merge by multi-select, inline rename, "+ Add topic", "{n} topics", grouped-topics note at 100. | `topics.group_label` is needed: from PDF outline or bookmarks (`pypdf` outline; pdfplumber doesn't expose it easily **[verify]**), from docx/md headings, or from the `detect_topics` output. Endpoints: `PATCH /topics/{id}`, `DELETE /topics/{id}` (409 when last), `POST /materials/{mid}/topics`, `POST /materials/{mid}/topics:merge {topic_ids}`. |
| **Too-little-material note** in setup, with the primary button disabled until the count fits. | The capacity endpoint (§1 FR-10, H5). |
| **Mistake Review "Round done" vs "All cleared" panels**; "n of m cleared" progress; "Your progress is saved". | A round resource `review_rounds(id, project_id, created_at)` with practice questions, so the SPA can tell "round complete with Mistakes left" (server returns `remaining_outstanding`). |
| **Unified error pattern** ("Nothing you've made is lost." + Try again). | The stable `code` set grows: `project_read_only`, `topic_last_cannot_delete`, `topic_limit_reached`, `link_expired`, `google_link_requires_password`, `google_identity_in_use`, `email_not_verified`, `generation_cancelled`, `material_removed`, `insufficient_material`. |
| **Footer credit, wordmark, no logo.** | None. |

---

## 3. Conflicts

### 3.A PRD/UX vs. AGENTS.md policy

| # | AGENTS.md says | PRD/UX now says | Assessment / proposal |
|---|---|---|---|
| A-1 | "V1 is exactly Quiz, Flashcards, Summarize, Ask AI, Mistake Review, Saved Projects (PRD §7). Never build post-V1 items … or requirements absent from the brief and PRD unless asked." | PRD §1/§7.1 openly add Google sign-in, Settings, archive/delete, History, Topics, phone upload, bilingual UI, and account deletion. | Building them is allowed: they are now *in* the final PRD, and the policy defers to PRD §7. But the wording "exactly [six]" is now stale and will confuse agents. **Propose:** Cristoffer/Ihor update AGENTS.md to "V1 is PRD §7.1". I must not edit it. |
| A-2 | Project summary: "a desktop web app …" | PRD §6: desktop web plus one phone upload page. | No hard policy is broken (there is no "desktop only" rule line). **Propose** adding "plus a single phone upload page (FR-21)" to the AGENTS.md summary. |
| A-3 | "No application code exists yet; the stack is undecided until `bmad-architecture` runs." "TODO: app install, run, test, and mock-mode commands". | The spine is final and chose the stack. | Stale. Update after this spine update. |
| A-4 | "Pick the simplest design …; no microservices or extra infrastructure." | FR-24 (scheduled purge), FR-26 (background generation), FR-21 (live push), FR-16 (streaming) push toward queues, cron, and websockets. | **Resolvable within policy**: an in-process asyncio job runner, an in-process periodic purge, polling, and SSE on the existing FastAPI. Record this explicitly in the new ADs so nobody adds Redis or Celery. |
| A-5 | "Mock mode … so the grader can run the app and tests with no key and no paid calls." | FR-19 Google sign-in requires a Google OAuth client (free, but a credential). FR-1/FR-3/FR-19 need email delivery. | Google must be **optional and auto-hidden** when unconfigured (`google_enabled` in `/api/config`). Takeover and linking logic should be unit-testable with seeded identities. Email works locally through Mailpit (already in the spine). |
| A-6 | "Never silently edit a document marked `status: final` (brief, PRD)." | The spine itself is `status: final`. | The spine update needs explicit approval (the update run was started on `feature/architecture-update`; record the approval in the memlog). Any PRD amendments proposed here (H1, H3) need Cristoffer's or Ihor's approval. **Until then, implement the PRD as written.** |
| A-7 | "Never build … progress tracking/analytics." | SM-2 is measured; History shows "Unfinished · n of total"; flashcard end shows "needed a second try". | Not a conflict: these are artifact states, not analytics. Measure SM-2 by an ad-hoc SQL query, never a dashboard. |
| A-8 | "Sample and test documents … self-created or openly licensed." | Phone-photo, HEIC, and large-file (100-topic ceiling) tests. | Need self-made photos of the team's own notes and a generated long text file (for example, 500 pages of lorem or public-domain text) in `test-data/`. Note it for the test story. |

### 3.B PRD vs. UX (and inside the PRD)

| # | Conflict | Proposal |
|---|---|---|
| **C-1** | FR-21 and §5.5: "The only data it can read is the Project's name." But FR-21 and the UX also require the phone to **warn before sending** when the batch would exceed the daily image limit or the Project's 10 files. That needs reading the remaining image quota and slot availability. | The architecture can expose, through the token, `{project_name, images_left_today, slot_available: bool, expires_at}`: minimal, and never the file list. This is still a literal contradiction of "only … the Project's name". **Propose a PRD wording fix** ("…the Project's name and whether the batch fits the limits"). The alternative is to drop the pre-send warnings and rely on per-photo declines. **Human decision (H3).** |
| C-2 | FR-19's "does not sign in at once" for a verified Account vs. Supabase's automatic identity linking. | See H1. Not a PRD/UX conflict, but a PRD-vs-platform friction. |
| C-3 | FR-3 "applies to Accounts that have a password" + §7.2 "no adding a password to a Google account" vs. the generic Supabase reset flow, which would let a Google-only user set a password. | The backend-mediated reset request (§1.B FR-3). No PRD change. |
| C-4 | FR-26 "saved and announced in the Project" vs. UX "posts a quiet chat message … ·Open" in the thread. | Compatible. Architecture choice: render the notice from finished, unseen jobs rather than a persistent `chat_messages` row. If the team wants it to stay in the transcript, it becomes a third message role (`notice`). Obvious default: ephemeral notice plus a History entry. |
| C-5 | UX stores the panel and sidebar collapse state "to the account" (server). The PRD has no such requirement. | UI-only, harmless. Implement as `profiles.ui_prefs`, or downgrade to localStorage to save API surface. Low-stakes. |
| C-6 | PRD memlog "deferred non-blockers" vs. the final text: "Ask AI answers in the language of the question or the material" is listed as open, but FR-29 says chat answers follow the material. | Follow FR-29 (material). Obvious. |
| C-7 | FR-22 "minimum of 3" for a one-photo or one-slide Material (1 page). | Architecture: three topics may all map to the same single Section. Fine; no change. Note it for the prompt and mock. |
| C-8 | Consistency-check items (mock-level M1–M12, E-items) | Visual or copy only; no architectural impact. P1 is addressed by the amended FR-21 except for C-1 above. P3 is resolved (the PRD is now final). |

---

## 4. Decisions: human vs. obvious

### Need a human decision (Cristoffer/Ihor)

| ID | Decision | Recommendation |
|---|---|---|
| **H1** | FR-19 linking for a *verified* email Account: implement "must log in once with the password" against Supabase's automatic identity linking (manual linking plus a backend post-sign-in check), or amend the PRD to accept automatic linking. | **Amend the PRD** to accept Supabase's automatic linking for verified emails. It is equivalent security, with much less code and testing. If the team refuses, use manual linking plus the backend check. Verify Supabase's current linking behaviour first. |
| **H2** | Replace AD-13 (synchronous) with in-process background jobs (a `jobs` table, asyncio tasks, polling, cancel, restart → failed), used for generation **and** material processing. | **Yes**: the only way to meet FR-20 (cancel processing), FR-21 (live arrival), and FR-26 (leave and cancel) without extra infrastructure. Single app instance. |
| **H3** | The phone link's readable data (C-1): allow `images_left_today`/`slot_available`, or drop the pre-send warnings. | Allow them, with a one-line PRD wording amendment. |
| **H4** | The meaning of removing a Study Material (FR-20): tombstone (delete the file and the Section text, keep labels and file name), hard delete with denormalized labels, or soft-keep. | **Tombstone.** |
| **H5** | The Too-little-material check: a deterministic capacity heuristic before generating (matches the UX), an LLM preflight, or post-hoc only. | **Heuristic endpoint plus a post-hoc safety net** (save fewer items and tell the student). |
| **H6** | Data-use and deletion promise (§5.3, §9.2): require OpenRouter zero data retention, which may exclude free models and so affects the budget and the "$10 credits" strategy. | Require `data_collection: deny` **and ZDR** for live mode, and pick a cheap paid model with a spend cap. Verify OpenRouter's ZDR parameter and the models available under it. |
| **H7** | Frontend styling and components: plain CSS tokens and modules (+ Radix primitives for Dialog/Menu), or Tailwind. | **CSS variables from DESIGN.md tokens + CSS Modules + Radix primitives**, `react-router`, `react-i18next`, `@fontsource-variable/inter`, `lucide-react`, `qrcode`. |
| H8 | Small product nits the PRD memlog deferred: does a password reset end other sessions; can an Account with both methods edit its name. | Reset ends other sessions. A both-methods Account follows Google (read-only name), for consistency with FR-27. |
| H9 | Language of auth emails (verification, reset): bilingual via template branching, or a single language. | Bilingual, if Supabase templates can branch on `user_metadata.language` **[verify]**. Otherwise English plus Norwegian in one email. |
| H10 | Approve updating the `status: final` spine (and, separately, AGENTS.md wording A-1..A-3). | Approve. Keep AD-1..AD-18 ids, amend in place, add AD-19+. |

### Obvious answers (record as ADs or amendments; no debate needed)

- **AD-10/AD-11:** Mistakes from Quiz only. Drop the `flashcard` source_type and the card PracticeTarget (FR-12, FR-14, FR-18).
- **AD-12:** flashcards cap **20** (not 50), practice 20, topics ≤ 100. Image quota per photo.
- **AD-15 → AD-26:** a `chats` table, several chats per Project, current scope per chat. SSE streaming with a `done` event and inline citation markers. A streaming-specific transaction rule (amends AD-3 and AD-18).
- **AD-7 → Topic scope shapes** (`topic_ids` / `all_topics`; Summarize material ± one topic; chat material ± one). Artifacts store `topic_ids`, a label snapshot, and resolved `section_ids`.
- **AD-5:** non-paged formats chunked into ~500-word Sections; a Material row created as `processing` before extraction; rejected rows kept for display, file deleted, not counted. Phone batch = one Material, one Section per photo.
- **AD-6:** add the phone-batch rule; cite AD-6 to close PRD §9.1.
- **AD-8:** rewritten. Artifacts and answers are never updated. Mutable data now includes topics, project archive/delete state, `last_opened`/prefs, chat current scope, job status, and the Mistake `withdrawn_at`. Deletion only by removal tombstone, purge, or account deletion. One attempt per Quiz (retake on the same questions dropped; "Do it again" = new generation).
- **AD-22:** `archived_at`/`deleted_at` plus one `require_active` guard (`409 project_read_only`). Archive lets jobs finish; delete cancels them and revokes the phone link. Restore clears both.
- **Purge:** an in-process periodic task plus a read-time filter. "Delete forever" and account deletion share the purge code (Storage prefix first, then cascade). A system-context exception to AD-2's `account_id` rule, limited to purge.
- **AD-19 identity:** `profiles` table (first name, language, `email_verified_at`, takeover notice, `ui_prefs`, `last_project_id`). App-level email verification token (24 h) sent by backend SMTP, if Supabase's shared OTP expiry is confirmed. Supabase recovery expiry 1 h, requested through a backend endpoint that skips Google-only Accounts. Takeover = random password plus delete other `auth.sessions` rows plus the notice flag. `DELETE /api/me` for account deletion. Google hidden when unconfigured.
- **AD-1 amendment:** supabase-js additionally does `signInWithOAuth`, `linkIdentity`, and `updateUser({password})`. Reset requests go through the API.
- **AD-24 phone link:** a hashed token table, a second narrow auth dependency, batch create → per-photo upload → finalize, `APP_PUBLIC_URL`, client-side QR, revoke on close, archive, or delete.
- **AD-27 i18n:** the SPA owns every string. Errors are `code` + `params`. Prompts generate in the material's language.
- **Deferred → required:** show Source labels everywhere (§5.1).
- **Hosting constraints (Deferred) gain:** an unbuffered streaming response (SSE), a single app instance (in-process jobs), and a phone-reachable public URL. The ≥ 90 s request timeout is no longer needed for generation, but uploads of up to 50 MB still need generous body and time limits.
- **AD-4 mock mode gains:** `detect_topics` (deterministic, derived from length), streamed chat chunks, an optional `LLM_MOCK_DELAY_MS` to exercise progress and cancel, and per-photo extraction.
- **SM-2:** measured by SQL only; no analytics UI.
