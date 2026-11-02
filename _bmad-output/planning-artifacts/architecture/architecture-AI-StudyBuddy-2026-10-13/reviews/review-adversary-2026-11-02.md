---
type: architecture-review
lens: adversarial (incompatible-but-compliant unit pairs)
target: ../ARCHITECTURE-SPINE.md (status: draft, updated 2026-11-02)
context: ../../../prds/prd-AI-StudyBuddy-2026-10-06/prd.md
created: '2026-11-02'
---

# Adversarial review — unit pairs that obey every AD and still clash

**Verdict:** The spine's ownership rules are sound for the synchronous request path, but the new job model (AD-20) has no single owner for job state, Material state, or the save transaction. Several pairs of stories can each follow every AD exactly and still corrupt slots, save cancelled work, or block read-only Projects. About eight tighter rules close the serious holes. None of them needs new infrastructure.

Severity: **Critical** = data corruption or a PRD consequence broken in normal use; **High** = likely divergence between two developers/agents, user-visible bug; **Medium** = edge race or ambiguity a test will hit; **Low** = cleanup.

---

## H1 — Critical · `services/jobs` runner vs feature job handlers (quiz/flashcards/summaries/review): cancel vs save, and two owners of `generation_jobs`

**Units:** (a) jobs runner story, (b) quiz-generation story; also (c) project delete / "Delete forever" / purge task, (d) account deletion.

**Divergence:**
- AD-20 says the job "checks `cancel_requested` before each step and before saving", and AD-18 says "the job runner opens a connection per step". Developer (b) writes `check cancel → (new step) insert quiz + questions → commit`, then returns. Developer (a) then marks the job `completed` and sets `result_ref` in yet another step. Between the cancel check and the insert commit, `POST /api/jobs/{id}/cancel` or a Project delete commits `cancel_requested=true`. The quiz is saved anyway, the job then ends `completed` or `cancelled` depending on who wins, and the artifact may have no `result_ref` pointing to it. This breaks FR-26 ("cancelling stops generation") and FR-24 (delete cancels).
- Nothing says who writes `status`, `progress_step`, `result_ref`, and `error_code`. The runner and the handler both can, so both will.
- "Delete forever" and the hourly purge (AD-22), and account deletion (AD-19), cancel cooperatively and then delete immediately. A still-running handler then (i) hits a foreign-key violation or updates 0 rows, which surfaces as an unhandled exception and a `failed` log, or (ii) for `material_processing`, writes Sections or Storage objects under a prefix that was just deleted. That leaves orphaned Storage files after "permanent deletion", which contradicts §5.4.
- `jobs.cancel_for_project` is the only allowed cancel edge, but AD-23 needs to cancel *one Material's* job and AD-19 needs to cancel *all of an Account's* jobs.

**Tightening (amend AD-20 + AD-18):**
- **Only `services/jobs` writes `generation_jobs`.** Handlers are `async run(ctx) -> SavePlan`. They do the LLM work with no transaction open and return what to save. They never set status.
- **Atomic save:** in **one** transaction the runner does `SELECT … FROM generation_jobs WHERE id=$1 FOR UPDATE` and `SELECT … FROM projects WHERE id=$2 FOR SHARE`. If `cancel_requested`, or the Project row is missing or has `deleted_at` set, or (for `material_processing`) the Material's `removed_at` is set, it ends `cancelled` and saves nothing. Otherwise it calls the handler's `save(conn, plan)`, then sets `status='completed'`, `result_ref`, and `finished_at`, then commits.
- **Cancel** is `UPDATE … SET cancel_requested=true WHERE id=… AND status IN ('queued','running')`. Cancelling a job that has already completed is a no-op that returns the job's current state. The UI then shows the saved result instead of "cancelled".
- **Hard deletes wait:** `projects.purge` and Account deletion call `jobs.cancel_and_wait(project_ids, timeout)`, which awaits the in-process asyncio tasks (they are in-process, so this is possible), before deleting Storage and rows. A job whose save finds its Project row gone ends quietly as `cancelled`, not as an error.
- Allowed cancel edges become `jobs.cancel(job_id)`, `jobs.cancel_for_material(material_id)`, `jobs.cancel_for_project(project_id)`, and `jobs.cancel_for_account(account_id)`.

