---
review: tech-currency
target: ARCHITECTURE-SPINE.md (updated 2026-11-02, status draft)
date: 2026-11-02
lens: every committed technology decision and every platform behaviour it relies on was checked against the live source, not taken from memory
method: npm registry (`npm view`), PyPI JSON API, GitHub releases API, vendor docs (WebFetch); items already verified in the memlog `(version)` entries were re-checked only when they had moved
---

# Tech-Currency Review (2026-11-02): AI Study Buddy V1 Architecture Spine

## Verdict

Most pins and platform claims hold up. Two of them break on day one of the scaffold, though:

- **Supabase CLI.** "Current at scaffold" now means **CLI v3.0.0, released today**. In v3, `supabase db push` targets the *local* stack by default.
- **Manual identity linking.** The spine's Settings "Link Google" path (`linkIdentity`) needs manual linking enabled, and AD-2's auth-settings list doesn't include it.

Fix those two and the Node minimum, and the spine is sound for scaffolding.

## Findings (most severe first)

### F1: HIGH. Supabase CLI "current at scaffold" now resolves to v3.0.0 (released today), which changes `db push` semantics (AD-16, Stack)

- **Spine says:** the CLI is a "pinned root devDependency, current at scaffold", and migrations "reach Supabase Cloud only through `npx supabase db push` from `main`" (AD-16).
- **Found:**
  - `npm view supabase version` returns **3.0.0**, published 2026-11-02T12:18Z. The 2.x line ends at **2.122.0**.
  - The v3 notes say: "`db push`, `db pull`, … target the local stack when you pass no target. Add `--remote` for the linked project." `--linked`, `--project-ref` and `--db-url` are deprecated.
  - Every hosted change now asks for confirmation, and **fails unattended unless you pass `--yes`**. The default answer is No.
  - Flags and `SUPABASE_*` env vars now **override `config.toml`**. The CLI auto-loads `.env`, `.env.local` and `.env.<SUPABASE_ENV>` from `supabase/` and then from the project root, which is the same root `.env` that holds the app's `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and so on. An invalid `SUPABASE_*` value fails every command with `CliConfigValueError`.
  - `[inbucket]` has been replaced by `[local_smtp]`, and Mailpit is the local mail server.
  - The release links to a v2→v3 migration guide that currently returns **404**.
  - Sources: https://github.com/supabase/cli/releases/tag/v3.0.0 and https://www.npmjs.com/package/supabase (guide link: https://supabase.com/docs/guides/local-development/cli/migrating-to-v3 → 404)
- **Fix:** Pin an exact CLI version in `package.json`. Either:
  - pin `supabase@2.122.0` for the course and record why, or
  - adopt `3.0.x` and change AD-16 to read `npx supabase db push --remote` (plus `--yes` in any CI).

  Either way, at scaffold, check that none of the app's `SUPABASE_*` variable names in the root `.env` is read as a CLI config override. If one is, rename the app variables (for example with an `APP_` prefix), or keep the app `.env` where the CLI doesn't load it. Write the pinned version into the Stack table.

### F2: HIGH. `linkIdentity` needs manual linking enabled; AD-2's settings list leaves it out (AD-1, AD-2, AD-19)

- **Spine says:**
  - AD-1 allows `linkIdentity` for Google.
  - AD-19 has "Settings' manual 'Link Google' requires `email_verified_at`".
  - AD-2 lists the Supabase Auth settings that must be identical locally and in the cloud, and manual linking isn't among them.
- **Found:**
  - The Supabase error code `manual_linking_disabled` means: "Calling the supabase.auth.linkUser() and related APIs is not enabled on the Auth server." https://supabase.com/docs/guides/auth/debugging/error-codes
  - In the CLI config, `auth.enable_manual_linking` defaults to **false**. https://supabase.com/docs/guides/local-development/cli/config
  - The identity-linking guide labels the feature "Manual linking (beta)". It's enabled in the dashboard, or with `GOTRUE_SECURITY_MANUAL_LINKING_ENABLED` when self-hosting. https://supabase.com/docs/guides/auth/auth-identity-linking
  - The supabase-js `linkIdentity` reference doesn't mention the prerequisite. https://supabase.com/docs/reference/javascript/auth-linkidentity
