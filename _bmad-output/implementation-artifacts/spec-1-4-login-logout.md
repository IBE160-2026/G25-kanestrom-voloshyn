---
title: 'Story 1.4: Log in, stay signed in, and log out'
type: 'feature'
created: '2026-11-16'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: '4365df5d9e1b0a0e7b122ea02c99583f50106050'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-3-create-account.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-3b-email-verification.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A student can sign up but can't log in again, log out, or recover cleanly when a session ends. The backend already refuses missing and expired sessions (`user_auth`, Story 1.3), but the SPA doesn't act on it. FR-2 also needs the interface language to follow the Account across browsers.

**Approach:**
- Turn the Login screen's static parts into a working email-and-password login through `supabase-js`. After every sign-in, call `after-sign-in` and apply `profiles.language` when it is set.
- Add an Account menu to signed-in pages: "Welcome, {first name}", the avatar, Language, and Log out. Language saves through `PATCH /api/me`.
- Guard signed-in routes. On `unauthorized` or `session_expired`, sign out locally, remember the route in `sessionStorage`, and show "You've been signed out. Log in to continue." on Login. The next login returns to that route.

Decisions (Ihor, 2026-11-16):
- No dead controls (as in Stories 1.2 and 1.3). The "Forgot password?" link appears with Story 1.5, and Google with 1.6. Settings joins the Account menu in Story 7.3.

## Boundaries & Constraints

**Always:**
- **Supabase in the browser:** only `signInWithPassword`, `signOut` and session reads (AD-1), all in `frontend/src/auth/`. Every app call goes through `api/client.js`.
- **Login failures** of any kind (wrong password, unknown email, unverified) show one generic Error line, "Wrong email or password.", that never reveals whether the email exists (FR-2, AD-2). Network or Supabase errors show "Sign-in didn't work. Try again.". Buttons stay active, the typed email stays, and focus returns to the form.
- **Log out** is immediate, with no confirmation (EXPERIENCE.md). It calls `signOut` (which ends the `auth.sessions` row, so the old token gets `401 unauthorized` from `user_auth`) and lands on Login.
- **Signed-out handling:** an `unauthorized` or `session_expired` from any `apiFetch` signs out locally and stores the current path under one `sessionStorage` key. It navigates to `/` with the session-expired notice, and the next successful login goes there once (then the key is cleared). `auth_unavailable` never signs out.
- **Language:** after sign-in, `after-sign-in` receives the active language (it fills only an unset profile). If the returned profile has a language, the SPA switches to it and saves it locally. The Account menu's Language switch ("English" / "Norsk", each in its own language) switches at once and calls `PATCH /api/me {language}`.
- **`PATCH /api/me`** accepts only `language` (`en` | `nb`) for now; anything else gives `invalid_request`. It runs through `user_auth` and returns the profile.
- **Account menu:** Radix `DropdownMenu` (`radix-ui`, spine AD-28), with focus return and keyboard use. The trigger shows the avatar (initials from the first name, DESIGN.md `avatar.size-menu`) plus "Welcome, {first name}"; below 1024 px, the avatar only. Log out turns `{colors.error}` on desktop hover.
- Every string comes from the catalogues (AD-26): EXPERIENCE.md lines 188, 198, 200, 201, 215, 249. Styles use only tokens (AD-28). Frontend tests stub `supabase-js` and `fetch`; backend tests run against local Supabase.

**Never:**
- No password reset (1.5), Google (1.6), Settings page (7.3), or Projects/landing on `last_project_id` (Epic 2).
- No `updateUser`, and no Supabase call outside `frontend/src/auth/`.
- No dead links or buttons.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Login | correct email and password | `after-sign-in` called; lands on `/projects` with the Account menu showing "Welcome, {first name}" | N/A |
| Wrong password | registered email, wrong password | Error line "Wrong email or password."; email kept; focus to the form | no account hint |
| Unknown email | an email with no Account | the same message as a wrong password | identical text and timing class (no extra request) |
| Supabase down | the sign-in request fails (network or 5xx) | "Sign-in didn't work. Try again." | buttons stay active |
| Signed-out visit | `/projects` with no session | redirected to `/`; after login, back to `/projects` | N/A |
| Log out | Log out in the Account menu | Login screen; the old access token then gets `401 unauthorized` from `GET /api/me` | N/A |
| Session ended mid-use | any `/api` call returns `unauthorized` or `session_expired` | signed out locally; Login shows "You've been signed out. Log in to continue."; the next login returns to the same route | N/A |
| Auth outage | `/api` returns `503 auth_unavailable` | stays signed in; generic error shown | no sign-out |
| Language switch | choose "Norsk" in the Account menu | interface switches at once; `profiles.language` = `nb` | on API failure the UI keeps the switch and shows the generic error |
| Other browser | log in where the local choice is English but `profiles.language` = `nb` | interface switches to Norwegian after sign-in | N/A |
| Bad PATCH | `PATCH /api/me` with `{language: "de"}` or extra fields | `422 invalid_request` | envelope |
| Session lookup pinned | a token whose `session_id` belongs to another Account (Supabase stubbed to report account A) | `401 unauthorized` (deferred from Story 1.3) | envelope |