---

## H2 — Critical · `material_processing` job vs material removal vs the upload slot count: Material state has no owner, and the slot formula ignores `removed_at`

**Units:** (a) upload pipeline / slot check (AD-5), (b) material removal (AD-23), (c) processing job, (d) restart sweep (AD-20).

**Divergence:**
- AD-5 counts slots as `count(status IN (processing, ready)) < 10`. AD-23 frees the slot by setting `removed_at` and leaves `status` alone. Developer (a) writes the query exactly as AD-5 states it, so removed Materials **still occupy slots**. That breaks FR-20 ("slot frees immediately").
- Restart sweep and job failure (AD-20) mark only the *job* `failed` (`interrupted` / `llm_unavailable`). Nobody updates the Material, so it stays `status=processing` forever. It shows "Reading…" for good and holds a slot. AD-5's "ends with ready or rejected" covers only the happy path.
- "Connection per step" lets the job commit Sections in step N, Topics in step N+1, and `ready` in step N+2. Two things go wrong:
  - If the job is cancelled or crashes between steps, the Material is left half-built.
  - Removal blanks the Section text (AD-23) while the job is between steps. The job then inserts *new* Sections with full text, or Topics, after the tombstone. The removed student text survives, which violates AD-23's "Prevents" and §5.4.
- After removal the job may still call `projects.auto_name_if_unnamed`, so a removed file can name the Project.
- The removal transaction (AD-23, "a failed removal changes nothing") also deletes the stored original. A Storage delete is not transactional. If it runs before the DB commit and the commit fails, the Material survives but its original is gone. If removal deletes the original while the job is still reading it, the job fails with a Storage error, not `cancelled`.

**Tightening (amend AD-5 + AD-23, new rule in AD-20):**
- One repository predicate, used everywhere (upload, phone finalize, `slot_available`, the counts in the list): `occupies_slot := removed_at IS NULL AND status IN ('processing','ready')`.
- **`services/materials` owns `study_materials.status`.** The jobs runner calls a per-kind `on_terminal(conn, job, outcome)` hook. For `material_processing`, failure, interruption, or cancellation sets `status='rejected'` with `reason='processing_failed'` (or `'interrupted'`), unless `removed_at` is already set. The restart sweep calls the same hook.
- The processing job computes Sections, the integrity verdict, and Topics in memory. LLM calls run with no transaction open. It then writes **Sections + Topics + `status`/warning in one save transaction** under H1's lock, which also takes `study_materials … FOR UPDATE` and aborts if `removed_at IS NOT NULL`. Auto-naming runs only after that commit, and only if the Material is still not removed.
- Removal order: in one DB transaction, set `removed_at`, blank the Sections, and call `jobs.cancel_for_material`. Delete the original **after** commit, best effort, and log a failure. The job treats a missing original as a cancellation.

---

## H3 — High · Topic edits vs Quiz/Flashcards/Summary scope resolution: no allowed edge to a shared resolver, and resolution time is undefined

**Units:** (a) topics edit story (AD-21), (b) quiz generation, (c) flashcards generation, (d) capacity endpoint, (e) "Do it again" / job retry.

**Divergence:**
- AD-7 says "the backend resolves a scope", but the allowed call graph lists only `materials → topics`. Quiz, flashcards, summaries, chat, and review **may not call `topics`**, so each writes its own SQL from `topic_ids` to `section_ids`. The copies differ on details such as: student-added Topic with no Sections → whole Material, exclusion of removed Materials, and whether the Material must be `ready`. The capacity endpoint (d) then disagrees with what the job actually sends, so "Too little material" and "only n were possible" contradict each other.
- AD-7 doesn't say *when* resolution happens. One developer resolves in the request (stores `section_ids` in the job's `params`). Another resolves in the job's `reading` step. If a Topic is merged (new id?) or deleted between the click and the run, the second design fails with `not_found` or silently narrows the scope.
- "Do it again" (AD-8) uses the artifact's `generation_params`, while retry (AD-20) uses the job's `params`. Those are two shapes for the same setup. With `topic_ids` stored, a later merge makes the ids dangling. With `section_ids` stored, the rerun ignores Topic edits. FR-25 says "same … Topics". A merge also has no defined surviving id.

