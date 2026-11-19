# Epic 7 Context: Control over projects, account, and language

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give the student control over their own data and interface: archive and restore Projects (read-only while archived), delete Projects into a 30-day Deleted projects area with restore, "Delete forever", and automatic purge, manage the Account in one Settings page (name, password, Google linking, language, data), delete the Account permanently, and finish the bilingual EN/NB interface so every surface built in Epics 1–7 reads naturally in both languages. It realizes the product's "the student controls their own data" promise and closes FR-29, whose Norwegian wording was signed off by Ihor and Cristoffer on 2026-11-16 and is now binding.

## Stories

- Story 7.1: Archive and restore a Project
- Story 7.2: Delete a Project, restore it, or delete it forever
- Story 7.3: Manage my account in Settings
- Story 7.4: Delete my account
- Story 7.5: Complete the bilingual interface (FR-29)

## Requirements & Constraints

- **Archive:** no confirmation, immediately undoable; nothing is deleted. An archived Project is readable (chats, History, files, Topics) but nothing can change: no chat, generation, Mistake Review, upload, removal, Topic edits, rename, "Do it again", or quiz resume. Mistakes are kept but the indicator is hidden; running generation finishes and saves; the phone link is revoked. Restore returns it exactly as it was.
- **Delete (soft):** active or archived Projects; confirmation says it moves to Deleted projects and is permanently deleted after 30 days. Deleted Projects are read-only like archived ones and show days left. Deleting cancels running generation and revokes the phone link. Restore always returns the Project to the active list, even if it was archived before.
- **Delete forever / purge:** permanent and immediate after a confirmation stating it can't be undone; removes files, extracted text, Study Content, chats, and Mistakes including history. Projects past 30 days are purged automatically, and reads must already treat them as gone (a host that slept never shows them). An automated test covers a purge racing a running job.
- **Landing rules:** deleting the open Project lands on the most recent other active Project, or the empty Projects page; sign-in with an archived/deleted last Project lands on the most recent active one.
- **Settings:** email cannot be changed. Email Accounts edit first name in place (shows immediately, persists). Google-linked Accounts: name and picture follow Google, read-only. "Change password" works without a verified email and the old password stops working. Unverified Accounts can resend verification (new 24 h link, older ones invalidated). Google linking only once verified. Language and data deletion are reachable from Settings.
- **Account deletion:** deliberate confirmation (typed word), immediate and permanent, includes Projects in Deleted projects and all Mistake history; the session ends; the same email can register again (automated test).
- **Bilingual completion:** every key in both `en.json` and `nb.json` (automated check), singular and plural forms where counts appear, every API error code translated, no user-facing string hard-coded outside `frontend/src/i18n/`. Norwegian follows the binding glossary (Samtale, Treningskort, Repetisjon av feil, emner; KI not AI; "materiale"; "Oppsummer"; "Kan det"; spaced ellipsis "Leser …"; "Quiz"/"quizer"). Generated content stays in the material's language.
- **Scope tier:** FR-23/FR-24 (7.1–7.2) and FR-29 completion (7.5) are Extensions in the cut order; FR-27/FR-28 are not in the cut list.

## Technical Decisions

