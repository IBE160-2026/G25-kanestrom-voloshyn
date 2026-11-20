---
title: 'Story 7.3b: Link Google account and resend verification in Settings'
type: 'feature'
created: '2026-11-20'
status: 'done'
baseline_commit: '121a53314fbd7065e7c40b6db8cec2930ad3e0ce'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** In Settings, an email Account can't link Google, and an unverified Account has no way to get a new verification link (FR-1, FR-19, FR-27, AD-19; epics.md Story 7.3, the last two criteria). This is Story 7.3 part B; part A (7.3a) is merged.

**Approach:**
- **Settings › Account** (email Accounts without a Google identity):
  - **Verified:** a "Link Google account" / "Koble til Google-konto" row. It calls `supabase.auth.linkIdentity({provider: 'google'})` and returns through `/auth/callback`. Before leaving, the SPA remembers the current route and that this is a link. On return, it lands on that route with Settings open.
  - **Unverified:** in place of the link, show "Verify your email first" (muted) and a "Resend verification email" button. `POST /api/me/verification` → `204`: it issues a new 24 h token (`verification.issue`, which invalidates older ones) and sends it after the commit. On success, show "We've sent a new link. It works for 24 hours." A verified Account answers `409 already_verified`; an Account without an email identity answers `409 no_password`.
- **After the link:**
  - **Success:** the callback calls `POST /api/me/google-link`. It sets `first_name` from the Google profile (overwriting it, since a linked name follows Google; deferred from 7.3a) and returns `Me`. Settings then shows "Signs in with Google", a read-only name and the picture.
  - **Already linked elsewhere:** Settings shows "This Google account is already linked to another Study Buddy account." in the error colour.
  - **Cancelled consent:** nothing is shown.
- **Backend guard (AD-19), in `user_auth` before the takeover step:** an unverified Account whose Google identity's email differs from the Account's email is a manual link, not a Google sign-in. Supabase's automatic linking needs matching emails. The guard removes that identity using the student's own token (`DELETE /auth/v1/user/identities/{identity_id}`, in `supabase_auth.py`) and answers `409 email_not_verified`. This happens before any takeover, so an unverified Account can't be taken over by someone else's Google account. A same-email Google identity on an unverified Account keeps the existing takeover: Google proved the address.
- **New copy, pending Cristoffer's approval:** `email_not_verified` "Verify your email before linking Google." / "Bekreft e-postadressen din før du kobler til Google."

## Boundaries & Constraints

**Always:** reuse `verification.issue` / `send_verification_email`, `supabase_auth.google_profile`, the callback's code exchange, and the takeover code path. All copy goes through i18n, taken from EXPERIENCE.md L272, L455–457. Styles use tokens only. Never log tokens, emails, or response bodies.

