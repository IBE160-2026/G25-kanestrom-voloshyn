---
title: 'Story 1.3 part 2: Verify my email by link'
type: 'feature'
created: '2026-11-16'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: 'ecb27afea1efdf2d363eb37c81b29570ceaeb519'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-3-create-account.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** FR-1 requires a verification link, valid for 24 hours and resendable, sent after sign-up. It is the only gate on Google linking. Story 1.3 left it out by decision (split, Ihor, 2026-11-12), so new Accounts never get an email and `email_verified_at` is never set.

**Approach:** Add `mailer.py` (aiosmtplib) and the `email_verifications` table. On sign-up, `after-sign-in` issues a token and emails the link once, after the commit. `GET /api/auth/verify?token=` sets `email_verified_at` and redirects to an SPA screen that shows the outcome.

Decisions (Ihor):
- **Wording.** The email is drafted here and added to EXPERIENCE.md › Strings by surface and the sign-off checklist (approved 2026-11-12).
- **Libraries.** `aiosmtplib` (spine Stack); mail goes out after the commit (AD-18).

Email text (English, then Norwegian, proposed; `{name}` is the first name, `{link}` the verify URL):
- Subject: "Confirm your email for Study Buddy" / "Bekreft e-postadressen din for Study Buddy"
- Body:
  - "Hi {name},"
  - "Confirm your email address by opening this link:"
  - "{link}"
  - "The link works for 24 hours. You can use Study Buddy without confirming; you only need it to link a Google account."
  - "If you didn't create an account, you can ignore this email."
- Norwegian body:
  - "Hei {name},"
  - "Bekreft e-postadressen din ved å åpne denne lenken:"
  - "{link}"
  - "Lenken virker i 24 timer. Du kan bruke Study Buddy uten å bekrefte; du trenger det bare for å koble til en Google-konto."
  - "Hvis du ikke har opprettet en konto, kan du se bort fra denne e-posten."

## Boundaries & Constraints

**Always:**
- **Tokens:** 32 random bytes, URL-safe. They are stored only as a SHA-256 hash, valid 24 h, and single use. `issue()` invalidates every older unused token for the Account, so Story 7.3's resend reuses it. Tokens are never logged.
- **First email:** only on the call where the Account has no live verification record (none ever issued, or every earlier one invalidated after a failed send), its email isn't verified, and its Supabase user has an email identity. A repeated call sends nothing (idempotent).
- **Sending:** after the request's transaction commits (AD-18), through FastAPI `BackgroundTasks`. A send failure is logged without the address or token and never changes the response. Decision (Ihor, 2026-11-16): after a failed send, the background task invalidates that token in its own transaction, so the next `after-sign-in` sends a fresh one.
- **Language:** `profiles.language`, falling back to the `language` in the request, then English. The link is `{APP_PUBLIC_URL}/api/auth/verify?token=…`.
- **`mailer.py`** is the only SMTP sender. It reads `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_USERNAME`, `SMTP_PASSWORD` and `SMTP_TLS` (`none` | `starttls` | `tls`) from config, and sends one email per connection.
- **Verify endpoint:** needs no bearer token; looking up a token hash is a system-context exception (AD-2). The token is marked used and `email_verified_at` is set in one transaction.
- Every SPA string comes from the catalogues (AD-26); styles use only tokens (AD-28).
- Backend tests run against local Supabase and check delivery through the Mailpit API. Frontend tests stub `fetch` (spine › Tests).

**Never:**
- No resend button or Settings (Story 7.3). No Google linking (1.6). No password-reset email (1.5).
- No Supabase-sent emails; confirmations stay off.
- No email sent inside an open transaction. No token or address in logs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sign-up, Norwegian | first `after-sign-in` with `language: "nb"` | one email in Mailpit, to the Account's address, with the Norwegian subject and body and a working link | N/A |
| Sign-up, English | same with `language: "en"` | the English email | N/A |
| Repeat call | a second `after-sign-in` | no second email, no new token | idempotent |
| SMTP down | Mailpit unreachable | `after-sign-in` still returns 200; the failure is logged | logged, swallowed |
| Valid link | an unused, newest token within 24 h | `email_verified_at` set; `303` to `/email-verified`; the SPA shows "Your email is verified." | N/A |
| Expired link | a token older than 24 h | not verified; `303` to `/email-verified?status=expired`; the SPA shows "This link has expired" | N/A |
| Used link | the same token opened again (a second click, or a mail scanner opened it first) | if the Account is verified: `303` to `/email-verified`, the success screen; otherwise expired. `email_verified_at` unchanged. Decision (Ihor, 2026-11-16). | N/A |
| Failed send, then sign-in | SMTP failed on the first send; `after-sign-in` is called again | the failed token is invalidated; a fresh email is sent | N/A |
| Replaced link | an older token after a newer one was issued | treated as expired | N/A |
| Garbage token | missing, malformed, or unknown | treated as expired | no 500 |