- **Fix:** Add "manual linking **on** (`[auth] enable_manual_linking = true`, and the same toggle in the Cloud dashboard)" to AD-2's settings list. Also note that it's a beta feature. Add a scaffold test in which a verified email Account links Google from Settings.

### F3: MEDIUM. The Node minimum is too low for react-router 8 (Stack)

- **Spine says:** "Node.js ≥ 22.12; 24 or 26 LTS, set in `engines`".
- **Found:** `react-router@8.5.1` declares `engines.node >=22.22.0` and peer `react >=19.2.7`. The v8 upgrade guide confirms "node@22.22+" for every mode, declarative included. Vite 8.3.5 and create-vite 9.3.3 only need `>=22.12.0`, so react-router is the binding constraint.
  - https://reactrouter.com/upgrading/v7.md
  - `npm view react-router@8.5.1 engines`
- **Fix:** Change the row to `≥ 22.22` (recommended: 24 or 26 LTS). Note also that v8 **removed `react-router-dom`**. Import `BrowserRouter`, `Routes`, `Route`, `Link` and `useNavigate` from `react-router`, and DOM-only APIs (`RouterProvider`) from `react-router/dom`. Nothing else in v8 is a breaking change for declarative mode: the future flags are framework or data mode only.

### F4: MEDIUM. `enabled` for the Google provider must itself come from the environment (AD-2)

- **Spine says:** "Google provider enabled only when its client id and secret are set in `.env` (read through `env()`)".
- **Found:**
  - `auth.external.<provider>.client_id` is required, with no default.
  - The secret defaults to `env(SUPABASE_AUTH_EXTERNAL_<PROVIDER>_SECRET)`.
  - `enabled` is a separate boolean that defaults to false. https://supabase.com/docs/guides/local-development/cli/config
  - `config.toml` can't express "enabled if the keys are present". A hard-coded `enabled = true` with an empty `client_id` breaks `supabase start` for a grader without keys.
  - CLI v3 states that `env()` is accepted on boolean fields, and that `SUPABASE_AUTH_EXTERNAL_GOOGLE_ENABLED` overrides config (F1 source).
- **Fix:** Write it as `enabled = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_ENABLED)"`, with `false` in `.env.example`. Derive `google_enabled` in `/api/config` from the same variable. Test `supabase start` with no Google keys set.

### F5: MEDIUM. FastAPI is now 0.162 after 12 "breaking" minors in 3 weeks; pin through the lockfile (Stack, AD-17, AD-25)

- **Spine says:** "FastAPI ≥ 0.143 (uses `app.frontend`)".
- **Found:**
  - The latest is **0.162.0** (2026-10-23).
  - Releases 0.145–0.162 each list "Breaking Changes". Most concern form, file and body parameter defaults, which is exactly the upload surface:
    - 0.147: omitted boolean form fields become False, reverted in 0.162
    - 0.150: unselected file inputs are treated as missing
    - 0.151: JSON null is distinguished from omitted
    - 0.155: `**extra` removed from params
    - 0.146: the `root_path` parameter is deprecated
  - Source: https://github.com/fastapi/fastapi/releases
  - `app.frontend()` is still documented, and its behaviour is unchanged:
    - fallback applies only to GET/HEAD requests that accept HTML
    - other methods get `404`
    - path operations win over frontend routes
    - Source: https://fastapi.tiangolo.com/tutorial/frontend/
  - FastAPI has had native SSE since **0.135**: `fastapi.sse.EventSourceResponse` / `ServerSentEvent`.
    - It works on POST.
    - It sets `Cache-Control: no-cache` and `X-Accel-Buffering: no` automatically.
    - It sends a keep-alive ping every 15 s.
    - Source: https://fastapi.tiangolo.com/tutorial/server-sent-events/
- **Fix:** Use `fastapi ≥ 0.162`, locked exactly in `uv.lock`, with upgrades done deliberately. In AD-25, name `EventSourceResponse` rather than a hand-rolled `StreamingResponse`. Its no-buffering header and pings also cover the Deferred hosting requirement ("not buffer streamed responses").

### F6: MEDIUM. OpenRouter stream errors arrive as HTTP 200; AD-3's error mapping covers only status codes (AD-3, AD-25)

