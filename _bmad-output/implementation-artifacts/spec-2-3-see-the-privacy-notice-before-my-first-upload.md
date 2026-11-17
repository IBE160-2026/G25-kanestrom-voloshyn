---
title: 'Story 2.3: See the privacy notice before my first upload'
type: 'feature'
created: '2026-11-17'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-2-upload-documents-and-watch-them-get-processed.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Files can be uploaded without the student ever being told that they go to an external AI service. FR-6 and §5.3 require a one-time notice before the Account's first upload, and the server must refuse uploads until the notice is accepted (AD-19, UX-DR6).

**Approach:**
- Backend: `GET /api/me` and `after-sign-in` return `privacy_notice_accepted` (from `profiles.privacy_notice_ack_at`). New `POST /api/me/privacy-notice` sets it once and is idempotent; it is bookkeeping, on the route-guard allowlist. `identity.require_privacy_ack` runs in the upload before anything is stored, and refuses with `403 privacy_notice_required`.
- SPA: until the Account has accepted, Upload, "browse", and a drop (on the drop zone, Files panel, or Files strip) open the Privacy notice, a modal dialog: "Before your first upload", the body text, "Cancel", and "Got it, upload" (primary).
  - Cancel uploads nothing and discards any dropped files.
  - "Got it, upload" saves the acceptance, then continues the action that opened the notice. A picker opened from Upload or "browse" opens in the same click, so the browser allows it; dropped files are uploaded.
  - It never blocks again.
- The Files panel shows a muted "How your files are used" link, which opens the same text with only "Close".
- All copy is EXPERIENCE.md's signed strings (Privacy notice title, body, buttons, and link). The dialog follows DESIGN.md › Modal dialog: focus is trapped, Esc acts as Cancel, and focus returns to the opener. There is no error colour or icon.

</frozen-after-approval>

## Implementation Notes

- Backend: `privacy_notice_accepted` on `Me` (also from `after-sign-in`), `POST /api/me/privacy-notice` (idempotent; keeps the first time; on the AD-22 allowlist), and `identity.require_privacy_ack` as the first step of `services/materials.upload` (AD-19's allowed call), so a refused upload stores and inserts nothing. The request body has already been received by then.
- SPA: `PrivacyNotice` (radix Dialog; no trigger, so it records the opener and gives focus back on close). `ProjectHome` gates Upload, "browse", and drops on the drop zone, Files panel, and Files strip until `me.privacy_notice_accepted`. "Got it, upload" opens the picker in the same click; picked files upload only once the acceptance is saved (dropped if saving fails). Dropped files upload after the save. Uploads wait until the profile has loaded. `privacy_notice_required` is a non-retryable refusal. "How your files are used" sits under the types hint in the Files panel.
- A failed save shows muted text in the dialog (role="alert", no error colour), per DESIGN.md's calm notice.
- The error text for `privacy_notice_required` is a draft awaiting Cristoffer's approval: "Accept the note on how your files are used before your first upload." / "Godta merknaden om hvordan filene dine brukes før du laster opp første gang." The SPA normally shows the notice instead.
- The "Upload from phone" entry and the phone-link refusal (AD-19) are deferred to Story 6.1 (`deferred-work.md`).
- Tests: `PrivacyNotice.test.jsx` (every entry point, Cancel/Esc, accept + continue, never again, info mode, focus, failed save, Norwegian) and `test_materials.py` (refusal before anything is stored, the gate before the file checks, idempotent acceptance). The gate and failed-save tests fail when the code is broken (checked).

## Review Triage Log

Blind Hunter only (the oneshot route skips the other layers).

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | The gate sits in the route, not in `services/materials` as AD-19 lists | medium | Patched: first step of `materials.upload`; test that it comes before the file checks |
| 2 | The comment says nothing is read before the gate | low | Patched: it now says the body is already received |
| 3 | A failed acceptance still uploads picker files | medium | Patched: they upload only after a successful save; test |
| 4 | `acceptance.current` isn't cleared; failed save untested | low | Patched with 3 |
| 5 | `privacy_notice_required` offers a pointless "Try again" | low | Patched: added to the non-retryable rules |
| 6 | The notice can open before the profile loads | low | Patched: uploads wait for the profile |
| 7 | `markPrivacyAccepted` ignores the returned profile | low | Patched: takes no argument |
| 8 | The dialog uses `radius-lg` and a hard-coded line height | low | Patched: `radius-xl`, `--type-body-line-height` |
| 9 | The failed-save message uses the error colour | low | Patched: muted text with `role="alert"` |
| 10 | Missing tests: "browse", strip drop, focus after Cancel, busy buttons, drop while open | low | Patched: first three; the other two rejected (covered by radix and the busy prop) |
| 11 | No backend test for `after-sign-in` returning the flag; refusal order untested | low | The flag is covered by `test_auth.py`'s `NO_PREFS`; the order test was added |
| 12 | The spec is incomplete; the phone gate isn't deferred | low | Patched: these notes, plus a `deferred-work.md` entry for Story 6.1 |
| 13 | One blank line before new Python definitions | low | Patched |
| 14 | The endpoint docstring cites §5.3, not AD-22 | low | Patched |
