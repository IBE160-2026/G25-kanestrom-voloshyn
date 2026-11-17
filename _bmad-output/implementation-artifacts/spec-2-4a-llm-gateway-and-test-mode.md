---
title: 'Story 2.4a: The LLM gateway and test mode'
type: 'feature'
created: '2026-11-17'
status: 'ready-for-dev'
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
- [ ] `backend/pyproject.toml`, `app/config.py`, `.env.example` -- the `openai` dependency and the three settings.
- [ ] `backend/app/llm/` -- the gateway (live client, mock path, one schema retry, error mapping, logging), `schemas.ProjectName`, the prompt, and the mock fixture for `name_project`.
- [ ] `backend/app/main.py`, `app/errors.py` -- create the gateway in lifespan; map gateway errors to the error envelope.
- [ ] `backend/tests/test_llm.py` -- every matrix row, plus a route-level test (a throwaway route raising each gateway error) for the envelope codes.
- [ ] `frontend/src/i18n/en.json`, `nb.json` -- `errors.llm_unavailable`.

**Acceptance Criteria:**
- Given `LLM_MODE=mock` and no key, when the full suite runs, then nothing reaches the network.
- Given `APP_ENV=development` and no key, then `LLM_MODE` still resolves to mock with a warning.

## Verification

**Commands:**
- `cd backend; uv run pytest` -- expected: all green with `LLM_MODE=mock`
- `cd frontend; npm test; npm run lint` -- expected: all green

## Implementation Notes

## Spec Change Log

## Review Triage Log