</frozen-after-approval>

## Code Map

- `frontend/src/auth/index.js` -- `getClient()` from `/api/config`, `signUp`, `getAccessToken`. Add `signIn(email, password)` and `signOut()` here. It maps every credential failure to one code; errors with no HTTP status, or 5xx, map to "failed".
- `frontend/src/api/client.js` -- `apiFetch` and `ApiError`. Add the signed-out hook: on `unauthorized`/`session_expired`, call `auth.signOut({scope: 'local'})`, store the route, and navigate (through a small listener the router registers, so `client.js` doesn't import the router).
- `frontend/src/routes.jsx` -- `/`, `/signup`, `/projects`, `/email-verified`. Add a `RequireSession` wrapper around `/projects`.
- `frontend/src/pages/Login.jsx` + `components/AuthLayout.jsx` + `ErrorLine.jsx` -- the static Login from Stories 1.2 and 1.3. Add the form, following `CreateAccount.jsx`'s patterns (`noValidate`, the busy guard, the re-keyed ErrorLine, focus handling).
- `frontend/src/pages/Projects.jsx` -- the greeting and empty state from Story 1.3. Move the greeting into a new `components/TopBar.jsx` with `components/AccountMenu.jsx` and `Avatar.jsx`.
- `frontend/src/i18n/index.js` -- `setLanguage(lng)` (saves locally). Reuse it after sign-in and from the menu.
- `backend/app/api/me.py` -- `GET /api/me` and the `Me` model; add `PATCH`. `backend/app/db/profiles.py` -- add `set_language`.
- `backend/tests/test_auth.py` -- the `stub_auth` fixture and `make_settings`; use them for the pinned-session row (`deferred-work.md`, Story 1.3 #19).

## Tasks & Acceptance

**Execution:**
- [x] `frontend/package.json` -- `radix-ui` 1.8 (spine Stack).
- [x] `frontend/src/auth/index.js` -- `signIn`, `signOut`, and error mapping.
- [x] `frontend/src/api/client.js` -- the signed-out handling (once per burst of requests; `auth_unavailable` excluded).
- [x] `frontend/src/routes.jsx` + `components/RequireSession.jsx` -- guard and return-to.
- [x] `frontend/src/pages/Login.jsx` -- the form, the session-expired notice, and the language-after-sign-in step.
- [x] `frontend/src/components/TopBar.jsx`, `AccountMenu.jsx`, `Avatar.jsx` (+ CSS modules) -- the menu with Language and Log out; `Projects.jsx` uses `TopBar`.
- [x] `backend/app/api/me.py`, `db/profiles.py` -- `PATCH /api/me`.
- [x] Tests -- every matrix row: the frontend ones with `supabase-js` and `fetch` stubbed (including keyboard use of the menu); the backend `PATCH`, logout-then-401 against local GoTrue, and the pinned session.
- [x] Catalogues -- `login.*`, `account.*`, `session.expired` from the EXPERIENCE.md lines above.

**Acceptance Criteria:**
- Given the grader flow, when a student who signed up logs out and logs in again at `http://localhost:8000`, then they reach `/projects` with "Welcome, {first name}", and the language they picked in the Account menu is restored in a fresh browser profile.
- Given the source, when it is searched, then Supabase is still used only in `frontend/src/auth/` and `fetch` only in `api/client.js` (the boundary test passes).

### Review Findings

Code review pass 2 (2026-11-16, run by Cristoffer: Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor against `14a62b4`).

- [x] [Review][Decision → Patch] Log out bypasses supabase-js — resolved 2026-11-16 (Cristoffer chose option 1): `signOut()` keeps the immediate storage clear, then in the background calls both `auth.admin.signOut(token, 'local')` and supabase-js's own `auth.signOut({ scope: 'local' })`, so an in-flight refresh is discarded and an in-memory session is removed; the 3 s limit now also covers the `/api/config` load. (c) is accepted: Log out never waits on the network. Original finding: `signOut()` clears `localStorage` by hand and calls `auth.admin.signOut`, while the Always section allows only `signOut` (AD-1). Verified consequences: (a) a token refresh already in flight when Log out runs can write the session back, because the manual clear skips supabase-js's `_sessionRemovalEpoch` guard (`@supabase/auth-js` GoTrueClient, commit guard after `_saveSession`); (b) with `localStorage` blocked, supabase-js keeps the session in memory, so Log out leaves it and Login sends the student straight back to `/projects` (which is refused, which signs out locally again, and so on); (c) the server call is fire-and-forget with a 3 s timeout, so if it fails the `auth.sessions` row and the old token stay valid. Sources: blind-hunter, acceptance-auditor, edge-case-hunter, verification-gap.
- [x] [Review][Patch] Language switch items are 32 px tall, below the 44×44 px target in "Done for every story" [frontend/src/components/AccountMenu.module.css:88] — rejected by Cristoffer 2026-11-16: works fine in use; kept as is.
- [x] [Review][Patch] Avatar initial takes the first code point, so a name typed in decomposed form (e.g. "A" + combining ring) shows a bare "A"; normalize to NFC first [frontend/src/components/Avatar.jsx:5] — rejected by Cristoffer 2026-11-16: "Å" names show correctly in the app.
- [x] [Review][Patch] No test runs Log out against the real supabase-js storage layout; every test stubs `createClient` with the same format the code assumes [frontend/src/auth/supabase.test.jsx] — fixed: new test with the real library and only `fetch` stubbed; breaking the token read makes it fail (checked).
- [x] [Review][Patch] (found in the manual check) An address Supabase refuses, such as "åså@gmail.com", showed "Something went wrong." on the first-name field — fixed: `signUp` maps `validation_failed` and `email_address_invalid` to `email_invalid`, and Create account shows "Enter a valid email address." on the email field [frontend/src/auth/index.js, frontend/src/pages/CreateAccount.jsx].
- [x] [Review][Defer] No test covers Login's "already signed in" redirect resolving while a login is in flight (the `!inFlight.current` guard) [frontend/src/pages/Login.jsx:52] — deferred: narrow window (slow `/api/config`), single-condition guard; add when the Login tests are next touched.

**Rejected (22):**
- false: Login button `disabled` while busy breaks "Buttons stay active" — the rule is about the state after an error, and the button is enabled again then (same pattern as Create account and the reset pages).
- false: `returnTo` lets control characters through — the path comes from `location.pathname` (percent-encoded), sessionStorage is same-origin, and `pushState` refuses another origin.
- false: `set_language` ignores a missing profile row — `UserAuth` refuses a deleted Account before the update runs.
- false: Login tests mock `signOut` with the wrong return value — Login never calls `signOut`.
- false: `onSignedOut` drops an earlier listener — only one `RequireSession` is mounted, and its cleanup only removes its own listener.
- false: `ended` can hang when `/api/config` hangs — nothing awaits `ended`.
- low: a reload after a failed after-sign-in skips it, so the Account language isn't applied — needs after-sign-in to fail and a reload; fix adds a branch.
- low: the locked Login form has no "use another account" action — only while after-sign-in keeps failing; reload or waiting works.
- low: an `unauthorized` language save flashes the error before the redirect — session ending mid-switch is rare; fix adds a guard.
- low: the language-save error doesn't say the language wasn't saved — matches the spec's "generic error"; a new string would need Norwegian sign-off.
- low: other open tabs aren't signed out at once — their next request is refused and redirects (FR-2 holds).
- low: two quick language saves can arrive out of order — latest-wins covers the UI; the server race needs two switches within one round trip.
- low: a remembered route can survive a detour through Create account — needs a specific path through two pages.
- low: no end-to-end test of the grader flow — the manual check passed on 2026-11-16.
- low: a refused token whose refresh also fails skips the redirect — needs expiry inside the request round trip.
- low: `Projects` stays `aria-busy` if the listener is skipped — follows from the previous item (and pass 1, #20).
- low: a 401 without the JSON envelope doesn't sign out — the backend always sends the envelope; no proxy in V1.
- low: the remembered route drops `location.hash` — no route uses a hash.
- low: backend tests lack PATCH after logout and PATCH with a NULL language — the shared `UserAuth` and the UPDATE are already covered.
- low: `z-index: 10` and `120ms` transitions are literals — DESIGN.md has no z-index or motion tokens to use.
- low: `test/mocks.js` copies `SIGNED_OUT_CODES` — the module is mocked there, so it can't import the real set; a change would show in the client tests.
- low: formatting nits in `Login.jsx` and `Login.module.css` — already gone in the current file, or whitespace only.

## Implementation Notes

- Installed `radix-ui` 1.8.1 (`^1.8.1`). `lucide-react` is not installed; the menu chevron is a small inline SVG.
- `auth/index.js`: the Supabase client uses an explicit `auth.storageKey` (`studybuddy.auth`). `signIn` maps Supabase errors with an HTTP status below 500 to `credentials`, and 429, no status, 5xx, a thrown error, or a failed `/api/config` load to `failed`. `signOut()` reads the stored access token straight from storage, removes the stored session (and its `-user` key) at once, and then, in the background, asks Supabase to end that session (`POST /logout?scope=local` through `auth.admin.signOut(token, 'local')`), giving up after 3 s. It resolves right after the local clear with `{ ended }` and never throws. Other devices stay signed in. `hasSession()` reads the stored session.
- `auth/returnTo.js` (no Supabase import) owns the one `sessionStorage` key `studybuddy.returnTo`. It accepts only same-origin paths (`/x`, never `//host` or `/\host`), never stores `/`, and clears the key as it is read. An explicit Log out clears it too.
- `api/client.js`: on `unauthorized` or `session_expired` from an authenticated call, it acts only if the refused token is still the current access token (read when the refusal is handled). A refusal of an older token, after Log out or a new login, is ignored. A request sent without a token counts only while there is still no session. A burst of refusals of the same token shares one sign-out and one listener call. The listener call is wrapped, so the `ApiError` always reaches the caller. `auth_unavailable` and every other code never sign out. `detachSignedOutListener()` lets a deliberate Log out drop the listener first.
- `components/RequireSession.jsx` is a layout route around `/projects`. It renders nothing while the session is read; with no session (or a failed read) it remembers the route and redirects to `/` without the notice. While mounted it registers the `onSignedOut` listener, which remembers the current path and navigates to `/` with `state.sessionExpired`.
- Login: the notice's `role="status"` region is always mounted (empty), and the text is added just after mount, so it is announced. `location.state` is then replaced with `null`, so a reload doesn't repeat it, and the Error line replaces it after a failed attempt. Blank fields fail with "Wrong email or password." without a request. After `signIn`, `after-sign-in` is sent with only `language`. A profile language replaces the local one through `setLanguage`. If `after-sign-in` fails, the session is kept (an auth outage never signs out), "Sign-in didn't work. Try again." shows, the fields lock, and a retry repeats only `after-sign-in`. If the failure was a session refusal, `api/client.js` has signed out, and the next attempt logs in again. A student who still has a session goes straight to `takeRememberedRoute() ?? '/projects'`. Login and Create account share `components/AuthForm.module.css`, formerly `CreateAccount.module.css`.
- Account menu: Radix `DropdownMenu` with `modal={false}`, so the rest of the page isn't hidden from assistive technology and the top-bar alert can be announced while the menu is open. The Language switch is a `RadioGroup`; each item has `lang`, and selecting keeps the menu open. The switch calls `setLanguage` at once, then `PATCH /api/me`. Saves are latest-wins, and a failure of the latest save shows in an Error line in `TopBar`, outside the menu, so it survives closing. `TopBar` shows the menu once `/api/me` has settled, even on failure: then the trigger is named "Account menu" and the avatar is empty. Log out first detaches the expiry listener, then clears the return route and the local session, and navigates at once. Below 1024 px the greeting is visually hidden but stays the trigger's accessible name. Log out turns `--color-error` only under `@media (hover: hover) and (pointer: fine)`. Menu spacing uses the spacing scale (`--space-1`; width `calc(var(--space-7) * 5)`).
- Catalogues: `login.email`, `login.password`, `login.submit`, `login.errors.credentials`, `login.errors.failed`, `session.expired`, `account.welcome` (moved from `projects.welcome`), `account.language`, `account.logOut`, and one new draft string with no EXPERIENCE.md row: `account.menu` ("Account menu" / "Kontomeny"), the trigger's accessible name only when the profile has no first name.
- Backend: `PATCH /api/me` takes `MeUpdate` (`extra="forbid"`, `language: Literal["en", "nb"]`, required), so a bad value, `null`, `{}`, or any extra field gives `422 invalid_request`. `identity.set_language` → `profiles.set_language` overwrites the language (unlike `fill_unset`).
- Tests: `backend/tests/test_me.py` (PATCH, cross-browser language through a second password login, logout ends the row and the old token gets 401 while another session keeps working, and the pinned session). Removing `AND user_id = %s` in `db/sessions.py` makes the pinned test fail (checked); its `deferred-work.md` entry is removed. Frontend page tests share `src/test/mocks.js` for the mocked `auth/` and `api/client.js`; `test/reset.js` now also clears `sessionStorage`.
- `docker compose up -d --build` again hit the bake entitlement prompt; the image was built with `docker build -t g25-kanestrom-voloshyn-app .` and started with `docker compose up -d --no-build`.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-11-16). Layers: blind (B), edge-case (E), verification-gap (V).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | E/B: `signOut` may leave the local session (supabase-js returns early on a session-load/refresh error); Log out waits on the network; a stale session makes Login bounce to a blank `/projects` | high | `auth.signOut` ignores `{error}`; `AccountMenu` awaits the server call; Login redirects on `hasSession`. Log out can appear to do nothing. | patch |
| 2 | B/E: a late 401 for an old token signs out the new session; null-token and pending-merge variants | medium | `handleSignedOut` only compares with `handledToken`; an explicit Log out never sets it. | patch |
| 3 | B: a deliberate Log out can show the expiry notice and store a return route | medium | `RequireSession`'s listener is still live while `signOut` runs. | patch |
| 4 | B: Login signs out on `503 auth_unavailable` from `after-sign-in` | medium | The frozen boundary says `auth_unavailable` never signs out. | patch |
| 5 | B: no Account menu (so no Log out) when `/api/me` fails | medium | `TopBar` renders the menu only when `me` is set. | patch |
| 6 | B: the error line sits inside `role="menu"` and vanishes on close | medium | An alert inside a menu is unreliable for screen readers (Accessibility Floor); `onOpenChange` clears it. | patch |
| 7 | B: a 429 rate limit shows "Wrong email or password." | medium | It misleads a student with the right password; a 429 reveals nothing about the account. | patch |
| 8 | B/E: rapid language switches can save an older choice | low | Unordered PATCHes. Direct fix: latest wins. | patch |
| 9 | B: the session notice may not be announced and comes back after reload | low | `role=status` present at mount; `location.state` survives reload. Direct fix. | patch |
| 10 | B: literal `2px`/`3px`, and a sidebar token borrowed for the menu width | low | AD-28: spacing only through `var(--…)`. | patch |
| 11 | B: Login imports `CreateAccount.module.css` | low | A later Create-account style change would silently alter Login. Direct fix: shared auth styles. | patch |
| 12 | B/E: the already-signed-in redirect ignores and leaves the saved route | low | Direct fix: `takeRememberedRoute() ?? HOME`. | patch |
| 13 | E: a listener that throws replaces `ApiError` | low | Direct `try/catch`. | patch |
| 14 | B/E: backend tests don't assert PATCH or logout status | low | Direct asserts. | patch |
| 15 | V: avatar initial upper-casing untested | low | Pre-verified. | patch |
| 16 | V: a failed session read remembering the route is untested | low | Pre-verified. | patch |
| 17 | B: an unrelated `epic-1-context.md` change mixed into this story's commit | low | The commit log is graded. Committed separately as `docs:`. | patch (process) |
| 18 | B: `test_me.py` imports fixtures from `test_auth.py` | low | It works; moving them to `conftest.py` is a refactor across files. | reject |
| 19 | B: fragile `settledResults` mock in a CreateAccount test | low | It passes; Vitest internals are stable in the locked version. | reject |
| 20 | B: Projects `aria-busy` forever outside `RequireSession` | low | Every signed-in route is wrapped; #1 and #2 make the listener reliable. | reject |
| 21 | B: tracking files disagree; compose unverified | false | Step 5 syncs sprint-status; `docker compose up -d --build` succeeds here. | reject |
| 22 | (implementer) the `account.menu` label has no EXPERIENCE.md row | low | An accessible name used only when there's no first name. | ask human (doc row) |

## Verification

**Commands:**
- `cd backend && uv run pytest` -- expected: all pass against local Supabase.
- `cd frontend && npm test && npm run lint && npm run build` -- expected: all pass; only `tokens.css` has hex colours.
- `docker compose up -d --build` -- expected: the app serves the Login form.

**Manual checks:**
- In a browser: log in, open the Account menu with the keyboard, switch to Norsk, log out, log in from a private window and see Norwegian; check that a wrong password and an unknown email show the same message.
