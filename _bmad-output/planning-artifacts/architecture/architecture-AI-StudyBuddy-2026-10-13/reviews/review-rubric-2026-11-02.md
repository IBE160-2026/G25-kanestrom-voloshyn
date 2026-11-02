---
type: review
lens: rubric walker (independent)
target: ARCHITECTURE-SPINE.md (updated 2026-11-02, AD-1..AD-28)
date: 2026-11-02
inputs: ARCHITECTURE-SPINE.md, .memlog.md, AGENTS.md, prd.md (FR-1..FR-29, §5.2)
---

# Rubric review: Architecture Spine, 2026-11-02 update

## Verdict

The spine is solid and close to build-ready. Every FR has a home, the operations story is mostly decided, and AGENTS.md policy is respected. It is **not ready to mark `final`** yet: three cross-module seams are unowned (shared scope resolution, phone→materials, projects→phone), the AD-2 "only exception" and the AD-8 "only mutable data" lists are both incomplete, and the job and quota rules leave four races or leaks that two developers would each resolve differently.

Severity: **H** means two units will diverge or data will be corrupted or leaked. **M** means likely rework or an FR consequence left unenforced. **L** means hygiene.

## Findings

### H1: Shared scope resolution has no owner, and features may not call one (AD-7, service-call list)
- AD-7 says "the backend resolves a scope to Section ids plus Topic labels", but it doesn't say which module does it. The allowed service-to-service calls permit only `materials → topics`.
- As written, `quiz`, `flashcards`, `summaries`, `chat` and `review` may not call a shared resolver. Each would write its own resolver, which is exactly the divergence AD-7 exists to prevent. The same applies to the budget check and to `capacity`.
- **Fix:** name one owner, either `topics.resolve_scope(conn, account_id, project_id, scope) -> ResolvedScope{section_ids, topic_labels, material_ids, est_tokens}` or a `services/scope` module. Add "any generating service → `topics.resolve_scope`" to the call list. Capacity and the `scope_too_large` check use only this function.

### H2: Two required service-to-service calls are missing from the allowed list (Design Paradigm, AD-22, AD-24, AD-20)
- **`phone` → `materials`:** finalize "takes the slot under AD-5's `FOR UPDATE` lock and enqueues `material_processing`". The slot logic lives in `materials`, so `phone` must either duplicate it or make an unlisted call.
- **`projects` → `phone`:** archive and delete revoke phone links, but `phone_upload_links` belongs to `phone`.
- **`jobs` → feature services:** the runner dispatching to `quiz`, `flashcards`, `summaries`, `review` and `materials` appears only in the mermaid diagram (`JOBS --> SVC`), not in the rule list.
- **Fix:** add these three lines to the list:
  - `phone → materials.create_from_batch`, which reuses the AD-5 slot transaction
  - `projects → phone.revoke_for_project`
  - `jobs → <feature>.run_job(kind)` through a registry keyed by `kind`

  Also state that the `jobs` runner is the only caller of the job bodies.

### H3: A restart or crash leaks a Material slot permanently (AD-20 Restart, AD-5)
- The restart sweep marks `queued`/`running` jobs `failed (interrupted)`. It never touches `study_materials.status`.
- An interrupted `material_processing` job therefore leaves its Material in `processing` forever. That Material counts toward the 10 (AD-5 step 3) and shows "Reading…" indefinitely.
- The same problem hits a job that ends `failed` or `cancelled` for any other reason, unless the job body handles it.
- **Fix:** add to AD-20: "When a `material_processing` job ends `failed` or `cancelled`, or is swept at startup, it sets its Material to `rejected` with reason `interrupted` or `processing_failed` in the same transaction. Cancel-by-removal leaves the tombstone." Also say whether any reserved image units are released (see H4).

### H4: The image quota is reserved in three different places (AD-6, AD-12, AD-24, AD-18)
- **AD-6:** a unit is consumed "once its vision call is made, whatever the outcome", which implies the reservation happens in the job.
- **AD-24:** a phone photo reserves its unit at upload, in the request.
- **AD-12:** `release` happens after a provider error.
- Nothing says where a single computer-uploaded image reserves its unit. If the reservation is in the job, FR-7 ("an image past that limit is declined with a clear message") becomes a late, asynchronous rejection instead of a refusal on upload.
- Release is also undefined for a cancelled job, an interrupted job, an abandoned phone batch, and a removed processing file.
- **Fix:** one rule in AD-12:
  1. Image units are reserved in the upload request: the single-image upload, or the per-photo POST.
  2. A failure returns `429 quota_exceeded` synchronously.
  3. The unit is released only on a gateway provider error (`ProviderRateLimited`/`ProviderUnavailable`/`LLMOutputError`) or on an interrupted or cancelled job before the vision call.
  4. Unreadable photos and abandoned batches keep their units.