- **Spine says:** `429` maps to `ProviderRateLimited` and `402/403` to `ProviderUnavailable`. AD-20 says cancel "cancels its in-flight LLM task".
- **Found:**
  - Once a stream has started, "the `200 OK` status is committed". In Chat Completions, the final chunk carries a top-level `error` and `finish_reason: "error"`.
  - Streams also contain `: OPENROUTER PROCESSING` comment lines. The openai SDK handles these.
  - Aborting a stream stops billing only "for supported providers". Cancelling a **non-streaming** request doesn't stop billing.
  - Source: https://openrouter.ai/docs/api/reference/streaming
- **Fix:** In AD-3, add a rule that `answer_chat_stream` treats `finish_reason == "error"` or a chunk-level `error` as a gateway exception, which becomes SSE `error{code}` plus a quota release. Note in AD-20 that cancelling a structured (non-streaming) job call only discards the result, and the cost is still incurred.

### F7: LOW. `generate_link`, admin password set, and `delete_user` are confirmed; there are two caveats (AD-19)

- **Confirmed:**
  - `supabase.auth.admin.generate_link({"type": "recovery", "email": …, "options": {"redirect_to": …}})` returns `properties.action_link`, `email_otp`, `hashed_token`, `redirect_to` and `verification_type`. It **doesn't send an email**: the links are "to be sent via a custom email provider".
    - https://supabase.com/docs/reference/python/auth-admin-generatelink
    - https://supabase.com/docs/reference/javascript/auth-admin-generatelink
    - https://github.com/supabase/supabase-py/blob/main/src/auth/src/supabase_auth/types.py
  - Supabase-py `admin.update_user_by_id(uid, {"password": …})` sets a password. https://supabase.com/docs/reference/python/auth-admin-updateuserbyid
  - `admin.delete_user(id)` hard-deletes by default (`should_soft_delete=False`). The `auth.users` row is removed and the delete cascades to `auth.sessions`. https://supabase.com/docs/reference/python/auth-admin-deleteuser and https://supabase.com/docs/guides/auth/managing-user-data
  - The recovery-link lifetime is `auth.email.otp_expiry`, which **defaults to 3600** (the docs state no maximum). The production checklist recommends ≤ 3600. https://supabase.com/docs/guides/deployment/going-into-prod
- **Caveat 1:** "You cannot delete a user if they are the owner of any objects in Supabase Storage." AD-19 deletes the `{account_id}/` prefix first, and objects uploaded with the secret key have no user owner, so this should be safe. Still, put it in a test, and keep deletion as the order of operations.
- **Caveat 2:** That a hard delete frees the email for re-registration is **not stated in the docs**. It's an inference from the row being removed. Assert it in an integration test.
- **Caveat 3:** Supabase links are single-use, and email link scanners can consume them ("prefetching … can consume the OTP token"). https://supabase.com/docs/guides/troubleshooting/otp-verification-failures-token-has-expired-or-otp_expired-errors-5ee4d0.md
  - Option: email a link to the SPA's reset route carrying `hashed_token`, and have the SPA call `verifyOtp({type: "recovery", token_hash})`. A prefetch can't consume that.
- **Fix:** Remove `[verify generate_link at scaffold]` from AD-19, since it's now verified. Add the `otp_expiry = 3600` key name to AD-2. Optionally adopt the token-hash reset route.

### F8: LOW. `auth.sessions` and revocation are confirmed; `capture="environment"` works over HTTP (AD-2, AD-24)

- **Sessions:**
  - The auth migration creates `sessions(id uuid pk, user_id → users ON DELETE CASCADE, created_at, updated_at)`. https://github.com/supabase/auth/blob/master/migrations/20220811173540_add_sessions_table.up.sql
  - `refresh_tokens.session_id` references `sessions(id)` **ON DELETE CASCADE**, so deleting session rows revokes refresh.
  - Access tokens stay valid until `exp`, which is why AD-2's per-request row lookup is needed. Sign-out removes the rows. https://supabase.com/docs/guides/auth/sessions
  - `created_at` is **nullable**. Treat NULL as expired.
  - Time-box and inactivity timeout are still Pro-only, which confirms the custom 30-day check is needed.
