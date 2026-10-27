---
review: adversarial
target: ../ARCHITECTURE-SPINE.md
reviewed: 2026-10-13
method: Pairs of sibling units, each obeying every AD literally, that still build incompatibly.
---

# Adversarial Review: Architecture Spine, AI Study Buddy V1

**Verdict:** The spine's ownership and layering decisions are sound. However, the interfaces *between* services are underspecified: Mistake identity, the transaction boundary across services, limit enforcement under concurrency, Mistake Review provenance, and LLM output schemas. Two agents could each follow every AD and still produce code that does not fit together. Most of the holes below can be closed by adding one or two sentences to an existing AD.

Severity: **High** means a likely, user-visible bug or a test or grading failure that both builders could defend as compliant. **Medium** means rework at integration time. **Low** means worth one line, but not urgent.

---

## H1 — Mistake identity: no `project_id`, and the uniqueness rule conflicts with re-failure after clear (High)

**Units:** `services/quiz` + `services/flashcards` (callers) vs. `services/mistakes` + the migration author. Also `services/projects` (FR-9 indicator).

**How they diverge:**
- AD-10 has `record_failure(account_id, source_type, source_item_id)` and says "A Mistake is unique on (`account_id`, `source_type`, `source_item_id`)". It also says the FR-9 indicator is `count(outstanding mistakes for project)`. The signature carries no `project_id`. To count per project, the mistakes author must either:
  - (a) add `project_id` to the table and derive it by joining `quiz_questions → quizzes` or `flashcards → flashcard_sets`. This means `services/mistakes` reads tables that quiz and flashcards own. Or
  - (b) leave it out, and have `projects` compute the count with a polymorphic join across two source tables.
  
  Two builders will pick different options. The quiz author will also likely pass whatever IDs they hold.
- The migration author reads "unique on (account_id, source_type, source_item_id)" literally and writes a plain `UNIQUE` constraint. The mistakes author reads "a repeat failure on an item that already has an **outstanding** Mistake is a no-op". By implication, a failure on an item whose Mistake was *cleared* creates a new Mistake: the student retakes the quiz, gets the same question wrong again, and it should show up in the count. With a plain `UNIQUE`, that insert either raises `IntegrityError` (500 on quiz answer) or is silently swallowed by `ON CONFLICT DO NOTHING`. If it is swallowed, the re-failure never reaches the FR-9 count.
- It is also unclear whether `source_item_id` is the question/card id, or the answer/mark id that caused the failure. FR-18 requires keeping "the historical record of the original incorrect attempt", which needs the answer id.

**Tightening (AD-10):**
- Signature: `record_failure(conn, account_id, project_id, source_type, source_item_id, failed_answer_id)`. Callers pass `project_id`, which they already hold. `mistakes` never reads source tables.
- `mistakes` columns: `project_id` (NOT NULL), `source_type`, `source_item_id` (question or card id), `failed_answer_id` (the quiz answer or flashcard mark row), `created_at`, `cleared_at`, `cleared_by_practice_answer_id`.
- Uniqueness is a **partial** unique index: `UNIQUE (account_id, source_type, source_item_id) WHERE cleared_at IS NULL`. A failure after a clear creates a new Mistake row. The no-op case uses `ON CONFLICT ... DO NOTHING` against that partial index.
- FR-9 is `SELECT count(*) FROM mistakes WHERE project_id = $1 AND account_id = $2 AND cleared_at IS NULL`, exposed as `mistakes.outstanding_count(account_id, project_id)`. `projects` calls it and never queries the table itself.

---

## H2 — Limits are check-then-act across a long synchronous request, and multi-file upload makes the race the normal path (High)

**Units:** "Upload story" (`services/materials` + SPA upload page) vs. `services/usage`. Also "chat" vs. "usage quotas".

