---
title: 'Story 2.4a: The LLM gateway and test mode'
type: 'feature'
created: '2026-11-17'
status: 'done'
baseline_commit: '0f1fce6c4fcac8b14a4107a17208bd677a8d7671'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The app can't call an AI model yet, and every AI feature (naming, Topics, image text, Quiz, …) needs one gateway that keeps students' material private and runs without a key for the grader (AD-3, AD-4, FR-30). Split from Story 2.4 by Cristoffer on 2026-11-17; the automatic Project name follows in Story 2.4b.

**Approach:**
- Build `backend/app/llm/`, the only `openai` importer. It uses `AsyncOpenAI` at `https://openrouter.ai/api/v1` with `LLM_TIMEOUT_SECONDS`.
- Every live request sends `extra_body.provider = {require_parameters: true, data_collection: "deny", zdr: true}` and `response_format: json_schema`. The output is validated against the task's Pydantic schema with one retry, then the gateway raises `LLMOutputError`.
- Provider errors become `ProviderRateLimited` (429) and `ProviderUnavailable` (402/403, timeout, connection error). The API maps them to `503 llm_unavailable` and `LLMOutputError` to `502 llm_output_invalid`, in the error envelope.
- The first typed task is `name_project(sections) -> ProjectName{name: 1–100 chars}`. Its prompt (in `llm/prompts/`) asks for a short name in the material's main language, from the supplied text only. It uses `LLM_TEXT_MODEL`.
- Mock mode (`LLM_MODE=mock`) returns deterministic fixture output, parsed through the same schema. For `name_project` that is the first Markdown heading of the first Section, else its first six words, trimmed to 100 characters. `LLM_MOCK_DELAY_MS` delays every mock task. No key and no network are needed.
- The gateway is created once in the app lifespan and is available on `app.state`.

## Boundaries & Constraints

**Always:**
- Only `backend/app/llm/` imports `openai`; the existing boundary test stays green. Tests always run with `LLM_MODE=mock`, and live-path tests use a stubbed client with no network.
- Log task, model, duration, and outcome only. Never log keys, prompts, or material text.
- The new settings `LLM_TEXT_MODEL`, `LLM_TIMEOUT_SECONDS` (default 60), and `LLM_MOCK_DELAY_MS` (default 0) go into `config.py` and `.env.example` without values. The existing `resolve_llm_mode` rules are unchanged.

**Never:**
- No caller of `name_project` yet (Story 2.4b). No other task (`detect_topics`, `extract_image_text`, … come with their stories). No quota logic, no UI change, and no SDK other than `openai`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Mock, heading | Sections of `test-data/photosynthesis-notes.md` | `ProjectName(name="Photosynthesis: Study Notes")`; same result every time | N/A |
| Mock, no heading | first Section "Water evaporates from oceans and lakes when …" | `ProjectName(name="Water evaporates from oceans and lakes")` | N/A |
| Mock, delay | `LLM_MOCK_DELAY_MS=50` | returns after at least 50 ms | N/A |
| Live request | `LLM_MODE=live`, stubbed client | one call with the model, `extra_body.provider` (three flags), and `response_format.type == "json_schema"` | N/A |
| Live, invalid once | the first reply isn't schema-valid, the second is | the second result is returned (exactly one retry) | N/A |
| Live, invalid twice | both replies invalid, or a blank name | `LLMOutputError` | `502 llm_output_invalid` when it reaches a route |
| Provider errors | 429 / 402 / 403 / timeout | `ProviderRateLimited` / `ProviderUnavailable` | `503 llm_unavailable` |

</frozen-after-approval>

## Code Map

- `backend/app/config.py` -- `llm_mode`, `openrouter_api_key`, `resolve_llm_mode` (L95-109) exist; add the three settings.
- `backend/app/main.py` lifespan -- sets `app.state.llm_mode` already; create the gateway there and store it on `app.state.llm`.
- `backend/app/llm/__init__.py` -- empty stub; add `gateway.py`, `schemas.py`, `errors.py`, `prompts/name_project.md`, `fixtures.py`.
- `backend/app/errors.py` -- `AppError` and the envelope handlers; add handlers for the gateway exceptions.
- `backend/tests/test_boundaries.py` -- the AST test that only `app/llm/` imports `openai`.
- `backend/app/extraction/` -- produces the Sections (`label`, Markdown `text`) that `name_project` takes; `test_extraction.py` shows how to build them from `test-data/`.
- `backend/pyproject.toml` -- add `openai` (pinned).
- `frontend/src/i18n/en.json`, `nb.json` -- add `errors.llm_unavailable` from EXPERIENCE.md L275 ("The AI service isn't responding right now." / "KI-tjenesten svarer ikke akkurat nå."). `llm_output_invalid` uses the generic error text.

## Tasks & Acceptance

**Execution:**
- [x] `backend/pyproject.toml`, `app/config.py`, `.env.example` -- the `openai` dependency and the three settings.
- [x] `backend/app/llm/` -- the gateway (live client, mock path, one schema retry, error mapping, logging), `schemas.ProjectName`, the prompt, and the mock fixture for `name_project`.
- [x] `backend/app/main.py`, `app/errors.py` -- create the gateway in lifespan; map gateway errors to the error envelope.
- [x] `backend/tests/test_llm.py` -- every matrix row, plus a route-level test (a throwaway route raising each gateway error) for the envelope codes.
- [x] `frontend/src/i18n/en.json`, `nb.json` -- `errors.llm_unavailable`.