**Never:** unlinking Google from Settings; email change; a resend rate limit (decided 2026-11-16: Story 7.3's resend is not limited); edits to final docs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Link offered | verified email Account, no Google | "Link Google account" row | N/A |
| Unverified | email Account, unverified | "Verify your email first" + Resend; no link row | N/A |
| Resend | click | `204`; a new token is emailed and older ones are invalidated; success line | fail → error line |
| Resend verified | API call | `409 already_verified` | N/A |
| Google-only / linked | Google identity present | no link row and no resend | N/A |
| Link success | consent completed | Settings reopens on the earlier route; Google method shown; name = Google first name | `google-link` fails → error line in Settings |
| Linked elsewhere | `identity_already_exists` on return | Settings reopens with the "already linked" error | N/A |
| Cancelled | `access_denied` on return | Settings reopens; nothing shown | N/A |
| Unverified manual link | different-email Google identity, unverified | identity removed; `409 email_not_verified`; password still works; no takeover | unlink fails → `503 auth_unavailable` |
| Same-email, unverified | Google email = Account email | existing takeover (unchanged) | N/A |
| Norwegian | nb | all new strings in Norwegian | N/A |

</frozen-after-approval>

## Code Map

- `backend/app/auth.py` -- `_authenticate` step 4 (L162–181). Add the guard before `_needs_takeover`. `_ValidToken` needs the Google identity's `identity_id` and `email`, and the user's email.
- `backend/app/supabase_auth.py` -- `providers`, `google_profile` (L251). Add a helper returning the Google identity's id and email. Add `unlink_identity(client, settings, token, identity_id)` (user `DELETE /auth/v1/user/identities/{id}`); a failure → `auth_unavailable`.
- `backend/app/services/verification.py` -- `issue` (L36) and `send_verification_email` (L89). Add `resend(conn, account_id, has_email_identity)` raising `already_verified` / `no_password`.
- `backend/app/services/identity.py` -- add `link_google(conn, account_id, google_first_name)`, which overwrites `first_name` (new `db/profiles.set_first_name` exists).
- `backend/app/api/me.py` -- `POST /me/verification` (BackgroundTasks, as in `api/auth.py` `after_sign_in` L44) and `POST /me/google-link` → `Me`.
- `backend/tests/test_routes_guard.py` -- allowlist both routes (Account bookkeeping).
- `backend/tests/test_google.py` -- shows how Google identities are created in tests. New `backend/tests/test_link_google.py` covers the backend matrix rows, including "password still works after the guard" and "no takeover".
- `frontend/src/auth/index.js` -- `linkGoogle()`, modelled on `signInWithGoogle` (L59), plus a sessionStorage marker (`{route}`) for the link.
- `frontend/src/pages/AuthCallback.jsx` -- with the link marker: a success calls `google-link` and every exit navigates to the marked route with `state: { settings: { linkError } }`. Without the marker, nothing changes.
- `frontend/src/components/AppShell.jsx` -- open Settings when `location.state?.settings` is present, pass `linkError`, then clear the state (`replace`).
- `frontend/src/pages/Settings.jsx` -- `AccountSection`: the link row or the verify-first row, the resend button and its success line, and the link error.
- `frontend/src/test/fakeApi.js`, `i18n/en.json`, `nb.json`, `i18n/errors.js` (`email_not_verified`, `already_verified`). New `frontend/src/pages/LinkGoogle.test.jsx` covers the frontend matrix rows.

## Tasks & Acceptance

**Execution:**
- [x] `backend/app/auth.py`, `supabase_auth.py` -- the manual-link guard and unlink.
- [x] `backend/app/services/verification.py`, `identity.py`, `api/me.py` -- resend and google-link.
- [x] `backend/tests/test_link_google.py` + `test_routes_guard.py` -- the backend rows.
- [x] frontend `auth/index.js`, `AuthCallback.jsx`, `AppShell.jsx`, `Settings.jsx`, fakeApi, i18n -- the link and resend UI.
- [x] `frontend/src/pages/LinkGoogle.test.jsx` -- the frontend rows; `AuthCallback` without the marker is unchanged.

**Acceptance Criteria:**
- Given a verified email Account, when the student links Google from Settings, then they return to the same page with Settings open, and both email and Google sign-in reach the same Account.
- Given an unverified email Account with a different-email Google identity attached, when it makes any request, then the identity is gone, the answer is `409 email_not_verified`, and the old password still signs in.

## Implementation Notes

- Guard: `_is_manual_link` treats a Google identity with no email, or an Account with no email, as a manual link (fails closed). `seed_google` in `tests/test_google.py` now seeds the Account's own email by default, and `stubbed_user` gives its Google identity that email, so the existing takeover tests stay same-email. An unlink answering 404 (already gone, e.g. a concurrent request) still answers `409 email_not_verified`.
- Every Google identity is checked; each one whose email differs (or is missing) is removed. An unusable identity id answers 503 before any DELETE.
- Resend: the unique index `email_verifications_one_live_idx` allows only one live link per Account, so the new link can't coexist with the old one until the send succeeds. Instead `resend` returns the ids of the links it replaced, and a failed send deletes the new link and makes those live again (`verifications.restore_replaced`). The automatic after-sign-in path is unchanged.
- `POST /api/me/google-link` answers `409 link_failed` when the Account has no Google identity. A resend answering `409 already_verified` marks the profile verified in the SPA, so the row becomes Link Google account.
- `_ValidToken` keeps the bearer token (`repr=False`) for the one call made as the student.
- The link marker lives in `auth/returnTo.js` (`rememberLinkRoute`/`peekLinkRoute`/`forgetLinkRoute`, key `studybuddy.linkGoogle`), not `auth/index.js`, because page tests mock `auth/index.js`. The callback peeks it and clears it only on an exit, so StrictMode's second effect still sees it. `signInWithGoogle` drops any stale marker. Cancelled consent is detected from `error=access_denied` in the callback URL (`consentCancelled`); `completeGoogleSignIn` is unchanged.
- `linkError` is an API-style `{code, params}` rendered with `errorText`: `google_identity_in_use` (new catalogue entry with the "already linked" copy), the google-link error's code, or `link_failed` (generic text).
- "Link Google account" is shown only when `isGoogleEnabled()` (as on Login); the verify-first row and Resend show regardless.
- `errors.already_verified` reuses the existing "Your email is verified." / "E-postadressen din er bekreftet." copy.
- `Settings.test.jsx`'s password-changed assertion now finds the text, since the unverified default profile adds a second status line.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | BH, EC | resend invalidates the older link before the background send; a failed send leaves no working link while the UI says it was sent | medium | `issue` invalidates, `send_verification_email` deletes the new token on failure | patch — a failed send restores the replaced links (one-live-link index kept) |
| 2 | BH, EC | `409 already_verified` leaves the Verify-first row and Resend visible | low | no `setMe` on that code | patch — mark the profile verified |
| 3 | BH, EC | `POST /me/google-link` answers 200 without a Google identity | medium | no provider check | patch — `409 link_failed` |
| 4 | BH | only the first Google identity is checked by the guard | medium | `google_identity` returns the first match | patch — check every Google identity, remove each mismatch |
| 5 | EC | Link Google button stays busy after Back from Google (bfcache) | low | `busy` never reset | patch — reset on `pageshow` persisted |
| 6 | EC, BH | remembered link route drops the URL hash | low | `pathname + search` only | patch |
| 7 | BH | `.ghostSmall:disabled` duplicates `.ghost:disabled` | low | same rule twice | patch — one selector |
| 8 | VG | mocked `SIGNED_OUT_CODES` lacks `google_takeover` | low | real set in api/client.js has it | patch |
| 9 | VG | fail-closed branch (Google identity without email) untested | medium | no test builds an email-less identity | patch — test |
| 10 | VG, BH | missing/invalid `identity_id` → 503 untested | medium | stubbed tests always pass a UUID | patch — test |
| 11 | VG, BH | resend email language untested | medium | only an English profile asserted | patch — nb test |
| 12 | VG | link-mode callback: hash cancel, `failed`, signed-out google-link untested | medium | four cases only | patch — three tests |
| 13 | BH | guard differs from AD-19's wording (user-token unlink, not admin; same-email manual link still takes over) | low | the approved frozen intent decided both; GoTrue has no admin identity-unlink endpoint | reject — spine wording to be amended with Cristoffer's or Ihor's approval (issues.md) |
| 14 | BH | unlimited resend can flood someone else's inbox | medium | address is unverified by definition | reject — the frozen intent keeps "no resend rate limit" (decided 2026-11-16); raised with Cristoffer |
| 15 | BH | resends count toward the automatic reminder schedule | low | `sent_history` counts every row | reject — a resend is a sent email; intended |
| 16 | BH | resend falls back to English, not the SPA language | false | `profiles.language` is always filled by the first after-sign-in | reject |
| 17 | BH | guard's HTTP call made while a pooled connection is held | low | only on the rare manual-link path; bounded by the HTTP timeout | reject |
| 18 | EC | Google identity without email in a genuine same-email sign-in is unlinked | low | GoTrue's Google identities carry the email; fail-closed is the intended side | reject |
| 19 | EC | unlink 404 may be `manual_linking_disabled` | low | config.toml enables manual linking (AD-2 parity) | reject |
| 20 | EC | an unusable identity id 503s every request | low | GoTrue always returns `identity_id` | reject |
| 21 | EC | same-email manual link on an unverified Account takes over | false | decided in the frozen intent (Google proved the address) | reject |
| 22 | EC | email provider without `user.email` reports `no_password` | low | not reachable for an email identity | reject |
| 23 | EC | `google_takeover` on google-link relies on generic sign-out | low | link is offered only to verified Accounts; signed-out handling goes to Login | reject |
| 24 | BH | `link_failed` has no catalogue entry | low | falls back to the generic text by design | reject |
| 25 | BH | tests don't assert the picture or error colour | low | the alert role and the Google method line are asserted | reject |
| 26 | BH | `email_not_verified` copy approval untracked | low | tracked in issues.md by the session log | reject |

## Verification

**Commands:**
- `cd backend; uv run pytest` -- expected: all green with `LLM_MODE=mock`
- `cd frontend; npm test; npm run lint` -- expected: all green (from PowerShell)
