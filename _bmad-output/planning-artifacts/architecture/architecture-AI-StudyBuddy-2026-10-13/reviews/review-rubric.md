---
title: Rubric review — ARCHITECTURE-SPINE.md (AI Study Buddy V1)
reviewed: ARCHITECTURE-SPINE.md (status: draft, 2026-10-13)
reviewer: independent rubric review
date: 2026-10-13
---

# Rubric review — Architecture Spine, AI Study Buddy V1

## Verdict

The spine is strong. It fixes nearly all the real divergence points for a two-person team, and it follows AGENTS.md policy closely. One latent defect would break the "same image local and cloud" promise. The Mistake uniqueness rule contradicts FR-18 history retention. The operational envelope has gaps around cloud migrations, Supabase auth config parity, and bucket setup. Fix the six findings below before epics/stories. None of them requires reshaping the architecture.

## Scorecard

| # | Criterion | Result | Notes |
| --- | --- | --- | --- |
| 1 | Fixes real divergence points, misses none | Mostly | Strong coverage (data path, auth, LLM gateway, sections/scope, mistakes ownership, quotas, sync model, error envelope). Gaps: Mistake uniqueness vs. history (F2), upload request granularity (F4), FTS config, which service-to-service calls are allowed. |
| 2 | Every Rule enforceable and prevents its divergence | Mostly | AD-10's unique key as written blocks re-recording after a clear (F2). AD-13's step order contradicts AD-6 (F4). AD-6's "page contains readable text" is not measurable (F5). |
| 3 | Nothing Deferred lets units diverge | Mostly | Hosting deferral is missing its constraints (timeout ≥ 90 s, Docker, runtime config) (F1, F4). Frontend test runner/CI deferral is low risk. |
| 4 | Tech plausibly current | Yes | Versions are consistent with the memlog's 2026-10-13 verification. Supabase CLI is unpinned ("latest via npx"), and "Docker Desktop current" is vague (F3). MarkItDown's PDF page boundaries are unverified (F5). |
| 5 | Covers FR-1..FR-18 | Yes, with caveats | Every FR is mapped. FR-1's duplicate-email error and FR-3's reset link depend on Supabase auth settings that the spine doesn't pin (F3). §5.1 needs three outcomes for every format, but .docx/.txt/.md have no warn tier (F5). |
| 6 | Operational envelope decided/deferred/open | Partial | Local run, secrets, and config are decided. Missing: how migrations reach Supabase Cloud and who applies them; bucket provisioning; auth config parity; grader `.env` bootstrap; LLM spend/free-tier strategy; free-project pausing (F3, F6). |
| 7 | Decisions not rationale, terse, valid mermaid, no leftovers, memlog landed | Mostly | Mermaid looks valid. No template leftovers. A few rationale sentences remain (AD-2 "This is needed because…"). AD-2, AD-11, AD-14, AD-15, and AD-16 come from the memlog's "architect-chosen, for user review" list but aren't marked as pending or adopted. The memlog's OCR question (line 15) is never marked resolved. |
| 8 | AGENTS.md policy | Yes | Single gateway (AD-3), deterministic mock mode with a production guard (AD-4), secrets in `.env` + `.env.example`, `test-data/`, no extra infrastructure. One suggestion: make AD-3 mechanically enforceable with a test that fails if `openai` is imported outside `app/llm/`. |

## Findings

### F1 — HIGH — Build-time SPA config contradicts "same app image" for local and cloud (AD-17, Conventions › Config, Structural Seed deployment diagram, Deferred › Hosting)

- **Problem:** `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are inlined into `frontend/dist` at `vite build`, which runs inside the multi-stage Dockerfile. So one image can't serve both the local Supabase (`http://127.0.0.1:54321`) and Supabase Cloud, even though the deployment diagram says "same app image".
- **Second URL split:** the container reaches local Supabase at `host.docker.internal`, while the browser and the JWT `iss` claim use `127.0.0.1`. One `SUPABASE_URL` can't serve both. The auth story (AD-2) and the deploy story will each pick a different answer.
- **Fix:** Add a rule to AD-17 or Conventions with three parts:
  1. The SPA gets its Supabase URL and publishable key at runtime from `GET /api/config` (unauthenticated, public values only). No `VITE_*` Supabase vars. Alternatively, explicitly decide on per-environment image builds with `--build-arg`, and drop "same image".
  2. The backend has two settings: `SUPABASE_URL` (server-to-server, may be `http://host.docker.internal:54321`) and `SUPABASE_PUBLIC_URL` (what the browser uses and what `iss` must match).
  3. AD-2 validates `iss` against `SUPABASE_PUBLIC_URL/auth/v1` and fetches JWKS through `SUPABASE_URL`.

  Add both settings to `.env.example`.

### F2 — HIGH — Mistake uniqueness blocks re-recording after a clear (AD-10, interacts with AD-8 and FR-18)