**Tightening (amend AD-7 + call graph + AD-21):**
- Add one function, `topics.resolve_scope(conn, account_id, project_id, scope) -> ResolvedScope{section_ids, topic_labels, material_ids, est_tokens}`, and add the edges `quiz, flashcards, summaries, chat, review → topics.resolve_scope`. Capacity uses the same function.
- **Resolve in the request transaction.** The job's `params` is exactly the artifact's `generation_params` (one Pydantic model per kind), and the job reads only `params.section_ids`. Topic edits never affect queued or running jobs.
- Rerun and retry use the stored `section_ids` minus removed Materials. If any cited Material is removed, rerun returns `409 material_removed` (FR-25). The Topic labels in the snapshot are what the student sees.
- A merge keeps the id of the first selected Topic (lowest `position`) and deletes the others.

---

## H4 — High · LLM gateway schemas and mock fixtures vs service-side citation validation: UUID section ids can't be in static fixtures

**Units:** (a) `llm/` gateway + fixtures (AD-3/AD-4), (b) quiz/flashcards/summary/chat services validating `source_section_ids` "against the scope" (AD-7), (c) `generate_practice` batching (AD-11).

**Divergence:**
- AD-3 says the prompt "labels each Section with its id", and AD-7 says the service validates citations against the scope. Section ids are runtime UUIDs, so **static fixtures in `llm/fixtures/` can't cite valid ids**. In mock mode every item fails validation, or the fixture author hard-codes ids that only exist after a particular seed. The grader's run then breaks on a fresh `db reset`.
- Live models also garble 36-character UUIDs. Nothing says whether an invalid citation drops the citation, drops the item, or triggers the schema retry. The gateway (schema-valid) and the service (scope-invalid) will each decide differently, and an item without sources breaks SM-4 / §5.1.
- `generate_practice` returns items keyed by `mistake_id`, which has the same UUID problem. "Fewer items than requested is valid" (AD-3) means a missing practice item for a Mistake is silent.
- Fixtures have a fixed length. Asking for 20 returns the fixture's N items, so mock mode always shows "only N were possible" and the 5/10/20 paths are untestable.

**Tightening (amend AD-3 + AD-4):**
- The gateway takes the scope's Sections (and the practice targets) as ordered input and **labels them locally** (`S1…Sn`, `T1…Tn`). It maps the labels back to UUIDs and drops any citation outside the input.
- The gateway drops items left with zero valid citations. Zero items remaining → `LLMOutputError`. Services receive only validated UUIDs and never re-validate. Chat markers use the same local labels (`[S3]`).
- Fixtures cite local labels and are **templates**: mock returns `min(requested, capacity)` items, cycling the template and citing `S((i mod n)+1)`.
- A practice item missing for a target → the round serves that Mistake's saved original Question (same path as removed material).

---

## H5 — High · Phone photo upload vs `material_processing` vs desktop image upload: two places reserve image quota, plus batch storage before the Material exists

**Units:** (a) phone photos endpoint (AD-24), (b) processing job's vision step (AD-6), (c) desktop single-image upload, (d) batch finalize.

**Divergence:**
- AD-24: a photo request is "reserving one image unit". AD-6: an image "consumes one unit … once its vision call is made". Developer (a) reserves at receipt and developer (b) reserves at the vision call, so phone photos count twice. Or (c), the desktop image, gets reserved by nobody if the reservation was moved to the phone service.
- AD-12 `release` "after a provider error" contradicts AD-6 "whatever the outcome", so a failed vision call is either refunded or not, depending on which AD the developer read.
- If a batch is never finalized (link expires, dialog closed, archive revoked the link), the photos' reserved units and stored files are never cleaned up. FR-21 also says photos past the limit are "declined individually", which only works if the reservation happens at receipt.
- AD-16's Storage path is `{account}/{project}/{material_id}/…`, but phone photos arrive before the Material exists, and no `phone_batches` table is defined. Each developer will invent a different staging location. Finalize after the link expires is also undefined ("an expired link cannot send").