- **Phone capture:**
  - The HTML Media Capture spec has no secure-context requirement. Capture happens in the OS picker. https://w3c.github.io/html-media-capture/
  - MDN compatibility data: `capture` is supported in **Chrome Android 25+** and **Safari iOS 10+**. Desktop Chrome, Firefox and Safari ignore it and show a normal picker. https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture and https://github.com/mdn/browser-compat-data/blob/main/api/HTMLInputElement.json
  - Plain-HTTP LAN is fine for the input itself. The phone page must avoid secure-context-only APIs (for example `crypto.randomUUID`, `navigator.clipboard`) when it's served from `http://<LAN-IP>`.
  - The attribute is only a hint, so the server-side type and size checks stay authoritative, as they already are.

## Other items verified with no change needed

| Item | Spine | Found (2026-11-02) | Source |
| --- | --- | --- | --- |
| OpenRouter `provider.zdr` | per-request, combined with `data_collection: "deny"` and `require_parameters: true` | Per-request boolean that restricts routing to ZDR endpoints. It works as an OR with the account and guardrail ZDR settings (it can turn ZDR on, never off). `data_collection` defaults to `"allow"`. `require_parameters` defaults to `false`. Safety-Retention endpoints are included only if the account allows them. Implicit in-memory caching isn't counted as retention. A CSAM screening update took effect on 2026-10-27. | https://openrouter.ai/docs/features/provider-routing, https://openrouter.ai/docs/features/zdr |
| openai SDK `extra_body` | `provider` sent via `extra_body` | The README documents `extra_query`, `extra_body` and `extra_headers`. HTTPX2 is the default client. Chat Completions are "supported indefinitely". The latest is **3.42.1** (2026-11-01), so `3.x (≥ 3.29)` holds. | https://github.com/openai/openai-python/blob/main/README.md, https://pypi.org/project/openai/ |
| Chat streaming with citations | plain text deltas plus inline `[S:id]` markers | Fine. This is ordinary Chat Completions streaming, and no structured-output streaming is needed. | (F6 source) |
| pdfplumber | "current at scaffold" | **0.11.10** (2026-06-15), a pure-Python wheel, classifiers up to Python 3.14. It depends on pdfminer.six==20260107 and pypdfium2 ≥ 5.9. It doesn't conflict with `markitdown[docx,pptx]`, because markitdown pulls in pdfminer only under `[pdf]`/`[all]`. Pin `0.11.x`. | https://pypi.org/project/pdfplumber/ |
| markitdown `.pptx` markers | split on `<!-- Slide number: N -->` | Still emitted in `main`. Speaker notes are appended per slide as `### Notes:`, so they become part of the slide's Section (decide whether that's wanted). The latest is **0.1.9** (2026-10-21, fixes only; Python `>=3.10,<3.15`). Bumping the Stack row to 0.1.9 is optional. | https://github.com/microsoft/markitdown/blob/main/packages/markitdown/src/markitdown/converters/_pptx_converter.py, https://github.com/microsoft/markitdown/releases/tag/v0.1.9 |
| pillow-heif | 1.8 | 1.8.1, with cp314 wheels for win_amd64, manylinux x86_64/aarch64 and musllinux | https://pypi.org/project/pillow-heif/1.8.1/ |
| psycopg | 3.3 | 3.3.6. `psycopg-binary` 3.3.6 has cp314 win_amd64 and manylinux wheels | https://pypi.org/project/psycopg-binary/3.3.6/ |
| radix-ui | 1.8, unified package | 1.8.1. Install with `npm install radix-ui`. Import as `import { Dialog } from "radix-ui"`, or use the tree-shake-friendly `import * as Dialog from "radix-ui/dialog"`. React 19 peer is OK. | https://www.radix-ui.com/primitives/docs/overview/getting-started |
| react-i18next / i18next | 17.1 / 26.7 | 17.1.11 / 26.7.1. Peer `i18next >= 26.2.0`. The recent changelog is fixes only. | https://github.com/i18next/react-i18next/blob/master/CHANGELOG.md |
| @fontsource-variable/inter | 5.3 | 5.3.0. `import "@fontsource-variable/inter"` resolves to `index.css` | `npm view @fontsource-variable/inter@5.3.0 exports` |
| qrcode | 1.5 | 1.5.4, last published 2024-08-05. Stable but quiet. Acceptable for client-side QR. | https://www.npmjs.com/package/qrcode |
| @supabase/supabase-js | 2.118 | 2.118.0, Node ≥ 22 | `npm view @supabase/supabase-js` |
| supabase-py (if used for admin calls) | not pinned | `supabase` 2.33.0 / `supabase-auth` 2.33.0. Add it to the Stack table if `services/identity` uses it rather than raw GoTrue REST. | https://pypi.org/project/supabase/ |
| Lifespan background tasks with a single worker | in-process `asyncio` jobs plus an hourly purge | Valid pattern. Two platform rules apply:<br>1. Keep a strong reference to every `asyncio.create_task` result ("to avoid a task disappearing mid-execution").<br>2. pdfplumber, MarkItDown, pillow-heif and sync psycopg block the event loop. Run them via `asyncio.to_thread`, or use `psycopg.AsyncConnection`, or the job runner will stall chat streaming and polling. | https://docs.python.org/3/library/asyncio-task.html#asyncio.create_task |
| Supabase automatic linking | accepted for verified Accounts; takeover for unverified | Confirmed. Supabase refuses to auto-link to unverified emails and "will remove any other unconfirmed identities". Inference, to verify in a test: with `enable_confirmations=false`, signup auto-confirms the email at the Supabase level, so auto-linking *will* happen for app-unverified Accounts. That's why AD-19's takeover (random password plus deleting other sessions) is needed. | https://supabase.com/docs/guides/auth/auth-identity-linking |