- **Problem:** AD-10 says a Mistake is unique on (`account_id`, `source_type`, `source_item_id`). FR-18 and AD-8 keep cleared Mistakes as history (`cleared_at` set, row kept). A migration author will write a plain `UNIQUE` constraint. After the student clears a Mistake and then misses the same question in a later retake, `record_failure` will either violate the constraint or be swallowed as a "no-op". Either way the new Mistake is lost and FR-12/FR-9 break.
- **Missing column:** the FR-9 indicator counts per Project, but the key and `record_failure` signature don't include `project_id`.
- **Fix:** Reword the rule to "at most one *outstanding* Mistake per (`account_id`, `source_type`, `source_item_id`), enforced by a partial unique index `WHERE cleared_at IS NULL`. A failure on an item whose Mistake was cleared inserts a new Mistake row." Add `project_id` to the `mistakes` row. `record_failure` derives it from the source item. The FR-9 count is `WHERE project_id = ? AND cleared_at IS NULL`.

### F3 — MEDIUM-HIGH — Operational envelope gaps: cloud migrations, auth config parity, bucket provisioning, grader bootstrap (AD-16, Deferred, Stack)

Each gap below is a place where the local grader stack and the live demo can silently diverge.

- **Cloud migrations:** AD-16 says the CLI applies `supabase/migrations/`, but not how they reach Cloud. Fix: "`npx supabase db push` to the linked Cloud project, run by one named person, only from `main` after merge. No dashboard schema edits."
- **Bucket:** `study-materials` must exist in both environments. `config.toml` `[storage.buckets]` covers local only. Fix: create the bucket (private) in a migration (`insert into storage.buckets …`) so `db reset`/`db push` provision it everywhere.
- **Auth settings that change FR behavior:**
  - FR-1 requires a clear "email already registered" error. With email confirmations ON, Supabase obfuscates duplicate sign-ups, so the error never appears.
  - FR-3 needs `site_url` and redirect allow-list entries for the reset link.
  - Fix: pin `enable_confirmations = false`, `site_url`, and `additional_redirect_urls` in `supabase/config.toml`, and list the same values as a Cloud dashboard checklist (or apply them with `supabase config push`).
- **Grader bootstrap:** the local Supabase keys come from `npx supabase status`, and the grader must copy them into `.env`. Fix: decide on one command or README step (for example `npx supabase status -o env` mapped into `.env`), with the order "supabase start → db reset → fill .env → docker compose up".
- **Tool pinning:** pin the Supabase CLI as a root `devDependency` (exact version) instead of "latest", because `config.toml` keys change between CLI versions. Replace "Docker Desktop current" with a minimum Compose v2 version.
- **Operations:** add a Deferred/open note that Supabase free projects pause after inactivity. The demo owner must un-pause the project before the presentation. Backups are out of scope.

### F4 — MEDIUM — Upload pipeline order contradicts AD-6, and upload granularity is undecided (AD-13, AD-6, AD-16, Deferred › Hosting)

- **Order contradiction:** AD-13 orders the upload as "storage, extraction, Content Integrity, Section insert". AD-6 says "a rejected file is not stored". The materials story and the extraction story will implement different orders.
- **Granularity:** FR-6 allows "one or more files". It isn't decided whether the SPA sends many files in one request or one per request. Ten HEIC images through a vision model in one request will exceed the 90 s timeout.
- **Fix:**
  1. Rewrite the AD-13 order as: validate type/size/count and quota → extract + integrity → if accepted: write to Storage, then one DB transaction (Material + Sections + `usage.consume`) → on DB failure delete the stored blob → auto-name if first.
  2. Add the rule "exactly one file per upload request; the SPA uploads selected files sequentially and shows per-file outcomes".
  3. Under Deferred › Hosting, add the hard constraints the chosen host must meet: runs the Docker image, allows request duration ≥ 90 s, accepts 50 MB request bodies.

### F5 — MEDIUM — Content Integrity thresholds aren't fully measurable, and three formats lack a warn tier (AD-6, AD-5, PRD §5.1)

- **Undefined page test:** "≥ 80 % of pages/slides contain readable text" doesn't define a readable page. Two developers will choose different per-page minimums.
- **Missing warn tier:** for .docx/.txt/.md, "only the character rule" leaves accept or reject only. PRD §5.1 requires accept / warn / reject "across every Study Material format".
- **Missing cases:** corrupt or encrypted files aren't mentioned.
- **Unverified tooling:** AD-5 assumes MarkItDown yields PDF page boundaries. Its PDF converter emits one text stream, so per-page Sections and per-page readability are unverified.
- **Fix:**
  1. Define "readable page/slide" as ≥ N non-whitespace characters (config `INTEGRITY_MIN_PAGE_CHARS`, default for example 40).
  2. For unstructured text formats, add a warn tier: warn when there are 200–1,000 characters, or when more than X % of characters are replacement or non-printable.
  3. State that a file the converter can't open (corrupt or password-protected) is `rejected` with `material_unusable`.
  4. Add `[ASSUMPTION: MarkItDown preserves PDF page breaks — verify at scaffold; otherwise split pages with pdfminer.six (already a markitdown[pdf] dependency) and convert per page.]`

