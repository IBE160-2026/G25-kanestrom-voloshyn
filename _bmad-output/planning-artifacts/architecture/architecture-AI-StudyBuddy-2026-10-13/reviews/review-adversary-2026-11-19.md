---
type: architecture-review
lens: adversarial (pairs of units that each follow every rule and still don't fit together)
target: ../ARCHITECTURE-SPINE.md (status: final, amendment of 2026-11-19, AD-19 Google takeover password step)
context: ../.memlog.md (2026-11-19 entries), ../../../../implementation-artifacts/spec-1-6-google-sign-in.md, backend/app/auth.py, backend/app/supabase_auth.py (working tree, still on the admin update)
created: '2026-11-19'
---

# Adversarial review: AD-19 takeover via the caller's own token (2026-11-19)

**Scope.** Only what the amendment decides or leaves open:
- AD-19: the takeover sets the random password with the caller's own token (`PUT /auth/v1/user` through `supabase_auth.py`), never the admin update.
- AD-19: the takeover runs only when the Account has both an email and a Google identity. A Google-only Account never gets a password.
- AD-2: the adapter's call list now reads "the caller's own password update for the takeover" instead of "admin user update".

The units are: `user_auth` step 4 (Story 1.6), `POST /api/auth/after-password-reset` (Story 1.5), Settings' change-password and "Link Google" with the after-link re-check (Story 7.3), `DELETE /api/me` (Story 7.4), and AD-18's side-effect rule as a reader of all of them.

**GoTrue behaviour this review relies on.** `PUT /auth/v1/user` with a password calls `UpdatePassword(tx, &sessionID)`, which runs `LogoutAllExceptMe`: it deletes every session of the user except the one whose token made the call. The admin update passes no session id and runs `Logout`, which deletes all of them. The memlog entry of 2026-11-19 confirms this locally. So the amendment changes *which session survives the takeover*: before, none survived; now, the caller's survives.

**Verdict.** Do not finalize as written. The amendment fixes a real bug (the first Google sign-in after a takeover got 401), but "the caller's own token" makes the outcome depend on **whose** request triggers the takeover. The trigger is "any request" on an Account that a pre-registering attacker can also reach, so the attacker can be the caller, keep their session, and end the victim's. That is the attack AD-19's Prevents line names. Close it in the spine with one rule about which session may run the takeover (A1, A2). Widen one word in AD-18 (A3). The rest is cheap to leave to code with a test.

Severity: **Critical** = breaks the security guarantee the rule exists for. **High** = likely divergence that breaks another story or locks a student out. **Medium** = rework or a hidden failure. **Low** = settled by the first example.

---

## A1. Critical: the attacker's session can be "the caller" (close in the spine)

**Units:**
- (a) `user_auth` step 4, written to the letter: on *any* request where the Account has email + Google identities, `email_verified_at IS NULL`, `google_takeover_at IS NULL`, call `PUT /auth/v1/user` with the request's token, delete every other session, set the flags.
- (b) The attacker who pre-registered `victim@example.com` with a password. They hold a valid password session and keep calling any `/api/*` route (for example `GET /api/me` in a loop, 10 times a second).

**Sequence:**
1. The victim signs in with Google. Supabase links the Google identity automatically, because `enable_confirmations = false` makes the email look confirmed to GoTrue.
2. Between GoTrue's OAuth callback and the SPA's first `/api/auth/after-sign-in` (code exchange plus redirect, hundreds of ms to seconds), the attacker's next poll arrives. All conditions hold, so the takeover runs **with the attacker's token**.
3. GoTrue's `LogoutAllExceptMe` deletes the **victim's** Google session and keeps the attacker's. Step 3 then deletes "every other" session again, still around the attacker's, and sets `google_takeover_at`.
4. The victim gets `unauthorized` and signs in with Google again. The takeover is now marked done, so nothing ends the attacker's session. The attacker keeps reading and writing the victim's Projects for up to `SESSION_MAX_AGE_DAYS` (30 days), refreshing as needed. They also see the Google name and picture.

Under the old admin update this race ended in "everyone signed out, password unknown", which is safe. The amendment makes it unsafe. The cause is the amendment's own decision, so it is in scope.

**Tightening (one sentence in AD-19):** "The takeover runs only on a request whose session came from a Google sign-in (the token's `amr` includes `oauth`). On an Account where the takeover is due, a request from any other session deletes that session and gets `unauthorized`." GoTrue stores `amr` per session (`auth.mfa_amr_claims`), so refreshed tokens keep it. `user_auth` already decodes the token's claims for `session_id`. The attacker can sign in again with the password, but every such session is refused until the victim's first request completes the takeover, and then the password is random. This is non-obvious, so it belongs in the spine, not in code.

## A2. Critical: a manual link burns the one-time takeover (close in the spine, same sentence plus one)

**Units:**
- (a) Story 7.3: "Link Google" is offered only while verified. The backend re-checks in the endpoint the SPA calls after linking, and removes an unverified link (`email_not_verified`).
- (b) `user_auth` step 4 as amended: the trigger is "both identities exist". It does not say how the Google identity got there.
- (c) The attacker from A1, before the victim ever uses the app. `enable_manual_linking = true` (AD-2), so the attacker's password session calls `linkIdentity` from the browser console with **the attacker's own Google account**. They skip the after-link call (the "skipped browser call" in AD-19's Prevents line).

**Sequence:** The Account now has email + Google and is unverified. The attacker signs in with their own Google, so the session is `amr = oauth` and A1's rule passes too. The takeover runs and keeps the attacker's session. `google_takeover_at` is set, and the attacker's Google identity stays linked, because the removal lives only in an endpoint the attacker never calls. Later the victim signs in with Google. Supabase links the victim's Google to the same user by email, and no takeover runs because it is "once". The attacker now has a permanent Google sign-in to the victim's Account, not limited to 30 days.

Even without an attacker, (a) and (b) conflict in a legitimate run: if the after-link request is the first one after the link, `user_auth` runs the takeover **before** the handler's re-check. The student's own password is replaced with a random one, and then Google is unlinked, so they have no working sign-in until they reset the password.

**Tightening:** move the re-check into `user_auth` and order it before the takeover. "On an unverified Account, a Google identity whose email differs from the Account's email (a manual link) is removed through `supabase_auth.py` and the request gets `email_not_verified`. Only a Google identity with the Account's email can cause a takeover." Automatic linking only ever matches by email, so this separates the two paths without new state. The SPA-called re-check can stay as the fast path, as after-sign-in already is.

## A3. High: AD-18 says "admin call", and the takeover's call no longer is one (close in the spine: one word)

**Units:**
- (a) AD-18: "No Supabase **admin** call (`supabase_auth.py`) … runs while a write transaction is open." Its second sub-bullet says the takeover commits in its own transaction. It does not say whether the HTTP call sits inside or before that transaction.
- (b) A Story 1.6 rework that wants the takeover serialized. It opens a transaction, locks `profiles` `FOR UPDATE`, runs `delete_others` (deleting `auth.sessions` rows), then calls `PUT /auth/v1/user`, which is now not an admin call, then commits.

**Divergence:** GoTrue's `LogoutAllExceptMe` runs `DELETE FROM auth.sessions …` on its own connection and blocks on the rows (b) has already deleted and still holds locked. (b) waits for the HTTP answer, so the two wait on each other until the 5 s timeout. Then (b) gets 503 and rolls back. Every retry takes the same order, so the Account answers `auth_unavailable` on every request, permanently. Even without the deadlock, a pooled connection and a row lock are held across an external call, which is the harm AD-18 exists to prevent.

**Tightening:** in AD-18 change "No Supabase admin call" to "No Supabase Auth call, admin or user-token,". Optionally add "the takeover's password call runs before its transaction opens". The current code already does this, so the fix is wording only.

## A4. Medium: which failures of `PUT /auth/v1/user` mean what (cheap to leave to code, with a test)

**Units:** (a) AD-2 step 1 says only a 401/403 **from the token check** means `unauthorized`. (b) The takeover's call reuses the same token a few ms later. Possible answers:
- 401/403 because the session was deleted in between (a parallel takeover, a logout, Story 7.4's delete), or the token expired just after step 1. GoTrue checks that the session exists.
- 422 because the random password breaks a rule. Examples: `password_requirements` in `config.toml`, which a later Settings story may tighten ("lower_upper_letters_digits_symbols"), or leaked-password protection on Cloud.
- 400/401 "reauthentication needed" if `secure_password_change` is turned on and the session is older than 24 h. This applies to a takeover retried on an older session.

The working code maps every non-200 to `auth_unavailable`. For 401/403 that loops harmlessly: the SPA keeps the session and the next step 1 says `unauthorized`. For 422 or reauthentication it **bricks the Account**: every request answers 503 forever, and both stories followed the rules.

**Leave to code:**
- Map 401/403 from this call to `unauthorized`.
- Generate the password from all four character classes.
- Add `secure_password_change = false` to the `config.toml` test or comment, so the takeover can't be broken by a settings change.

If the team wants it in the spine, one clause in AD-2's settings list is enough: "`secure_password_change = false`; the takeover's password satisfies any `password_requirements`".

## A5. Medium: "a Google-only Account never gets a password" is stated where it can't be enforced (cheap: reword)

**Units:** (a) AD-19 now states the invariant as a rule. (b) Story 7.3 writes change-password with `updateUser({password})`, gated in the SPA on "Account has a password". It reads that as "has an email identity", or for a taken-over Account as "has a password". (c) `PUT /auth/v1/user` accepts a password for an OAuth-only user from **any** holder of that user's token, for example the student with curl. GoTrue's password grant then accepts email + password without checking for an email identity.

**Divergence:** the backend never gives a Google-only Account a password, but the Account can still get one, and the spine claims otherwise. That harms nobody, because only the owner holds the token. But a test or reviewer who relies on the rule (for example Story 1.5's "only for an Account with an email identity") will be wrong. A Google-only Account that sets a password this way still gets no reset email.

**Leave to code, with a reword:** "The backend never sets a password on a Google-only Account, and the SPA never offers one". This states what the app controls. Also, a taken-over Account is "an Account that has a password" in AD-1's sense, so Story 7.3 will offer it "Change password". Decide in Story 7.3's spec whether that is wanted. The owner setting their own password is safe once A1 holds.

## A6. Low: GoTrue now ends other sessions on every user-token password change (leave to code / UX)

**Units:** (a) Story 1.5's `after-password-reset` deletes other sessions. The browser's `updateUser({password})` already did that through `LogoutAllExceptMe`, so the backend call is now defence in depth. Keep it, because it is what holds if GoTrue changes. (b) Story 7.3's change-password goes through the same endpoint, so it **also** signs out every other device. The PRD only decided that for a reset (memlog H8). A Story 7.3 author who promises "other devices stay signed in" can't deliver it. Settle this in Story 7.3's copy, not in the spine.

Also check, cheaply in code: if Supabase's "password changed" security notification is enabled on Cloud, the takeover makes Supabase email the victim in English. That breaks "Auth emails are sent only by `mailer.py`". Keep it off in `config.toml` and on Cloud.

## A7. Low: account deletion during a takeover (leave to code)

Story 7.4 deletes the user while another tab's request is between the takeover's `PUT` and its step-3 transaction. `profiles.ensure` then hits the FK on `auth.users` and answers 500 instead of `unauthorized`. Map a missing user in step 3 to `unauthorized`, as `identity.get_profile` already does.

---

## What to change in the spine (proposal; needs Ihor's approval, spine is `status: final`)

1. AD-19 takeover bullet, add: "It runs only on a request whose session came from a Google sign-in (`amr` includes `oauth`) and only for a Google identity whose email is the Account's email. On an Account where it is due, any other session is deleted and refused `unauthorized`. On an unverified Account, `user_auth` removes a Google identity with a different email (`email_not_verified`) before the takeover check." (A1, A2)
2. AD-18: "No Supabase admin call" becomes "No Supabase Auth call (admin or user-token)". (A3)
3. AD-19 invariant reword: "The backend never sets a password on a Google-only Account, and the SPA never offers one." (A5)

Items A4, A6 and A7 go to Story 1.6 and Story 7.3 code and tests.

Note: the working tree's `backend/app/auth.py` and `supabase_auth.py` still use the admin update, so the amendment is not implemented yet. A1 and A2 should be settled before Story 1.6 switches to `PUT /auth/v1/user`.
