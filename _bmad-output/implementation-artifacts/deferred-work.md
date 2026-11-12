- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-runnable-app-skeleton.md`
  summary: Add an automated smoke check that the built Docker image serves the SPA at `/` (default `frontend_dist`, Dockerfile COPY layout, `parents[2]`).
  evidence: Review pass 1, finding #4. `create_app` only logs a warning when dist is missing, so a layout change would make the container serve the API only, with every pytest green. The check needs CI or a container harness, which doesn't exist yet.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-runnable-app-skeleton.md`
  summary: Replace AGENTS.md's TODO "Running and verifying" section with the verified commands from README (via `bmad-project-context` refresh).
  evidence: Review pass 1, finding #26. The scaffold now exists, and AGENTS.md says to replace the TODO on the first refresh after scaffolding. Include: `Accept: text/html` SPA fallback, compose URL overrides, and that Windows dev needs `uvicorn --reload` (psycopg async can't use the Proactor loop; finding #22).
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-create-account.md`
  summary: Story 1.3 part 2 — the verification email and link: `mailer.py` (aiosmtplib, Mailpit SMTP 54325 enabled in config.toml), `email_verifications` (32-byte token, SHA-256 hash, 24 h, single use, newer replaces older), sending from `after-sign-in` in `profiles.language`, `GET /api/auth/verify` → SPA "Your email is verified." / "This link has expired".
  evidence: Split from Story 1.3 by Ihor on 2026-11-12 (spec over 2,400 tokens). Decided already: Ihor approved drafting the email's subject and body in English and Norwegian (proposed), adding them to EXPERIENCE.md Strings by surface and the sign-off checklist; libraries `httpx2` + `aiosmtplib` are in the spine (with the AD-18 rule: send mail after commit).
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-create-account.md`
  summary: Pin `user_auth`'s session lookup to the authenticated Account with a two-account stubbed test (session id from account B, Supabase reports account A → 401).
  evidence: Review pass 1, finding #19. Dropping `AND user_id = %s` in `db/sessions.py` fails no test. Real GoTrue already binds session and user in step 1, so the exposure is small. Add it when Story 1.4 extends the `user_auth` tests.
