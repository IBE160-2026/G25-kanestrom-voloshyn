---
title: 'Tech-currency review: Google takeover via own-token password update'
reviewed: ARCHITECTURE-SPINE.md (uncommitted diff, updated 2026-11-19)
lens: technology currency / reality check
date: '2026-11-19'
verdict: pass with findings (one high: whose session survives)
---

# Tech-currency review: Google takeover via own-token password update

## Scope

Only the amended lines: the AD-2 Supabase Auth adapter list ("the caller's own password update for the takeover", admin user update removed), and the AD-19 takeover bullet (`PUT /auth/v1/user` with the caller's token, never the admin update; "both an email and a Google identity"; a Google-only Account never gets a password). I checked them against the Supabase Auth (GoTrue) source at the exact version the pinned CLI runs, against the running local stack, and against the CLI 2.122.0 config source.

## Evidence

**Versions.** Supabase CLI 2.122.0 (pinned, AD-16) runs `public.ecr.aws/supabase/gotrue:v2.197.0` (`docker ps`). I read the source at tag `v2.197.0` of `github.com/supabase/auth`, and the CLI source at tag `v2.122.0` of `github.com/supabase/cli` (`apps/cli-go/pkg/config/`).

**Source (GoTrue v2.197.0).**
- `internal/api/user.go` `UserUpdate`: when a password is sent it calls `user.UpdatePassword(tx, &session.ID)`, with the session taken from the JWT's `session_id`.
- `internal/models/user.go` `UpdatePassword`: with a session id it calls `LogoutAllExceptMe` (`DELETE FROM sessions WHERE id != ? AND user_id = ?`). With `nil` it calls `Logout` (deletes every session of the user). It also clears the confirmation, recovery, email-change and reauthentication tokens, plus all one-time tokens, in both cases.
- `internal/api/admin.go` `adminUserUpdate`: calls `user.UpdatePassword(tx, nil)`, so every session ends, the caller's included.
- Guards in `UserUpdate` before the password is set:
  - `checkPasswordStrength`: min length and required character sets; max 72.
  - The MFA/AAL2 check, only when MFA is enabled.
  - The anonymous-user check.
  - The `IsSSOUser` block (SAML SSO only, not OAuth Google).
  - `UpdatePasswordRequireReauthentication`: a nonce is needed when the session is nil or `session.CreatedAt` is more than 24 h old.
  - `UpdatePasswordRequireCurrentPassword`: needs `current_password` unless the session is a recovery session.
  - The same-password check, which returns 422 `same_password`.
- `UserUpdate` (not the admin path) sends the "password changed" email when `mailer.notifications.password_changed_enabled` is on.

**Live test, local stack.** I created a throwaway confirmed email+password user, signed in twice, ran each step below, then deleted the user. A recount found 0 test users left.

| Step | Result |
|---|---|
| `PUT /auth/v1/user` `{password: token_urlsafe(32)}` with session 1's token | 200; `auth.sessions` 2 → 1 |
| Session 1: `GET /user` / refresh | 200 / 200 |
| Session 2: `GET /user` / refresh | 403 `session_not_found` / 400 `refresh_token_not_found` |
| Old password login | 400 `invalid_credentials` |
| Same password again (fresh session) | 422 `same_password` |
| Admin `PUT /auth/v1/admin/users/{id}` `{password}` | 200; sessions 2 → 0; caller's token 403 `session_not_found` |
| Access-token claims of a password session | `amr: [{method: "password"}]`, `aal1`, `session_id` |

**Config.** In local `supabase/config.toml`: `secure_password_change = false`, `enable_confirmations = false`, `minimum_password_length = 8`, `password_requirements = ""`, and the password-changed notification is commented out (off). In the CLI 2.122.0 source, `secure_password_change` maps to `SecurityUpdatePasswordRequireReauthentication` and is sent by `config push`. The CLI has **no** key for `update_password_require_current_password`.

## What checks out

- **(a) Confirmed.** `PUT /auth/v1/user` with a password keeps the caller's session (token and refresh token both still work) and ends every other session of the user. Source and the live test agree.
- **(b) Confirmed.** The admin password update ends all sessions, the caller's included. The amendment's reason ("would also end the caller's session") is correct.
- The AD-2 adapter list matches the new flow. Admin user update is no longer needed there; delete, `generate_link` and identity unlink stay.
- The spine's own "delete every other `auth.sessions` row" is now redundant with GoTrue's `LogoutAllExceptMe`, but it is harmless. It is also a correct belt-and-braces step, because it runs under the profile lock and is not tied to GoTrue's behaviour. Keep it.
- "A Google-only Account never gets a password" fits the source. Setting a first password through `UserUpdate` calls `ensureEmailIdentityForPassword`, which would add an email identity to a Google-only user. Excluding that case is right.
- **(c), same-password rule.** Not a risk for a 32-byte random password. A repeat call (the retry path) also sends a new random value. A 422 `same_password` can only happen if the same string is sent twice, which `secrets.token_urlsafe` does not do.
- **(c), password strength.** `token_urlsafe(32)` gives 43 characters from `[A-Za-z0-9_-]`. That is within 8–72 and passes the current empty `password_requirements`.
- Confirmations off has no effect on this path: `UserUpdate` has no confirmation check for password changes.

## Findings

### F1 (high): the session that survives is whichever one makes the first request, which may be the squatter's

The takeover protects a real Google owner against a password Account someone else created with their unverified email. It runs "on any request" from that Account once the Google identity exists. With the admin update, every session ended, so it did not matter whose request triggered it. With the own-token update, **the caller's session is kept and every other session ends.** Suppose the squatter's password session (an open tab, a background refetch) makes the first request after the Google sign-in. Then the squatter keeps their session, and the Google owner is signed out. That is the reverse of the takeover's purpose.

The access token says how its session was created: `amr[].method` is `password` for a password sign-in and `oauth` for Google, as seen live for `password`.

Proposal: run the takeover only on a request whose token `amr` includes `oauth`, or alternatively whose `auth.sessions` row was created at or after the Google identity's `created_at`. A due takeover on any other session should end that session (`unauthorized`) without running the takeover, and should not be counted as its trigger. This needs an AD-19 Rule amendment, approved by Cristoffer or Ihor. It is the one finding that changes behaviour.

### F2 (medium): `secure_password_change` must stay false and be pinned in AD-2

When it is on, `UserUpdate` needs a reauthentication nonce if the caller's session is more than 24 h old. The backend has no nonce, so the takeover would fail on every request from such a session. With retry-on-next-request, every request then gets a 503. That happens whenever the trigger session is older than 24 h, for example if the takeover first fails and is retried a day later, or (with F1's fix) if the Google session is a day old.

