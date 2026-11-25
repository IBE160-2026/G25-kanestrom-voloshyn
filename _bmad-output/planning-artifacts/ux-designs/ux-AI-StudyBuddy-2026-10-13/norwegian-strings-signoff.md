---
title: "Norwegian strings sign-off (FR-29)"
status: signed
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
| D1 | "AI" in Norwegian text: "KI" or "AI"? | KI (KI-tjeneste) | [x] | [x] |
| D2 | "Material" in Norwegian: "stoff" or "materiale"? | materiale ("materialet ditt", "Alt materiale"). Cristoffer chose this 2026-11-16 over the draft "stoff". | [x] | [x] |
| D3 | "Summarize" button: "Oppsummer" or "Sammendrag"? | Oppsummer (verb, like "Quiz" and "Treningskort" next to it) | [x] | [x] |
| D4 | "Got it" on flashcards: "Kan det" or "Skjønner"? | Kan det | [x] | [x] |
| D5 | Ellipsis spacing in Norwegian: "Leser …" (with space) or "Leser…"? | With space ("Leser …", "Venter på bilder …") | [x] | [x] |
| D6 | Is "Quiz" kept as the Norwegian term (plural "quizer")? | Yes | [x] | [x] |

## 2. Glossary terms (Bilingual terms table)

- [x] Ihor  [x] Cristoffer: Ikke helt · Den ligger fortsatt i repetisjonen din. · Repetisjon av feil · Samtale · Treningskort · Du har {n} feil å repetere · Alt er repetert! Bra jobba. · SLETT · English / Norsk · EN | NO

## 3. Strings by surface: tick each flow

Each row points to the "Strings by surface" rows for that flow.

| Flow | Rows to check | Ihor | Cristoffer |
| --- | --- | --- | --- |
| Sign-in and account | Login (tagline, privacy line, actions, fields, invalid login, sign-in failure), Create account (duplicate email, password too short; new 2026-11-12: first name missing, email missing or invalid), Password reset (request, link expired, new password, saved; reset email subject and body, new 2026-11-16), Session expired, Email verified, Verification email (subject and body, new 2026-11-16), Verification email resent, Google takeover notice, Link Google (already linked elsewhere, email not verified) | [x] | [x] |
| Projects and sidebar | Projects page (empty), "+ New project", placeholder name, greeting, Sidebar project menu, collapse and expand | [x] | [x] |
| Upload and files | Upload drop zone, Upload buttons, Files panel header and strip, File status, partly unreadable note, unreadable image, unsupported type, over 50 MB, 11th file, image limit, Files strip warning | [x] | [x] |
| Privacy notice (new 2026-11-02) | Privacy notice title, body, buttons and link | [x] | [x] |
| Topics | Topic count, grouped-topics note, merge, group row, "+ Add topic" | [x] | [x] |
| Ask AI (chat) | Scope control, composer, New chat, empty thread, thinking, answer ready, limit notice, message limit reached, tool buttons | [x] | [x] |
| Quiz | Quiz setup, count picker, too-little-material note, answer labels, feedback (correct, not quite), next question, see results, score summary | [x] | [x] |
| Flashcards | Count picker, too-little-material note, actions, progress, end screen | [x] | [x] |
| Flashcards, Story 4.1 additions (new 2026-11-23) | Flashcards setup ("Lag treningskort"), Flashcards generation failed, Flashcards set ready (until Story 4.2), Finished-generation message for Flashcards | [x] | [ ] |
| Flashcards, Story 4.2 additions (new 2026-11-23) | Flashcard, front ("Begrep", "Klikk for å snu") | [x] | [ ] |
| Summary, Story 4.3 additions (new 2026-11-23) | Finished-generation message for Summary, Summary view scope line, Summary generation failed | [x] | [ ] |
| Ask AI, Story 4.4 additions (new 2026-11-25) | Chat bar scope label ("Svar fra"), Tool buttons row label ("Studer dette materialet") | [x] | [ ] |
| Summary | Summarize setup, "Saved to History" | [x] | [x] |
| Mistake Review | Mistakes card and Start, progress, context, next mistake, Round done, All cleared, saved line, already starting, source file removed | [x] | [x] |
| History | History link, filter, empty, loading, error, "Do it again", Unfinished, source removed | [x] | [x] |
| Generation states | Progress steps (Quiz, Flashcards, Summary, Mistake Review), cancel, cancelled, finished-generation messages | [x] | [x] |
| Errors and limits | Inline error (generic, reassurance, AI service down), too much material, read-only project, history error, remove failed, API error codes (new 2026-11-12: not found, bad request, not signed in, no access, action not available, changed meanwhile, invalid details) | [x] | [x] |
| Settings | Account menu (incl. its accessible name "Kontomeny", new 2026-11-16), Settings sections, account actions, sign-in method, password changed | [x] | [x] |
| Archive and deletion | Archived group, banner and Undo, Deleted projects group and days left, delete-project and delete-forever dialogs, Settings › Delete a project, delete-account entry and dialog, Account deleted | [x] | [x] |
| Phone upload | QR dialog, batch name, phone page header, actions, countdown, expired, sent, over image limit, photo over 50 MB, project full | [x] | [x] |

## 4. Cross-checks before signing

- [x] **Singular and plural forms exist for every count.** For example "1 feil" / "{n} feil", "1 dag igjen" / "{n} dager igjen", "1 bilde" / "{n} bilder", "1 melding" / "{n} meldinger", "1 emne" / "{n} emner", "1 side" / "{n} sider", and "1 treningskort" / "{n} treningskort".
- [x] **One form of address.** Every string uses "du" and "din/ditt/dine", never "De".
- [x] **Sentence case** in buttons and headings, for example "Slett prosjekt", not "Slett Prosjekt".
- [x] **The confirmation word** is SLETT exactly, matching the delete-account check.
- [x] **The privacy notice** in Norwegian makes no claim beyond the English one, which is limited to what architecture AD-3 guarantees.
- [x] **Errors and limit messages** exist in both languages (FR-29).
- [x] **No English string is left untranslated** in Strings by surface.

## 5. Sign-off record

| Reviewer | Date | Signed | Notes |
| --- | --- | --- | --- |
| Ihor Voloshyn | 2026-11-16 | [x] | Approved verbally to Cristoffer on 2026-11-16, including Cristoffer's changes; ticked by Cristoffer on his behalf. |
| Cristoffer Mathias Kanestrøm | 2026-11-16 | [x] | D2 changed to "materiale"; "studiematerialet"; "Lenken/Koden gjelder i …"; "Sidene {pages}" plural added; "Gjør det igjen"; "Valgene dine er lagret."; singular forms added for every count. Cristoffer, as native Norwegian speaker, does the final language read of both English and Norwegian. |

Once both have signed, set this file's `status: signed`, remove the *(proposed)* tags in EXPERIENCE.md, and close the Norwegian-strings open question in EXPERIENCE.md, the PRD (§9.3), and the spec.