**Tightening (amend AD-6, AD-12, AD-24):**
- **Reserve at receipt** for every image (desktop image upload and each phone photo), in the request. The job never reserves.
- Release only when the gateway raises `ProviderRateLimited`/`ProviderUnavailable` for that image. A schema or legibility outcome is not refunded. `reserve` returns the `usage_day`, and `release(kind, usage_day)` decrements that same day.
- Add `phone_batches(id, link_id, project_id, account_id, material_id NULL, finalized_at)` and `phone_batch_photos(batch_id, position, storage_path)`. Photos are stored under `{account}/{project}/batches/{batch_id}/…`. Finalize creates the Material and points it at the batch's paths (no copy).
- Finalize is allowed within `PHONE_LINK_TTL_SECONDS + 120 s` of the link's creation, even after a dialog-close revoke, but never after archive or delete. Unfinalized batches older than 1 h are deleted by the hourly lifespan task (AD-22). Their units are **not** refunded, because the photos were accepted. This last point is a `[NOTE FOR PM]` if refunds are wanted.

---

## H6 — High · `projects.require_active` guard + its route test vs bookkeeping writes and archived-job saves

**Units:** (a) AD-22 guard and the test "every mutating route calls it", (b) jobs `seen`/`cancel` endpoints, (c) chat open (`last_opened_at`), (d) flashcard `ended_at`, (e) phone-link revoke on dialog close, (f) quiz/summary/review job save in an archived Project, (g) auto-name and Topic detection inside `material_processing`.

**Divergence:**
- The test forces every mutating route through `require_active`. In an archived or deleted Project that means:
  - the "… is ready · Open" notice can't be dismissed (`POST /jobs/{id}/seen` → 409)
  - a running generation can't be cancelled
  - opening a chat to *read* it fails because it writes `last_opened_at`
  - a Flashcard Set can't be marked ended
  - the dialog-close `sendBeacon` revoke fails noisily

  FR-23 says these Projects stay readable.
- AD-20 says "the save path skips `require_active`", but AD-22 says "every *mutating service*" calls it. Developer (f) puts the guard in `quiz.save_generated` as AD-22 instructs, so archived generation fails, which breaks FR-23 and FR-26.
- For (g), it's unclear whether a `material_processing` job in an archived Project may write Topics and auto-name (Topic edits and rename "require active"). One developer guards and one doesn't.

**Tightening (amend AD-22):**
- Split writes into **content mutations** (guarded) and **bookkeeping writes** (unguarded, but still account-scoped):
  - job `seen_at` and `cancel_requested`
  - chat `last_opened_at`
  - flashcard `ended_at`
  - phone-link `revoked_at`
  - `profiles.*`

  The route test carries an explicit allowlist of the bookkeeping routes.
- Job `save(conn, plan)` functions never call `require_active`. H1's save lock checks `deleted_at IS NULL` instead. Archived Projects accept job saves of every kind, including `material_processing` Topics and auto-naming.
- `require_active` is called only from request-facing service functions.

---

## H7 — Medium · SPA job poll vs phone arrivals vs Material/artifact refresh: the poll stops exactly when the computer needs it

**Units:** (a) `api/client.js` polling hook (AD-20), (b) phone dialog (AD-24), (c) Materials list "Reading…" state, (d) announcement notice.

**Divergence:**
- AD-20: polling "stops when none are active". AD-24: the computer "shows new material through the AD-20 poll while the dialog is open". While photos are arriving and before finalize, there is **no job**, so the poll is stopped and the finalize-created job is never seen (FR-21: "appears … without a manual refresh").
- `?active=1` drops a job as soon as it completes. A poller that sees the job disappear doesn't learn whether it ended `ready`, `rejected`, `failed`, or `cancelled`. One developer refetches Materials, another doesn't.
- The notice needs *finished, unseen* jobs, which `active=1` never returns.
- Two tabs, or a job started by the phone or another tab, never start the poll in a tab that is idle.
- It's undefined whether `material_processing` and cancelled jobs produce the "is ready" notice.

