# Tech-currency review: httpx2 / aiosmtplib amendment (2026-11-12b)

**Scope:** the uncommitted diff to `ARCHITECTURE-SPINE.md` only:
- AD-2 step 1: token validation via "async `httpx2` client" (line 106)
- AD-19: auth emails sent "over SMTP with `aiosmtplib`" (line 465)
- Stack table: `httpx2` 2.16 and `aiosmtplib` 5.1 (lines 671-672)

Checked against Python 3.14, FastAPI 0.162 / Starlette 1.10.0 (`backend/uv.lock`), and openai SDK 3.x.

**Method:** PyPI JSON API (live, 2026-11-12), GitHub API for the repos, upstream README / CI config, and the installed Starlette source in `backend/.venv`. Nothing below is asserted from training data alone.

## Verdict

**Pass.** Both libraries exist, are maintained, and the pinned minors are current. httpx2 is the real, ecosystem-endorsed successor to httpx, not a typosquat. Three small follow-ups, none of which need a spine change.

## Evidence

### httpx2

| Check | Result |
|---|---|
| PyPI latest | `2.16.0`, uploaded 2026-10-21; earlier 2.13.1 (09-23), 2.14.0 (10-18), 2.15.x (10-19) |
| Requires-Python | `>=3.11`; classifiers list 3.11-3.15, so 3.14 is covered |
| Status / licence | Production/Stable, BSD-3-Clause; author metadata Tom Christie (original httpx author) |
| Source | `github.com/pydantic/httpx2`: not a fork, not archived, ~1.6k stars, last push 2026-11-11 |
| Stewardship | README: Pydantic took over stewardship "under the HTTPX2 name" because httpx saw limited activity. `encode/httpx` has only shipped `1.0.devN` pre-releases since 0.28.1 |
| Starlette 1.10.0 | `starlette/testclient.py` does `import httpx2 as httpx` first. It falls back to `httpx` with a `StarletteDeprecationWarning` ("Using `httpx` with `starlette.testclient` is deprecated; install `httpx2` instead"). The `full` extra lists `httpx2>=2.0.0` |
| FastAPI 0.162.x | the `standard`/`all` extras list `httpx2>=2.0.0` (next to the legacy `httpx<1.0.0`) |
| openai 3.49.0 (latest) | **hard dependency** `httpx2<3,>=2.12.0`, so 2.16 sits inside the SDK's range and the app already pulls httpx2 in transitively |
| Deps | `httpcore2==2.16.0` (same maintainer, same release), `anyio>=4.10`, `idna`, `truststore>=0.10` (replaces `certifi`) |

The spine's claim "also Starlette's TestClient" is accurate for the locked Starlette 1.10.0.

### aiosmtplib

| Check | Result |
|---|---|
| PyPI latest | `5.1.3`, uploaded 2026-09-08 (5.1.0 2026-01-25, 5.0.0 2025-10-19), so "5.1" is the current minor |
| Requires-Python | `>=3.10`. PyPI lists no per-version classifiers, but upstream CircleCI tests 3.10-3.15 including 3.14 and 3.14t |
| Status / licence | Production/Stable, MIT, zero runtime deps |
| Source | `github.com/cole/aiosmtplib`: not archived, last push 2026-11-03 |
| Fit | asyncio-native, so it fits AD-29 (async I/O paths) with no `to_thread` wrapper |

## Findings

1. **[Medium, follow-up, not a spine defect] The backend still locks `httpx`, not `httpx2`.** `backend/pyproject.toml` line 22 has `httpx>=0.28.1` as a dev dependency, and `uv.lock` resolves `httpx 0.28.1` / `httpcore 1.0.9`. Since Starlette 1.10 prefers httpx2, tests using `TestClient` now emit a `StarletteDeprecationWarning`. Once the openai SDK is added, both httpx and httpx2 would be installed. The story that adds `app/auth.py` should replace the dev dependency with `httpx2>=2.16`, add it to main dependencies, and drop `httpx`. Code should `import httpx2` directly (or `import httpx2 as httpx`), and tests should never mix the two packages' exception and transport types.

2. **[Low] httpx2 trusts the OS certificate store through `truststore`, not `certifi`.** httpx2 depends on `truststore`, so HTTPS calls to cloud Supabase and OpenRouter use the container's CA bundle. The `python:3.14-slim` base in `Dockerfile` normally ships `ca-certificates`, but no one has checked this for the image. Local Supabase is plain `http://`, so the grader run is unaffected. Confirm one HTTPS call from inside the built image before the first cloud deploy.

3. **[Low] httpx2 releases quickly.** Four minors shipped in roughly a month (2.13 to 2.16). The "2.16" pin means a `>=2.16` floor, and openai caps it at `<3`. The lockfile is what freezes the version, so commit `uv.lock` updates deliberately. No action beyond normal lockfile hygiene.

4. **[Info] Mailpit and SMTP TLS.** Mailpit locally accepts plain SMTP on port 1025. aiosmtplib 5.x upgrades to STARTTLS automatically when the server advertises it. `mailer.py` should take TLS mode, port, and credentials from env (names in `.env.example`), not hard-code them, so the same code works against Mailpit and the future cloud SMTP provider (spine line 808). This is an implementation note, not a currency issue.

5. **[Info] Consistency.** No other spine line mentions `httpx`, so nothing is left stale. AD-3 still holds: httpx2 is used for Supabase Auth only, and LLM traffic still goes only through `backend/app/llm/` (the openai SDK uses httpx2 internally, which is fine).

## Not checked

- No httpx2 or aiosmtplib calls have been run on this machine, because neither package is installed in `backend/.venv` yet.
- No CVE or advisory scan was run beyond confirming both projects are active.
