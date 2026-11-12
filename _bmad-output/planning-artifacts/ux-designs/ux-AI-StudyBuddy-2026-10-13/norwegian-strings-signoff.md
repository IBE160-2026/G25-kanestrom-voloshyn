---
title: "Norwegian strings sign-off (FR-29)"
status: open
created: 2026-11-02
owners: [Ihor Voloshyn, Cristoffer Mathias Kanestrøm]
---

# Norwegian strings sign-off (FR-29)

FR-29 is **not complete** until both of you have signed below. The strings live in [EXPERIENCE.md › Voice and Tone](EXPERIENCE.md#voice-and-tone), in the "Bilingual terms" glossary and the "Strings by surface" table. Every Norwegian string there is tagged *(proposed)*.

**How to review:**
- Edit a string directly in EXPERIENCE.md.
- Tick a box here only when the strings in that group read naturally to you and follow the glossary.
- Note any disagreement in the Notes column of the sign-off record at the end.

On sign-off:
1. Remove the *(proposed)* tags.
2. The glossary becomes binding.
3. The frontend copies the table into `frontend/src/i18n/en.json` and `nb.json` (architecture AD-26).

## 1. Decisions to settle first

| # | Question | Draft choice | Ihor | Cristoffer |
| --- | --- | --- | --- | --- |
| D1 | "AI" in Norwegian text: "KI" or "AI"? | KI (KI-tjeneste) | [ ] | [ ] |
| D2 | "Material" in Norwegian: "stoff" or "materiale"? | stoff ("stoffet ditt", "Alt stoff") | [ ] | [ ] |
| D3 | "Summarize" button: "Oppsummer" or "Sammendrag"? | Oppsummer (verb, like "Quiz" and "Treningskort" next to it) | [ ] | [ ] |
| D4 | "Got it" on flashcards: "Kan det" or "Skjønner"? | Kan det | [ ] | [ ] |
| D5 | Ellipsis spacing in Norwegian: "Leser …" (with space) or "Leser…"? | With space ("Leser …", "Venter på bilder …") | [ ] | [ ] |
| D6 | Is "Quiz" kept as the Norwegian term (plural "quizer")? | Yes | [ ] | [ ] |

## 2. Glossary terms (Bilingual terms table)

- [ ] Ihor  [ ] Cristoffer: Ikke helt · Den ligger fortsatt i repetisjonen din. · Repetisjon av feil · Samtale · Treningskort · Du har {n} feil å repetere · Alt er repetert! Bra jobba. · SLETT · English / Norsk · EN | NO

## 3. Strings by surface: tick each flow

Each row points to the "Strings by surface" rows for that flow.

| Flow | Rows to check | Ihor | Cristoffer |
| --- | --- | --- | --- |
| Sign-in and account | Login (tagline, privacy line, actions, fields, invalid login, sign-in failure), Create account (duplicate email, password too short), Password reset (request, link expired, new password, saved), Session expired, Email verified, Verification email resent, Google takeover notice, Link Google (already linked elsewhere, email not verified) | [ ] | [ ] |
| Projects and sidebar | Projects page (empty), "+ New project", placeholder name, greeting, Sidebar project menu, collapse and expand | [ ] | [ ] |
| Upload and files | Upload drop zone, Upload buttons, Files panel header and strip, File status, partly unreadable note, unreadable image, unsupported type, over 50 MB, 11th file, image limit, Files strip warning | [ ] | [ ] |
| Privacy notice (new 2026-11-02) | Privacy notice title, body, buttons and link | [ ] | [ ] |
| Topics | Topic count, grouped-topics note, merge, group row, "+ Add topic" | [ ] | [ ] |
| Ask AI (chat) | Scope control, composer, New chat, empty thread, thinking, answer ready, limit notice, message limit reached, tool buttons | [ ] | [ ] |
| Quiz | Quiz setup, count picker, too-little-material note, answer labels, feedback (correct, not quite), next question, see results, score summary | [ ] | [ ] |
| Flashcards | Count picker, too-little-material note, actions, progress, end screen | [ ] | [ ] |
| Summary | Summarize setup, "Saved to History" | [ ] | [ ] |
| Mistake Review | Mistakes card and Start, progress, context, next mistake, Round done, All cleared, saved line, already starting, source file removed | [ ] | [ ] |
| History | History link, filter, empty, loading, error, "Do it again", Unfinished, source removed | [ ] | [ ] |
| Generation states | Progress steps (Quiz, Flashcards, Summary, Mistake Review), cancel, cancelled, finished-generation messages | [ ] | [ ] |
| Errors and limits | Inline error (generic, reassurance, AI service down), too much material, read-only project, history error, remove failed, API error codes (new 2026-11-12: not found, bad request, not signed in, no access, action not available, changed meanwhile, invalid details) | [ ] | [ ] |
| Settings | Account menu, Settings sections, account actions, sign-in method, password changed | [ ] | [ ] |
| Archive and deletion | Archived group, banner and Undo, Deleted projects group and days left, delete-project and delete-forever dialogs, Settings › Delete a project, delete-account entry and dialog, Account deleted | [ ] | [ ] |
| Phone upload | QR dialog, batch name, phone page header, actions, countdown, expired, sent, over image limit, photo over 50 MB, project full | [ ] | [ ] |

## 4. Cross-checks before signing

- [ ] **Singular and plural forms exist for every count.** For example "1 feil" / "{n} feil", "1 dag igjen" / "{n} dager igjen", "1 bilde" / "{n} bilder", "1 melding" / "{n} meldinger", "1 emne" / "{n} emner", "1 side" / "{n} sider", and "1 treningskort" / "{n} treningskort".
- [ ] **One form of address.** Every string uses "du" and "din/ditt/dine", never "De".
- [ ] **Sentence case** in buttons and headings, for example "Slett prosjekt", not "Slett Prosjekt".
- [ ] **The confirmation word** is SLETT exactly, matching the delete-account check.
- [ ] **The privacy notice** in Norwegian makes no claim beyond the English one, which is limited to what architecture AD-3 guarantees.
- [ ] **Errors and limit messages** exist in both languages (FR-29).
- [ ] **No English string is left untranslated** in Strings by surface.

## 5. Sign-off record

| Reviewer | Date | Signed | Notes |
| --- | --- | --- | --- |
| Ihor Voloshyn | | [ ] | |
| Cristoffer Mathias Kanestrøm | | [ ] | |

Once both have signed, set this file's `status: signed`, remove the *(proposed)* tags in EXPERIENCE.md, and close the Norwegian-strings open question in EXPERIENCE.md, the PRD (§9.3), and the spec.