**How they diverge:**
- FR-6 says "upload one or more files". AD-13 makes each upload synchronous: storage, extraction, possibly a vision LLM call, then naming, which takes 5–60 s. AD-5 enforces "≤ 10 per Project" in `materials` **before extraction**. The SPA author, following FR-6, lets the student select 5 files and fires 5 parallel `POST`s, a normal UX choice. On a Project with 8 Materials, all 5 requests see `count = 8`, all pass, and the Project ends up with 13 Materials. Every unit followed its AD.
- Images make it worse. AD-12 says `usage.check(kind)` runs before the LLM call and `usage.consume(kind)` after success. Five parallel image uploads at 23/25 all pass `check`, giving 28/25. The same applies to two browser tabs on Ask AI at 49/50. FR-7 ("a 26th image ... is declined") and FR-16 ("a 51st message ... is declined") are tested consequences.
- The API shape is undecided. One builder writes `POST /materials` taking a single `file`. The other sends `multipart files[]`, and if one file in the batch fails (for example the 11th), each side handles partial success differently.
- Quota accounting is also ambiguous for a **rejected** image. The vision call *succeeded* (it returned `unreadable`), so a literal reading of AD-12 says to consume. A reading of AD-6 ("a rejected file is not stored, does not count") says not to consume. One builder's test expects 24 and the other's expects 25.

**Tightening:**
- **AD-5 / AD-13:** One file per upload request. The SPA uploads selected files **sequentially** and shows per-file results. The Material-count check runs again inside the final insert transaction, after `SELECT ... FROM projects WHERE id=$1 FOR UPDATE`. The early check is only a fast fail.
- **AD-12:** Replace check/consume with an atomic `usage.reserve(conn, account_id, kind)`:
  - It runs `INSERT ... ON CONFLICT (account_id, usage_day, kind) DO UPDATE SET count = usage_counters.count + 1 WHERE usage_counters.count < limit RETURNING count`. No row returned means `429 quota_exceeded`.
  - It is called before the LLM call and committed immediately. `usage.release(...)` decrements only when the gateway raises (`ProviderRateLimited`, `ProviderUnavailable`, `LLMOutputError`).
  - An image that is rejected for legibility **does consume** quota, because the provider was paid. State this explicitly.
  - The schema-retry inside the gateway still counts as one unit.

---

## H3 — No transaction/unit-of-work contract across services; AD-16's "one transaction" cannot be satisfied as written (High)

**Units:** `services/quiz` (answer submission) vs. `services/mistakes`. Also `services/materials` vs. `services/projects` (naming), and `services/chat` vs. `usage`.

**How they diverge:**
- AD-16 says "an Attempt + `record_failure` run in one DB transaction". AD-10 says only `mistakes` writes the `mistakes` table. AD-16 says repositories use psycopg with no ORM. Nothing says who opens the connection or how a service passes it on:
  - The mistakes author writes `record_failure` to open its own connection from the pool and commit. That is natural and fully compliant with AD-10.
  - The quiz author inserts the answer in its own transaction, then calls `record_failure`. The two are not atomic. A crash between them gives a wrong answer with no Mistake, which violates FR-12 "automatically recorded".
- Naming during upload (AD-13 + AD-14) has two problems:
  - The materials author wraps "Material + Sections" in a transaction (AD-16) and calls `projects` → `llm.name_project` inside it. That holds a row lock for the 2–10 s LLM call, and turns a naming failure (`ProviderRateLimited`) into a rollback of an already-paid image extraction.
  - The projects author assumes naming is best-effort and runs it after commit.
  
  The spine does not say whether a naming failure fails the upload. It also does not say whether `materials` may import `projects` at all: the dependency diagram only shows services → `mistakes` and services → `usage`.
- Chat ordering is also unspecified:
  - The chat author inserts the user message, calls the LLM, and inserts the assistant message. If the LLM fails, an orphan user message stays in the insert-only thread (AD-8), and AD-15 then replays it as history in every later turn.
  - Another author inserts both messages only after success. The SPA author, expecting the first design, renders the user bubble from the server echo.

