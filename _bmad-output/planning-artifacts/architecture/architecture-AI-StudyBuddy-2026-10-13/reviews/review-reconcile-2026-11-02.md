---
title: Reconcile review — ARCHITECTURE-SPINE.md (update run) vs PRD 2026-11-02 + UX 2026-10-14
date: 2026-11-02
reviewer: reconcile lens (read-only; spine not edited)
inputs:
  - ARCHITECTURE-SPINE.md (status draft, updated 2026-11-02)
  - .memlog.md (decisions since 2026-10-27, lines 47–71)
  - prd-AI-StudyBuddy-2026-10-06/prd.md (final, 29 FRs, updated 2026-11-02)
  - ux-AI-StudyBuddy-2026-10-13/EXPERIENCE.md (final; all 21 [NOTE FOR ARCHITECTURE] rows), DESIGN.md (skimmed)
---

# Reconcile review — 2026-11-02

## Verdict

The updated spine faithfully carries every memlog decision since 2026-10-27 and maps all 29 FRs. But it leaves four gaps where a PRD guardrail can silently fail or two builders will diverge: the Google takeover and link gate are triggered by the client; a Material can get stuck in `processing`; the job runtime model (async vs. blocking, timeouts) is unspecified; and the 8-character password floor is missing from the Supabase settings. Fix those before re-finalizing.

## Coverage checks

### Capability map: FR-1..FR-29

All 29 FRs appear in the Capability → Architecture Map. Frontmatter `binds` also lists FR-1..FR-29 and SM-4.

| Row | FRs |
| --- | --- |
| Account | FR-1, 2, 3, 19, 27, 28 |
| Projects | FR-4, 5, 8, 9, 23, 24 |
| Upload | FR-6, 7, 20, 21, 22 |
| Quiz | FR-10, 11, 12 |
| Flashcards | FR-13, 14 |
| Summarize | FR-15 |
| Ask AI | FR-16 |
| Mistake Review | FR-17, 18 |
| History | FR-25, 26 |
| Language | FR-29 |

Minor: AD-20 `Binds` lists FR-5 (rename), which has nothing to do with jobs (see L9).

### Memlog decisions since 2026-10-27 → spine

| Memlog line | Decision | Landed? |
| --- | --- | --- |
| 49 | AD-1..18 ids stable, AD-13 replaced, new from AD-19 | ✓ (AD-13 and AD-15 carry REPLACED stubs) |
| 50 | In-process jobs, `generation_jobs`, cancel flag, restart → failed, one instance | ✓ AD-20, AD-17 |
| 52 | App-level verification, confirmations off | ✓ AD-2, AD-19 |
| 53 | H1(b): auto-link verified, takeover unverified, `google_enabled` | ✓ AD-19, AD-1. The enforcement point is weak (H1). |
| 54 | H3(a): phone reads `project_name`, `images_left_today`, `slot_available`, `expires_at` | ✓ AD-24 |
| 55 | H4(a): tombstone, `material_ids`, `withdrawn_at` index | ✓ AD-23, AD-10, AD-7 |
| 56 | H5(a): capacity endpoint, "only n possible" | ✓ AD-7 |
| 57 | H6(a): `zdr`, `data_collection` deny, `require_parameters`, paid model with spend cap | ✓ AD-3, Deferred |
| 58 | H7(a): tokens.css, CSS Modules, Radix, no Tailwind | ✓ AD-28 |
| 59 | npm versions 2026-11-02 | ✓ Stack table matches |
| 60 | H8: reset ends other sessions; Google name and picture read-only | ✓ AD-19. The mechanism for ending sessions is missing (M4). |
| 61 | H9: backend SMTP auth emails, `generate_link` recovery | ✓ AD-19 |
| 62 | PRD FR-19 / FR-21 / §5.5 edits approved | ✓ reflected |
| 63 | Quiz-only Mistakes, caps 20/20/20/100, multi-chat, SSE, stream txn | ✓ AD-10, AD-12, AD-25, AD-18 |
| 64 | Topics AD, scope shapes, ~500-word chunking, `generation_params` | ✓ AD-21, AD-7, AD-5. The page definition drifts (M3). |
| 65 | Material processing job, rejected handling, phone batch rule | ✓ AD-5, AD-6. The failure and cancel terminal state is missing (H2). |
| 66 | Lifecycle, `require_active`, purge task | ✓ AD-22 |
| 67 | `profiles`, reset endpoint, `DELETE /api/me`, supabase-js list | ✓ AD-19, AD-1 |
| 68 | i18n | ✓ AD-26 |
| 69 | History `UNION ALL`, one attempt per Quiz, `ended_at`, `seen_at`, `progress_step` | ✓ AD-27, AD-8, AD-20 |
| 70 | Phone link transport, `APP_PUBLIC_URL`, polling | ✓ AD-24, AD-17, AD-20 |
| 71 | Sources required; `review_rounds.remaining_outstanding`; `ui_prefs`; mock additions; hosting needs | ✓ |
| 71 | **"SM-2 measured by SQL only, no analytics UI"** | **✗ missing (L1)** |