- Then make AD-6's last bullet refer to that rule.

### H5: The AD-2 "only exception" is false (AD-2, AD-20, AD-22, AD-24, AD-19)
- Several system-context paths run unscoped by a request's `account_id`, beyond the purge:
  - the restart sweep, which updates every job
  - the job runner, which loads a job by id
  - `phone_link_auth`, which looks up a project by token hash
  - `GET /api/auth/verify?token=`, which looks up a token hash without a bearer token
  - the password-reset email lookup
- `projects.purge(conn, project_id)` also takes no `account_id`, even though "Delete forever" calls it from a request.
- **Fix:** rewrite the exception as a closed list:
  1. `projects.purge_expired(conn)`, which is the only unscoped delete
  2. the `jobs` startup sweep
  3. lookups by token hash (phone link, verification), which then scope everything else by the row's `account_id`
  4. the job runner, which scopes by the job row's `account_id`
- Change the signature to `projects.purge(conn, account_id, project_id)` for request paths.

### H6: The job save path has a race against cancel and delete, and the per-step connection rule is ambiguous (AD-18, AD-20)
- "Checks [cancel] before each step and before saving" is a check-then-act sequence. A cancel or Project delete that lands between the check and the commit still saves.
- "Opens a connection per step" doesn't say that the connection is closed before the step's LLM call. Read literally, it holds a connection, and possibly an open transaction, across a 60-second model call. That contradicts AD-18's last bullet.
- **Fix:** amend AD-18 with these rules for jobs:
  - Each step runs read transaction → commit or close → LLM call with no connection → save transaction.
  - The save transaction starts with `SELECT … FROM generation_jobs WHERE id=$1 FOR UPDATE`.
  - It aborts as `cancelled` if `cancel_requested`.
  - It inserts the artifact and sets `status='completed'`, `result_ref`, all in that one transaction.
  - `progress_step` updates are their own short transactions.

### H7: Sync vs async execution is undecided (AD-18, AD-20, Stack)
- The spine fixes `asyncio` tasks for jobs and SSE streaming, but it never says whether services, repositories and `psycopg` are sync or async.
- `pdfplumber`, MarkItDown and `pillow-heif` are CPU-bound and blocking. Run directly in an `asyncio` task, they freeze every request, including the 2-second polls and live SSE streams, on the single instance (AD-17).
- Two developers will pick different styles, and the `conn` passed around will be of different types.
- **Fix:** add a rule. For example:
  - Services and repositories are synchronous and use `psycopg` sync connections from one `psycopg_pool.ConnectionPool`.
  - Request handlers are plain `def`, so they run in the threadpool.
  - The job runner executes each job body with `asyncio.to_thread`. Cancel is cooperative through `cancel_requested`, not by cancelling the task.
  - Only the SSE endpoint is `async` and iterates the gateway stream.
  - Alternatively, decide the opposite, all async with `AsyncConnection`, but decide one.
- Note that `psycopg_pool` is a sub-package. Name it in the Stack table.

### M1: The AD-8 "only mutable data" and "deletion only through" lists contradict other ADs
- **Mutated elsewhere but missing from the list:**
  - Section `text` and `tsvector`, emptied on removal (AD-23)
  - Material warning flag, named pages and rejection reason (AD-6, AD-5)
  - `generation_jobs` `progress_step`, `cancel_requested`, `result_ref`, `error_code`, `finished_at` and `seen_at` (AD-20), which "job status" undersells
  - `email_verifications`, which resend invalidates (AD-19)
  - `review_rounds` state, if any
  - `topic_sections` (AD-21 merge)
- **Deleted outside the three listed paths:**
  - Topic delete and merge (AD-21)
  - phone links and their abandoned batches (AD-24)
  - verification tokens
  - the Storage original of a rejected Material (AD-5)
- **Unspecified:** "Do it again" from `generation_params.topic_ids` after one of those Topics was deleted or merged. AD-7 snapshots the labels but never says what a re-run does with them.
- **Fix:**
  - Rewrite the mutable list as "mutable columns per table", including the items above.
  - Change the deletion list to "artifact and answer rows are deleted only through: AD-22 purge, AD-19 Account deletion. Topics, tokens, links and batches follow their own AD."
  - Add to AD-7 or AD-21: "Do it again re-runs the stored `section_ids`; it is unavailable if any of its Materials is removed. Topic edits never invalidate an artifact." Alternatively, choose to re-resolve the surviving `topic_ids` and say so.