**Tightening (new AD, or extend AD-16):**
- **Unit of work:** The API layer opens one `psycopg` connection per request through a FastAPI dependency and passes `conn` into the service. Every service-to-service and repository function takes `conn` as its first argument and never commits. The API layer commits on success and rolls back on exception.
- **No LLM call inside an open write transaction.** Pattern: validate, then call the LLM, then make one short write transaction. Usage reservations (H2) are the only exception: they are committed separately before the call.
- **Allowed service-to-service calls:** any service → `mistakes`, any LLM-calling service → `usage`, `materials` → `projects.auto_name_if_unnamed(conn, account_id, project_id, material_id)`. Nothing else.
- **Naming is best-effort.** It runs after the Material commit. A failure is logged and leaves `name = NULL`, and the next accepted upload tries again because the condition is "name IS NULL". The upload never fails because naming failed.
- **Chat:** the user message and the assistant message are inserted together, in one transaction, only after a successful answer. A failed turn stores nothing, consumes nothing (it is released), and returns the error envelope. The SPA keeps the typed text for retry.

---

## H4 — Mistake Review provenance and session semantics are undefined (High)

**Units:** `services/review` (+ `llm.generate_practice` prompt/fixture author) vs. `services/quiz` / `services/flashcards` (what they persist). Also the review SPA page.

**How they diverge:**
- AD-11 says practice is generated "from the source item plus its stored **source Sections**". AD-7 only says that "every generated **artifact** ... stores the Section ids". The quiz author stores `section_ids` on the `quizzes` row, which is enough for AD-7. Then the review author finds that a Mistake on question 7 of a whole-Project quiz has "source Sections" equal to the whole Project. Two results:
  - (a) the practice prompt is not targeted, which goes against FR-18's "targeting the specific content/topic".
  - (b) once 20 Mistakes each carry the whole Project, the AD-7 budget check returns `422 scope_too_large` for Mistake Review. A student who could take the quiz now cannot review it.