- **Project states:** `projects.archived_at` and `projects.deleted_at` (both on the closed mutable-column list). `GET /api/projects` returns every state, with `purge_at` for deleted Projects.
- **Read-only guard:** every content mutation calls `projects.require_active(conn, account_id, project_id)` first → `409 project_read_only`. Bookkeeping routes are account-scoped but unguarded: job seen/cancel, chat `last_opened_at`, flashcard set end, phone-link revoke, prefs, restore, delete forever. A route test asserts every mutating route either calls `require_active` or is allowlisted.
- **Archive and delete** both call `phone.revoke_for_project`; delete also calls `jobs.cancel_for_project`. Restore clears the state column.
- **Purge:** `projects.purge(conn, account_id, project_id)`: (1) `jobs.cancel_and_wait`, (2) `DELETE FROM projects` (cascades to every child), (3) delete the Storage prefix after commit. Called by "Delete forever", Account deletion, and an in-process periodic task in the FastAPI lifespan (once at startup, then hourly) for `deleted_at` older than 30 days. No cron service or extra infrastructure.
- **Job interplay:** the job save transaction never calls `require_active` (archived Projects still save) but aborts if the Project has `deleted_at`, `cancel_requested`, or a cited Material is removed. Cancel uses `UPDATE … WHERE status IN ('queued','running')` and aborts the in-flight LLM call. Only `services/jobs` writes `generation_jobs`.
- **Profiles / Settings API:** `profiles` holds `first_name`, `language`, `email_verified_at`, Google takeover fields, `ui_prefs`, `last_project_id`, `privacy_notice_ack_at`; read/write via `GET/PATCH /api/me` and `PATCH /api/me/prefs`. Password change is the browser's `supabase-js` `updateUser({password})` (never `updateUser({email})`). Resend verification issues a new single-use hashed token (24 h) via `mailer.py` and invalidates older ones. "Link Google" uses `linkIdentity`, offered only while `email_verified_at` is set; the backend re-checks after linking and removes an unverified link (`email_not_verified`); an identity linked elsewhere → `google_identity_in_use`.
- **Account deletion:** `DELETE /api/me`: (1) `jobs.cancel_for_account` and wait, (2) delete Storage prefix `{account_id}/`, (3) admin delete-user through `supabase_auth.py` (app tables cascade from `profiles` → `auth.users`). The SPA then signs out.
- **Data rules:** every app table hangs off `projects` or `profiles` with `ON DELETE CASCADE`; Storage objects are deleted only after the DB change commits; row deletion happens only through the closed list (purge and Account deletion are on it). Schema changes only via `supabase/migrations/`.
- **i18n:** SPA owns every string via `react-i18next`; API errors are `{"error": {code, params, message}}` and `message` is never shown. Language before sign-in: `localStorage`, then `navigator.language`, English fallback; after sign-in: `profiles.language` via `PATCH /api/me`. Auth emails go out in `profiles.language`.
- **Tests:** backend `pytest` with `LLM_MODE=mock` against local Supabase; frontend Vitest uses the real catalogues via the shared render helper, never mocking `react-i18next`.

## UX & Interaction Patterns

- **Sidebar:** project "···" menu — active: Rename · Archive · Delete project; archived: Restore · Delete project; deleted: Restore · Delete forever. "Archived ({n})" and "Deleted projects ({n})" groups at the bottom, collapsed by default, absent when empty; deleted rows are muted with "Deleted · {n} days left" ("1 day left"). Both groups stay hidden in the Sidebar strip.
- **Archive:** Undo message "{project} archived · Undo", bottom-left, 6 s, persists on hover/focus. Archiving the open Project keeps it open, read-only, with the Archived banner ("Archived · Restore", Restore primary).
- **Read-only Project:** composer, tool buttons, New chat, uploads, file Remove, Topic edits, rename (Top bar too), "Do it again", and quiz resume disabled; no Mistakes card (returns on Restore when > 0). Blocked-action copy: "This project is archived/deleted. Restore it to make changes."
- **Deleted banner:** "Deleted · {n} days left" with Restore (primary) and "Delete forever".
- **Three Confirm dialogs (Radix Dialog, Esc/Cancel safe, focus return):** delete project → names the Project, 30-day text, final Button (primary), no typing; delete forever → names what is lost, final Button (danger); delete account → names what is lost including Deleted projects, Button (danger) disabled until DELETE (SLETT in Norwegian) is typed. Danger buttons appear only on these irreversible confirms (plus Remove file).
- **Landings:** delete the open Project or delete forever from the open deleted Project → most recent active Project or empty Projects page; from the sidebar menu → current page; restore → current page, no Undo; 30-day purge → no navigation, row leaves the group; Account deleted → Login screen "Your account and files have been deleted."
- **Settings:** one page, sections Account · Language · Your data, reached from the Account menu (Settings · Language · Log out). Email accounts: initials avatar, inline name edit, "Change password" (always enabled), "Link Google account" or, if unverified, muted "Verify your email first" + "Resend verification email" ("We've sent a new link. It works for 24 hours."). Already-linked-elsewhere error in the error colour; cancelled consent shows nothing. Google accounts: name, email, picture read-only. Language switch applies immediately and saves. Your data: "Delete a project" list with Delete per row, and "Delete my account and all my files".
- All copy comes from EXPERIENCE.md › Strings by surface (EN/NB signed); Norwegian must match it exactly, with the (proposed) tags removed.

## Cross-Story Dependencies

- Builds on Epic 1 (identity, `profiles`, Account menu, language system, verification and Google linking backend), Epic 2 (Projects, Sidebar, `require_active`, Storage layout), Epic 3 (jobs runner, cancel paths, Mistakes card), Epic 5 (History read-only behaviour, "Do it again", resume), and Epic 6 (`phone.revoke_for_project`).
- 7.2 reuses 7.1's read-only state and banner pattern; 7.2's delete-project dialog is reused by 7.3's Your data list; 7.4 reuses `projects.purge`/cascade semantics from 7.2 and lives in 7.3's Settings page.
- 7.5 comes last: it audits every surface from Epics 1–7, so all other stories' strings must already be in the catalogues.