### M2: The synchronous vs job boundary of a generation request is unstated (AD-7, AD-20)
- AD-7 returns `422 scope_too_large`, and AD-22 returns `409 project_read_only`. Neither can come from a job that has already returned `202`.
- **Fix:** add to AD-20 "Starting a job": "The request synchronously runs `require_active`, validates and resolves the scope, runs the budget check, and reserves quota where AD-12 applies. It stores the resolved `section_ids` in `params`. The job never re-resolves the scope."

### M3: Identity mechanics that FR-1, FR-3 and FR-27 need have no owner (AD-1, AD-2, AD-19)
- **FR-1, password length:** "a password shorter than 8 characters is refused". `minimum_password_length = 8` is missing from AD-2's Supabase settings.
- **FR-1, verification email:** sign-up happens in `supabase-js` (AD-1), so nothing triggers the email. The spine names no endpoint (such as `POST /api/auth/after-sign-up`) that creates the profile from user metadata (`first_name`, language) and sends the verification mail. `after-sign-in` is defined only for OAuth callbacks.
- **FR-3, ending other sessions:** "A completed reset ends every other session" names no mechanism. The reset completes in `supabase-js`, so the backend never sees it.
- **Fix:**
  - Add `minimum_password_length = 8` to AD-2's settings.
  - Have the SPA call `POST /api/auth/after-sign-in` after every sign-in and sign-up, not only OAuth, so it creates the profile and sends the first verification email.
  - Either add `supabase.auth.signOut({scope: 'others'})` after `updateUser({password})` to AD-1's allowed list, or add a `POST /api/auth/after-password-reset` that deletes the other `auth.sessions` rows. Pick one.

### M4: The AD-11 double-click guard has no mechanism
- "Prevents duplicate practice from double clicks", but the Rule enforces nothing. Two concurrent `review_round` jobs would pick the same oldest 20 Mistakes and generate duplicate Practice Questions.
- **Fix:** "At most one `queued`/`running` `review_round` job per Project. This is a partial unique index on `generation_jobs(project_id) WHERE kind='review_round' AND status IN ('queued','running')`. A second start returns the existing `job_id`."

### M5: The phone batch has no data home (AD-24, ER diagram)
- Photos are POSTed to `/batches/{id}/photos` before finalize, but no `phone_batches` table or Storage path is defined, and the ER diagram has no batch entity.
- Cleanup of a batch that is never finalized is undefined. Its Storage objects are orphaned, and its reserved units are left in an unclear state.
- **Fix:** add `phone_batches(id, link_id, project_id, account_id, created_at, finalized_at)` and `phone_batch_photos(batch_id, position, storage_path, status)`, with a Storage path under `{account_id}/{project_id}/batches/{batch_id}/…`. Have the hourly AD-22 task also delete un-finalized batches older than the link TTL. Add both tables to the ER diagram.

### M6: Grader run details: Supabase keys, Linux host access, Cloud config (Consistency Conventions, AD-16, AD-17, Deferred)
- AGENTS.md says `.env.example` holds names "without a value", but the grader needs the local publishable and secret keys and the DB URL. The spine never says where they come from (`npx supabase status`).
- `host.docker.internal` doesn't resolve on Linux Docker without `extra_hosts: ["host.docker.internal:host-gateway"]`.
- Deferred "Mirror AD-2's auth settings in the dashboard" brings back exactly the dashboard drift that AD-16 forbids for the schema.
- **Fix:**
  - In "Local run", add a step: "copy `API URL`, `DB URL`, and the publishable and secret keys from `npx supabase status` into `.env`." Alternatively, document that the CLI's fixed local defaults may be pre-filled as non-secret values and get explicit approval for that exception to the AGENTS.md rule.
  - Add the `extra_hosts` line to `docker-compose.yml` in the seed.
  - Replace "mirror in dashboard" with "`npx supabase config push` from `main`", if the pinned CLI supports it at scaffold.

### L1: Rationale and wording hygiene (rubric item 7)
- **Rationale inside Rules:**
  - AD-2: "because with them on, unverified users can't log in"
  - AD-7: "This is consistent with the PRD."
  - AD-25: "because EventSource can't send the bearer token"
  - AD-17: "because jobs are in-process"

  Move these to `.memlog.md` or cut them.