**Tightening (amend AD-20 + AD-24):**
- `GET /api/projects/{id}/jobs` returns jobs that are active, plus jobs that are finished with `seen_at IS NULL`, each with `kind`, `status`, `result_ref`, and `error_code`.
- The SPA polls every 2 s while any job is active **or** the phone dialog is open. Otherwise it fetches the jobs list once whenever the Project view gains focus.
- On any transition to a terminal state, the hook invalidates the resource named by `kind`/`result_ref` (the Materials list, History).
- Only `completed` jobs of kind quiz/flashcards/summary/review_round render the notice. `material_processing` and `cancelled` jobs are created with `seen_at = finished_at`.

---

## H8 — Medium · Chat streaming vs usage quotas vs History/chat ordering: messages have no id/order, and disconnect/archive mid-stream are undefined

**Units:** (a) chat stream (AD-25/AD-18), (b) `services/usage` (AD-12), (c) chat reopen / History (AD-27), (d) archive in another tab.

**Divergence:**
- `chat_messages(chat_id, role, scope, text, source_section_ids)` has **no `id`** (yet `done` returns `message_id`) and **no ordering column**. The user and assistant rows are inserted in the same transaction, so `created_at DEFAULT now()` gives both rows *the same timestamp*. Replay order and prior-turn context then come out in arbitrary order.
- Two sends in the same chat (two tabs, or a double Enter) interleave.
- If the client disconnects mid-stream there is no `error` event. Developer (a) leaves the quota consumed and stores nothing. Developer (b) expects `release` only on a provider error. The PRD-visible effect is that the student loses a message *and* a unit.
- If the Project is archived while the stream runs, transaction 2 either calls `require_active` (and drops an answer the student just read) or doesn't (and writes into an archived Project).
- History's keyset on `created_at` alone, across a `UNION ALL` of four tables, skips or duplicates rows on equal timestamps. Ordering chats by `created_at` disagrees with "the SPA opens the chat last used" (`last_opened_at`).

**Tightening (amend AD-25 + AD-27):**
- `chat_messages(id uuid, chat_id, seq int, role, scope, text, source_section_ids, created_at)` with `UNIQUE(chat_id, seq)`. Transaction 2 takes `chats … FOR UPDATE`, sets `seq = max+1` for the user message and `max+2` for the assistant message, and does not re-check `require_active` (the answer was already shown).
- The server allows one stream in flight per chat and rejects a second with `409 chat_busy` (add the code).
- On client disconnect, the server aborts the provider call, releases the quota, and stores nothing.
- History keyset is `(created_at, id)`. A chat's History time is its `created_at` (stated explicitly).

---

## Further holes (not in the top 8)