### F6 — MEDIUM — LLM provider operating strategy is undecided and can make the live demo fail (AD-3, AD-12, Deferred › model IDs; memlog line 19)

- **Free-tier ceiling:** the memlog records that OpenRouter free models allow 50 requests/day account-wide with under 10 credits purchased. A single student's Ask AI quota (50/day) plus uploads and quizzes would exhaust the whole demo's budget.
- **Conflicting policy:** the Deferred note to enable the "no training" data policy can exclude most `:free` endpoints.
- **Narrower candidates:** `require_parameters: true` narrows the candidates further.
- **Fix:** Add a Deferred/open-question entry that names an owner and a date, with these items:
  1. Live demo uses either (a) ≥ 10 USD credits with `:free` models, or (b) a low-cost paid model with an OpenRouter key spend limit. Record the chosen limit.
  2. Verify that the chosen model still has an endpoint under the no-training policy with structured outputs.
  3. The demo key is separate from developer keys.

  This is the provider/infra strategy dimension the altitude owns. Right now it's implicit.

## Lower-severity notes

- **Postgres FTS text-search config (AD-7):** the `tsvector` generated column (migration) and the Ask AI query (`services/chat`) must use the same config. Material may be Norwegian or English. Fix: pin `'simple'` (language-neutral) in AD-7.
- **Service-to-service calls (Paradigm):** the diagram allows only `services → mistakes/usage`, but AD-14 and AD-13 require `materials → projects` (auto-name). Fix: state "services may call `mistakes`, `usage`, and `projects.auto_name`; no other cross-service imports".
- **Quota semantics (AD-12):** say whether an image that comes back `unreadable` (vision call succeeded, file rejected) consumes `image_extraction` quota. Recommend yes: the call succeeded and cost money. `check`/`consume` aren't atomic. Accept the small overshoot or use `UPDATE … WHERE count < limit RETURNING`.
- **Ask AI budget split (AD-15/AD-7):** history and scope text share one budget, but the priority isn't stated. Fix: material is filled first and history is trimmed oldest-first.
- **Practice generation (AD-11):** "up to 20" doesn't say which 20. Fix: oldest outstanding first.
- **Practice grounding (AD-7/AD-11):** Section ids are stored per artifact, not per question or card. So a flashcard's practice question is grounded on the whole set's scope, which can be large. Store Section ids per Question/Card, or accept this explicitly.
- **Adoption tags (Memlog landing):** AD-2, AD-11, AD-14, AD-15, and AD-16 lack `[ADOPTED]` and come from the memlog's "for user review" list (line 35). Mark them as pending approval or get approval and tag them. Record that the memlog OCR question (line 15) is resolved by AD-5/AD-6, since the vision model makes FR-7 cheap.
- **Remaining rationale:** trim the rationale prose in AD-2 ("This is needed because…") and AD-16's `[ASSUMPTION: no ORM, for transparency.]` reason. This is minor.
- **Enforcing AD-3:** add a pytest that scans `backend/app` and fails if `openai` is imported outside `app/llm/`.
- **Deferred test runner/CI:** low risk, but name one person who chooses it in the first frontend story, so both developers don't each pick one.
- **Test isolation:** tests use the local Supabase stack. Decide `supabase db reset` before the suite, or per-test transactions/fixtures, so the two developers' test suites don't depend on leftover data.

## FR coverage check

FR-1, FR-2 (AD-2 session check), and FR-3 are covered by AD-1/AD-2. Caveat: FR-1 and FR-3 depend on the auth settings in F3.

| FR | Covered by |
| --- | --- |
| FR-4, FR-5 | AD-14 |
| FR-6 | AD-5 limits, AD-13 (caveat F4) |
| FR-7 | AD-5, AD-6, AD-12 (caveat F5) |
| FR-8 | AD-8 and persistence |
| FR-9 | AD-10 (caveat F2) |
| FR-10–FR-12 | AD-7, AD-9, AD-10 |
| FR-13, FR-14 | AD-7, AD-10 |
| FR-15 | AD-7 |
| FR-16 | AD-7, AD-12, AD-15 |
| FR-17, FR-18 | AD-10, AD-11 |
| §5.1 | AD-6 (caveat F5) |
| §5.2 | AD-12 |

No FR is unmapped.

## Mermaid check

All three diagrams (component graph, deployment flowchart, ER diagram) use valid syntax. The ER diagram leaves out the polymorphic Mistake → source link and Section provenance. That's acceptable for a seed.
