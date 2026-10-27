---
review: tech-currency
target: ARCHITECTURE-SPINE.md (+ .memlog.md)
date: 2026-10-13
lens: Is every committed technology decision web-verified, current, and does each live default/behaviour the spine relies on actually hold?
---

# Tech-Currency Review — AI Study Buddy V1 Architecture Spine

## Verdict

Most choices hold up: they exist, fit the use, and are documented. But one load-bearing behaviour is wrong. MarkItDown's PDF output has no page boundaries and drops empty pages, so AD-5 and AD-6 can't be built on it as written. Several version pins are also already stale: openai is on 3.x, not 2.x; markitdown is 0.1.8; FastAPI is 0.143; React is 19.3; Node 24 leaves Active LTS on 2026-10-20.

## Findings (most severe first)

### F1 — HIGH — MarkItDown can't give one Section per PDF page, and it hides empty pages (AD-5, AD-6)

- **Spine says:** "Office and PDF formats use MarkItDown", and PDF yields "one Section per page". AD-6 Accept/Warn/Reject uses "≥ 80 % of pages/slides contain readable text", and scanned pages "count as unreadable".
- **Found:** The MarkItDown PDF converter returns one Markdown string, built as `"\n\n".join(markdown_chunks)`, with no page markers. A page break and a paragraph break both become `\n\n`. Pages with no extractable text are skipped entirely. The pdfminer fallback path also returns one blob for the whole document. So from MarkItDown's output you can't split by page or count unreadable pages, which means the AD-6 percentage can't be computed.
  - Source: https://github.com/microsoft/markitdown/blob/main/packages/markitdown/src/markitdown/converters/_pdf_converter.py
- **.pptx is fine:** the converter writes `<!-- Slide number: N -->` before each slide, so splitting per slide works if you split on that marker. Treat the marker as an internal format and cover it with a test.
  - Source: https://github.com/microsoft/markitdown/blob/main/packages/markitdown/src/markitdown/converters/_pptx_converter.py
- **Fix:** Amend AD-5. For PDFs, iterate pages with `pdfplumber`, which is already installed as a dependency of `markitdown[pdf]`, calling `page.extract_text()` per page. One Section per page; an empty page counts as unreadable for AD-6. Keep MarkItDown for .docx and .pptx (split .pptx on the slide marker). Add a scaffold test with a 3-page PDF that has one blank page.

### F2 — HIGH — The openai SDK pin is a major version behind (Stack, AD-3)

- **Spine says:** `openai` "2.x (≥ 2.53)". The memlog says "openai SDK ~2.53 (Aug 2026)".
- **Found:** The latest is **3.29.0** (released 2026-10-11). 3.0.0 came out on 2026-08-12. Its breaking change: HTTPX2 is now the default HTTP client and `httpx` is no longer installed automatically. Third-party reports also say certifi was dropped in favour of the OS trust store, which can break TLS in slim containers. That claim isn't confirmed in the primary source.
  - https://pypi.org/project/openai/3.29.0/
  - https://github.com/openai/openai-python/releases/tag/v3.0.0
  - https://ecorpit.com/openai-python-3-0-httpx2-certifi-tls-container-breakage-2026/ (third-party)
- **Fix:** Change the Stack row to `openai 3.x (≥ 3.29)`. Note that any test that mocks at the HTTP layer (respx, httpx mocks) must target HTTPX2. AD-4's fixture-level mock is unaffected. Make sure the runtime image has `ca-certificates` installed, and smoke-test one live call from the container at scaffold. If the team prefers 2.x, pin `<3` explicitly and record why.

### F3 — MEDIUM — The local Supabase CLI issues HS256 tokens by default, so the JWKS path is never exercised locally (AD-2)

- **Spine says:** Verify against JWKS and fall back to `GET /auth/v1/user` "when the project has no asymmetric keys". It carries `[ASSUMPTION: local Supabase CLI and the cloud project behave the same here]`.
- **Found:**
  - The Supabase docs say the JWKS endpoint "does not return any keys if you are not using asymmetric JWT signing keys". For HS256 they recommend `GET /auth/v1/user`. https://supabase.com/docs/guides/auth/jwts
  - Locally, asymmetric keys are opt-in: you set `signing_keys_path` in `config.toml` and run `supabase gen signing-key --algorithm ES256`. The file must be a bare JSON array. There are known pitfalls with ES256 vs HS256 mismatches. https://github.com/supabase/cli/issues/4098 and https://github.com/supabase/cli/issues/4488
  - Without that setup the local stack signs tokens with HS256, so the grader's run always takes the fallback path. Cloud (new projects) takes the JWKS path. The two code paths differ between environments, and only one gets tested.