- `generate_practice` has no input shape. A quiz Mistake carries stem, options, correct option, and explanation. A flashcard Mistake carries front and back. The prompt author designs for one shape, and the review author passes the other or a union.
- The batching model is unclear. One builder makes one gateway call per Mistake (20 sequential LLM calls in one synchronous request, which overruns AD-13's 90 s timeout). Another makes one batched call returning a list keyed by `mistake_id`, which the fixture author does not know about.
- There is no "session" entity. Pressing "Start review" twice regenerates practice for the same outstanding Mistakes (paid calls). The older, unanswered Practice Questions stay answerable. The SPA author resumes the old ones on reload, while the backend author always generates new ones. A correct answer to an *old* practice question for an already-cleared Mistake calls `mistakes.clear`. One builder makes that idempotent, and another raises on it.
- "Up to 20" does not say *which* 20 when 35 are outstanding.

**Tightening:**
- **AD-7 / AD-9:** Each Quiz Question and each Flashcard stores its own `source_section_ids` (a non-empty subset of its artifact's scope). These are returned by the LLM as section **labels** or indices from the prompt and mapped to ids by the backend. Any label that does not resolve fails validation and triggers the AD-3 retry.
- **AD-11:**
  - `generate_practice` takes a list of `PracticeTarget {mistake_id, source_type, prompt_text, correct_text, source_section_ids}`, built by `review` from either source type. It is one batched gateway call per request, with output items keyed by `mistake_id`. Missing ids are dropped, and extras are ignored.
  - Grounding text for the call is the **union** of the targets' own sections, subject to the AD-7 budget. If the budget is exceeded, reduce the batch (oldest first) instead of returning `422`.
  - Selection is the oldest 20 outstanding Mistakes, by `created_at`.
  - Reuse rule: when a request arrives, any outstanding Mistake that already has an *unanswered* Practice Question gets that question back, not a new one. Only Mistakes without one are generated.
  - `mistakes.clear` is idempotent. Clearing an already-cleared Mistake is a no-op that still records the Practice Answer.

---

## H5 — LLM output schemas, persisted shapes, and fixtures are three different contracts (Medium)

**Units:** `llm/` gateway + `llm/fixtures/` author vs. `services/quiz` + migration author vs. SPA quiz page. Also `extraction/` vs. tests.

**How they diverge:**
- AD-9 asks for a "stable `option_id`" but does not say who assigns it:
  - The gateway author lets the model emit `"option_id": "a".."d"` and `"correct_option_id": "b"`, and writes fixtures that way.
  - The quiz author assigns UUIDs on insert, expecting `option_id` to be globally unique, and maps them.
  - The SPA author keys React lists by `option_id` and submits it. Submitting `"b"` to a backend that expects a UUID fails, and the reverse also fails.
  - Nobody says whether options are shuffled. LLMs put the correct answer at "a" or "b" far more often than chance, which hurts SM-4/SM-5 quality. Shuffling can be done by the gateway or the service, but if both do it, the order is wrong.
- AD-12 says the backend "truncates to the cap", but the request contract (requested count vs. cap) and the behaviour on *fewer* returned items are not specified. If a fixture holds 5 questions and a test requests 10, one builder calls it success with 5 questions and the other raises `LLMOutputError`.
- AD-4 requires deterministic fixtures but gives no rule for *selecting* a fixture. The materials test author needs the mock `extract_image_text` to return `partial` and `unreadable` in order to test AD-6's warn and reject paths. The gateway author ships one fixture that always returns `readable`. The rejection paths of FR-7, a graded consequence, then become untestable in mock mode, or the test author monkeypatches the gateway, which defeats AD-4.

**Tightening:**
- **AD-3:** Gateway schemas live in `llm/schemas.py` and are the *wire* contract. For MCQ, the model returns `options: [str×4]`, `correct_index: 0..3`, `explanation`, and `source_sections: [label]`.
- **AD-9:** The **service** shuffles the options and assigns `option_id` values `"a".."d"`, unique within a question and stored per question. The API sends only those ids. The gateway never invents ids.
- **AD-12:** Return `min(requested, returned)` items, after truncating to the cap. Fewer items than requested is still a success if at least 1 item is returned. Zero items is `LLMOutputError`.
- **AD-4:**
  - Fixtures are keyed per task. In mock mode, a filename or content marker selects the variant. For example, a test image whose name contains `unreadable` or `partial` selects the `unreadable` or `partial` legibility fixture.
  - `test-data/` contains one sample file per AD-6 outcome.
  - Fixtures cite section labels by position, so they map onto any material's Sections.

---

## H6 — Rename and auto-name disagree on what "unnamed" means (Medium)

**Units:** "Project naming story" (`projects.auto_name_if_unnamed`) vs. "Project rename story" (rename endpoint + SPA form).

**How they diverge:**
- AD-14 uses `name = NULL` as the placeholder signal, and "sets the name only if it is still `NULL`". FR-5 allows renaming to "any text". The rename author trims the input and stores an empty or whitespace-only name as `NULL`, a reasonable way to show the placeholder again. The next upload then auto-names and **overwrites the student's explicit choice**, which goes against "a rename is final".
- Another rename author stores `''`. The SPA author's placeholder check is `name == null`, so the Project card renders blank.
- No maximum length is set, while the LLM name has an implied one. A 10 kB rename breaks the project list layout. Truncation also differs: one builder truncates on the server, the other on the client.

**Tightening (AD-14):**
- Add `projects.name_source` (`auto` | `student` | NULL), or equivalently a `renamed_at` column. Auto-naming runs only while no student rename has happened.
- Rename rejects empty or whitespace-only names with `422 invalid_name`, trims the input, and caps it at 100 characters on the server.
- Auto-generated names are capped to the same limit by the service.

---

## Further holes (lower priority)

| # | Sev | Units | Divergence | Tightening |
| --- | --- | --- | --- | --- |
| L1 | Med | Quiz-taking API vs. SPA quiz page | The spine does not say whether an Attempt is created explicitly (`POST /attempts`) or implicitly on the first answer. A double-click, retry, or refresh re-submits an answer. AD-8 makes answers insert-only, so duplicate answers inflate or deflate the score (FR-11 "accurately reflects") and can produce duplicate `record_failure` calls. Resume (FR-8) does not say whether an unfinished Attempt is continued. | Make Attempt creation explicit. Add `UNIQUE(attempt_id, question_id)` on quiz answers. A re-submit returns the stored result (idempotent). Score = correct answers / question count. An unfinished Attempt is resumable. Apply the same idempotence to practice answers: one answer per practice question, and a wrong one stays answered, so practice again means a new request. |
| L2 | Med | Scope picker (SPA) vs. quiz, flashcards, and summaries services | The API body for a scope is undefined: `{"section_ids":[...]}` versus `{"scope":"project"}`. Repositories filter by `account_id` but not by `project_id`, so the student's Section ids from Project B are accepted for a quiz in Project A. Summaries (FR-15 "one Study Material or part of one") may limit scope to one Material while the shared picker allows several. | Request field: `section_ids: [uuid] \| null`, where null means the whole Project, resolved and stored as an explicit list. The service validates that every id belongs to `(account_id, project_id)`, otherwise `422 invalid_scope`. Decide whether Summaries allows a scope across Materials. The SPA picker groups by Material and offers a Material-level checkbox. |
| L3 | Med | Chat scope (AD-15) vs. AD-7 scope | Chat stores `material_id \| NULL`, while every other feature stores Section ids. Builders disagree over whether the chat answer's stored "Section ids" are the *scope* or the *retrieved subset*. | AD-15: the user message stores `scope_material_id`. The assistant message stores `source_section_ids` = the Sections actually sent. |
| L4 | Med | Quiz/flashcard/summary/chat services vs. gateway | "Estimated tokens" has no single definition. A `len/4` estimate in one service and a tokenizer in another give different `scope_too_large` boundaries for the same scope, and chat history trimming uses a third. | `llm.estimate_tokens(text)` is the only estimator. `llm.fits_budget(parts)` covers the system prompt, history, and material, and services call it. History is trimmed oldest-first before material is trimmed. |
| L5 | Low | `extraction/` sectioning vs. integrity scoring | "Top-level heading" for .docx and .md is ambiguous (H1 only, or highest level present), as is content before the first heading. Empty PDF pages may be stored as empty Sections and later sent as labelled blanks. | Split on the highest heading level present. Leading content becomes Section 0 labelled "Introduction". Store a Section only if its text is non-empty after trimming, but still count empty pages in the AD-6 ratio. |
| L6 | Low | `auth.py` vs. db layer | AD-2's `auth.sessions` lookup is DB access outside `backend/app/db/`, so builders disagree on where that SQL lives. Errors for a missing or invalid token (`unauthorized`) are not in the code list. A user-agnostic SPA handles only `session_expired`. | Put the session lookup in `db/auth_sessions.py`. Add `unauthorized` (401) to the codes. `api/client.js` signs out on any 401. |
| L7 | Low | `materials` vs. `storage.py` | The order of "store the original" versus "reject" is unspecified. AD-6 says a rejected file "is not stored", but AD-13 lists storage first. One builder uploads and then deletes on rejection, another extracts first. An orphaned blob remains if the DB commit fails. | Extract from the in-memory bytes first. Upload to Storage only for accepted files, before the DB commit. On commit failure, delete the object as best effort. |

## Things checked and found adequate

- The single gateway and single mock switch (AD-3, AD-4) and the production fail-closed rule.
- Single ownership of `usage_counters` and `mistakes`, as stated (aside from the interface gaps above).
- One origin with no CORS (AD-17), and keys only on the backend (AD-1).
- Immutability of artifacts (AD-8), which makes Mistake → Question references safe.