### Over-reach

No material over-reach found. Two items go beyond the PRD text, but both are user-approved and logged:

- **H8(a):** a completed reset ends every other session.
- **AD-14:** blank-name rejection and the 100-character cap, against FR-5's "any text" (memlog 42/45).

The phone link's `images_left_today` and `expires_at` are justified by the amended FR-21 and the UX countdown and "{k} more photos" copy.

---

## Findings

Severity:

- **High:** a PRD guardrail can silently fail, or builders will diverge on a core path.
- **Medium:** a divergence or gap that needs a one-line decision.
- **Low:** a hygiene fix.

### H1 — The Google takeover and the "link only after verified" gate depend on the client (fail-open) — High

**Source:** FR-19 (takeover; "Google can be linked … by either route, only after verified"), §5.5, and the EXPERIENCE.md note "Account identity and linking": "Enforce both rules server-side".

**Spine:** AD-19 (Google), AD-1 (`linkIdentity` allowed in the browser).

**Problem:**

- **Takeover:** it runs only when the SPA calls `POST /api/auth/after-sign-in`. Supabase auto-links the Google identity during the OAuth callback. With confirmations off, Supabase treats every email as confirmed, so the link always happens. If the tab closes, the call fails, or a modified client skips it, the pre-registered attacker's password and sessions survive. That is exactly the hijack hole FR-19 closes.
- **Link gate:** `linkIdentity` is a browser → Supabase call, so the `403 email_not_verified` gate on "Settings' manual Link Google" has no backend endpoint to live on. It is unenforceable as written.

**Fix:** state the invariant inside `user_auth` (AD-2), not in an optional call.

- On every authenticated request, if the Account has a Google identity and `email_verified_at IS NULL`, run the takeover idempotently before serving. The takeover sets a random password, deletes the other `auth.sessions` rows, and sets `notice_google_takeover`. Guard it with a `profiles.google_takeover_at` marker so it runs once.
- `after-sign-in` remains only as the fast path, plus the `409 google_identity_in_use` check.
- For manual linking, the SPA calls `linkIdentity` only when `GET /api/me` reports verified. Any unverified link that slips through is converted by the same `user_auth` rule. Drop `403 email_not_verified` as a backend response, or attach it to an explicit `POST /api/me/link-google/precheck`.

### H2 — A `material_processing` job that fails, is interrupted, or is cancelled leaves the Material in `processing` forever — High

**Source:** FR-6 ("a processing file that is then rejected frees its slot"; the 10-slot cap), FR-20, FR-24 (restore returns everything "as it was"), FR-26 (a failure "loses no saved work").

**Spine:** AD-5 (Material ends only `ready` or `rejected`), AD-20 (restart → `failed` `interrupted`; Project delete → `cancelled`), AD-23.

**Problem:** no rule maps a non-success job end to a Material status. Three cases leave a permanently `processing` Material that holds a slot and blocks generation:

- a provider error in `extract_image_text` or `detect_topics`
- a process restart mid-job
- a Project deletion during processing (the Material is still `processing` after restore)

**Fix:** add to AD-5 or AD-20 that the `material_processing` terminal states are owned by `services/materials`:

| Job outcome | Material result |
| --- | --- |
| `failed` (including `interrupted`) | `status=rejected`, `reason=processing_failed`; the original is deleted; the student re-uploads, and the slot is freed |
| `cancelled` by removal | `removed_at` (already the case) |
| `cancelled` by Project delete | `rejected`, `reason=processing_cancelled`, or re-enqueued on restore (pick one) |

The restart sweep applies the same mapping.

### H3 — Job and stream runtime model unspecified: async vs. blocking I/O, LLM timeout, concurrency — High

**Source:** FR-16 NFR (first words ≤ 5 s, complete ≤ 15 s), FR-26 NFR (≤ 60 s), FR-26 cancel.

**Spine:** AD-20 ("`asyncio` task … cancels its in-flight LLM task"), AD-16 (`psycopg`, sync or async not stated), AD-3 (the `openai` client type is not stated), AD-5 (`pdfplumber` and MarkItDown are CPU-bound and blocking).

**Problem:** one builder will write sync `psycopg` + sync `OpenAI` calls inside `asyncio` tasks. That blocks the single-worker event loop (AD-17 `--workers 1`), so a PDF extraction or a 20-question generation stalls every SSE chat stream and every 2 s poll. That breaks the 5 s NFR and makes "cancel in-flight task" a no-op.

The spine also states:

- no LLM request timeout, so a hung provider call leaves a job `running` forever, and FR-26 failure never fires
- no cap on concurrent jobs: 10 sequential uploads plus generations all run at once against OpenRouter rate limits

**Fix:** one rule in AD-20/AD-3:

- The gateway uses `AsyncOpenAI` with `LLM_TIMEOUT_SECONDS`; a timeout raises `ProviderUnavailable` → `llm_unavailable`.
- DB access is either the `psycopg` async API (`AsyncConnection` pool), or sync `psycopg` called via `asyncio.to_thread`. Pick one.
- Extraction always runs via `asyncio.to_thread`.
- A `JOBS_MAX_CONCURRENT` semaphore (default ~3) bounds running jobs; extra jobs stay `queued`.

Add the new variables to `.env.example`.

### H4 — The FR-1 8-character password floor is missing from AD-2's Supabase settings — High

**Source:** FR-1 ("A password shorter than 8 characters is refused"), §5.5, Conventions › Limits ("Every PRD limit is enforced in a backend service").

**Spine:** AD-2 Supabase Auth settings list, AD-1 (sign-up and `updateUser({password})` go browser → Supabase).

**Problem:** sign-up, password change, and reset completion bypass FastAPI. The only server-side enforcement point is Supabase Auth, and `supabase/config.toml` defaults `minimum_password_length` to 6. A crafted client, or a forgotten SPA check, creates a 6-character password.

**Fix:** add "`minimum_password_length = 8`, identical in `config.toml` and Cloud" to the AD-2 settings list. Add a test that `signUp` with 7 characters fails against local Supabase. Note in Conventions › Limits that this is the one limit Supabase enforces.

### M1 — Image-quota timing: AD-6 and AD-24 contradict each other, and single-image upload is unspecified — Medium

**Source:** FR-7 ("An image past that limit is declined with a clear message"), FR-21 (per-photo decline; "if no photo goes through, no slot is used"), the EXPERIENCE.md note "Server-side limit re-check".

**Spine:**

- AD-6 says a unit is consumed "once its vision call is made".
- AD-24 reserves at the photo POST, but the vision call happens later, in the finalize job.
- AD-12 says `release` happens on provider error.
- AD-5 doesn't say when a single `.jpg` upload reserves.

**Problem:** if a single image reserves inside the job, the upload returns `202`, takes a slot, and fails later. That is not "declined". Builders also diverge on whether an unfinalized batch, a cancelled job, or a removed Material refunds quota.

