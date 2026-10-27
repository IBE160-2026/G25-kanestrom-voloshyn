---
title: 'Reconcile review: ARCHITECTURE-SPINE.md vs PRD'
reviewed: '2026-10-13'
spine: ../ARCHITECTURE-SPINE.md (status: draft)
prd: ../../../prds/prd-AI-StudyBuddy-2026-10-06/prd.md (status: final)
---

# Reconcile review: spine vs PRD

## Verdict

The spine mostly matches the PRD and maps all 18 FRs. It does contradict the final PRD in one place: AD-7's `scope_too_large` rejection conflicts with the whole-Project and whole-Material scopes in FR-10, FR-13 and FR-15. It also leaves several decisions open, and two builders could fill them in different ways: Supabase email-confirmation config, the warn path for text formats, Mistake uniqueness after clearing, logout and revoked sessions, and how uploads are split into requests. Fix these before stories are written.

## Capability-map coverage (FR-1..FR-18)

| FR | Map row | Status |
| --- | --- | --- |
| FR-1, FR-2, FR-3 | Account & Authentication | Mapped |
| FR-4, FR-5, FR-8, FR-9 | Projects, naming, resume, indicator | Mapped |
| FR-6, FR-7 | Upload and extraction | Mapped |
| FR-10, FR-11, FR-12 | Quiz | Mapped |
| FR-13, FR-14 | Flashcards | Mapped |
| FR-15 | Summarize | Mapped |
| FR-16 | Ask AI | Mapped |
| FR-17, FR-18 | Mistake Review | Mapped |

All 18 FRs are mapped, and §5.1, §5.2 and the AGENTS.md mock-mode policy also have rows. One small gap: the "Projects…" row lists governing ADs but not AD-2. FR-8's "student's own Project list" depends on AD-2's account scoping (this is cosmetic).

## Findings

Severity: **high** means it contradicts the final PRD, or builders will produce incompatible code. **Medium** means the spine is silent where a decision is needed. **Low** means a small gap or an over-reach to confirm.

### F1 — HIGH — `scope_too_large` contradicts whole-Project / whole-Material scopes (contradiction + over-reach)

- **PRD:** FR-10 and FR-13 let the student choose "the whole Project" as the Selection Scope. FR-15 covers "an entire Study Material". The FR-12 NFR sets a 60 s target for "a single lecture-deck-sized upload". FR-6 allows up to 10 materials of up to 50 MB each.
- **Spine:** AD-7 says that if the scope is over `LLM_CONTEXT_BUDGET_TOKENS`, the request returns `422 scope_too_large` and the student must narrow the scope. Because the budget is "configured per model, no product constant", there is no guarantee that even one lecture deck fits.
- **Problem:** A full Project, or a single long PDF, can be refused with no workaround. That adds a refusal the final PRD does not have. AGENTS.md says not to change a final requirement silently.
- **Fix:** Pick one of these:
  - (a) Keep the 422, but add a floor rule: `LLM_CONTEXT_BUDGET_TOKENS` must fit at least one maximum-size Material plus the prompt, and the model choice in Deferred must meet that. Raise the whole-Project case with Cristoffer/Ihor as a proposed PRD clarification, tagged `[NOTE FOR PM]`, and wait for approval.
  - (b) For over-budget scopes, have the service select Sections. For Quiz and Flashcards, sample Sections evenly across the scope up to the budget and record the Section ids used. For Summarize, do a two-stage map-reduce over Section groups. Either way the scope is never refused.
  
  Option (b) keeps the PRD as written.

### F2 — HIGH — Supabase email-confirmation setting is not decided; FR-1 and FR-2 depend on it

- **PRD:** FR-1 says a duplicate email gets a clear error, and email verification is optional ("not required for an Account to function"). FR-2 says incorrect credentials get a generic invalid-login message that does not reveal whether the email is registered.
- **Spine:** AD-1 and AD-2 hand sign-up and login to Supabase Auth from the SPA. Nothing says whether `enable_confirmations` (and `double_confirm_changes`) is on or off, locally or in the cloud.
- **Problem:** Supabase Cloud turns email confirmation on by default, and the local `config.toml` defaults to off. With confirmation on:
  - an unconfirmed account cannot log in, which breaks FR-1;
  - sign-up with an existing email returns an obfuscated "success" instead of an error, which breaks FR-1's clear duplicate-email error;
  - login returns "Email not confirmed", which reveals that the email is registered and breaks FR-2.
  
  The local stack and the cloud would therefore behave differently.