</frozen-after-approval>

## Code Map

- `backend/app/api/auth.py` -- `after_sign_in(body, user: UserAuth, conn: Conn)` from Story 1.3. Add a `BackgroundTasks` parameter and the verify route. `Conn` is `Depends(request_conn, scope="function")`, so the commit happens before the response and before background tasks run.
- `backend/app/auth.py` -- `CurrentUser(account_id, session_id, email)`; `email` comes from Supabase's user object. For "has an email identity", use the Supabase user's `identities` (keep `user` on `CurrentUser`, or add the providers).
- `backend/app/services/identity.py`, `backend/app/db/profiles.py` -- the `after_sign_in` service and `fill_unset`. Add `services/verification.py` and `db/verifications.py`.
- `backend/app/config.py`, `.env.example`, `docker-compose.yml` -- add the SMTP settings. Locally the defaults are `127.0.0.1:54325`, `none`, and a from-address such as `Study Buddy <no-reply@studybuddy.local>`. Compose overrides `SMTP_HOST=host.docker.internal`, as it does for `SUPABASE_URL`.
- `supabase/config.toml` line 111 -- uncomment `smtp_port = 54325` under `[inbucket]`, so the stack exposes Mailpit SMTP after `npx supabase stop && start`.
- `backend/tests/test_auth.py` -- the `gotrue` and `sign_up` helpers, the `stub_auth` fixture, and `make_settings`; reuse them. The Mailpit API is `http://127.0.0.1:54324/api/v1/messages` (search by recipient, then delete in teardown).
- `frontend/src/routes.jsx` -- add `/email-verified`. `frontend/src/components/AuthLayout.jsx` is the layout for the result screen.
- `frontend/src/i18n/{en,nb}.json` -- add `verify.success` ("Your email is verified.", EXPERIENCE.md line 206) and `verify.expired` ("This link has expired", line 187), plus a "Log in" link back to `/`.
- EXPERIENCE.md -- add the email subject and body rows next to "Email verified" (line 206), plus a line in `norwegian-strings-signoff.md` › "Sign-in and account".

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<timestamp>_email_verifications.sql` -- `email_verifications(id, account_id → profiles ON DELETE CASCADE, token_hash unique, created_at, expires_at, used_at, invalidated_at)`, RLS on, `anon` and `authenticated` revoked (as in `profiles`).
- [x] `supabase/config.toml` -- enable Mailpit SMTP 54325.
- [x] `backend/pyproject.toml` -- `aiosmtplib` 5.1.
- [x] `backend/app/mailer.py` -- `send(to, subject, body)` plus the verification templates in English and Norwegian (the frozen text).
- [x] `backend/app/services/verification.py` + `db/verifications.py` -- `issue(conn, account_id) -> token`, `verify(conn, token) -> bool`, and the first-email rule.
- [x] `backend/app/api/auth.py` -- wire up the first email in `after-sign-in` (background, after commit), and `GET /api/auth/verify`.
- [x] `backend/tests/` -- every backend matrix row (expiry by moving `expires_at` in SQL; SMTP down by pointing at a closed port).
- [x] `frontend/src/pages/EmailVerified.jsx` + route + catalogue keys + tests -- both outcomes and the "Log in" link.
- [x] `.env.example`, `docker-compose.yml`, `README.md` (Norwegian) -- the SMTP variables; verification emails land in Mailpit at `http://localhost:54324`; restart Supabase after pulling (`npx supabase stop && npx supabase start`).
- [x] EXPERIENCE.md + `norwegian-strings-signoff.md` -- the email rows (approved), and a memlog entry in the UX workspace.

**Acceptance Criteria:**
- Given the grader flow, when a visitor creates an account at `http://localhost:8000/signup`, then the verification email appears in Mailpit, and opening its link in the browser shows "Your email is verified." and sets `profiles.email_verified_at`.
- Given the source, when it is searched, then only `app/mailer.py` imports `aiosmtplib`, and no log call includes a token or an email address.

### Review Findings

Code review pass 2 (2026-11-16, run by Cristoffer: Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor against `df32d84`).

