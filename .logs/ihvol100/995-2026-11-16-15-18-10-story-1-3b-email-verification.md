# Story 1.3 part 2: email verification

## 2026-11-16 kl. 15:18 — Ihvol100

### Oppgave
Build Story 1.3 part 2 (verify my email by link), split off from Story 1.3, with `bmad-build`.

### Plan
- Branch `feature/email-verification` from `main` (Stories 1.1–1.3 merged).
- Recompiled `epic-1-context.md`; wrote the spec [spec-1-3b-email-verification.md](../../_bmad-output/implementation-artifacts/spec-1-3b-email-verification.md), with the email text approved by Ihor.
- A subagent built the spec; then a three-layer review. Ihor decided two changes to the locked rules.
- Continues from [996-…-story-1-3-create-account.md](996-2026-11-12-14-17-13-story-1-3-create-account.md).

### Resultat
- **Commit** `df32d843a52a1ccf274d3a9994d5309cdf75bf6f`:
  - `mailer.py` (aiosmtplib) and `email_verifications`: hash-only tokens, 24 h, single use, at most one live link per Account.
  - The first email is sent after commit, in the student's language. A failed send is invalidated and retried on the next sign-in (Ihor).
  - `GET /api/auth/verify` and the `/email-verified` screen. A used link shows success when the email is verified (Ihor; this covers mail scanners and double clicks).
  - Verify tokens redacted from the uvicorn access log; Mailpit SMTP 54325 enabled.
- **Docs:** email text in EXPERIENCE.md and the sign-off checklist. Restored AD-4's "live without a key fails in production" in the epic context.
- **Verified** on a fresh `db reset`:
  - pytest 105/105, Vitest 87/87; lint and build clean; `docker compose up -d --build` works.
  - End-to-end against the container: the Norwegian email arrived in Mailpit; the link opened twice → success both times; `email_verified: true`.
- **Review:** 18 findings: 2 decided by Ihor, 8 patched, 2 deferred (`deferred-work.md`), 6 rejected, all in the spec's triage log.
- Bård Pettersen's PRD feedback (2026-11-12) suggests ranking requirements into core and extension, with FR-19 (Google) among the first to cut. Not acted on, because the PRD is final.
- Not pushed.

### Åpne punkter
- Manual browser check of the email flow: sign up in Norwegian, click the link in Mailpit's UI, "E-postadressen din er bekreftet.", then the same link again.
- Deferred: a concurrency test for the first email; the expired screen gets "Resend" in Story 7.3.
- Decide with Cristoffer whether to act on Bård's suggestion to rank requirements into core and extension (`tilbakemelding-prd.md`).