- **Fix:** Add a rule under AD-1 or AD-2:
  - Email confirmation is OFF in both `supabase/config.toml` and the Cloud project.
  - `frontend/src/auth/` maps every Supabase sign-in error to one generic message.
  - The `user_already_exists` sign-up error maps to FR-1's duplicate-email message.
  - The password-reset redirect URL (`site_url` / `additional_redirect_urls`) is set for both environments.
  
  Also add a sentence that password hashing is delegated to Supabase Auth (bcrypt). This covers FR-1's rule that passwords are never stored in plain text. Passwords never reach FastAPI, and the logging rule already bans logging them.

### F3 — MEDIUM — Content Integrity has no warn path for .docx/.txt/.md and no rule for corrupted files

- **PRD:** §5.1 applies "across every Study Material format": fully usable files are accepted silently, partially usable files are accepted with a warning, and corrupted or mostly unusable files are rejected.
- **Spine:** AD-6 applies only the character rule (< 200 chars → reject) to .docx, .txt and .md. These formats can therefore only be accepted or rejected, never `accepted_with_warning`. The spine also does not say what happens when MarkItDown throws on a corrupted file, or when a .docx or .pptx has slides or pages that are only images.
- **Fix:**
  - State that any parse exception, and any non-UTF-8 .txt/.md that cannot be decoded, returns `rejected` (`422 material_unusable`).
  - Give .docx a page-equivalent: the Section-based ratio from AD-5 (headings with < N characters count as unreadable). Alternatively, warn when extracted text is below a second character threshold, for example < 1,000 characters.
  - Document explicitly that .txt and .md can only accept or reject, with the reason: plain text has no partial-extraction failure mode. That makes it a recorded decision rather than an omission.

### F4 — MEDIUM — Mistake uniqueness is unclear after a Mistake is cleared

- **PRD:** FR-12 and FR-14 record a new Mistake for each incorrect answer or "not yet known" mark. FR-18 says clearing removes the Mistake from the count, and history is kept.
- **Spine:** AD-10 says a Mistake is "unique on (`account_id`, `source_type`, `source_item_id`)". It also says a repeat failure while a Mistake is outstanding is a no-op.
- **Problem:** If one builder writes a plain UNIQUE constraint, a question that was cleared and later failed again in a retake can never become a Mistake again. That breaks FR-12, because the error is swallowed silently. Another builder might write a partial index. The two would not be compatible.
- **Fix:** Make the rule a partial unique index, `UNIQUE (account_id, source_type, source_item_id) WHERE cleared_at IS NULL`. Also give `mistakes` a `project_id` column (derived from the source item inside `record_failure`) so the FR-9 count query is `WHERE project_id = ? AND cleared_at IS NULL` and needs no join through two source tables.

### F5 — MEDIUM — Logout and revoked sessions are not enforced at the API

- **PRD:** FR-2 says a session lasts 30 days "unless the student logs out sooner".
- **Spine:** AD-2 verifies JWTs locally against JWKS and checks only `auth.sessions.created_at`.
- **Problem:** After `signOut()`, Supabase deletes the session row. However, the access token stays cryptographically valid until it expires (about 1 h). The spine does not say what happens when the session row is missing, so one builder may let the request through.
- **Fix:** Add to AD-2: if the token's `session_id` has no row in `auth.sessions`, return `401 session_expired`, the same as an expired session. The SPA uses `signOut({ scope: 'local' })` or the default global scope. Pick one and state it.

### F6 — MEDIUM — How uploads map to requests, and how auto-naming fails, inside the synchronous upload

- **PRD:** FR-6 says the student can upload "one or more files". FR-4 says auto-naming runs only after extraction succeeds. FR-7 sets a limit of 25 images per day.
- **Spine:** AD-13 handles an upload as one synchronous request with a timeout of at least 90 s. That request covers storage, extraction, vision OCR and naming. AD-6 says a rejected file "is not stored", but AD-13 lists storage before extraction.
- **Problem:** The spine does not say whether a request carries one file or many, so builders may diverge on:
  - partial-failure semantics (2 files accepted, 1 rejected);
  - the timeout risk when several 50 MB files or several vision calls share one request;
  - races on the 10-file limit;
  - whether a naming LLM error (429 or invalid output) fails the whole upload.