- **Errors in bindings and status:**
  - AD-20 binds **FR-5** (rename), which has no job. It should be FR-4 (auto-name runs in `material_processing`).
  - `status: draft` should become `final` only after these fixes and approval. AGENTS.md treats the spine as final.
- **Missing details:**
  - AD-27 keyset pagination by `created_at` alone can skip rows that share a timestamp. Use `(created_at, id)`.
  - `chat_messages` has no `created_at` or `id` in its column list, so ordering is undefined.
  - AD-3 maps no gateway timeout and no 5xx. Map both to `ProviderUnavailable`, with a `LLM_TIMEOUT_SECONDS` setting so the 60-second FR-26 target is bounded.
  - AD-25 doesn't say what happens when the client disconnects mid-stream. Treat it as a failure: store nothing and release the quota.
- **Leftovers:** `companions: []` and the `[verify generate_link at scaffold]` marker are acceptable open-item markers, not template leftovers.
- **Mermaid:** all three diagrams parse (graph TD, flowchart LR, erDiagram). Apart from M5, the ER diagram is consistent with the ADs.

## Rubric walk

| # | Criterion | Result |
| --- | --- | --- |
| 1 | Fixes the real divergence points, misses none | Mostly. Misses scope-resolver ownership (H1), three cross-service seams (H2), sync/async (H7), and the request/job boundary (M2). |
| 2 | Every AD Rule enforceable and prevents its stated divergence | Mostly. AD-11's double-click Prevents has no Rule (M4). AD-20 cancel is check-then-act (H6). AD-8's lists are not closed (M1). AD-2's exception is not closed (H5). |
| 3 | Nothing Deferred lets units diverge | Pass, except the "mirror in dashboard" item (M6). Model IDs and budget are config values. CI is deferred safely. |
| 4 | Tech plausibly current | Pass. Versions were registry-verified on 2026-11-02 per the memlog. `app.frontend` is per the memlog's docs check. Add `psycopg_pool` (H7). |
| 5 | Covers FR-1..FR-29 | All 29 are bound and mapped. The unenforced consequences are FR-1 (password length 8, verification trigger), FR-3 (end other sessions; M3), FR-7 (synchronous image-limit decline; H4), FR-6 (slot freed on processing failure; H3), and FR-25 ("Do it again" after Topic edits; M1). |
| 6 | Every dimension decided, deferred or open; operations | Decided: deployment shape, environments (`APP_ENV`), secrets, migrations (CLI, `db push` from `main`), grader run, single instance, purge task, job restart sweep. Gaps: Material status on restart (H3), local key provisioning and Linux host access (M6), abandoned-batch cleanup (M5). |
| 7 | Decisions not rationale, terse, valid mermaid, stable ids, no leftovers | AD-13 and AD-15 are kept as REPLACED stubs, with no reuse and no renumbering. Mermaid is valid. There is minor rationale creep and a wrong binding (L1). |
| 8 | Respects AGENTS.md | Pass. Only `llm/` imports `openai` (test-asserted). Mock mode needs no key and fails closed in production. No queue, worker or Redis. Migrations are the only schema path. `mistakes` and `usage` are sole owners. Services never commit. The one tension is `.env.example` values vs the grader's local keys (M6). |

## Internal-consistency checks requested

- **AD-8 mutable list vs other ADs:** inconsistent with AD-5, AD-6, AD-20, AD-21, AD-23 and AD-24. See M1.
- **AD-18 vs AD-20 and AD-25:** the stream rule (reserve → stream with no connection → insert) is consistent. The job rule is under-specified about connection release and has a cancel race. See H6.
- **AD-2 exception vs AD-22:** AD-22 calls the purge "the system-context exception in AD-2", which is consistent on its face. But AD-20's sweep and runner, AD-24's token lookup, and AD-19's verify endpoint are further exceptions, and `purge(conn, project_id)` is unscoped on request paths. See H5.
- **AD-19 vs AD-22, Account deletion:** AD-22 says account deletion "calls" `projects.purge`. AD-19 instead deletes the `{account_id}/` prefix and relies on cascade, and the call list allows `identity → projects.purge`. Pick one. AD-19's single-prefix delete is simpler; if you keep it, drop the reuse claim from AD-22 and the `identity → projects.purge` line.
- **AD-6 vs AD-12 vs AD-24, quota timing:** inconsistent. See H4.
- **AD-7 vs AD-20, where validation happens:** unstated. See M2.