**Fix:** one rule.

- Every image or photo reserves synchronously at receipt, so `429 quota_exceeded` comes before storage and before a slot.
- The unit is released only on a provider error, or if the vision call never happens: the Material is removed or cancelled before extraction, the batch expires unfinalized, or finalize is refused for lack of a slot.
- Reword AD-6 to match.

### M2 — Topic edits vs. scope resolution and "Do it again" are undefined — Medium

**Source:** FR-22 ("no content is left out of every Topic"; "Topic edits persist and apply to every later Selection Scope choice"), FR-25 ("run again … with the same count, Topics, and Study Material"), the EXPERIENCE.md "Do it again" note.

**Spine:** AD-7 (`{"all_topics": true}`; `generation_params` stores `topic_ids`, a label snapshot, and `section_ids`), AD-21 (delete and merge).

**Problem:** builders will diverge on three questions:

1. Does `all_topics` resolve via `topic_sections`? If it does, deleting a Topic silently drops its Sections from "All topics".
2. Does "Do it again" reuse the live `topic_ids`, which may now be deleted or merged, or the stored `section_ids`?
3. Is a merge across two Materials refused, and with which code?

**Fix:** add to AD-7/AD-21:

- `all_topics` resolves to every Section of every non-removed ready Material, independent of `topic_sections`.
- "Do it again" reuses the stored `section_ids` and Topic label snapshot. It is unavailable when any of those Sections' Materials is removed.
- A merge must name Topics of one Material, else `422 topic_merge_cross_material`. Add the code to the list.

### M3 — The Topic target count uses the Section count, which is not FR-22's "page" for .docx/.md — Medium

**Source:** FR-22 ("for .txt, .md, and .docx, a page is about 500 words"), the EXPERIENCE.md "Topic detection" note.

**Spine:**

- AD-5 splits .docx/.md "at headings first, then into chunks of about 500 words".
- AD-21 computes the target as `clamp(ceil(sections / 5), 3, 100)`.

**Problem:** a heading-heavy 2,000-word note with 40 short headings yields 40 Sections, so the target is 8 Topics instead of about 1. Sections double as source labels, so builders will also diverge on whether to pack small headings together.

**Fix:** for non-paged formats, compute the AD-21 page count as `ceil(words / 500)`, not the Section count. Alternatively, have AD-5 pack consecutive heading Sections until about 500 words. State which one.

### M4 — "A completed reset ends every other session" has no mechanism; the FR-3 single-use and newer-invalidates rules are unverified — Medium

**Source:** FR-3 (single use; a newer link invalidates earlier ones), memlog H8(a).

**Spine:** AD-19 ("A completed reset ends every other session"), AD-1 (reset completion and `updateUser` are browser → Supabase).

**Problem:** the backend never sees the reset complete, so it can't delete the other `auth.sessions` rows. Ending sessions from the browser would need `signOut({scope:'others'})`, which is not in AD-1's allowed list. The behaviour of `generate_link` for "newer invalidates older" sits only under `[verify generate_link at scaffold]`.

**Fix:** pick one of:

- After a successful `updateUser({password})` on the reset route, the SPA calls `POST /api/auth/after-password-reset` (`user_auth`). That call deletes every `auth.sessions` row except the caller's.
- Add `signOut({scope: 'others'})` to the AD-1 allowed list.

Also add the FR-3 cases (reuse, newer link, 1 h expiry) to the scaffold verification as tests.

### M5 — The finished-generation notice: placement, persistence, and seen rules diverge from the UX — Medium

**Source:** EXPERIENCE.md Chat message ("Your quiz on {topic} is ready · Open" appears in the thread), the EXPERIENCE.md "History" note ("Background-finished generation posts a chat message"), FR-26.

**Spine:** AD-20 Announcement ("not a chat message"; `seen_at`; `POST /api/jobs/{id}/seen`).

**Problem:** the deviation from the UX note is deliberate but unexplained. These questions are open:

- Where does the notice render: the current chat thread or a banner?
- Does it survive switching chats?
- Is a job seen when the student is still on the generating screen at completion?
- Do `material_processing` jobs announce?

**Fix:** state in AD-20:

- The notice renders at the end of whichever chat thread is open, from a `GET …/jobs?unseen=1` call.
- Only `quiz`, `flashcards`, `summary`, and `review_round` jobs announce.
- A job is marked seen when its result is opened, including automatically when the generating screen is still open, or when the notice is dismissed.
- This replaces the UX "chat message" so History stays a read model (AD-27).

### M6 — The UX still shows the superseded FR-19 verified-account flow; the spine follows the PRD silently — Medium

**Source:** PRD FR-19 (updated 2026-11-02: a verified Account "signs in … and links the Google identity at once"). EXPERIENCE.md still has the old flow in three places:

- State Patterns › Account: "Log in with your password once to link Google"
- the string table row "Google sign-in, existing verified email account"
- the Google button and Flow 6 failure path

**Spine:** AD-19 (Google, verified email Account).

**Problem:** a frontend builder following the UX (status final) will build a "log in with password once" guidance state that the backend never produces.

**Fix:** add one line to AD-19: "Per FR-19 (2026-11-02), EXPERIENCE.md's 'Log in with your password once to link Google' state and string are superseded; there is no linking message." Then route the UX amendment to Cristoffer, since the UX is final and the edit needs approval. The same applies to the UX phone note "read only the Project's name and nothing else", which the amended FR-21 supersedes.

### M7 — SM-4 citation-validation failure handling is unspecified — Medium

**Source:** §5.1 Sources, SM-4 (gating: "each names a source that contains it"), FR-11, FR-14, FR-15, FR-16, FR-18.

**Spine:** AD-7 (`source_section_ids` "validated against the scope"), AD-25 (inline `[S:id]` markers validated at the end).

**Problem:** the spine doesn't say what happens to an item or answer whose citations are all invalid or missing. Options include dropping it, retrying, or saving it with empty sources. A chat reply like "your material doesn't cover that" has no citation by nature.

**Fix:**

- **Structured items** (question, card, summary section, practice question): invalid ids are discarded. An item left with zero valid ids is dropped and counts toward "only {n} were possible"; zero items left raises `LLMOutputError`.
- **Chat:** an answer with no valid citation is stored with `sources=[]`. The prompt (AD-3) requires such an answer to state that the material doesn't cover the question.

### M8 — Sign-up bootstrap: how `first_name` reaches `profiles`, when the first verification email is sent, and the Google picture source — Medium

**Source:** FR-1 (first name; "can verify its email through an emailed link"), FR-19 and FR-27 (Google name and picture), DESIGN.md Avatar.

**Spine:** AD-19 Profiles ("created on first `user_auth` success"), Verification.

**Problem:** sign-up is browser → Supabase, so these are open:

- Does `first_name` go in `options.data` metadata, or in a follow-up `PATCH /api/me`?
- Who sends the first verification email, and when?
- `profiles` has no picture column, and the spine doesn't say where `GET /api/me` gets the Google picture.

**Fix:** state:

- `signUp` passes `options.data.first_name`.
- Profile creation copies it, and for an Account with an email identity it also issues the first verification email.
- For Google Accounts, `GET /api/me` returns `first_name` and `avatar_url` from the Google identity's `identity_data` (read-only per FR-27). No picture is stored.

### L1 — The memlog decision "SM-2 measured by SQL only, no analytics UI" did not land

**Spine:** none.

**Fix:** add it to Deferred or Conventions: "SM-2 is measured by an ad-hoc SQL query over `mistakes.created_at` and `review_rounds.created_at`; there is no analytics UI (PRD §7.2)." Make sure both columns exist.

### L2 — AD-8's "only mutable data" list is incomplete

AD-23 overwrites Section text and `tsvector`, which contradicts AD-8. The list also omits:

- `email_verifications` (consumed or invalidated)
- `study_materials` warning fields and the reject reason (set by the job)
- `generation_jobs.seen_at` and `progress_step`
- phone batch state
- `profiles.notice_google_takeover`