- **Fix:**
  - One file per request; the SPA sends a multi-select as files one after another.
  - Order within the request: validate type and size, then lock the Project row (`SELECT … FOR UPDATE`) and check the count, then extract, then judge integrity, and store only if accepted (or delete on reject).
  - A naming failure is logged and leaves `name = NULL`. The next accepted upload tries again, and the upload itself still succeeds.

### F7 — LOW — AD-11 adds a 20-item cap on review sessions that the PRD does not have (over-reach)

- **PRD:** FR-18 covers "each outstanding Mistake". §5.2 lists every cost cap, and none applies to Mistake Review.
- **Spine:** AD-11 caps Practice Questions at 20 per request, tagged `[ASSUMPTION]`.
- **Fix:** You can keep it, because it bounds cost and is honestly tagged. Two changes:
  - Index it in a spine Assumptions list as a proposed §5.2 addition for PM approval.
  - Define the order: oldest outstanding Mistakes first. That way a student with more than 20 Mistakes can reach all of them over repeated sessions, which still meets "each".

### F8 — LOW — The point at which the OCR quota is consumed is unclear for rejected images

- **PRD:** FR-7 says "A 26th image *processed*… is declined".
- **Spine:** AD-12 says `consume` runs "after it succeeds" (the gateway call). A gateway call that returns `legibility: unreadable` counts as a success.
- **Fix:** State it explicitly: an image counts toward the quota whenever the vision call returns a valid response, whatever the integrity outcome. It does not count on provider or schema errors. Also make `check` and `consume` atomic with a single `UPDATE … SET n = n + 1 WHERE n < limit RETURNING`, or with a row lock, so that parallel requests cannot go over 25 or 50.

### F9 — LOW — Ask AI history can leak material from outside a narrowed scope

- **PRD:** FR-16 says an answer never introduces facts absent from the material in the active scope, and narrowing changes which material answers draw from.
- **Spine:** AD-15 sends prior turns as history, capped only by the token budget.
- **Problem:** After the student narrows the scope, earlier assistant turns that were grounded in other materials still reach the model. The model may then repeat facts from outside the scope.
- **Fix:** Send as history only turns whose stored scope equals the current scope. Alternatively, have the prompt state that history is conversational context only and that facts must come from the supplied Sections.

### F10 — LOW — The 10-material cap is permanent because Materials cannot be deleted

- **PRD:** FR-6 says a Project holds "up to 10 Study Materials *simultaneously*". The word "simultaneously" suggests materials can be removed.
- **Spine:** Under Deferred, "Deleting Projects or Materials: not in the PRD."
- **Fix:** No architecture change is needed. Record this as a `[NOTE FOR PM]`: without deletion, a Project is full after 10 materials and the student has to create a new one. Confirm that this is acceptable for V1.

### F11 — LOW — Scanned PDFs and image-only slides are always rejected

- **PRD:** FR-6 accepts PDFs and §5.1 rejects material that is "mostly unusable". FR-7 shows the product does want handwritten and photographed content.
- **Spine:** AD-6 says "V1 never runs OCR on PDF pages".
- **Problem:** A scanned lecture handout is perfectly readable to a human, but V1 rejects it.
- **Fix:** You can keep this decision for simplicity. Make sure the `material_unusable` message for this case tells the student to upload page photos instead. Optionally, record it as a `[NOTE FOR PM]` so it is not discovered during SM-1 testing.

## Checked and consistent (no action)

- FR-4/FR-5 auto-name only after extraction and never overwrite a rename (AD-14).
- FR-7 treats image and text material equally through Sections (AD-5).
- FR-8 and SM-3 resume works because artifacts are immutable and chat is persistent (AD-8, AD-15).
- FR-9 indicator is a live count, so it shows nothing when there are zero Mistakes (AD-10); the hiding itself is a UI detail.
- FR-11 explanations are not exposed before the student answers (AD-9).
- FR-12 and FR-14 capture Mistakes automatically and only through `services/mistakes` (AD-10).
- FR-17 starts Mistake Review only when the student asks and never pushes it (AD-11).
- FR-18 history is kept through insert-only answers (AD-8).
- §5.2 limits are enforced in the backend (AD-12, Limits convention), and the per-Account daily unit matches the PRD assumptions.
- SM-4 grounding instruction (AD-3); mock mode with no key needed (AD-4); secrets only in `.env` (Config convention); test data only in `test-data/`.
- No post-V1 features were introduced, and embeddings, analytics and spaced repetition are explicitly excluded.
- AD-9 (4-option multiple choice only) narrows the question format, but this is a legitimate architecture decision that the PRD leaves open, not an over-reach.
