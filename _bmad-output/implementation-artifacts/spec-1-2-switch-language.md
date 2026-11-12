---
title: 'Story 1.2: Switch the interface between English and Norwegian'
type: 'feature'
created: '2026-11-12'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: '96f05188bf8d1f0758aab67a4f8b0ee0101f4903'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-1-runnable-app-skeleton.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The SPA has no language system: the placeholder Login shows only the wordmark, and there is nowhere for interface strings to live. FR-29 needs English and Norwegian (bokmål) from the first screen, and AD-26 says every interface string and every API error is rendered by the SPA from catalogues.

**Approach:** Add `react-i18next` with `frontend/src/i18n/en.json` and `nb.json`. Before sign-in the language comes from a saved choice, then the browser, with English as the fallback. Add the EN | NO toggle to the Login screen, plus an error helper that turns an API error's `code` and `params` into text in the active language.

## Boundaries & Constraints

**Always:**
- Every user-facing string comes from the catalogues through `react-i18next` (AD-26). Counts use i18next plural keys (`_one` / `_other`) in both languages.
- English values and Norwegian drafts are copied from EXPERIENCE.md › Strings by surface. Every Norwegian value stays marked as draft (UX-DR17); the final wording is Story 7.5's.
- Detection: a saved choice in `localStorage` wins. Otherwise `navigator.languages`: `nb`, `nn`, or `no` (any region) selects Norwegian, `en*` selects English, and anything else falls back to English. `<html lang>` follows the active language.
- The toggle reads "EN | NO" and works with mouse and keyboard. The active segment is shown in more than colour, and each segment has a 44×44 px target (Accessibility Floor). Styles use only `var(--…)` tokens.
- An API error renders from `errors.<code>` with its `params`. An unknown code falls back to the generic "Something went wrong." The server's `message` is never shown.
- The footer credit is verbatim in both catalogues (DESIGN.md).

- Decision (Ihor, 2026-11-12): the Login screen shows only its static parts: the wordmark, tagline, privacy line, footer credit, and the EN | NO toggle, in the DESIGN.md layout. No form fields or auth buttons yet.
- Decision (Ihor, 2026-11-12): add Vitest + `@testing-library/react` + jsdom as the frontend test runner, plus `@testing-library/jest-dom` and `@testing-library/user-event`. Every matrix row becomes an automated test. The spine was amended on 2026-11-12 (Tests convention, Stack); follow its frontend test rules.

**Never:**
- No `profiles.language`, `PATCH /api/me`, or Account menu: those come with sign-in (Story 1.4).
- No login form, Google button, or any auth behaviour (Stories 1.3–1.6).
- No new backend code, and no strings in JSX outside the catalogues.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First visit, Norwegian browser | no saved choice; `navigator.languages = ["nb-NO"]` (also `nn`, `no`) | Norwegian; `<html lang="nb">` | N/A |
| First visit, English browser | no saved choice; `["en-GB"]` | English | N/A |
| First visit, other language | no saved choice; `["de-DE", "fr"]` | English | N/A |
| Saved choice | `localStorage` holds `nb`; browser English | Norwegian | N/A |
| Toggle | press NO while English is shown | every on-screen string switches at once; `nb` saved; survives reload | N/A |
| Storage blocked | `localStorage` throws | detection still works; the toggle switches for the session | the error is swallowed, no crash |
| Known API error | `{code: "not_found", params: {}}` | the catalogue text for `not_found` in the active language | N/A |
| Unknown API error | `{code: "brand_new_code"}` | "Something went wrong." (or its Norwegian draft) | N/A |
| Count string | `n = 1` and `n = 3` in both languages | singular and plural forms | N/A |

</frozen-after-approval>

## Code Map

- `frontend/src/main.jsx` -- mounts `<App />` and imports `styles/global.css`; initialise i18n here, before the first render.
- `frontend/src/App.jsx` -- renders `Login` for every path. Keep that.
- `frontend/src/pages/Login.jsx` + `Login.module.css` -- the placeholder (centred wordmark). Extend it with the static parts (frozen decision); composition from `mockups/key-login.html` (toggle top right, credit bottom centre), with DESIGN.md (line 683 layout, line 749 Language switch, line 595 footer credit) winning over the mock.
- `frontend/src/styles/tokens.css` -- `--color-*`, `--type-*-*`, `--space-*`, `--radius-*` from DESIGN.md. Use the existing names; add none.
- `frontend/package.json` -- add `i18next` 26.7 and `react-i18next` 17.1 (spine Stack). No language-detector plugin: detection is about 15 lines, and the rules are in the matrix.
- `backend/app/errors.py` -- the codes the backend emits today: `not_found`, `bad_request`, `unauthorized`, `forbidden`, `method_not_allowed`, `conflict`, `file_too_large`, `invalid_request`, `http_error`, `internal_error`. Give each an `errors.*` entry (the Norwegian is a draft where EXPERIENCE.md has none). Don't change the backend.
- EXPERIENCE.md lines 196–201 and 259 have the Login and generic-error strings. The Bilingual terms table (lines 104–115) has "EN | NO" and "English"/"Norsk".