**Fix:** add these to the list.

### L3 — Phone batch orphans and the missing entity

AD-24 doesn't cover cleanup of batches that are never finalized: stored photos and reserved quota (see M1). It also doesn't say what happens when finalize finds no slot. The ER diagram has no `PHONE_BATCH`/photo entity.

**Fix:**

- An unfinalized batch is discarded when its link expires or is revoked: delete its photos and release its quota.
- Finalize without a slot returns `409 material_limit_reached` and discards the batch.
- Add the entity to the ER diagram.

### L4 — Restore semantics

AD-22 says "Restore clears the state". This is ambiguous for a Project that was archived and then deleted.

**Fix:** "Restore from Deleted clears both `deleted_at` and `archived_at`" (FR-24 `[ASSUMPTION]`).

### L5 — The requested count must accept any 1..20

The UX Too-little-material note offers "any number, stated exactly", and FR-10/13 offer "the largest count it supports".

**Fix:** state in AD-7/AD-12 that the count is an integer from 1 to 20, not only 5/10/20.

### L6 — Routes outside the Project path

`POST /api/jobs/{id}/cancel`, `/api/jobs/{id}/seen`, and `/api/chats/{id}/messages` contradict the Naming convention ("nested under the Project"). They also contradict AD-2's wording ("checked to belong to the URL's Project").

**Fix:** nest them under `/api/projects/{project_id}/…`, or state that the scoping for these routes is an `account_id` join.

### L7 — The ready-material precondition is not stated as a server rule

§4.2 says generation and chat need an active Project with at least one ready Study Material, but no AD says so.

**Fix:** state it as a server rule with a code. Reuse `insufficient_material` or add `no_ready_material`.

### L8 — Logout scope

supabase-js `signOut()` defaults to the `global` scope, which ends sessions on every device. FR-2 says "Logging out ends the session".

**Fix:** state the scope in AD-1. Use `local` to sign out only this device, or `global` deliberately.

### L9 — Binds and string ownership

- AD-20 `Binds` lists FR-5; drop it.
- AD-26 says "The SPA owns every interface string", but AD-19's auth emails are backend-rendered in two languages.

**Fix:** name `backend/app/mailer` templates (en/nb) as the one backend-owned string set, under the same team sign-off for Norwegian strings.

## UX `[NOTE FOR ARCHITECTURE]` disposition

| Note | Disposition |
| --- | --- |
| Account identity and linking | AD-19. The enforcement point is weak (H1); the UX copy is stale (M6). |
| Password reset | AD-19, AD-2. Verification is weak (M4). |
| Streaming chat answers | AD-25 `done` event ✓ |
| Topic detection | AD-21 ✓; the page definition drifts (M3); edits vs. scope (M2) |
| Phone upload | AD-24 ✓ (polling chosen; the amended FR-21 reads more than "name only") |
| Server-side limit re-check | AD-5, AD-24, AD-12. The quota timing is unclear (M1). |
| Per-generation caps | AD-12 ✓ |
| Chats | AD-25, AD-12 ✓ |
| Soft delete and purge job | AD-22 ✓ |
| String externalization | AD-26 ✓ (L9) |
| Content Integrity thresholds | AD-6 ✓ |
| Generation across navigation | AD-20 ✓ (H3, M5) |
| Mistake clearing | AD-10, AD-11, AD-18 ✓ |
| Partial runs | AD-8, AD-27 ✓ |
| Archived projects | AD-22, AD-20 ✓ |
| Session expiry | AD-2 + `last_project_id` ✓ |
| Theming | AD-28 tokens ✓ |
| File removal | AD-23 ✓ (H2 covers the cancel path) |
| History | AD-27 ✓; "posts a chat message" deliberately replaced (M5) |
| Panel state | `profiles.ui_prefs` ✓ (the per-Project map is implicit in jsonb) |
| "Do it again" | AD-8, AD-23 ✓ (M2) |