- [x] [Review][Decision → Patch] The first verification email can be blocked for good — resolved 2026-11-16 (Cristoffer chose option 1): `verifications.exists_for` now counts only links still within their 24 h, so the next sign-in after expiry sends a new link (at most once a day until verified); a stored-but-unsent link recovers the same way. New test `test_an_expired_first_link_is_replaced_on_the_next_sign_in` fails with the old query (checked). See Spec Change Log. Original finding: `issue_first` sends a first email only while `verifications.exists_for` finds no link that wasn't invalidated, and that check also counts expired links and links that were never sent. Verified cases: (a) the first link expires unused after 24 h: no later sign-in sends a new one; (b) the process stops between the commit and the background send: the unsent link stays live; (c) the send fails and the follow-up invalidation also fails (`services/verification.py:101-106`): same. In every case the Account gets no verification email until Story 7.3's resend, while PRD §5.5 and FR-1 (Core) say "resendable until verified". The matrix has no row for an expired first link. Sources: blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor.
- [x] [Review][Patch] The SMTP-down test asserts the address isn't logged, but not the token or the link [backend/tests/test_verification.py] — fixed: it also asserts that neither `token=` nor `/api/auth/verify` is in the log.
- [x] [Review][Defer] No test sends two first `after-sign-in` calls at once (the profile-row lock) — deferred: already in `deferred-work.md` from pass 1 (#11).

**Rejected (18):**
- false: the Norwegian body says "Lenken virker i 24 timer" — changed to "gjelder" in `639a9ea` with the sign-off.
- false: an old link verifies a changed email address — the email can't be changed in V1 (PRD §7.2, FR-27).
- false: "Log in" on the success screen ignores an open session — Login sends a signed-in browser straight to `/projects`.
- false: `issue()` without the row lock can hit the unique index — only `issue_first` (which locks) calls it today; Story 7.3 must lock too.
- false: an address that needs SMTPUTF8 retries forever — Supabase refuses such addresses at sign-up (`validation_failed`).
- false: the manual check's "same link again → expired" is a code bug — the code follows the matrix (Ihor's decision); the manual check line in this spec is out of date (fixing it means editing the spec under review).
- low: the Code Map names `[inbucket]`, the file has `[local_smtp]` — recorded in Implementation Notes.
- low: no production check of the SMTP settings and `APP_PUBLIC_URL` — V1 runs locally for the grader; a guard adds config branches.
- low: compose passes a `.env` `SMTP_HOST` through — the example `.env` leaves it empty, so the Docker default applies.
- low: old verification rows are never purged — a retention job is new scope.
- low: a mail scanner's click counts as verification — a recorded decision (Ihor, 2026-11-16); the link still reached that inbox.
- low: only `uvicorn.access` redacts `token=` — no other server or proxy in V1.
- low: the two screen strings end with different punctuation — the strings are signed off as written.
- low: a malformed `SMTP_FROM` fails only at send time — a config typo, logged by type.
- low: a timeout after the server accepted the email invalidates a delivered link — rare, and the fix needs error-type branching.
- low: credentials can go over plain SMTP when `SMTP_TLS=none` — a configuration choice; Mailpit needs none.
- low: `/email-verified` shows success when opened directly — nobody reaches it without a link; the fix spans backend and SPA.
- low: existing unverified Accounts get a first email on their next sign-in after the migration — intended; only local data exists.

## Implementation Notes