**Acceptance Criteria:**
- Given `LLM_MODE=mock` and no key, when the full suite runs, then nothing reaches the network.
- Given `APP_ENV=development` and no key, then `LLM_MODE` still resolves to mock with a warning.

## Verification

**Commands:**
- `cd backend; uv run pytest` -- expected: all green with `LLM_MODE=mock`
- `cd frontend; npm test; npm run lint` -- expected: all green

## Implementation Notes

- `openai==3.52.0` (it depends on `httpx2`, already in the project). The gateway is `app.llm.Gateway`; `create_gateway(settings, mode)` builds it in the lifespan, `app.state.llm`, closed on shutdown. Mock mode creates no client.
- Live mode without `LLM_TEXT_MODEL` fails at startup with `ConfigError` (in `create_gateway`); `resolve_llm_mode` is unchanged.
- The mock fixture uses the first non-blank Section (blank PDF pages or slides are skipped) and lives in `llm/fixtures.py` as this spec's Code Map says; the spine's AD-4 wording is `llm/fixtures/` (a folder). Turn it into a package when later tasks add fixtures.
- Every non-429 provider status (402, 403, 5xx, …), timeouts, and connection errors become `ProviderUnavailable`; provider errors are not schema retries. The client is built with `max_retries=0`, so the SDK adds no hidden retries; failures are logged with their message (e.g. `ProviderUnavailable (Provider answered 401)`). A 200 reply without a message counts as invalid output.
- `name_project` sends Sections labelled `[S1]…[Sn]`, capped at 12,000 characters in total (`NAME_PROJECT_MAX_CHARS`), with `strict: true` and the Pydantic JSON schema (includes `minLength`/`maxLength`). Not yet tried against a real OpenRouter model.
- `errors.llm_output_invalid` is added to both catalogues with the generic text.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | VG, BH | 12,000-char cap in `label_sections` untested | medium | No test referenced `label_sections`/`NAME_PROJECT_MAX_CHARS`; only a 60-char single Section reached the live path | patch — cap test added |
| 2 | VG, BH | catch-all `openai.APIError` branch, empty-reply paths untested | low | No parametrize case reached the branch | patch — case added |
| 3 | VG, BH | lifespan live mode / shutdown `aclose` untested | low | True, but trivial code; suite is mock-only by AD-4 | reject |
| 4 | EC | live `name_project` with only blank Sections sends an empty message | low | Ready files pass integrity thresholds (AD-6), so 2.4b's caller can't reach it | reject |
| 5 | EC, BH | SDK `max_retries=2` hides 429 and multiplies the timeout | medium | `AsyncOpenAI` default retries 2; worst case ~6 min per call | patch — `max_retries=0` |
| 6 | EC | `choices[0].message is None` raises AttributeError → unmapped 500 | medium | `_complete` dereferenced `.message.content` directly | patch — getattr, test added |
| 7 | EC | startup failure after `create_gateway` leaks the client | low | Only on a crashing startup; process exits | reject |
| 8 | EC | Setext headings / `#` in code blocks in mock fixture | low | Mock is a deterministic stand-in; extraction emits ATX headings | reject |
| 9 | EC | mock delay test can flake on Windows' coarse clock | low | `asyncio.sleep` may wake a few ms early vs `perf_counter` | patch — `>= 0.045` |
| 10 | EC | test docstring claims no database while the lifespan test opens the pool | low | `create_app` lifespan opens the pool | patch — docstring corrected |
| 11 | BH | sprint-status `in-progress` vs spec `in-review` | false | Workflow syncs sprint status at step 3 and step 5 by design | reject |
| 12 | BH | key without `LLM_TEXT_MODEL` now fails startup in development | low | True, but fail-fast is intended and `.env.example` says the model is required for live | reject |
| 13 | BH | non-429 status codes lost in logs | low | `_run` logged only the class name | patch — message (status) in outcome |
| 14 | BH | `strict: true` with `minLength`/`maxLength` may be refused by strict providers | maybe-false | Needs one real OpenRouter call with the chosen model | defer |
| 15 | BH | schema retry resends identical messages; refusal/truncation not logged | low | Spec asks for one plain retry | reject |
| 16 | BH | no socket guard enforces "nothing reaches the network" | low | Mock creates no client and live tests inject a stub; a guard is extra infrastructure | reject |
| 17 | BH | prompt doesn't treat material as untrusted | low | Prompt had no such rule; pattern will be reused | patch — rule added |
| 18 | BH | importing `app.errors` loads `openai` via `app.llm.__init__` | low | True, but no cycle exists (`app.config` imports nothing from app) | reject |
| 19 | BH | mock reads only the first Section; blank first page/slide fails | medium | `pdf.py`/`office.py` emit blank Sections | patch — first non-blank Section |
| 20 | BH | `_run`/`_live` untyped | low | Developer-only, no named failure | reject |
| 21 | BH | `llm/fixtures.py` vs AD-4's `llm/fixtures/` | low | Follows the spec's Code Map; convert when a second fixture lands | reject |
| 22 | BH | handler log inconsistency, no Retry-After | low | Gateway log already covers both; no client backs off yet | reject |