Locally it is `false`, but AD-2's pinned list of Cloud settings does not include it. `config push` does manage it (CLI 2.122.0 maps it to `SecurityUpdatePasswordRequireReauthentication`), so the fix is one more bullet: `secure_password_change = false` (the takeover's own-token password update cannot reauthenticate).

### F3 (medium): "Require current password" is a dashboard-only setting that would break the takeover

GoTrue v2.197.0 has `UpdatePasswordRequireCurrentPassword`. When it is on, `UserUpdate` returns 400 `current_password_required` for a non-recovery session, and the backend cannot know the current password. CLI 2.122.0 has no `config.toml` key for it, so `config push` neither sets it nor resets it. The Supabase password docs do describe the `current_password` parameter (supabase-js ≥ 2.102.0).

Proposal: AD-2 should name it as a Cloud setting that must stay off, checked by hand. The adapter should also map a 400 with `error_code` `current_password_required` or `reauthentication_needed` to a logged configuration error rather than a silent generic 503.

### F4 (low): the password-changed notification email

Only the user endpoint sends it, and only if `password_changed_enabled` is on. It is off locally and in the CLI default. If it were turned on in Cloud, the takeover would email the unverified (possibly squatter's) address saying the password changed. That is harmless, but it is a behaviour difference from the admin path. Worth one line in AD-19, or keep the notification off.

### F5 (low): side effects both paths already had

`UpdatePassword` also clears the confirmation and recovery tokens and all one-time tokens. Any outstanding password-reset link for the Account stops working at takeover, which is desirable. App-level verification (AD-19) does not use GoTrue's confirmation token, so nothing breaks. No change needed. Recorded so the effect is known.

### Note: the code is not yet aligned (outside this diff)

`backend/app/supabase_auth.py` `set_random_password` still calls the admin `PUT /auth/v1/admin/users/{id}`. `backend/app/auth.py` already says it uses "the own-token update". The implementation must switch to `PUT /auth/v1/user` with `apikey: <publishable>` and `Authorization: Bearer <caller token>`, and the tests should assert that the caller's session survives.

## Not confirmed / out of scope

- Hosted Supabase Cloud's current default for "Require current password" and "Secure password change". I could not reach the dashboard. Both are assumed off; check them by hand (F2, F3).
- A live Google OAuth sign-in (needs real Google credentials). The `oauth` `amr` value comes from GoTrue's documented AMR methods. Only `password` was observed live.
