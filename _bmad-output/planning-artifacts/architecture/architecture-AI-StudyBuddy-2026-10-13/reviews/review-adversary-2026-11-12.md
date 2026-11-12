---
type: architecture-review
lens: adversarial (pairs of units that each follow every rule and still don't fit together)
target: ../ARCHITECTURE-SPINE.md (status: final, amendment of 2026-11-12, frontend test runner)
context: ../../../../implementation-artifacts/spec-1-2-switch-language.md
created: '2026-11-12'
---

# Adversarial review: frontend test runner amendment (2026-11-12)

**Scope.** Only what the amendment decides or leaves open: the Tests convention row ("Frontend tests use Vitest with `@testing-library/react` and jsdom (`npm test` in `frontend/`, configured in `vite.config.js`)"), the three new Stack rows, and the Deferred note. Units are two frontend stories built independently, for example Story 1.2 (language toggle, the first story with tests) and a later story such as the Login form (1.3–1.6), the Project dashboard, or job polling (AD-20).

**Verdict:** Accept the amendment, with two short additions. The runner, its environment, the config location, and the command are decided clearly, and they close the main risk: each story choosing its own runner. The amendment leaves open how a test reaches the world outside the component, meaning the API, auth, and i18n. That is where two compliant stories really diverge, and one of those choices (a backend-backed frontend test) quietly conflicts with the deferred CI decision. A second hole is specific to this project. AGENTS.md forbids any technology the spine does not name, so leaving out `@testing-library/jest-dom` and `@testing-library/user-event` is itself a binding decision, but it reads as an oversight. The rest is cheap to leave to the conventions that Story 1.2's first tests will set.

Severity: **High** = likely divergence that breaks another story's tests or CI; **Medium** = divergence that costs rework or hides bugs; **Low** = cosmetic, settled by the first example.

---

## A1. High: tests that need a running backend vs tests that mock `/api` (close in the spine)

**Units:** (a) a Login/auth story whose author mirrors the backend Tests row ("against the local Supabase stack") and renders `<App/>` against the real `/api/config` and Supabase Auth; (b) a dashboard story that stubs `globalThis.fetch` with `vi.stubGlobal`; (c) a job-polling story that uses `vi.mock('../api/client.js')`.

**Divergence:**
- All three follow the letter of the spine. The row says only "Vitest … jsdom". The backend row next to it says tests run against the local stack, so (a) is a reasonable reading.
- (a) fails in practice. jsdom's default origin is `http://localhost:3000`. The Vite `/api` proxy is not active under Vitest. A relative `fetch('/api/config')` therefore misses uvicorn and fails unless the author hard-codes a base URL, and that conflicts with AD-17 (no build-time URLs). Even when it works, `npm test` then needs Docker, Supabase, and uvicorn. The deferred CI pipeline would inherit that.
- (b) and (c) are both workable, but they test different things. Stubbing fetch also tests `api/client.js` (token attachment and parsing `code`/`params` into errors, AD-26). Mocking `client.js` is simpler but never covers that code. If each story picks its own mix, nobody tests the client, or every page test duplicates fetch-response fixtures that drift from the real error shape.
- The same split appears for `auth/`: one story mocks `@supabase/supabase-js`, another mocks the `auth/` module.

**Tightening (one sentence in the Tests row):** "Frontend tests need no backend, Supabase, or network. `api/client.js` and `auth/` have their own tests that stub `fetch` and `supabase-js`. All other tests mock those two modules (`vi.mock`)." This follows AD-1's existing boundaries, so it adds no new concept. It is a real trade-off (more realistic vs isolated and CI-ready) and not obvious, because the backend row points the other way.

## A2. High: jest-dom matchers and user-event are banned, though the ban looks unintended (close in the spine)

**Units:** (a) Story 1.2 tests the toggle with `fireEvent.click` and `expect(btn.getAttribute('aria-pressed')).toBe('true')`; (b) a later story wants `expect(btn).toHaveAttribute(...)`, `toBeInTheDocument()`, and `userEvent.keyboard('{Enter}')` (Story 1.2 itself requires "works with mouse and keyboard", and `fireEvent` does not simulate keyboard activation of a button).

**Divergence:**
- The Testing Library docs, and most agents, reach for `@testing-library/jest-dom` and `@testing-library/user-event` by default. Neither is in the Stack. Under AGENTS.md ("Never introduce a technology the spine doesn't name"), story (b) must either stop and amend the spine through `bmad-architecture` or add the packages anyway. The second option is likely, and it creates a setup file (`setupFiles: ['./src/test/setup.js']` with `import '@testing-library/jest-dom/vitest'`) that changes the global `expect` for every story's tests.
- The result is two assertion styles in one suite, plus a mid-project spine amendment for a test helper.
- The keyboard criterion from Story 1.2 can only be tested faithfully with user-event, or with hand-written `keyDown` plus `click` sequences that do not prove real activation.

**Tightening:** Decide it now in the Stack table, in one of two ways. Either add `@testing-library/jest-dom` (with the `/vitest` entry imported in one setup file) and `@testing-library/user-event` as devDependencies, or write "no matcher or event add-ons: plain `expect` and `fireEvent` only". The first is the usual choice and costs two rows. Both close the hole. The second leaves the keyboard criterion weakly tested.

## A3. Medium: one shared setup file, cleanup, and the `globals` switch (close as part of A2, or leave to Story 1.2)

**Units:** (a) a story that sets `test.globals: true` and writes bare `describe`/`it`; (b) a story that imports `describe, it, expect` from `vitest` (the default, `globals: false`).

**Divergence:**
- RTL unmounts after each test only when a global `afterEach` exists. With `globals: false` and no setup file, rendered trees pile up in `document.body` within a file. `getByRole('button', {name: 'EN'})` then finds two matches in the second test. Story (b)'s author adds `afterEach(cleanup)` per file. Story (a)'s author does not need to.
- If a later story flips `globals`, the other style breaks. Under `globals: false`, bare `describe` throws a ReferenceError. Under `globals: true`, per-file cleanup is redundant but harmless. oxlint's `no-undef` may also flag bare globals depending on its config.

**Tightening:** One clause, ideally next to A2: "`globals: false` (import from `vitest`); one setup file `src/test/setup.js` registers RTL `cleanup` (and jest-dom, if adopted)." If that is not added to the spine, Story 1.2 should set it, and later stories should follow it. It is cheap either way, because the first test that renders twice in one file shows the problem.

## A4. Medium: real catalogues vs mocked `react-i18next` (one sentence in the spine is worth it, since AD-26 is the reason)

**Units:** (a) Story 1.2 imports `i18n/index.js` and asserts English text ("Study Buddy", the tagline); (b) a later story uses `vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: k => k }) }))` and asserts on keys such as `'quiz.start'`.

**Divergence:**
- Both pass. Story (b)'s tests can never catch a key missing from the catalogue. Story 1.2's key-parity test compares `en.json` with `nb.json`, not code with catalogue. A typo'd key renders as the raw key in the product while the test still passes. That defeats the point of AD-26.
- With real i18n, the singleton carries state across tests. Detection runs at import against jsdom's `navigator.languages` (`en-US`) and `localStorage`. One test that presses NO leaves `nb` saved and active for the next test in the same file. Vitest isolates files, but not tests within a file. Story (a)'s author resets this, and story (b)'s author never meets it.
- Assertions on English text break if `en.json` wording changes, for example at Story 7.5's string sign-off. Key assertions do not. This is a real trade-off.

**Tightening:** "Tests render with the real catalogues through a shared `renderWithProviders` helper that resets the language to `en` and clears `localStorage`; do not mock `react-i18next`." If preferred, the wording-churn concern can be handled by asserting with `i18n.t('key')` instead of literal English. Story 1.2 is the natural place to create the helper, so the spine sentence can be short.

## A5. Low: Node floor now differs between the Stack rows (cheap fix, do it now)

**Divergence:** The Node row says "≥ 22.22", and `frontend/package.json` `engines` says `>=22.22`. The new jsdom row says it needs `^22.22.2`. A developer on Node 22.22.0 or 22.22.1 meets `engines` and every spine row, but `npm test` may fail or warn under jsdom 31. The Docker build stage uses `node:24` (floating). That is fine as long as it resolves to 24.15 or later, but the build does not run tests anyway.

**Tightening:** Raise the Node row to "≥ 22.22.2 (24.15+ or 26 LTS preferred)" and `engines` to match. This is a one-line edit, not a design choice.

## A6. Low: details best left to the conventions Story 1.2 sets

These pairs diverge, but the first test settles each one cheaply, and a spine rule would be noise:

- **Location and naming.** Colocated `src/**/X.test.jsx` (Story 1.2) vs `frontend/tests/` mirroring `backend/tests/`. Vitest's default include runs both, so nothing breaks. Copy the first story. JSX in a `.test.js` file fails to parse at once, so it corrects itself.
- **Config file.** A story that adds `vitest.config.js` silently overrides `vite.config.js` (Vitest prefers it) and drops the React plugin. The amendment already rules this out by naming `vite.config.js`. No action needed.
- **Watch mode.** The memlog says `npm test` = `vitest run`, but the spine says only `npm test`. A `"test": "vitest"` script would start watch mode in an interactive shell. Vitest runs once in CI and non-TTY shells, so the risk is small. Optionally add "(`vitest run`)" to the row.
- **Querying by CSS-module class vs role.** Vitest does not process CSS by default, so class-name assertions are fragile. Testing Library practice (query by role and accessible name, assert `aria-pressed`) settles it. The same goes for computed styles: jsdom does not resolve `var(--…)` or layout, so the 44×44 px target and contrast cannot be tested here and stay manual checks. That is a limit of the runner, not a spine hole.
- **Router wrapper** (`MemoryRouter` vs `createMemoryRouter`) and **fake vs real timers** for the 2 s job poll (AD-20). These are settled by the shared render helper from A4 and the first polling story.

## Not a hole

- AD-28 Libraries is unchanged. Story 1.2's precondition asked for "Stack plus AD-28 Libraries". The memlog explains why only Stack changed (AD-28 lists runtime libraries). That is consistent. The story's precondition text is just broader than needed.
- The CI decision stays deferred. The amendment does not decide it, but A1 is what keeps it cheap later.

## Suggested amendment text (Tests row, frontend half)

> Frontend tests use Vitest with `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, and jsdom (`npm test` = `vitest run` in `frontend/`, configured in `vite.config.js`; `globals: false`; one setup file `src/test/setup.js`). They need no backend, Supabase, or network: `api/client.js` and `auth/` are tested by stubbing `fetch` and `supabase-js`, and all other tests mock those two modules. Tests use the real i18n catalogues through a shared render helper and never mock `react-i18next`.

Plus two Stack rows (jest-dom, user-event) and the Node floor raised to 22.22.2.