## Tasks & Acceptance

**Execution:**
- [x] `frontend/package.json` -- add `i18next`, `react-i18next` -- AD-26.
- [x] `frontend/src/i18n/index.js` -- init i18next: resources `en` and `nb`, `fallbackLng: 'en'`, `interpolation.escapeValue: false`. Export `detectLanguage()`, `setLanguage(lng)` (save to `localStorage` under `studybuddy.language`, guarded with try/catch), and a `languageChanged` hook that sets `<html lang>` -- matrix rows 1–6.
- [x] `frontend/src/i18n/en.json`, `nb.json` -- the same key tree (`login.*`, `language.*`, `footer.credit`, `errors.*`). Top-level `"_meta": {"status": "draft"}` in `nb.json`, plus a `"_meta"` note in `en.json` saying the strings come from EXPERIENCE.md -- UX-DR17.
- [x] `frontend/src/i18n/errors.js` -- `errorText(t, error)` returns `t('errors.' + code, params)` when the key exists, else `t('errors.generic')` -- AD-26.
- [x] `frontend/src/components/LanguageToggle.jsx` + `.module.css` -- two buttons "EN" and "NO" with `aria-pressed`, inside a group labelled with the translated "Language".
- [x] `frontend/src/pages/Login.jsx` + `Login.module.css` -- render the wordmark, tagline, privacy line, and footer credit from the catalogues, with the toggle top right.
- [x] `frontend/vite.config.js`, `frontend/package.json` -- add devDependencies at the spine's Stack versions (`vitest` 5.1, `@testing-library/react` 16.3, `@testing-library/dom` 10.4, `@testing-library/jest-dom` 7.0, `@testing-library/user-event` 14.6, `jsdom` 31.0); a `test` block (`environment: 'jsdom'`, `globals: false`, `setupFiles: ['./src/test/setup.js']`; import `defineConfig` from `vitest/config` if Vite's won't type the block); a `"test": "vitest run"` script; `engines.node` `">=22.22.2"` in this file and in the root `package.json`. If jsdom 31 fails the first render test, pin `jsdom` 30.1 and note it.
- [x] `frontend/src/test/setup.js`, `frontend/src/test/render.jsx` -- the setup file loads the jest-dom matchers and runs Testing Library `cleanup` after each test. The render helper wraps components with the real i18n instance and resets the language and `localStorage` before each test. Never mock `react-i18next`.
- [x] `frontend/src/**/*.test.jsx` (next to the code) -- one test per matrix row, plus a test that both catalogues have identical key sets. Drive the toggle with `user-event` (click, and Tab then Enter), and query by role and accessible name. No backend or network.
- [x] `README.md` -- add `cd frontend && npm test` to "Tester" (in Norwegian).

**Acceptance Criteria:**
- Given the built app at `http://localhost:8000`, when a person switches EN | NO, then every visible string changes language without a reload, and the choice survives a reload.
- Given the source, when `frontend/src` is searched, then no user-facing literal string appears in JSX outside the i18n catalogues (the wordmark "Study Buddy" included).
- Given both catalogues, when their keys are compared, then they are identical.

## Implementation Notes