- **Fix:** Pick one path and remove the assumption:
  - **Option (a), simplest:** always call `GET /auth/v1/user` with the token. That adds one network hop per request, which is negligible at this scale. The call also rejects revoked sessions.
  - **Option (b):** commit a dev-only signing-key file. This conflicts with the "never commit secrets" policy, so it isn't recommended.

  Separately, `session_id` is confirmed as a required JWT claim (https://supabase.com/docs/guides/auth/jwt-fields), and sessions live in `auth.sessions` (https://supabase.com/docs/guides/auth/sessions). The docs don't list that table's columns, though. Verify `created_at` at scaffold with `\d auth.sessions`. Treat a missing row (logged out or revoked) as `401`.

### F4 — MEDIUM — Node 24 stops being Active LTS one week after this spine is written (Stack)

- **Spine says:** Node.js "24 LTS". The memlog says "Node 24 Active LTS (inferred from schedule, verify at scaffold)".
- **Found:** Per the official schedule, v24 enters **Maintenance on 2026-10-20** and reaches end-of-life on 2028-04-30. **v26 becomes Active LTS on 2026-10-28.** https://raw.githubusercontent.com/nodejs/Release/main/schedule.json
- **Is 24 still usable?** Yes. Vite 8 and create-vite 9 need `^20.19 || >=22.12`, and supabase-js 2.117 needs `>=22`, so Node 24 works for the whole project.
- **Fix:** Write "Node.js 24 (Maintenance LTS from 2026-10-20; 26 is acceptable once Active LTS on 2026-10-28)", or require `>=22.12` in `package.json` `engines`. The memlog line should state the real dates instead of "inferred".

### F5 — LOW — FastAPI pin is stale, and a native SPA-fallback API now exists (Stack, AD-17)

- **Spine says:** FastAPI "0.136". AD-17 describes a hand-built "SPA fallback".
- **Found:**
  - The latest is **0.143.0** (2026-10-08). Its one breaking change is that OpenTelemetry auto-configuration became opt-in. https://pypi.org/project/fastapi/0.143.0/ and https://github.com/fastapi/fastapi/releases
  - FastAPI now has `app.frontend("/", directory="dist", fallback="index.html")`. Fallback applies only to GET/HEAD navigation-like requests, missing assets still return 404, and API routes take precedence. It was added around 0.138, with `check_dir` arriving in 0.141. https://fastapi.tiangolo.com/tutorial/frontend/
- **Fix:** Pin `fastapi >= 0.141`. In AD-17, use `app.frontend(...)` instead of a custom catch-all, with `check_dir=False` so dev runs work without a build. Add an explicit `/api/{path:path}` 404 JSON route so unknown API paths never return `index.html`.

### F6 — LOW — Other pins drifted, and some details are missing (Stack)

| Item | Spine | Current (2026-10-13) | Source |
| --- | --- | --- | --- |
| markitdown | 0.1.4 | **0.1.8** (2026-09-21); requires Python `>=3.10,<3.15` (fits 3.14); `[pdf]` extra pulls in pdfminer-six and pdfplumber | https://pypi.org/pypi/markitdown/json |
| React | 19.2 | **19.3.0** | https://registry.npmjs.org/react/latest |
| psycopg | 3.3 (memlog 3.3.4) | 3.3.6 (2026-09-18); fine. Recommend `psycopg[binary]` for Windows dev | https://pypi.org/pypi/psycopg/json |
| pillow-heif | 1.x | **1.8.1** (2026-10-11); cp314 wheels for win_amd64 and manylinux x86_64 exist. Confirmed fit | https://pypi.org/project/pillow-heif/1.8.1/ |
| Vite | not stated (only create-vite 9.x) | create-vite **9.2.1**; Vite **8.3.4**; template `react` (`npm create vite@latest frontend -- --template react`) confirmed | https://registry.npmjs.org/create-vite/latest, https://registry.npmjs.org/vite/latest, https://github.com/vitejs/vite/tree/main/packages/create-vite |
| supabase-js | ≥ 2.110, Node ≥ 22 | 2.117.3, engines `>=22.0.0`. Confirmed | https://registry.npmjs.org/@supabase/supabase-js/latest |

- **Fix:** Update the Stack rows to the minors above. Add a "Vite 8.x" row. Lock everything through `uv.lock` and `package-lock.json` at scaffold.

## Items verified with no change needed

- **Supabase key naming and env vars.** The keys are `sb_publishable_…` and `sb_secret_…`. `supabase start` prints both locally, and "the local secret key takes the place of the local service_role key". The secret key is rejected from browsers. The React quickstart uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` with `createClient(url, publishableKey)`, matching the spine's convention. https://supabase.com/docs/guides/api/api-keys and https://supabase.com/docs/guides/getting-started/quickstarts/reactjs
  - Caveat for `storage.py`: secret keys are not JWTs. Send them in the `apikey` header rather than `Authorization: Bearer`, and the docs ask for log sanitisation. The spine doesn't say whether `storage.py` uses `supabase-py` or raw HTTP. Choose one at scaffold and confirm it supports `sb_secret_` keys.
- **The 30-day time-box is Pro-only** ("only available on Pro Plans and up"), which confirms the need for the custom `session_id`/`created_at` check. https://supabase.com/docs/guides/auth/sessions
- **OpenRouter structured outputs.** `response_format: {type: "json_schema", json_schema: {name, strict: true, schema}}` is confirmed. `provider.require_parameters: true` is a per-request field that limits routing to endpoints supporting every parameter in the request. https://openrouter.ai/docs/features/structured-outputs and https://openrouter.ai/docs/features/provider-routing
  - Implementation note: the openai SDK has no `provider` parameter, so pass it via `extra_body={"provider": {...}}`. The OpenRouter docs don't show an openai-SDK example of this.
  - The spine defers "no training" to an account setting. A per-request `provider.data_collection: "deny"` (or `zdr: true`) is also available and enforces it in code. Consider adding it in the gateway.
- **OpenRouter image input.** The `image_url` content part with a `data:image/jpeg;base64,…` URL is confirmed. https://openrouter.ai/docs/guides/overview/multimodal/image-understanding
  - Supported input formats aren't listed in the docs, and HEIC isn't mentioned, which justifies the spine's HEIC→JPEG conversion. Converting every image to JPEG, not only HEIC, is the safest choice.
- **react-router** is deliberately deferred. Fine.
- **Python 3.14** pin is fine. markitdown caps Python at `<3.15`, which supports *not* moving to 3.15 yet.

## Sources

- https://raw.githubusercontent.com/nodejs/Release/main/schedule.json
- https://github.com/microsoft/markitdown/blob/main/packages/markitdown/src/markitdown/converters/_pdf_converter.py
- https://github.com/microsoft/markitdown/blob/main/packages/markitdown/src/markitdown/converters/_pptx_converter.py
- https://pypi.org/pypi/markitdown/json
- https://pypi.org/project/openai/3.29.0/
- https://github.com/openai/openai-python/releases/tag/v3.0.0
- https://ecorpit.com/openai-python-3-0-httpx2-certifi-tls-container-breakage-2026/
- https://supabase.com/docs/guides/auth/jwts
- https://supabase.com/docs/guides/auth/jwt-fields
- https://supabase.com/docs/guides/auth/sessions
- https://supabase.com/docs/guides/auth/signing-keys
- https://supabase.com/docs/guides/api/api-keys
- https://supabase.com/docs/guides/getting-started/quickstarts/reactjs
- https://github.com/supabase/cli/issues/4098
- https://github.com/supabase/cli/issues/4488
- https://humanwhocodes.com/snippets/2026/02/using-your-own-supabase-signing-keys/
- https://pypi.org/project/fastapi/0.143.0/
- https://github.com/fastapi/fastapi/releases
- https://fastapi.tiangolo.com/tutorial/frontend/
- https://pypi.org/project/pillow-heif/1.8.1/
- https://pypi.org/pypi/psycopg/json
- https://registry.npmjs.org/create-vite/latest
- https://registry.npmjs.org/vite/latest
- https://github.com/vitejs/vite/tree/main/packages/create-vite
- https://registry.npmjs.org/@supabase/supabase-js/latest
- https://registry.npmjs.org/react/latest
- https://openrouter.ai/docs/features/structured-outputs
- https://openrouter.ai/docs/features/provider-routing
- https://openrouter.ai/docs/guides/overview/multimodal/image-understanding
