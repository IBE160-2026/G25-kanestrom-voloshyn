---
type: architecture-review
lens: adversarial (pairs of units that each follow every rule and still don't fit together)
target: ../ARCHITECTURE-SPINE.md (status: final, amendment of 2026-11-12, backend HTTP client and SMTP library)
context: ../../../../implementation-artifacts/spec-1-3-create-account.md, ../.memlog.md (entries 89–91)
created: '2026-11-12'
---

# Adversarial review: httpx2 + aiosmtplib amendment (2026-11-12)

**Scope.** Only what the amendment decides or leaves open:
- AD-2 step 1 now says "(async `httpx2` client)".
- AD-19 says auth emails go "over SMTP with `aiosmtplib`".
- Two new Stack rows: `httpx2` 2.16 ("Supabase Auth calls; also Starlette's TestClient") and `aiosmtplib` 5.1 ("async SMTP for `mailer.py`").

The units are backend stories built independently: Story 1.3 (`user_auth` in `app/auth.py`, the first `httpx2` user), the verification-mail story that creates `mailer.py`, Story 1.5 (password reset: admin `generate_link`), Story 1.6 (Google takeover and unlink: admin set-password and identity delete), the Account-deletion story (`auth.admin.delete_user`), the Storage story (`storage.py`), and later the LLM gateway (`llm/`, AD-3).

**Verdict.** Accept the amendment, but add three short items. Naming the two libraries closes the hole the amendment was written for: each module choosing its own sync or async client, and `smtplib`/`requests` blocking the single worker (AD-29). It still leaves open **where** the Supabase HTTP calls live and **which client shape** they use, and the spine's own text points toward a second SDK (`auth.admin.delete_user` is supabase-py naming). The amendment also brings two kinds of external side effect, admin calls and SMTP, into request handling without saying how they relate to the request transaction (AD-18) or how their failures map to error codes. Those are real trade-offs that independent stories will settle differently. Client lifetime, timeouts, the SMTP connection model, and the SMTP env-variable names are cheap to leave to the first story's code, with one local-run check.

Severity: **High** = likely divergence that breaks another story or a security or FR guarantee. **Medium** = divergence that costs rework or hides bugs. **Low** = cosmetic, settled by the first example.

---

## B1. High: no single owner of the Supabase HTTP calls, and the spine hints at a second SDK (close in the spine)

**Units:**
- (a) Story 1.3 writes raw `httpx2` in `app/auth.py` for `GET /auth/v1/user`, as the amendment says.
- (b) Story 1.5 reads AD-19 ("call Supabase admin `generate_link`") together with "`auth.admin.delete_user`" in the deletion rule and runs `uv add supabase` (supabase-py) to get `client.auth.admin.generate_link(...)`.
- (c) Story 1.6 writes its own `httpx2` helper in `services/identity` for `PUT /auth/v1/admin/users/{id}` and `DELETE /auth/v1/admin/users/{id}/identities/{identity_id}`.
- (d) The Storage story writes `storage.py` against `/storage/v1/object/...`. The Stack row gives `httpx2` only for "Supabase Auth calls", so the story picks whichever client it likes.

**Divergence:**
- Every unit can claim compliance. The Stack row names `httpx2` for Auth calls, but no rule says *only* `httpx2` and *only* REST. And `auth.admin.delete_user` in AD-19 reads like permission to use the SDK, even though AGENTS.md forbids technology the spine does not name.
- supabase-py has its own HTTP stack (httpx 0.x, plus separate sync and async clients). With it, the backend ships two HTTP libraries. That is exactly what the memlog says the amendment avoids, and it brings back the `httpx` deprecation path the amendment just removed.
- There is no adapter for Supabase Auth or Storage REST in the Layer table. Adapters are `db/`, `storage.py`, `mailer.py`, `llm/`, `extraction/`. So admin calls end up in three places: `auth.py` (API layer), `services/identity`, and possibly a new helper module per story. Each place builds its own base URL, `apikey` and `Authorization: Bearer <secret>` headers, and response parsing. One story's change (for example the new-style `sb_secret_…` key, which goes only in `apikey`) silently misses the others.
- Tests can't enforce the boundary the way they do for `openai`, because nothing names the boundary.

**Tightening (two sentences, no new concept):**
1. Add one adapter, e.g. `backend/app/supabase_auth.py` (seed line plus Layer row). It is the only module that calls Supabase Auth (`/auth/v1/user` for `user_auth`, and `/auth/v1/admin/*`: `generate_link`, update user, delete identity, delete user), as plain REST through `httpx2`. `storage.py` calls Storage REST through the same `httpx2` client. supabase-py is not used.
2. Replace `auth.admin.delete_user` in AD-19 with "delete the user through `supabase_auth`". Optionally add a Tests line: "no module outside `supabase_auth.py` and `storage.py` imports `httpx2` (tests excepted)", mirroring the `openai` check.

This is non-obvious (supabase-py is what agents reach for by default, and the spine text invites it) and cheap to close now, before Story 1.3 puts the first call in `auth.py`.

## B2. High: external side effects vs the request transaction (close in the spine, as an extension of AD-18)

AD-18 bans only *LLM* calls inside an open write transaction. The amendment adds two more slow, irreversible external effects (Supabase admin writes and SMTP sends) and says nothing about their order relative to the commit.

**Units and divergence:**
- **Verification mail.** (a) Inserts the `email_verifications` row, sends the mail, and the request commits at the end. If the commit then fails, the student holds a link whose token was never stored, so `GET /api/auth/verify` answers `link_expired` for a fresh link. (b) Sends after commit; an SMTP failure then leaves a stored token that was never sent, which Resend can recover. Both are compliant. Only (b) fails safely.
- **Locks during SMTP.** In (a), a real cloud SMTP provider can take seconds, and the write transaction keeps the `profiles`/`email_verifications` locks and a pooled connection for that time. That is the same harm AD-18 prevents for LLM calls ("DB locks held during a model call").
- **Takeover in `user_auth` (AD-19).** It sets a random password through the admin API (irreversible), then deletes other sessions and sets `google_takeover_at` on the *request's* connection. If the route handler then raises any domain error (`not_found`, `project_read_only`, …), the request rolls back. The password change stays, the session deletes are undone, and the flags are not set, so an attacker's pre-registered sessions survive until a request succeeds. A second author might commit the takeover on its own connection. Both obey "services never commit", because `user_auth` sits in the API layer.
- **Failure surfacing.** Password reset must "always answer the same way" (FR-3), so an SMTP or `generate_link` failure there must be swallowed and logged. Sign-up verification and Resend have no such rule. One story returns 500, another swallows, and the SPA gets inconsistent copy.

**Tightening:** extend AD-18's last bullet: "No LLM, Supabase admin, or SMTP call inside an open write transaction. Mail is sent after the commit, and a send failure is logged and never fails the request. `user_auth`'s takeover commits in its own transaction before the route handler runs." This is a real trade-off (simplicity of one transaction vs safe failure), and the security part is not obvious.

## B3. Medium-High: what a Supabase Auth outage means for `user_auth` (close in the spine: one error code)

**Units:** (a) Story 1.3 maps any non-200 from `GET /auth/v1/user`, including timeouts, connection errors, and 5xx, to `unauthorized`. (b) The gateway maps provider outages to `llm_unavailable` (AD-3), so a later author expects the same pattern for Auth and returns 500.

**Divergence:** Under (a), a short GoTrue blip, or a paused Supabase Cloud free project (Deferred: "wake it before demos"), makes the SPA **sign every open tab out** (AD-2: "The SPA signs out on `unauthorized`") and drop in-progress quiz state. Under (b), the student sees the generic error envelope with no matching i18n copy (AD-26). The error-code list in Consistency Conventions has no code for "auth service unreachable", so neither story can do the right thing without inventing a code.

**Tightening:** in AD-2 step 1: "Only a 401/403 from Supabase Auth means `unauthorized`. Transport errors, timeouts, and 5xx raise `auth_unavailable` (503), and the SPA keeps the session." Add `auth_unavailable` to the code list. The admin calls in B1 use the same mapping.

## B4. Medium: client lifetime and timeouts (leave to Story 1.3's code, but say it in the seed comment)

**Units:** (a) Story 1.3 opens `async with httpx2.AsyncClient() as c:` inside `user_auth`, so every API request (including 2 s job polls, AD-20) does a new TCP connect, plus a TLS handshake against Supabase Cloud. (b) Story 1.5 creates one shared client in the lifespan on `app.state`. (c) Different stories pass different timeouts or rely on `httpx2`'s default 5 s.

**Divergence:** This is mostly performance (a slower poll loop in the cloud demo) and test fragility (code that reads `app.state.http` fails under a `TestClient` used without `with`, because the lifespan never ran). It is not a correctness split, and B1's single adapter removes most of it, because one module owns the client.

**Recommendation:** no AD needed. Add "shared `httpx2.AsyncClient`" to the `main.py` seed comment's lifespan list, next to "pool". Let Story 1.3 pick a short explicit timeout (for example 5 s connect and read) inside the adapter. Keep the LLM gateway's client separate (see B6).

## B5. Medium: SMTP connection model, TLS mode, and local reachability (leave the code shape, add one local-run check)

**Units:** (a) The verification-mail story uses one-shot `aiosmtplib.send(...)` per email. (b) A later author keeps a persistent `SMTP` connection in the lifespan, "like the pool". (c) Local settings are `SMTP_HOST=localhost` with no TLS, while the cloud setup needs STARTTLS on 587 or implicit TLS on 465 plus credentials.

**Divergence:**
- (b) breaks after the provider's idle timeout, and the first email after a quiet period fails. At this traffic level, (a) is clearly right. Only one module (`mailer.py`) is involved, so the first story decides this, and that is fine.
- TLS: `aiosmtplib` upgrades with STARTTLS automatically when the server offers it, and uses implicit TLS only with `use_tls=True`. Without an explicit setting, a port-465 provider fails while local still works. That is cheap to fix in code: one env variable such as `SMTP_TLS = none|starttls|tls`, plus `SMTP_HOST/PORT/USERNAME/PASSWORD/FROM` in `.env.example`, and none of them prefixed `SUPABASE_AUTH_*` (existing Config rule).
- **Reachability (check this at scaffold):** the Local-run row names only Mailpit's web UI (`localhost:54324`). The app container needs the **SMTP** port, and Supabase CLI's default `config.toml` ships the local mail server's `smtp_port` (54325) commented out, so it may not be exposed. From the container the host is also `host.docker.internal`, not `localhost` (AD-17). A mailer story that tests only under `uv run` on the host can pass while `docker compose up`, the grader's run, sends nothing.

**Recommendation:** leave the connection model and env names to the mailer story. Add one Local-run note: "`config.toml` exposes the local SMTP port; in the container `SMTP_HOST=host.docker.internal`." This takes a few words and protects the grader path.

## B6. Low: does the LLM gateway share the app's `httpx2` client? (leave to code)

**Units:** (a) The gateway passes the shared Supabase client to `AsyncOpenAI(http_client=...)` "to reuse httpx2". (b) It lets the SDK build its own client.

**Divergence:** In (a), connection limits and timeouts are shared between 1–3 long LLM streams (`JOBS_MAX_CONCURRENT`, AD-25 chat) and the per-request `user_auth` calls. A saturated pool could stall token validation behind generation, and a short Supabase timeout could kill streams if someone sets it on the client instead of per call. AD-3 already fixes `timeout=LLM_TIMEOUT_SECONDS` on `AsyncOpenAI`, and the `openai` import boundary keeps the gateway self-contained. The safe default (b) is also the obvious one.

**Recommendation:** leave it. If B1 is adopted, its wording ("the Supabase client") already implies the gateway keeps its own.

## B7. Low: version alignment between `openai` and `httpx2` (no action)

The memlog says the `openai` 3.x SDK defaults to `httpx2`. Because the spine pins `httpx2` 2.16 and `openai ≥ 3.42` separately, uv resolves a single version, and a conflict would show up in `uv lock`, not at runtime. No spine text is needed. When the gateway lands, confirm that `uv tree` shows one `httpx2` and no `httpx`, which B1's "no supabase-py" also helps ensure.

---

## Summary of recommended spine edits

| # | Edit | Where |
| --- | --- | --- |
| B1 | One adapter (`supabase_auth.py`) owns all Supabase Auth REST through `httpx2`. `storage.py` uses the same client. No supabase-py. Reword `auth.admin.delete_user`. Optional import test. | Layer table, Structural Seed, AD-19, Tests row |
| B2 | No Supabase admin or SMTP call inside an open write transaction. Mail after commit, and send failures are logged. Takeover commits in its own transaction. | AD-18 (and a cross-reference in AD-19) |
| B3 | GoTrue transport or 5xx failure → `auth_unavailable` (503), not `unauthorized`. | AD-2 step 1, error-code list |
| B4/B5 | Seed comment: shared `httpx2` client in the lifespan. Local run: SMTP port exposed, `host.docker.internal`. | Structural Seed, Local-run row |

Everything else (timeouts, the SMTP connection model, SMTP env names, gateway client separation) can be left to the first story that touches it.