- Installed `aiosmtplib` 5.1.3. Migration `supabase/migrations/20261116120000_email_verifications.sql` (`token_hash` is the 64-char hex SHA-256, plus an `account_id` index); RLS on, `anon`/`authenticated` revoked. Applied locally with `npx supabase migration up --local`.
- `supabase/config.toml`: the section is `[local_smtp]` in CLI 2.122.0 (the spec said `[inbucket]`); `smtp_port = 54325` is uncommented there. After `npx supabase stop && npx supabase start`, Mailpit listens on 54325.
- `CurrentUser` gained `providers` (from the Supabase user's `identities[].provider`); "has an email identity" is `"email" in user.providers`.
- First-email rule in `services/verification.issue_first`: it locks the profile row (`SELECT … FOR UPDATE`), so two concurrent `after-sign-in` calls issue at most one token. The email is queued with `BackgroundTasks` only when a token was issued and Supabase reported an email address; `Conn` is function-scoped, so the commit happens before the background task runs.
- The greeting falls back to "Hi," / "Hei," when the profile has no first name (only possible if the first `after-sign-in` call carries no name).
- A send failure is logged as `Verification email could not be sent: <exception type>` only, because SMTP errors can echo the recipient address. The background task then invalidates that token in its own short transaction on a pooled connection; `exists_for` ignores invalidated rows, so the next `after-sign-in` sends a fresh link. A partial unique index allows at most one live (unused, not invalidated) link per Account.
- A used token redirects to the success screen when its Account is verified (second click, mail scanner), otherwise to expired.
- uvicorn's access log would have printed the verify URL with its token, so `main.py` adds a logging filter on `uvicorn.access` that blanks `token=` query values (installed in the lifespan, after uvicorn configures logging). Checked in the container log: `GET /api/auth/verify?token=[redacted]`.
- `GET /api/auth/verify` takes `token` as an optional query value, so a missing token redirects to the expired screen instead of returning 422; tokens over 256 characters are refused without hashing. The redirect `Location` is relative (`/email-verified`), so it also works through the Vite dev proxy.
- SPA: `pages/EmailVerified.jsx` uses `AuthLayout` with an Auth panel holding the result as an `h2`, and the layout's `switchTo` link "Log in" → `/`. New catalogue keys `verify.success`, `verify.expired`, `verify.logIn`. No "Send a new link" (Story 7.3).
- Backend tests are in `tests/test_verification.py`; they import the shared fixtures and helpers from `tests/test_auth.py` rather than moving them to `conftest.py`.
- `docker compose up -d --build` again hit the bake entitlement prompt; the image was built with `docker build -t g25-kanestrom-voloshyn-app .` and started with `docker compose up -d --no-build`.

## Spec Change Log

- 2026-11-16, code review pass 2, decided by Cristoffer: a new matrix row, outside the frozen block. **Expired first link, then sign-in:** the first link expired unused; `after-sign-in` is called again → a new link is issued and sent, and the old one stays expired. This keeps FR-1's "resendable until verified" (Core) without waiting for Story 7.3. The manual check's "open the same link again and see the expired screen" is out of date: for a verified Account a used link shows the success screen (matrix "Used link").

## Review Triage Log

Pass 1 (2026-11-16). Layers: blind (B), edge-case (E), verification-gap (V).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | B/E: a used link shows "expired" although the email is verified (second click, mail scanner) | medium | `consume` misses on `used_at`, so the request redirects to expired. | intent_gap → resolved (Ihor: success if verified) |
| 2 | B/E: a failed first send blocks every later first email | medium | The token is committed and `exists_for` blocks forever; there's no resend until Story 7.3. | intent_gap → resolved (Ihor: invalidate on failure, retry) |
| 3 | B/E/V: a token is issued when the Supabase user has no `email` | medium | `issue_first` runs before the `user.email` check. Direct fix: check first. | patch |
| 4 | V/B: the redaction filter is never checked to be attached to `uvicorn.access` | medium | Pre-verified; the test calls the class directly. | patch |
| 5 | B: language order, no-name greeting, and the `SMTP_TLS` / credentials mapping are untested | low | Direct tests. | patch |
| 6 | B: the Mailpit search can lag, so exact counts may flake | low | Direct fix: poll with a short timeout. | patch |
| 7 | B: the Data API test also passes on `200 []` | low | It hides a missing `revoke`. Assert the permission error. | patch |
| 8 | B: no database guard against two live tokens | low | Only `issue()` enforces it, and Story 7.3's resend isn't row-locked. Direct fix: a partial unique index. | patch |
| 9 | B: compose forces `SMTP_HOST` | low | `.env` can't override it. Direct fix: `${SMTP_HOST:-host.docker.internal}`. | patch |
| 10 | B: `epic-1-context.md` dropped AD-4's "live without a key fails in production" | medium | A regenerated summary lost a rule later stories need. | patch (doc) |
| 11 | V: concurrent first calls aren't tested | medium | Pre-verified; the harness cost is high and the SPA makes one call. | defer |
| 12 | B: the expired screen has no way forward and the UX gap isn't recorded | low | Resend is Story 7.3 by the epics; recorded as an open item. | defer |
| 13 | E: `/email-verified` opened directly shows success | low | Harmless (no state change); distinguishing it needs a URL change in the frozen matrix. | reject |
| 14 | E: an unparseable `SMTP_FROM` fails silently | low | A config error; the failure is logged. Startup validation adds branches. | reject |
| 15 | E: a DB failure on verify shows the JSON envelope | low | Rare; it adds a guard. | reject |
| 16 | B: `link_expired` added and generic codes dropped from the epic context | low | `link_expired` is a spine code (AD-24); the generic codes live in the catalogues. A summary choice. | reject |
| 17 | B: no source-level check for addresses in logs | low | Hard to do reliably; the runtime log tests cover it. | reject |
| 18 | B: the `[local_smtp]` deviation is in Implementation Notes only; Verification says compose failed | low | Fixing it would mean editing this spec; `docker compose up -d --build` works on this machine. | reject |

## Verification

**Commands:**
- `npx supabase stop && npx supabase start` (to pick up SMTP), then `cd backend && uv run pytest` -- expected: all pass.
- `cd frontend && npm test && npm run lint && npm run build` -- expected: all pass; only `tokens.css` has hex colours.
- `docker compose up -d --build`, then sign up through the API or browser -- expected: the email arrives in Mailpit and the link verifies.

**Manual checks:**
- In a browser: sign up in Norwegian, open the Mailpit email (Norwegian text), click the link, and see "E-postadressen din er bekreftet."; then open the same link again and see the expired screen.
