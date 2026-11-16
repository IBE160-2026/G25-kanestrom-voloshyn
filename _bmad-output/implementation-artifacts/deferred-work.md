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