| # | Sev | Units | Divergence | Tightening |
| --- | --- | --- | --- | --- |
| F1 | High | Frontend password-reset completion (supabase-js `updateUser`, AD-1) vs `services/identity` | AD-19: "a completed reset ends every other session", but the reset completes in the browser and no API call is specified, so nobody deletes the `auth.sessions` rows. | Add `POST /api/auth/after-password-reset`, called after `updateUser` on the recovery route. It deletes `auth.sessions WHERE user_id=… AND id <> current session_id`. Say explicitly whether a Settings password change does the same. |
| F2 | Medium | `user_auth` first-login profile creation vs the SPA's parallel startup calls | "Created on first `user_auth` success": `/api/me`, `/api/projects`, and the jobs poll fire together, so two INSERTs race and one returns 500. | `INSERT … ON CONFLICT (account_id) DO NOTHING`, in its own short transaction before the request transaction. |
| F3 | Medium | Review round job vs double-click / second round vs reuse of unanswered Practice Questions | AD-11 "Prevents duplicate practice from double clicks" has no mechanism. "Reuses still-unanswered Practice Questions" contradicts the ER shape, where each Practice Question belongs to exactly one round. | Partial unique index: one `queued/running` `review_round` job per Project (a second start returns the existing `job_id`). Add `review_round_items(round_id, practice_question_id, position)`, so a reused Practice Question appears in a new round without moving. `mistakes.clear` on a withdrawn Mistake is a no-op. |
| F4 | Medium | Flashcard `ended_at` (AD-27) vs History status vs tab close | "When the student leaves" needs an endpoint, and a closed tab never calls it, so the set looks resumable or "in progress" forever. "When the next set opens" doesn't say whether that means in this Project or anywhere. | Status is derived in one SQL expression in `db/flashcards`. A set is ended if `ended_at IS NOT NULL`, **or** a later set in the same Project has been opened, **or** the set has been idle more than 1 h. Leaving sends `sendBeacon` to `POST …/flashcard-sets/{id}/end` (a bookkeeping route, see H6). |
| F5 | Medium | Account deletion (AD-19) vs `projects.purge` (AD-22) | AD-22 says account deletion calls `purge`, while AD-19 deletes the `{account_id}/` prefix and relies on the cascade. That is two deletion paths, and neither waits for jobs (H1). If `delete_user` fails after the Storage delete, the Account is left with no files. | One path: `jobs.cancel_and_wait(account)` → `auth.admin.delete_user` (cascade) → delete the Storage prefix after that, best effort with logging. Remove "account deletion calls purge" from AD-22. |
| F6 | Low | Upload step 2 (store original) vs step 3 (slot check fails) | The original is stored under a `material_id` that never gets a row, which leaves an orphan whenever `material_limit_reached` fires. | The service generates the UUID first, and on a failed insert deletes the object. Or check the slot before storing *and* again under the lock. |
| F7 | Low | `projects.auto_name_if_unnamed` vs a concurrent student rename | Read-then-write implementations will overwrite a rename made during the naming LLM call. | It must be one conditional `UPDATE … WHERE name_source IS NULL`, issued after the LLM call. State this in AD-14. |
| F8 | Low | `usage.reserve` returning HTTP `429` (AD-12) vs the layering rule (services have no HTTP) | One developer raises an `HTTPException` inside the service, another raises a domain error. | Services raise `QuotaExceeded(limit)`, and the API maps domain errors to the envelope. State this once for every service error. |

## Suggested AD changes (summary)

1. **AD-20 (amend):** `services/jobs` is the sole writer of `generation_jobs`. Handlers return a save plan, and the runner commits plan + status in one locked save transaction. Cancel is conditional on the current status. Add `cancel_for_material`/`cancel_for_account`/`cancel_and_wait`. Add per-kind `on_terminal` hooks, also called by the restart sweep. Define what the poll returns and when the SPA polls.
2. **AD-5 / AD-23 (amend):** one `occupies_slot` predicate. `services/materials` owns Material status, including failure and interruption. The processing job saves in one transaction under the Material lock. Delete Storage only after the DB commit.
3. **AD-7 / call graph (amend):** `topics.resolve_scope` is shared, called in the request, and frozen into `params == generation_params`. State how rerun and retry use it. State which Topic id survives a merge.
4. **AD-3 / AD-4 (amend):** the gateway uses local labels for Sections and practice targets and does all citation validation. Fixtures are templates that cite local labels.
5. **AD-6 / AD-12 / AD-24 (amend):** image quota is reserved once, at receipt. `release` applies only on a provider error, against the reserved day. Add batch tables, staging paths, a finalize window, and cleanup.
6. **AD-22 (amend):** separate content mutations from bookkeeping writes (with the route-test allowlist). Job saves are never guarded by `require_active`, only by the deleted/cancelled lock.
7. **AD-25 / AD-27 (amend):** message `id`/`seq`, one stream per chat, disconnect semantics, `(created_at, id)` keyset.
8. **AD-19 (amend):** add a post-reset session-ending endpoint, idempotent profile creation, and one Account-deletion path.