- Installed versions: `i18next` 26.7.2, `react-i18next` 17.1.13, `vitest` 5.1.0, `@testing-library/react` 16.3.3, `@testing-library/dom` 10.4.2, `@testing-library/jest-dom` 7.0.1, `@testing-library/user-event` 14.6.10, `jsdom` 31.0.0. jsdom 31 worked, so there was no fallback to 30.1. `defineConfig` now comes from `vitest/config`.
- Count strings: the Login screen has no count, so the plural row uses `limits.messagesLeft_one/_other` ("{n} messages left today", EXPERIENCE.md › Limit notice). This adds a `limits.*` branch next to the listed key tree. The variable is i18next's `{{count}}`.
- Detection walks `navigator.languages` in order, and the first `nb`/`nn`/`no` or `en*` tag wins (`["de-DE", "nb"]` → Norwegian). If `languages` is empty it uses `navigator.language`. A saved value other than `en`/`nb` is ignored.
- Toggle: the visible text is "EN" / "NO" from `language.toggle.*`. Each button's accessible name is "English" / "Norsk" (`language.name.*`, each in its own language per the Bilingual terms), with `lang` set on the button, so the visible label is contained in the name. The active segment uses `aria-pressed` plus semibold weight in `--color-text`. The "|" divider is a CSS `::before` hidden from assistive technology, so no literal sits in JSX.
- `errorText` accepts `{code, params}` or the whole envelope. It looks up only codes matching `^[a-z0-9_]+$` that exist in the catalogue (via `i18n.exists`), so a path-like code can't reach a nested key. Error texts for the backend codes not covered by EXPERIENCE.md (`not_found`, `bad_request`, `unauthorized`, `forbidden`, `method_not_allowed`, `conflict`, `invalid_request`) are new English drafts as well as Norwegian drafts. `file_too_large` reuses "This file is over 50 MB."; `http_error` and `internal_error` reuse the generic text.
- The footer credit has no typography token. It uses `--type-overline-size` (11px) with muted colour.
- The "no literal strings in JSX" acceptance criterion is enforced by oxlint's `react/jsx-no-literals` (`frontend/.oxlintrc.json`). It was checked against a planted `<p>Hello world</p>`, which it flagged, and the plant was removed. It flags JSX text children only, not `{'string'}` expressions.
- `_meta` differs on purpose between the catalogues (`en`: source note; `nb`: `status: draft` plus a sign-off note). The key-parity test skips it.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-11-12). Layers: blind (B), edge-case (E), verification-gap (V).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | V: the production binding (`initReactI18next`, no provider) is never rendered; every test wraps in `I18nextProvider` | medium | Pre-verified. `App` is rendered only by `main.jsx`; dropping `.use(initReactI18next)` keeps every test green. | patch |
| 2 | B: AC "no literal strings in JSX" has no automated check | medium | Verification has only the hex grep; the AC can regress silently. | patch |
| 3 | B: implemented detection branches untested (`navigator.language` fallback, first-match order, `setLanguage('xx')`) | low | The code paths exist in `index.js`; tests cover only `languages` lists. Direct fix: three tests. | patch |
| 4 | B: README still says Node ≥ 22.22 | low | Both `package.json` files say `>=22.22.2`. One-line fix. | patch |
| 5 | B: `render.jsx` registers `beforeEach` as an import side effect; `index.test.jsx` registers it again | low | The reset depends on which files import the helper; the spine names one setup file. Direct fix: move the reset to `setup.js`. | patch |
| 6 | B: 8 new strings (7 error codes, plus wording not in EXPERIENCE.md) won't reach the Norwegian sign-off | medium | The sign-off checklist covers only EXPERIENCE.md › Strings by surface, which is `status: final`. Resolved: Ihor approved adding the 7 rows to EXPERIENCE.md and the sign-off checklist (2026-11-12). | ask human → resolved |
| 7 | E/B: server `params` passed as i18next options (`lng`, `returnObjects`, `context`) | low | Our backend sends none of these names; the fix adds a guard. | reject |
| 8 | E: non-object `params` | low | The server contract (`errors.py`) always sends a dict. | reject |
| 9 | E: another tab's choice doesn't sync | low | A new feature (a `storage` listener), not a defect. | reject |
| 10 | E: `vi.resetModules` keeps the i18next singleton, so listeners stack | low | Tests pass; the stacked listeners set the same `lang`. | reject |
| 11 | B: `errorText` checks `i18n.exists` on the global instance but renders with `t` | low | The app has one instance; only a `getFixedT` caller could disagree. | reject |
| 12 | B: `aria-pressed` buttons rather than a radio group | low | Screen readers announce "English, toggle button, pressed"; usable. A radio group needs arrow-key handling. | reject |
| 13 | B: status differs between spec and sprint-status | false | Step 5 syncs sprint-status to `review`. | reject |
| 14 | B: AGENTS.md still has the TODO run section | medium | The fix edits agent-context files; already in deferred-work.md (Story 1.1). | defer (existing) |
| 15 | B: the backend-codes list in the test is a copy | low | New codes arrive with their own stories; Story 7.5 checks that every code is translated. | reject |
| 16 | B: `limits.messagesLeft_*` is unused | low | It's a real EXPERIENCE.md string, used in Story 4.4, and needed for the plural row. | reject |
| 17 | B: label-in-name, "EN" vs "English" | false | The accessible name "English" contains the visible "EN" (case-insensitive), so WCAG 2.5.3 holds. | reject |
| 18 | B: `<title>` and `<html lang>` hardcoded in `index.html` | false | `lang` is set at runtime; "Study Buddy" is the same in both languages. | reject |
| 19 | B: lint missing from Verification; test files in the Docker build stage | low | Lint ran clean (implementer); the test files don't reach the runtime image. | reject |

## Verification

**Commands:**
- `cd frontend && npm run build` -- expected: builds; `grep -rE "#[0-9a-fA-F]{3,8}\b" src --include=*.css --include=*.jsx` matches only `tokens.css`.
- `cd frontend && npm test` -- expected: every test passes, one or more per matrix row.
- `cd frontend && npm run lint` -- expected: clean; `react/jsx-no-literals` (in `.oxlintrc.json`) fails on any literal text in JSX.
- `cd backend && uv run pytest` -- expected: still all pass (no backend change).

**Manual checks:**
- In a browser at `http://localhost:8000` (after `docker compose up --build`): set the browser to Norwegian and open in a fresh profile, then confirm Norwegian; toggle to EN, reload, and confirm English stays; check keyboard Tab/Enter on the toggle, and that there are no console errors.