## Sources

- https://github.com/supabase/cli/releases/tag/v3.0.0
- https://www.npmjs.com/package/supabase
- https://supabase.com/docs/guides/local-development/cli/config
- https://supabase.com/docs/guides/auth/debugging/error-codes
- https://supabase.com/docs/guides/auth/auth-identity-linking
- https://supabase.com/docs/reference/javascript/auth-linkidentity
- https://supabase.com/docs/reference/python/auth-admin-generatelink
- https://supabase.com/docs/reference/javascript/auth-admin-generatelink
- https://github.com/supabase/supabase-py/blob/main/src/auth/src/supabase_auth/types.py
- https://supabase.com/docs/reference/python/auth-admin-updateuserbyid
- https://supabase.com/docs/reference/python/auth-admin-deleteuser
- https://supabase.com/docs/guides/auth/managing-user-data
- https://supabase.com/docs/guides/auth/sessions
- https://github.com/supabase/auth/blob/master/migrations/20220811173540_add_sessions_table.up.sql
- https://supabase.com/docs/guides/deployment/going-into-prod
- https://supabase.com/docs/guides/troubleshooting/otp-verification-failures-token-has-expired-or-otp_expired-errors-5ee4d0.md
- https://openrouter.ai/docs/features/provider-routing
- https://openrouter.ai/docs/features/zdr
- https://openrouter.ai/docs/api/reference/streaming
- https://github.com/openai/openai-python/blob/main/README.md
- https://pypi.org/project/openai/
- https://fastapi.tiangolo.com/tutorial/frontend/
- https://fastapi.tiangolo.com/tutorial/server-sent-events/
- https://github.com/fastapi/fastapi/releases
- https://pypi.org/project/pdfplumber/
- https://github.com/microsoft/markitdown/blob/main/packages/markitdown/src/markitdown/converters/_pptx_converter.py
- https://github.com/microsoft/markitdown/releases/tag/v0.1.9
- https://pypi.org/project/pillow-heif/1.8.1/
- https://pypi.org/project/psycopg-binary/3.3.6/
- https://reactrouter.com/upgrading/v7.md
- https://www.radix-ui.com/primitives/docs/overview/getting-started
- https://github.com/i18next/react-i18next/blob/master/CHANGELOG.md
- https://www.npmjs.com/package/qrcode
- https://pypi.org/project/supabase/
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture
- https://github.com/mdn/browser-compat-data/blob/main/api/HTMLInputElement.json
- https://w3c.github.io/html-media-capture/
- https://docs.python.org/3/library/asyncio-task.html#asyncio.create_task
