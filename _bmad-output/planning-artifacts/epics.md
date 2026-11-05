---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-AI-StudyBuddy-2026-10-06/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-AI-StudyBuddy-2026-10-13/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-AI-StudyBuddy-2026-10-13/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-AI-StudyBuddy-2026-10-13/EXPERIENCE.md
  - _bmad-output/specs/spec-AI-StudyBuddy/SPEC.md
  - _bmad-output/specs/spec-AI-StudyBuddy/acceptance-criteria.md
  - _bmad-output/specs/spec-AI-StudyBuddy/user-journeys.md
  - _bmad-output/specs/spec-AI-StudyBuddy/glossary.md
---

# AI-StudyBuddy - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for AI-StudyBuddy, decomposing the requirements from the PRD, the UX design contract (DESIGN.md + EXPERIENCE.md), and the architecture spine into implementable stories. Every story cites its PRD FR ids, spec CAP ids, and spine AD ids. Each FR's full testable consequences are in the spec's `acceptance-criteria.md`, and stories reference them rather than restating them all.

**Standing decisions for this breakdown:**
- **Privacy notice (FR-6, §5.3, AD-19):** resolved; not to be reopened.
- **Google linking (FR-19 as amended, AD-19):** resolved; a verified Account is linked at once. Not to be reopened.
- **Norwegian strings (FR-29):** the team's sign-off (`norwegian-strings-signoff.md`) is an **acceptance dependency** of the FR-29 story. It does not block building or testing the language system or the draft Bokmål strings, but that story isn't fully done until the wording is approved.

**Done for every story** (applies in addition to its own acceptance criteria):
- The EXPERIENCE.md state patterns for its surfaces are implemented (UX-DR13): empty, loading, error, and narrow-window states. The same goes for keyboard and motion rules (UX-DR14), the Accessibility Floor (UX-DR15), and responsive behaviour (UX-DR16).
- Its interface strings live in `en.json` and `nb.json`, with draft Norwegian until sign-off (UX-DR17, AD-26). Styles use only token variables (UX-DR1, AD-28).
- Its tests pass with `uv run pytest` in mock mode against local Supabase, with no key (AD-4).
- Generated output stays grounded and names its sources (NFR-3, SM-4), and every limit it touches is enforced server-side (NFR-5).

## Requirements Inventory

### Functional Requirements

| FR | Requirement | CAP |
| --- | --- | --- |
| FR-1 | Create an Account with first name, email, and password (≥ 8 characters); one Account per email; 24-hour email verification link, resendable, gating only Google linking | CAP-1 |
| FR-2 | Log in with email + password or Google; land on the most recently used active Project or a start state; generic invalid-login message; 30-day session; logout ends it; after expiry, return to the same Project | CAP-1 |
| FR-3 | Password reset by emailed link (1 h, single use, newer replaces older) for Accounts with a password; identical reply whether or not the email exists | CAP-1 |
| FR-19 | Sign in with Google; a verified email Account is linked at once; an unverified email Account is taken over (old password and sessions end, one-time notice); linking only after verification; an identity already linked elsewhere is refused | CAP-1 |
| FR-4 | Create a Project; auto-name it once from the first successfully extracted material; placeholder until then | CAP-2 |
| FR-5 | Rename an active Project at any time; it persists; not while archived or deleted | CAP-2 |
| FR-6 | Upload PDF, .docx, .pptx, .txt, .md, .jpg/.jpeg, .png, .heic from computer or phone; ≤ 10 Materials (processing counts, rejected doesn't); ≤ 50 MB; server-enforced. **Privacy notice** before the Account's first upload or phone link; nothing uploads until accepted | CAP-3 |
| FR-7 | Extract printed/handwritten text from images; three outcomes per §5.1; 25 images per Account per day, counting each phone photo | CAP-3 |
| FR-8 | Resume a Project exactly as left: non-removed Materials with Topics, all Study Content and chats via History, Unfinished Quiz resumable | CAP-2 |
| FR-9 | Mistake indicator showing the outstanding count when > 0 and the Project is active; hidden at 0 and while archived or deleted | CAP-2 |
| FR-20 | Remove any Study Material (including processing or rejected) from an active Project; confirmation for ready ones; slot frees; generated content stays; Mistakes stay unless opted out | CAP-3 |
| FR-21 | One-time QR phone upload link: no phone login; reads only the Project name and whether a batch fits; ~10 min, revoked on close/archive/delete; a batch is one Material; per-photo limits; pre-send warnings; live arrival on the computer | CAP-10 |
| FR-22 | Detect Topics per Material (~1 per 5 pages, min 3, ceiling 100, server-counted); rename, merge, delete (not the last), add; edits stay within their Material; no fabrication for an absent Topic | CAP-11 |
| FR-23 | Archive and restore a Project: read-only while archived, no confirmation, undoable, Mistakes kept, running generation finishes, phone link revoked | CAP-9 |
| FR-24 | Delete a Project to Deleted projects for 30 days (read-only, days left, restorable), delete forever, automatic purge; deleting cancels generation and revokes the phone link; landing rules | CAP-9 |
| FR-10 | Generate a Quiz of 5/10/20 questions (default 10) from all or chosen Topics; traceable; ≤ 20; too-thin scope offers the largest supported count | CAP-4 |
| FR-11 | Answer one at a time with immediate grounded, sourced explanation; end score equals correct answers; missed questions listed | CAP-4 |
| FR-12 | Every wrong Quiz answer becomes a Mistake at answer time, recording its Study Material and the question and explanation as shown | CAP-4 |
| FR-13 | Generate 5/10/20 flashcards (default 10) from all or chosen Topics; traceable; ≤ 20; too-thin scope offers the largest supported count | CAP-5 |
| FR-14 | Step through cards, reveal on demand, mark known / not yet known; not-yet-known cards return in the set; no Mistakes, no schedule; sourced answers; end shows done and "needed more than one attempt", no score | CAP-5 |
| FR-15 | Summarize one ready Material, whole or one Topic; no unsupported claims; each section names its source | CAP-6 |
| FR-16 | Grounded chat as the Project home; several chats per Project; per-chat narrowing to one Material; persistent; 50 messages per Account per day across all chats; sourced answers | CAP-7 |
| FR-17 | Start Mistake Review only by the student's choice, from an active Project with outstanding Mistakes | CAP-8 |
| FR-18 | Targeted practice from wrong Quiz answers; ≤ 20 per round, oldest first; removed-material Mistakes use the saved question; a clear happens only after save; rounds repeatable; history kept until permanent deletion | CAP-8 |
| FR-25 | History per Project, newest first, filterable by type; read-only results; run again as a new generation; Unfinished Quiz resumes; a part-way Flashcard set is saved as ended; read-only while archived or deleted | CAP-12 |
| FR-26 | Generation continues off-screen, is cancellable, keeps setup choices on cancel and failure, is announced when finished; archive lets it finish, delete cancels it | CAP-12 |
| FR-27 | Settings: name (email Accounts), email, picture, sign-in methods; change password without verification; resend verification; link Google once verified; Google name and picture read-only | CAP-13 |
| FR-28 | Delete the Account after a deliberate confirmation; immediate and permanent, including Deleted projects and Mistake history; the session ends; the email is freed | CAP-13 |
| FR-29 | English and Norwegian (bokmål) interface, including errors and limits; switchable before sign-in; browser default with English fallback; saved to the Account; generated content follows the material's language | CAP-14 |

### NonFunctional Requirements

- **NFR-1 (performance):** each generation (Quiz, Flashcards, Summary, Mistake Review) completes within 60 s for one lecture-deck-sized upload (FR-26).
- **NFR-2 (performance):** an Ask AI answer starts appearing within 5 s and is complete within 15 s (FR-16).
- **NFR-3 (grounding, gating):** no output contains claims unsupported by the selected material, and every explanation, card, summary section, practice question, and chat answer names its source (PRD §5.1, SM-4).
- **NFR-4 (content integrity):** every format and phone batch has accept, warn-and-continue, or reject outcomes, with AD-6's thresholds.
- **NFR-5 (cost limits):**
  - ≤ 20 questions, ≤ 20 cards, and ≤ 20 practice questions per generation
  - 50 messages and 25 images per Account per day
  - 10 Materials per Project, 50 MB per file or photo, 100 Topics per Material

  All are server-enforced, each with a clear message, and no other daily limit exists (§5.2).
- **NFR-6 (data use):** material serves only its owner's content, is never shared with other Accounts, and isn't retained by the AI provider (§5.3, AD-3).
- **NFR-7 (data lifecycle):** removal, archive, soft delete, the 30-day purge, delete forever, and Account deletion behave as in §5.4.
- **NFR-8 (account security):**
  - one Account per email
  - hashed passwords of at least 8 characters
  - no account enumeration in login or reset
  - single-use 1 h reset links
  - the Google takeover and verify-before-link rules
  - a narrow phone link
  - 30-day sessions that logout ends at once

  See §5.5 and AD-2.
- **NFR-9 (usability, gating):** a first-time user completes UJ-1 without instruction (SM-5).
- **NFR-10 (accessibility):** EXPERIENCE.md's Accessibility Floor binds V1: WCAG AA text contrast, 3:1 non-text contrast, a full keyboard path, polite live regions and alerts, 44×44 px targets, and reduced motion.
- **NFR-11 (platform):** desktop web (≥ 1024 px full layout; a narrow window works), plus a single phone upload page.
- **NFR-12 (runnability):** the grader runs the app and tests locally with no key and no paid calls (mock mode, AD-4).

### Additional Requirements

From the architecture spine:

- **Starter / scaffold (Epic 1, Story 1):**
  - frontend from `npm create vite@9` (`react` JavaScript template, Vite 8)
  - backend as a uv FastAPI project (`backend/`)
  - `supabase init` with `supabase/config.toml` and `supabase/migrations/`
  - Supabase CLI pinned at exactly `2.122.0` as a root devDependency
  - the Structural Seed layout (AD-16, AD-17)
- **One deployable:** one Docker image (a multi-stage build: SPA, then Python runtime). FastAPI serves `/api/*` and the SPA through `app.frontend` with an SPA fallback, plus an `/api/{path}` JSON 404. One instance with one worker (AD-17, AD-29).
- **Async runtime:** async routes; a `psycopg_pool.AsyncConnectionPool`; `AsyncOpenAI`; blocking parsers via `asyncio.to_thread`; pure helpers synchronous (AD-29).
- **Config:** all settings in `backend/app/config.py` from env. `.env.example` lists every name. The SPA reads `/api/config` at runtime. `SUPABASE_URL`, `SUPABASE_PUBLIC_URL`, and `APP_PUBLIC_URL` (AD-17).
- **Auth:**
  - two dependencies, `user_auth` and `phone_link_auth`, with per-request `auth.sessions` checks (30 days; a missing row means logged out)
  - Supabase settings in `config.toml`: confirmations off, minimum password length 8, manual linking on, `otp_expiry` 3600, Google behind an env switch
  - see AD-1, AD-2, AD-19
- **Identity backend:**
  - `profiles` (including `privacy_notice_ack_at`)
  - `after-sign-in`, `after-password-reset`, and `password-reset` endpoints
  - app-level verification tokens
  - the takeover enforced in `user_auth`
  - `mailer.py` over SMTP (Mailpit locally)
  - `DELETE /api/me`

  See AD-19.
- **LLM gateway:**
  - only `backend/app/llm/` imports `openai`; one typed task per job; Pydantic schemas
  - local Section labels with citation mapping
  - `provider: {require_parameters, data_collection: deny, zdr: true}`
  - error mapping; mock mode with template fixtures, filename markers, and `LLM_MOCK_DELAY_MS`

  See AD-3, AD-4.
- **Background jobs:**
  - the `generation_jobs` table, owned by `services/jobs`
  - an asyncio runner (`JOBS_MAX_CONCURRENT=3`), handlers that return save plans
  - a locked save transaction, cancel paths, a restart sweep, and polling, with the finished-job notice

  See AD-20, AD-18.
- **Extraction pipeline:**
  - pdfplumber for PDF, MarkItDown for .docx/.pptx, pillow-heif for images
  - Sections, with `tsvector` (`simple` config)
  - the Material status lifecycle and the `occupies_slot` predicate
  - `on_terminal`, mapping job outcomes to Material states

  See AD-5, AD-6.
- **Data:** the schema, the bucket, and its policies live only in migrations; cascades hang off `projects` and `profiles`; Storage objects are deleted after commit (AD-16). Immutability and the closed mutable-column list (AD-8).
- **Domain services:**
  - `topics.resolve_scope`, the only scope resolver, with frozen `generation_params` and the capacity endpoint (AD-7, AD-21)
  - `services/mistakes`, the sole owner of Mistakes (AD-10)
  - `services/usage`, with atomic `reserve`/`release` (AD-12)
  - `projects.require_active` plus a bookkeeping allowlist, and the purge task (AD-22)
  - the Material tombstone (AD-23)
  - the phone link and batches with cleanup (AD-24)
  - chats with SSE streaming (`EventSourceResponse`) (AD-25)
  - the History read model (AD-27)
- **Frontend look:** `tokens.css` from DESIGN.md, CSS Modules, Radix primitives, `react-router` 8, `react-i18next` with `en.json`/`nb.json`, `@fontsource-variable/inter`, `lucide-react`, `qrcode` (AD-26, AD-28).
- **Tests:**
  - `pytest` in mock mode against local Supabase
  - an import test that only `llm/` imports `openai`
  - a `require_active` route test
  - a 7-character password test
  - `test-data/` samples for each AD-6 outcome
- **Local run (grader):** `.env` → `npx supabase start` → `npx supabase db reset` → `docker compose up`; Mailpit for email; Google hidden without keys; `APP_PUBLIC_URL` for the phone demo.

### UX Design Requirements

From DESIGN.md (visual) and EXPERIENCE.md (behaviour). Copy comes from EXPERIENCE.md › Strings by surface.

- **UX-DR1:** `tokens.css` with every DESIGN.md token (colours including tints, typography scale, spacing, radii, component tokens). Dark theme only. No hard-coded colours; Inter bundled.
- **UX-DR2: Shared primitives.** These are reused everywhere, so they need to be built once:
  - Focus ring
  - Button (primary, ghost, danger; danger only on the three irreversible confirms)
  - Overflow menu (Radix DropdownMenu, with focus return)
  - Key hint
  - Source label ("file · slide N")
  - Progress bar
  - Progress steps with Cancel
  - Skeleton (static)
  - Inline error (with "Nothing you've made is lost." and "Try again" taking focus)
  - Undo message (6 s, persists on hover or focus)
  - Empty state
  - Modal dialog (Radix Dialog, opens on Cancel, Esc safe, focus return)
  - Checkbox and radio
  - Text input (shortcuts disabled while focused)
- **UX-DR3: App shell.** Sidebar with its project "···" menu and inline rename; Sidebar strip; Archived group; Deleted projects group with days left; Top bar with inline rename; Archived banner and Deleted banner; Account menu; Avatar; Language switch. Collapse state saved to the Account; narrow windows start collapsed.
- **UX-DR4: Chat home.** Mistakes card (only when > 0, active); Chat bar with Scope control, New chat button, and History link; Chat message (pending "thinking…", streaming, Send disabled until complete, announced once); Tool buttons row; Composer; Limit notice (≤ 10 left, at 0 declined); Upload drop zone for an empty Project.
- **UX-DR5: Files panel.** Header "Files · n of 10"; Files strip with a warning icon and per-Project collapse state; Upload buttons; File row; File status (Reading…, Ready, Ready partly unreadable, Rejected) with notes; Remove file dialog (with the Reading… variant and the mistakes checkbox); live updates.
- **UX-DR6: Privacy notice.** Modal before the Account's first Upload, drop, or "Upload from phone". Cancel uploads nothing. "Got it, upload" saves acceptance and continues the action. A muted "How your files are used" link reopens the text with Close.
- **UX-DR7: Topics.** Topic chip (rename with Enter, × delete, never on the last one); Topic list (chapter groups, collapsed above about 20, scrollable, Merge by multi-select, keyboard model); Topic count; Grouped-topics note at 100; Topic scope picker reusing the list's grouping.
- **UX-DR8: Activities.**
  - **Activity header** ("← Back to chat"), Count picker (5/10/20, default 10, the button names the count), Too-little-material note (disables the button until the count fits).
  - **Quiz:** Answer option (keys 1–4; "Your answer" and "Correct answer" colours), Feedback panel (no auto-advance), Score summary.
  - **Flashcards:** Flashcard (Space flips, → Got it, ← Not yet), Flashcard end screen.
  - **Summary:** Summarize setup, Summary view with per-section sources.
- **UX-DR9: Mistake Review.** Session (original mistake as context, "n of m cleared", Stop for now), All cleared panel (only after the last clear is saved), Round done panel (when Mistakes remain).
- **UX-DR10: History.** History filter (All, Chats, Quizzes, Flashcards, Summaries); History row (read-only results, "Do it again" disabled when the source was removed, "Unfinished · n of total" resumes); empty, loading, and error states.
- **UX-DR11: Sign-in and Settings.**
  - **Sign-in:** Login screen (tagline, privacy line, EN | NO toggle), Auth panel, Google button (hidden without config), Error line, Create account screen, Password reset screens, Projects page (empty).
  - **Settings:** three Settings sections; the three Confirm dialogs (delete project primary, delete forever danger, delete account with typed DELETE/SLETT).
- **UX-DR12: Phone upload.** QR dialog ("Waiting for photos…", live batches, close ends the link); phone page with Phone action buttons, Photo thumbnails (× renumbers), Phone send button (live count, warnings), Link countdown, Expired notice, Phone footer credit. Mobile layout; no HTTPS-only APIs.
- **UX-DR13: State patterns.** Study Material, Account, Project and chat, Sidebar, Archived, Deleted, Topics, Daily limits, Generating (leave, finish notice, cancel, failure), Leaving part-way, Phone link, and Destructive-action landings, exactly as tabled in EXPERIENCE.md.
- **UX-DR14: Interaction primitives.** Keyboard shortcuts per activity (shown as Key hints, desktop only, off in text inputs); Tab order; subtle motion only; reduced motion makes transitions instant, keeps a static Reading… dot, stops the thinking dots, and removes skeleton shimmer.
- **UX-DR15: Accessibility floor.** Everything in EXPERIENCE.md › Accessibility Floor, including non-colour-only status labels, mistakes in amber not red, live regions, `aria-expanded` on groups and collapses, and 44×44 px targets.
- **UX-DR16: Responsive.** Below 1024 px: avatar-only Account menu, collapsed Sidebar and Files panel, and every listed surface stays usable. No full mobile layout beyond the phone page.
- **UX-DR17: Bilingual copy.** Every string in EXPERIENCE.md › Strings by surface is moved into `en.json`/`nb.json`, with singular and plural forms. Norwegian is draft until signed off (FR-29 acceptance dependency).

### FR Coverage Map

| FR | Epic | Brief |
| --- | --- | --- |
| FR-1 | Epic 1 | Account creation, email verification |
| FR-2 | Epic 1 | Login, 30-day session, logout, return after expiry |
| FR-3 | Epic 1 | Password reset |
| FR-19 | Epic 1 | Google sign-in, auto-link verified, takeover unverified |
| FR-29 | Epic 1 (language system) + Epic 7 (completion, sign-off dependency) | EN/NB interface |
| FR-4 | Epic 2 | Project creation and auto-naming |
| FR-5 | Epic 2 | Project rename |
| FR-6 | Epic 2 | Upload, limits, privacy notice |
| FR-7 | Epic 2 | Image text extraction, 25/day |
| FR-8 | Epic 2 (Materials, Topics) + Epic 5 (Study Content, chats, Unfinished Quiz) | Project resume |
| FR-20 | Epic 2 | Material removal |
| FR-22 | Epic 2 | Topic detection and editing |
| FR-10 | Epic 3 | Quiz generation |
| FR-11 | Epic 3 | Quiz taking with sourced feedback |
| FR-12 | Epic 3 | Mistake capture |
| FR-9 | Epic 3 | Mistake indicator |
| FR-17 | Epic 3 | Mistake Review start |
| FR-18 | Epic 3 | Targeted practice rounds |
| FR-26 | Epic 3 | Background generation, cancel, finish notice |
| FR-13 | Epic 4 | Flashcard generation |
| FR-14 | Epic 4 | Flashcard study |
| FR-15 | Epic 4 | Summary generation |
| FR-16 | Epic 4 | Ask AI, several chats, streaming |
| FR-25 | Epic 5 | History |
| FR-21 | Epic 6 | Upload from phone |
| FR-23 | Epic 7 | Archive and restore |
| FR-24 | Epic 7 | Project deletion and purge |
| FR-27 | Epic 7 | Account settings |
| FR-28 | Epic 7 | Account deletion |

## Epic List

### Epic 1: Get in: accounts, sign-in, and a runnable app
A student can create an Account with email or Google, log in and out, reset a forgotten password, and switch the interface between English and Norwegian. The grader can clone the repo and run the app locally in mock mode. Story 1 is the scaffold (create-vite React JS, uv FastAPI, `supabase init` with CLI 2.122.0, one Docker image, `/api/config`, mock-mode test setup).
**FRs covered:** FR-1, FR-2, FR-3, FR-19, FR-29 (language system). **CAPs:** CAP-1, CAP-14. **Key ADs:** AD-1, AD-2, AD-16, AD-17, AD-19, AD-26, AD-28, AD-29.

### Epic 2: Projects and study material
A student can create Projects, accept the one-time privacy notice, upload and remove files (with integrity outcomes and limits), get Projects auto-named, see and edit detected Topics, and find everything as left on return. Builds the LLM gateway with mock mode, the extraction pipeline, and the job runner (first used for `material_processing`).
**FRs covered:** FR-4, FR-5, FR-6, FR-7, FR-8 (Materials, Topics), FR-20, FR-22. **CAPs:** CAP-2, CAP-3, CAP-11. **Key ADs:** AD-3, AD-4, AD-5, AD-6, AD-8, AD-12, AD-14, AD-16, AD-18, AD-19, AD-20, AD-21, AD-23.

### Epic 3: Quiz and the Mistake loop
A student can generate a Quiz from Topics, answer with grounded, sourced feedback, see the score, have wrong answers recorded as Mistakes, see the indicator, and clear Mistakes in Mistake Review rounds. Generation runs in the background, can be cancelled, and announces itself when ready.
**FRs covered:** FR-9, FR-10, FR-11, FR-12, FR-17, FR-18, FR-26. **CAPs:** CAP-2 (indicator), CAP-4, CAP-8, CAP-12 (lifecycle). **Key ADs:** AD-7, AD-9, AD-10, AD-11, AD-12, AD-18, AD-20.

### Epic 4: Flashcards, summaries, and Ask AI
A student can practise with flashcards, summarize one file or Topic, and chat with their material in several chats with streamed, sourced answers. Reuses the scope resolver, source labels, and generation jobs.
**FRs covered:** FR-13, FR-14, FR-15, FR-16. **CAPs:** CAP-5, CAP-6, CAP-7. **Key ADs:** AD-3, AD-7, AD-8, AD-12, AD-18, AD-20, AD-25.

### Epic 5: History
A student can find every chat, quiz, flashcard set, and summary of a Project in one list, reopen results, resume an Unfinished Quiz, and run items again.
**FRs covered:** FR-25, FR-8 (Study Content, chats, Unfinished Quiz). **CAPs:** CAP-2 (resume), CAP-12. **Key ADs:** AD-7, AD-8, AD-27.

### Epic 6: Upload from phone
A student can scan a QR code and send photos of handwritten notes into a Project without logging in on the phone; they appear on the computer without a refresh.
**FRs covered:** FR-21. **CAPs:** CAP-10. **Key ADs:** AD-2, AD-5, AD-6, AD-12, AD-17, AD-20, AD-24.

### Epic 7: Control over projects, account, and language
A student can archive, restore, and delete Projects (30-day Deleted projects, automatic purge), manage Settings, delete the Account, and use a fully bilingual interface. The final story completes FR-29 and is accepted only after Ihor and Cristoffer sign off the Norwegian strings.
**FRs covered:** FR-23, FR-24, FR-27, FR-28, FR-29 (completion). **CAPs:** CAP-9, CAP-13, CAP-14. **Key ADs:** AD-19, AD-20, AD-22, AD-24, AD-26.

**Dependencies:** 1 → 2 → 3 → 4 → 5 → 7, with Epic 6 needing only Epic 2. Stories 4.1 and 4.3 reuse Story 3.1's generation lifecycle; Stories 4.4–4.5 (Ask AI) and Epic 6 need only Epic 2, so they can run in parallel with Epic 3. Epic 5 lists what Epics 3 and 4 create.

## Epic 1: Get in: accounts, sign-in, and a runnable app

A student can create an Account with email or Google, log in and out, reset a forgotten password, and switch the interface between English and Norwegian. The grader can clone the repo and run the app locally in mock mode. FRs: FR-1, FR-2, FR-3, FR-19, FR-29 (language system). CAPs: CAP-1, CAP-14.

### Story 1.1: Runnable app skeleton the grader can start locally

As a grader,
I want to clone the repository, fill in `.env`, and start the app with documented commands,
So that I can run and test AI Study Buddy without any paid key (NFR-12).

**Acceptance Criteria:**

**Given** a fresh clone with Docker running
**When** I copy `.env.example` to `.env`, run `npx supabase start` (copying the printed local keys into `.env`), `npx supabase db reset`, and `docker compose up`
**Then** the app opens in the browser on one origin, showing a placeholder Login screen styled from `frontend/src/styles/tokens.css` (every DESIGN.md token, dark theme only, no hard-coded colours) with the Inter font bundled locally (UX-DR1, AD-28)
**And** `GET /api/config` returns `{supabase_url, supabase_publishable_key, google_enabled}`, an unknown `/api/...` path returns the JSON error envelope with `404 not_found`, and a deep link like `/projects/x` returns the SPA (AD-17).

**Given** the repository layout
**When** I inspect it
**Then** it matches the spine's Structural Seed:
- `frontend/` was created with `npm create vite@9` (React, JavaScript)
- `backend/` is a uv project running async FastAPI with one worker and a `psycopg_pool` connection pool
- `supabase/` has `config.toml` and `migrations/`
- the root `package.json` pins `supabase@2.122.0` exactly
- `.env.example` lists every variable name without values (AD-16, AD-17, AD-29)

**Given** no `OPENROUTER_API_KEY` and `APP_ENV=development`
**When** the backend starts
**Then** `LLM_MODE` resolves to `mock` with a logged warning; with `APP_ENV=production` and `LLM_MODE` unset, startup fails (AD-4)
**And** `uv run pytest` runs green in mock mode and includes the test that no module outside `app/llm/` imports `openai` (AD-3).

**Given** the Supabase settings
**When** I read `supabase/config.toml`
**Then** it sets confirmations off, `minimum_password_length = 8`, `enable_manual_linking = true`, `otp_expiry = 3600`, Google enabled only via `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_ENABLED)`, and the per-environment site and redirect URLs (AD-2).

### Story 1.2: Switch the interface between English and Norwegian

As a student,
I want the app in English or Norwegian (bokmål) from the first screen,
So that I can use it in my own language.

**Acceptance Criteria:**

**Given** a first visit with no saved choice
**When** the Login screen opens
**Then** it follows the browser language, falling back to English when the browser is neither English nor Norwegian (FR-29).

**Given** the Login screen
**When** I use the EN | NO toggle
**Then** every string on screen switches immediately, and the choice persists across reloads before sign-in (AD-26).

**Given** the frontend code
**When** any user-facing string is rendered
**Then** it comes from `frontend/src/i18n/en.json` / `nb.json` through `react-i18next`, never hard-coded, with singular and plural forms for counts
**And** the Norwegian values are the drafted EXPERIENCE.md strings, still marked as draft (UX-DR17).

**Given** an API error
**When** the SPA shows it
**Then** it renders from the error's `code` and `params` in the active language, never the server's `message` (AD-26).

*Acceptance dependency:* none for this story. Final Norwegian wording is accepted in Story 7.5 (FR-29 completion).

### Story 1.3: Create an account with email and password

As a visitor,
I want to create an Account with my first name, email, and password,
So that my study work is saved to me.

**Acceptance Criteria:**

**Given** the Create account screen
**When** I submit a first name, a new email, and a password of at least 8 characters
**Then** the Account is created, I am signed in, `POST /api/auth/after-sign-in` creates my profile with that first name, and I land on the Projects page (empty) (FR-1, AD-19).

**Given** an email already registered by either method
**When** I try to sign up with it
**Then** I see "An account with this email already exists. Log in instead?" and no second Account is created (FR-1).

**Given** a password shorter than 8 characters
**When** I submit
**Then** sign-up is refused with the too-short message, and an automated test confirms that a 7-character sign-up fails (FR-1, AD-2).

**Given** a new email Account
**When** sign-up completes
**Then** the backend sends a verification email through `mailer.py`, which arrives in Mailpit locally, in my interface language
**And** opening the link within 24 hours sets `email_verified_at`, while an expired or replaced link does not verify (FR-1, AD-19).

**Given** an unverified Account
**When** I use the app
**Then** nothing is blocked by the missing verification, and passwords are never stored or logged in plain text (FR-1).

### Story 1.4: Log in, stay signed in, and log out

As a returning student,
I want to log in, stay signed in for 30 days, and log out when I choose,
So that I get back to my work without friction.

**Acceptance Criteria:**

**Given** valid credentials
**When** I log in with email and password
**Then** I reach my Projects (the empty Projects page until Epic 2 adds Projects), and the Account menu shows "Welcome, {first name}", Language, and Log out; Story 7.3 adds Settings to it (FR-2, UX-DR3).

**Given** wrong credentials
**When** I log in
**Then** I see one generic message that never reveals whether the email is registered (FR-2).

**Given** a signed-in session
**When** any `/api/*` request arrives
**Then** `user_auth` validates the token, rejects it with `unauthorized` if the session row is gone, and with `session_expired` if the session is older than 30 days or has no creation time (AD-2).

**Given** I select Log out
**When** it completes
**Then** the session ends at once and the old token is refused (FR-2).

**Given** my session expires mid-use
**When** I log in again
**Then** I return to the page I was on, with "You've been signed out. Log in to continue." shown before login (FR-2).

**Given** I change the language from the Account menu while signed in
**When** I sign in later on another browser
**Then** my choice comes from `profiles.language` (FR-29, AD-26).

### Story 1.5: Reset a forgotten password

As a student who forgot my password,
I want a reset link by email,
So that I can get back into my Account.

**Acceptance Criteria:**

**Given** the Password reset screen
**When** I request a link for any email
**Then** the reply is always "If an account exists, we've sent a link", and only an Account with an email identity gets an email, generated through Supabase admin `generate_link` and sent by `mailer.py` (FR-3, AD-19).

**Given** a reset link
**When** I open it within 1 hour, it is unused, and it is the newest one
**Then** I can set a new password; afterwards the old password fails and every other session ends via `after-password-reset` (FR-3, AD-19).

**Given** an expired, used, or replaced link
**When** I open it
**Then** I see "This link has expired" with "Send a new link" (FR-3).

**Given** an unverified Account
**When** I request a reset
**Then** it works the same as for a verified one (FR-3).

### Story 1.6: Sign in with Google

As a student,
I want to sign up or log in with my Google account,
So that I don't need another password.

**Acceptance Criteria:**

**Given** Google is not configured (no keys and the switch off)
**When** the Login or Create account screen opens
**Then** no Google button is shown, and everything else works (AD-2, AGENTS.md mock policy).

**Given** Google is configured and my Google email is new
**When** I complete Google sign-in
**Then** an Account is created with my Google first name and picture, and I land on the Projects page (FR-19).

**Given** my Google email matches an email Account whose email is **verified**
**When** I sign in with Google
**Then** I am signed in to that Account at once and the Google identity is linked, with no password step and no linking message; both methods then work (FR-19 as amended, AD-19).

**Given** my Google email matches an email Account whose email is **unverified**
**When** I sign in with Google
**Then** the Account is taken over:
- the old password stops working
- every earlier session ends
- I see "Your account now signs in with Google." once

**And** an automated test with seeded identities shows `user_auth` enforces the takeover even if the SPA never calls `after-sign-in` (FR-19, AD-19).

**Given** a Google identity already linked to another Account, or a cancelled consent
**When** I try to sign in
**Then** I see the "already linked" error or "Sign-in didn't work. Try again." respectively, and no Account changes (FR-19).

## Epic 2: Projects and study material

A student can create Projects, accept the one-time privacy notice, upload and remove files (with integrity outcomes and limits), get Projects auto-named, see and edit detected Topics, and find everything as left on return. FRs: FR-4, FR-5, FR-6, FR-7, FR-8 (Materials, Topics), FR-20, FR-22. CAPs: CAP-2, CAP-3, CAP-11.

### Story 2.1: Create, open, and rename Projects

As a student,
I want to create Projects, switch between them, and rename them,
So that each course has its own place.

**Acceptance Criteria:**

**Given** I have no Projects
**When** I sign in
**Then** I see the Projects page (empty) with "Create your first project"; selecting it creates an empty Project and opens it with the placeholder name and the Upload drop zone (FR-4, UX-DR11).

**Given** the app shell
**When** I use the Sidebar
**Then** I see my active Projects and "+ New project", can collapse it to the Sidebar strip, and the collapse state is saved to my Account; below 1024 px it starts collapsed (UX-DR3, UX-DR16).

**Given** an active Project
**When** I rename it inline in the Sidebar or Top bar (Enter saves, Esc cancels)
**Then** the new name shows at once and persists. Input is trimmed, blank input is refused with `invalid_name`, names are capped at 100 characters, and `name_source='student'` is set (FR-5, AD-14).

**Given** I have Projects
**When** I log in
**Then** I land on my most recently used active Project (`profiles.last_project_id`) (FR-2, FR-8).

**Given** the schema
**When** this story's migration runs
**Then** `projects` exists with `name`, `name_source`, `archived_at`, `deleted_at` (both null for now), with `ON DELETE CASCADE` from `profiles`
**And** `projects.require_active` plus the route test (every mutating route either calls it or is on the bookkeeping allowlist) are in place from this story on (AD-16, AD-22).

**Given** an open Project
**When** it renders
**Then** the Project home layout is in place for later stories to fill:
- the chat column, holding the Upload drop zone while no file is Ready
- an initially empty tool buttons row
- the Files panel on the right

Each later feature story adds its own control: the Quiz button in 3.1, Flashcards in 4.1, Summarize in 4.3, the composer and thread in 4.4, and "Upload from phone" in 6.1 (UX-DR3, UX-DR4).

**Given** another student's Project id
**When** I request it
**Then** I get `not_found`; every repository call is scoped by `account_id` (AD-2).

### Story 2.2: Upload documents and watch them get processed

As a student,
I want to upload my PDF, Word, PowerPoint, text, and Markdown files,
So that the app can study them with me.

**Acceptance Criteria:**

**Given** an active Project
**When** I upload a supported document (Upload button or drag and drop, one file per request, several files uploading one after another)
**Then** it appears in the Files panel as "Reading…", the request returns `202`, and a `material_processing` job extracts it in the background (AD-5, AD-20).

**Given** processing finishes
**When** the outcome is known
**Then** the file shows "Ready", "Ready, partly unreadable" (with its note), or "Rejected" (with reason), using AD-6's thresholds:
- PDF is read with pdfplumber page by page
- .docx and .pptx are read with MarkItDown
- text files are split into Sections of about 500 words

The Files panel and Files strip update without a refresh while a file is Reading… (FR-6, §5.1, UX-DR5).

**Given** limits
**When** I upload an unsupported type, a file over 50 MB, or an 11th file
**Then** I get the specific message for that rule. Processing files count toward the 10 and rejected ones don't; the count is re-checked under a Project lock, and an automated test covers two parallel uploads at 9 of 10 (FR-6, AD-5).

**Given** a corrupt or unparseable file
**When** it is processed
**Then** it is rejected, its stored original is deleted after commit, and its slot frees (AD-5, AD-6).

**Given** the app restarts while a file is Reading…
**When** it comes back
**Then** the job is marked `failed` (`interrupted`) and the Material becomes Rejected with reason `interrupted`, so no slot is held forever (AD-20, AD-5).

**Given** the job runner
**When** I inspect it
**Then** `generation_jobs` exists and only `services/jobs` writes it; at most 3 jobs run at once; parsers run via `asyncio.to_thread`. The SPA polls `GET /api/projects/{id}/jobs` every 2 s only while something is active (AD-18, AD-20, AD-29).

**Given** `test-data/`
**When** tests run in mock mode
**Then** there is one small self-made sample per AD-6 outcome for text formats, and each outcome is asserted.

### Story 2.3: See the privacy notice before my first upload

As a student,
I want to be told before my first upload where my files go,
So that I know how my study material is used.

**Acceptance Criteria:**

**Given** my Account has not accepted the notice
**When** I choose Upload or drop files (the "Upload from phone" entry gets the same gate in Story 6.1)
**Then** the Privacy notice opens first ("Before your first upload"), with text that claims only what AD-3 guarantees (FR-6, §5.3, UX-DR6).

**Given** the notice
**When** I select Cancel
**Then** nothing is uploaded and dropped files are discarded.

**Given** the notice
**When** I select "Got it, upload"
**Then** `POST /api/me/privacy-notice` saves `privacy_notice_ack_at`, the action that opened the notice continues, and the notice never blocks an upload again (AD-19).

**Given** an Account without acceptance
**When** an upload reaches the server
**Then** it fails with `privacy_notice_required` via `identity.require_privacy_ack` (AD-19).

**Given** I have accepted it
**When** I select "How your files are used" in the Files panel
**Then** the same text opens with only "Close".

### Story 2.4: My Project names itself from its first file

As a student,
I want a new Project to get a sensible name from my first file,
So that I don't have to think of one.

**Acceptance Criteria:**

**Given** a Project with no name
**When** its first Material reaches Ready
**Then** the Project gets a name derived from that content (for example "Biology — Cell Division"), never a static placeholder, and the name appears without a refresh (FR-4, AD-14).

**Given** I renamed the Project earlier, or it was already auto-named
**When** another Material becomes Ready
**Then** the name never changes (`UPDATE … WHERE name_source IS NULL`) (AD-14).

**Given** naming fails
**When** the file is processed
**Then** the file still becomes Ready and naming retries after the next ready file (AD-14).

**Given** the LLM gateway introduced in this story
**When** I inspect it
**Then** `backend/app/llm/` is the only `openai` importer:
- `AsyncOpenAI` points at OpenRouter with `provider: {require_parameters, data_collection: "deny", zdr: true}` and a timeout
- `name_project` returns a Pydantic model
- provider errors map to `llm_unavailable`
- mock mode returns a deterministic fixture through the same schema, and the test suite runs it with no key (AD-3, AD-4)

### Story 2.5: Upload photos of my notes

As a student,
I want to upload photos of handwritten or printed notes (JPG, PNG, HEIC),
So that my paper notes work like any other file.

**Acceptance Criteria:**

**Given** an image upload
**When** it is processed
**Then** it is normalized to JPEG (HEIC via pillow-heif), its text is extracted by the gateway's `extract_image_text`, and it ends Ready, "Ready, partly unreadable", or Rejected by legibility and character count (FR-7, AD-5, AD-6).

**Given** the daily image limit
**When** an image arrives
**Then** one unit is reserved atomically before storage, the 26th image today (Europe/Oslo) is declined with a clear message, and the unit is released only if the AI call fails or never happens (FR-7, AD-12).

**Given** I have 10 or fewer images left today
**When** I upload
**Then** the Limit notice shows "{n} images left today" (UX-DR4).

**Given** mock mode
**When** I upload `test-data` images named `*-partial.*` or `*-unreadable.*`
**Then** I get the partial and rejected outcomes, so FR-7's three outcomes are testable without a key (AD-4).

**Given** an image-sourced Material
**When** any later feature uses it
**Then** it is treated exactly like a text Material (FR-7).

### Story 2.6: See and edit the Topics in each file

As a student,
I want the app to list the Topics each file covers, and to fix them,
So that I can study exactly the parts I choose.

**Acceptance Criteria:**

**Given** a Material reaches Ready
**When** processing saves it
**Then** its Topics are saved in the same transaction. The server targets `clamp(ceil(pages/5), 3, 100)`, where a page is a PDF page, slide, photo, or about 500 words. Every Section is covered, and above 100 the content is grouped and the Grouped-topics note shows (FR-22, AD-21).

**Given** the Topic list under a file
**When** I view it
**Then** it shows the Topic count and chapter groups (collapsed above about 20), and it is scrollable and keyboard-operable (UX-DR7, UX-DR15).

**Given** an active Project
**When** I rename, merge (same file only), delete, or add a Topic
**Then** the change persists and affects only that file:
- merge keeps the first Topic's id
- the last Topic can't be deleted (`topic_last_cannot_delete`)
- adding past 100 is refused (`topic_limit_reached`)
- a cross-file merge is refused (`topic_merge_cross_material`)

(FR-22, AD-21)

**Given** mock mode
**When** a file is processed
**Then** `detect_topics` returns deterministic Topics derived from its length (AD-4).

**Given** I reopen the Project later
**When** it loads
**Then** every non-removed file is there with its Topics as I left them (FR-8).

### Story 2.7: Remove a file

As a student,
I want to remove a file I uploaded by mistake, even while it is still being read,
So that I keep my Project tidy and free its slot.

**Acceptance Criteria:**

**Given** a Ready file
**When** I choose Remove from its "···" menu and confirm in the Remove file dialog
**Then** the file is tombstoned in one transaction, freeing its slot at once and updating "Files · n of 10":
- `removed_at` is set
- Section text and search index are emptied, while the file name and labels are kept
- the stored original is deleted after commit

(FR-20, AD-23)

**Given** a file still Reading…
**When** I remove it (short dialog)
**Then** its job is cancelled, nothing from it is saved, its slot frees, and an unused image unit is released (FR-20, AD-20, AD-12).

**Given** a Rejected file
**When** I select Remove
**Then** it is removed at once, with no confirmation (FR-20).

**Given** removal fails
**When** I confirm
**Then** the dialog stays open with an Inline error, and the file keeps its slot (FR-20).

**Given** a removed file
**When** I later choose scope or capacity
**Then** it never appears (AD-23).
*(The "also remove its mistakes" checkbox arrives with Mistakes in Story 3.3. Until then it is hidden because no file has Mistakes.)*

## Epic 3: Quiz and the Mistake loop

A student can generate a Quiz from Topics, answer with grounded, sourced feedback, see the score, have wrong answers recorded as Mistakes, see the indicator, and clear Mistakes in Mistake Review rounds. Generation runs in the background, can be cancelled, and announces itself when ready. FRs: FR-9, FR-10, FR-11, FR-12, FR-17, FR-18, FR-26. CAPs: CAP-2 (indicator), CAP-4, CAP-8, CAP-12 (lifecycle).

### Story 3.1: Generate a Quiz from my Topics

As a student,
I want to pick Topics and a question count and get a Quiz made from my material,
So that I can practise without writing questions myself.

**Acceptance Criteria:**

**Given** an active Project with at least one Ready file
**When** I open Quiz from the Project home's tool buttons row (this story adds the Quiz button)
**Then** I can choose "All topics" or one or more Topics (grouped like the Topic list) and 5, 10, or 20 questions (default 10); the primary button reads "Make {n} questions" (FR-10, UX-DR7, UX-DR8).

**Given** my chosen scope
**When** setup shows
**Then** `GET /api/projects/{id}/capacity` computes `max_questions` through `topics.resolve_scope` with no AI call. If the count is too high, the Too-little-material note offers the largest supported count, and the button stays disabled until the count fits (FR-10, AD-7).

**Given** a scope over the context budget
**When** I generate
**Then** I am asked to narrow the scope (`scope_too_large`); a normal whole Project of 10 lecture-sized files always fits (AD-7).

**Given** I select "Make {n} questions"
**When** the request is accepted
**Then** the scope is resolved and frozen into the job's `params`, the request returns `202`, and Progress steps (Reading your material → Writing questions → Checking answers) reflect the job's real `progress_step` (FR-26, AD-20).

**Given** generation succeeds
**When** the job saves
**Then** in one locked save transaction that re-checks for cancel and removal:
- each Question has 4 shuffled options `a`–`d`, one correct option, and an explanation
- each Question cites the Sections it used, and items with no valid citation are dropped
- the model returns ≤ 20 items, and if fewer than requested, the student is told "only {n} were possible"

(FR-10, AD-3, AD-9, AD-18, AD-20)

**Given** I leave the setup screen while it generates
**When** it finishes
**Then** the Quiz is saved and the notice "Your quiz on {topic} is ready · Open" appears in the chat; opening or dismissing it marks it seen (FR-26, AD-20).

**Given** generation is running
**When** I select Cancel
**Then** it stops, nothing is saved, and I return to setup with my choices kept. If it fails instead, an Inline error ("Nothing you've made is lost." + "Try again") keeps my choices, and Try again starts a new job from the same setup (FR-26).

**Given** mock mode with `LLM_MOCK_DELAY_MS` set
**When** tests run
**Then** progress, finish-while-away, cancel, and failure paths are all exercised without a key (AD-4).
**And** quiz generation completes within 60 s for a lecture-deck-sized upload in live mode (NFR-1).

### Story 3.2: Take the Quiz with immediate, sourced feedback

As a student,
I want to answer one question at a time and see right away why an answer is right or wrong,
So that I learn from each question.

**Acceptance Criteria:**

**Given** a generated Quiz
**When** I open it
**Then** I see one question at a time with 4 options (keys 1–4 or click) and a progress bar. The correct answer and the explanation are not in the payload before I answer (FR-11, AD-9, UX-DR8).

**Given** I answer
**When** the answer is saved
**Then** it is scored in the backend (`submitted_option_id == correct_option_id`, no AI call). The Feedback panel shows "Not quite" / "It stays in your review." or the correct state, then the explanation with its Source label ("file · slide N"). There is no auto-advance; "Next question" (→) or "See results" on the last one (FR-11, §5.1, AD-9).

**Given** I resubmit the same answer (for example a double click)
**When** the server receives it
**Then** it returns the stored result; there is one answer per question (AD-8).

**Given** the last question
**When** I select "See results"
**Then** the Score summary shows a score equal to the number of correct answers and lists the missed questions with both answers. It offers "← Back to chat" (primary) and "New quiz", and keyboard and screen-reader rules hold (FR-11, UX-DR14, UX-DR15).

### Story 3.3: My wrong answers become Mistakes, and the Project shows how many

As a student,
I want every wrong Quiz answer recorded automatically and counted on my Project,
So that I know what to review.

**Acceptance Criteria:**

**Given** I answer a Quiz question incorrectly
**When** the answer is saved
**Then** in the same transaction `mistakes.record_failure` records a Mistake for that question. It notes the Materials it came from and keeps the question and explanation as shown, with no extra action from me. Only `services/mistakes` writes the table (FR-12, AD-10, AD-18).

**Given** I miss the same question again while its Mistake is outstanding
**When** the answer is saved
**Then** no duplicate is created; the partial unique index allows at most one outstanding Mistake per question (AD-10).

**Given** I leave a Quiz part-way
**When** I come back to the Project
**Then** the Mistakes from questions I answered are still recorded (FR-12).

**Given** an active Project with outstanding Mistakes
**When** I open its chat
**Then** the Mistakes card shows "{n} mistakes to review · Start", using `mistakes.outstanding_count`. With zero, there is no card and never "0 mistakes" (FR-9, UX-DR4).

**Given** I remove a file whose questions produced Mistakes (Story 2.7)
**When** the Remove file dialog opens
**Then** it shows the unchecked "Also remove its mistakes from my review". Checked, `mistakes.withdraw_for_material` takes those Mistakes out of the count and keeps their history; unchecked, they stay outstanding (FR-20, AD-10, AD-23).

### Story 3.4: Start a Mistake Review round

As a student,
I want to start practising my mistakes when I choose,
So that I review on my own terms.

**Acceptance Criteria:**

**Given** the Mistakes card
**When** I select Start
**Then** a `review_round` job starts with the generation lifecycle from Story 3.1 (progress steps, leaving, cancel, failure keeps the count unchanged). Review never starts on its own (FR-17, FR-26, AD-11).

**Given** I double-click Start
**When** a round is already queued or running for the Project
**Then** the second request returns `review_in_progress`, and only one round runs (AD-11).

**Given** more than 20 outstanding Mistakes
**When** the round is built
**Then** it takes the oldest 20, reuses any of their unanswered Practice Questions, and generates the rest in one batched AI call from each Mistake's original question and its cited Sections. The rest wait for a later round (FR-18, AD-11, AD-12).

**Given** a Mistake whose file was removed
**When** the round is built
**Then** its saved original question is re-shuffled and used as the practice item, with no AI call (FR-18, AD-11).

### Story 3.5: Clear Mistakes in review

As a student,
I want each correct practice answer to clear its Mistake,
So that my review count goes down as I learn.

**Acceptance Criteria:**

**Given** a Mistake Review session
**When** a practice question shows
**Then** I see the original mistake ("Your earlier answer") as context, and "The file this came from was removed." when that applies. The question works like a Quiz question (AD-9 format, sourced feedback) (FR-18, UX-DR9).

**Given** I answer correctly
**When** the answer is saved
**Then** `mistakes.clear` clears that Mistake (idempotently), the progress reads "{n} of {m} cleared", and the indicator decrements only after the save. If saving fails, an Inline error shows and the Mistake stays counted (FR-18, AD-10).

**Given** I answer wrong
**When** the answer is saved
**Then** the Mistake stays outstanding, and practice answers never create new Mistakes (FR-18, AD-10).

**Given** all of a round's questions are answered and Mistakes remain
**When** the last answer is saved
**Then** the Round done panel shows "Round done. {n} mistakes still to review." with "Review mistakes", which starts a new round (FR-18, UX-DR9).

**Given** the last outstanding Mistake is cleared and saved
**When** the round ends
**Then** the All cleared panel shows "All cleared! Nice work." and the Mistakes card is gone. It never shows after "Stop for now" or "← Back to chat", which say "Your progress is saved." and keep the remaining Mistakes outstanding (FR-18).

**Given** cleared or withdrawn Mistakes
**When** I look later
**Then** their original and review attempts are still stored for as long as the Project exists (FR-18, AD-8).

## Epic 4: Flashcards, summaries, and Ask AI

A student can practise with flashcards, summarize one file or Topic, and chat with their material in several chats with streamed, sourced answers. FRs: FR-13, FR-14, FR-15, FR-16. CAPs: CAP-5, CAP-6, CAP-7.

### Story 4.1: Generate a flashcard set

As a student,
I want a set of flashcards made from the Topics I choose,
So that I can do quick recall practice.

**Acceptance Criteria:**

**Given** an active Project with a Ready file
**When** I open Flashcards from the tool buttons row (this story adds the Flashcards button)
**Then** I choose "All topics" or one or more Topics, and 5, 10, or 20 cards (default 10); the button reads "Make {n} cards" (FR-13, UX-DR8).

**Given** my scope
**When** setup shows
**Then** capacity (`max_cards`) and the Too-little-material note work exactly as for the Quiz, through `topics.resolve_scope` (FR-13, AD-7).

**Given** I generate
**When** the `flashcards` job runs
**Then** it follows the Story 3.1 lifecycle:
- Progress steps "Reading your material → Writing cards → Checking sources"
- it continues when I leave, with a finish notice
- Cancel and failure keep my choices

(FR-26, AD-20)

**Given** the job saves
**When** cards are stored
**Then** there are ≤ 20 cards, each with a question, an answer, and cited Sections; uncited cards are dropped; and fewer than requested is reported as "only {n} were possible" (FR-13, AD-3, AD-12).

### Story 4.2: Study a flashcard set

As a student,
I want to flip cards and mark them "Got it" or "Not yet",
So that I keep practising the ones I don't know yet.

**Acceptance Criteria:**

**Given** a flashcard set
**When** I study it
**Then** I see one card at a time with "n of {total}". Space or a click flips it to show the answer and its Source label; → is "Got it" and ← is "Not yet" (FR-14, UX-DR8, UX-DR14).

**Given** I mark a card "Not yet"
**When** I continue
**Then** that card returns later in the same set until I mark it "Got it". Marks are stored insert-only, and **no Mistake is created** (FR-14, AD-10).

**Given** every card is known
**When** the set ends
**Then** the end screen says "{n} cards done. {m} needed a second try" with "Make more cards" and "← Back to chat". There is no score, streak, or due date (FR-14).

**Given** I select "Stop for now" or leave
**When** I open another set, or 30 minutes pass without a mark
**Then** the set is recorded as ended (`ended_at`, set lazily) and is not resumable (FR-14, FR-25, AD-27).

### Story 4.3: Summarize a file or one of its Topics

As a student,
I want a summary of one file, or of one Topic in it,
So that I can refresh a subject before diving in.

**Acceptance Criteria:**

**Given** an active Project
**When** I open Summarize from the tool buttons row (this story adds the Summarize button)
**Then** I pick exactly one Ready file and optionally one of its Topics ("Whole file" by default); nothing generates until "Make summary" (FR-15, UX-DR8).

**Given** I generate
**When** the `summary` job runs
**Then** it follows the Story 3.1 lifecycle, with the steps "Reading your material → Writing the summary → Checking sources" (FR-26).

**Given** the summary is saved
**When** I read it
**Then** each section names its source. It contains no claims absent from the file, is written in the material's main language, and ends with "Saved to History" and "← Back to chat" (FR-15, FR-29, AD-3).

**Given** generation fails
**When** I see the Inline error
**Then** my file and Topic choices are kept (FR-26).

### Story 4.4: Ask questions about my material and get streamed, sourced answers

As a student,
I want to ask anything about my material in the Project's chat,
So that I get answers grounded in my own notes.

**Acceptance Criteria:**

**Given** an active Project with a Ready file
**When** I open the Project
**Then** the chat is the home view, with the composer, Scope control ("All materials" by default), and tool buttons enabled. With no Ready file, the composer and tool buttons are disabled (FR-16, UX-DR4).

**Given** I send a message
**When** the answer comes
**Then** "Study Buddy is thinking…" shows until the first words, which appear within 5 s; the answer streams in and completes within 15 s. Send stays disabled until it completes, and screen readers hear the answer once, when it is complete (FR-16, NFR-2, UX-DR15).

**Given** the streaming endpoint
**When** I inspect it
**Then** `POST /api/chats/{id}/messages` returns an `EventSourceResponse` with `delta`, then `done{message_id, sources}` or `error{code}`, read via `fetch` and a ReadableStream (AD-25):
- citations are mapped and validated at the end, then stripped from the stored text
- the user and assistant messages are stored together only on success
- no DB connection is held during the stream (AD-18)

**Given** the scope fits the context budget
**When** I ask
**Then** the whole scope is sent; otherwise the most relevant Sections are picked by Postgres full-text search. Either way, the answer introduces no facts outside the scope and names its sources (FR-16, AD-7).

**Given** I narrow the chat to one file
**When** I keep asking
**Then** later answers in that chat use only that file until I broaden the scope again (FR-16).

**Given** the daily limit
**When** I send
**Then** one message unit is reserved atomically. With 10 or fewer left I see "{n} messages left today"; the 51st message today, across all chats and Projects, is declined clearly. A failed or abandoned answer (disconnect, provider error, or a mid-stream error chunk) costs nothing and stores nothing (FR-16, AD-12, AD-25).

**Given** a second send while an answer is streaming in the same chat
**When** it reaches the server
**Then** it returns `chat_busy` (AD-25).

### Story 4.5: Keep several chats in a Project

As a student,
I want to start a fresh chat when I change subject and keep my earlier chats,
So that each conversation stays focused.

**Acceptance Criteria:**

**Given** a chat in progress
**When** I select "New chat"
**Then** a fresh empty chat opens with "Ask anything about your material." The previous chat is kept unchanged, with its own messages and scope (FR-16).

**Given** I return to a Project
**When** it opens
**Then** it shows the chat I was last in (`chats.last_opened_at`), and every chat persists across sessions and can be continued (FR-16, FR-8).

**Given** messages in a chat
**When** they are stored
**Then** they keep a strict order (`seq`, unique per chat, assigned under a chat lock) (AD-25).
*(Listing earlier chats in one place arrives with History in Story 5.1.)*

## Epic 5: History

A student can find every chat, quiz, flashcard set, and summary of a Project in one list, reopen results, resume an Unfinished Quiz, and run items again. FRs: FR-25, FR-8 (Study Content, chats, Unfinished Quiz). CAPs: CAP-2 (resume), CAP-12.

### Story 5.1: Find everything I made in one History list

As a student,
I want one list of my chats, quizzes, flashcard sets, and summaries,
So that nothing I've done gets lost.

**Acceptance Criteria:**

**Given** a Project
**When** I select the History link in the chat bar
**Then** History opens in place of the chat, listing every chat (each chat its own row), Quiz, Flashcard set, and Summary, newest first. Results come from one `UNION ALL` read model with keyset pagination on `(created_at, id)`; there is no separate history table (FR-25, AD-27).

**Given** History
**When** I use the filter (All, Chats, Quizzes, Flashcards, Summaries)
**Then** the list filters by type. The filter stays usable while loading and when empty ("Nothing here yet"); loading shows static skeleton rows; a load failure shows "We couldn't load your history." with "Try again" (FR-25, UX-DR10).

**Given** a completed Quiz or Flashcard set
**When** I open its row
**Then** it shows its read-only results. A Summary or a chat reopens in full, and a chat in an active Project can be continued (FR-25, FR-16).

**Given** I reopen the Project in a later session
**When** I open History
**Then** every Study Content item and chat I made is there, exactly as left (FR-8, SM-3).

### Story 5.2: Resume an unfinished quiz and run things again

As a student,
I want to finish a quiz I left and redo a quiz or flashcard set with the same setup,
So that I can pick up and practise again easily.

**Acceptance Criteria:**

**Given** a Quiz I left before its last question
**When** I see it in History
**Then** its row reads "Unfinished · {n} of {total}", and opening it resumes at the first unanswered question (one attempt per Quiz) (FR-25, FR-8, AD-8).

**Given** a completed Quiz or Flashcard set
**When** I select "Do it again"
**Then** a new generation starts from the stored frozen setup (count, `section_ids`, Topic labels). It follows the Story 3.1 lifecycle under the same per-generation limits and leaves the original unchanged (FR-25, AD-7, AD-20).

**Given** an item whose source file was removed
**When** I open it
**Then** its results stay viewable, but "Do it again" is disabled with "The file this came from was removed." (the server returns `material_removed`) (FR-25, AD-7, AD-23).

**Given** a Flashcard set left part-way
**When** I see it in History
**Then** it is shown as ended, isn't resumable, and offers "Do it again" (FR-25).

## Epic 6: Upload from phone

A student can scan a QR code and send photos of handwritten notes into a Project without logging in on the phone; they appear on the computer without a refresh. FRs: FR-21. CAPs: CAP-10.

### Story 6.1: Show a QR code that lets my phone upload into this Project

As a student,
I want a QR code on my computer that opens an upload page on my phone,
So that I can send photos without logging in on the phone.

**Acceptance Criteria:**

**Given** an active Project, with my Account having accepted the privacy notice (Story 2.3)
**When** I select "Upload from phone" (this story adds it to the Files panel and the Upload drop zone)
**Then** the QR dialog shows a QR code rendered in the browser from `APP_PUBLIC_URL`, "Waiting for photos…", and "This code works for 10 minutes and stops when you close this window." Without accepted privacy, the notice comes first and the server refuses with `privacy_notice_required` (FR-21, FR-6, AD-19, AD-24, UX-DR12).

**Given** the link
**When** it is created
**Then** it is a random 32-byte token stored only as a hash in `phone_upload_links`, expiring after about 10 minutes (`PHONE_LINK_TTL_SECONDS`) (AD-24).

**Given** I scan the code on my phone
**When** the page `/u/:token` opens
**Then** it shows a mobile layout with no login: the Project name, the Link countdown (minutes, then seconds in the last minute), and "Take photos" / "Choose from gallery". `GET /api/phone/{token}` returns only `{project_name, images_left_today, slot_available, expires_at}`, never the file list (FR-21, §5.5, AD-2).

**Given** I close the QR dialog, or the link expires
**When** the phone tries to send
**Then** the link is revoked (`DELETE` plus `sendBeacon` on close), and the phone shows "This link has expired. Scan a new code on your computer." with Send disabled (FR-21, AD-24).

**Given** a local demo
**When** I set `APP_PUBLIC_URL` to my computer's LAN address
**Then** the phone on the same network reaches the page over plain HTTP, and the page uses no HTTPS-only browser features (AD-17, AD-24).

### Story 6.2: Send photos from my phone as one Study Material

As a student,
I want to photograph several pages and send them together,
So that my handwritten notes become one file in my Project.

**Acceptance Criteria:**

**Given** the phone page
**When** I take or choose photos
**Then** they appear as numbered thumbnails; × removes one and the pages renumber; the send button reads "Send {n} photos" with no maximum (FR-21, UX-DR12).

**Given** the batch would exceed my images left today or the Project's 10 files
**When** I am about to send
**Then** the phone warns me first ("You can send {k} more photos today…" / project full); these warnings are advisory (FR-21).

**Given** I send
**When** the photos upload
**Then** a batch is created, then each photo is sent in its own request (≤ 50 MB each). Each photo reserves one image unit; photos over a limit are declined one by one while the rest go through. Finalize takes one slot under the Project lock and enqueues processing (FR-21, FR-6, FR-7, AD-12, AD-24).

**Given** the batch is processed
**When** it finishes
**Then** it becomes one Study Material "Handwritten notes, {n} pages", with one Section per photo:
- Ready when every photo is readable
- "Ready, partly unreadable" naming the failed pages when some aren't
- Rejected, using no slot, when none are

(FR-21, AD-6)

**Given** the computer's QR dialog is open
**When** the batch arrives and is processed
**Then** the dialog and Files panel show it live, without a refresh, and "Files · n of 10" goes up by one (FR-21, AD-20).

**Given** no photo is accepted, or a batch is never finalized
**When** finalize runs, or the hourly cleanup passes the batch's window
**Then** nothing is created, no slot is used, staged photos are deleted, and unused image units are released (FR-21, AD-12, AD-24).

**Given** the phone after a successful send
**When** the link is still valid
**Then** it confirms the photos are in the Project and offers "Send more".
*(Revoking the link on archive or delete arrives with Story 7.1 and Story 7.2.)*

## Epic 7: Control over projects, account, and language

A student can archive, restore, and delete Projects (30-day Deleted projects, automatic purge), manage Settings, delete the Account, and use a fully bilingual interface. FRs: FR-23, FR-24, FR-27, FR-28, FR-29 (completion). CAPs: CAP-9, CAP-13, CAP-14.

### Story 7.1: Archive and restore a Project

As a student,
I want to put a finished course aside without deleting anything,
So that my Project list stays focused.

**Acceptance Criteria:**

**Given** an active Project
**When** I choose Archive from its "···" menu
**Then** it moves to the "Archived ({n})" group at once, with no confirmation, and the Undo message "{project} archived · Undo" shows for 6 s (staying while hovered or focused). Undo restores it (FR-23, UX-DR2, UX-DR3).

**Given** an archived Project is open
**When** I use it
**Then** its chats, History, files, and Topics can be read, but nothing can change:
- the composer, tool buttons, uploads, removal, Topic edits, rename, "Do it again", and quiz resume are disabled
- the Archived banner offers Restore
- every content mutation is refused server-side with `project_read_only`, via `require_active`
- bookkeeping still works (dismissing notices, ending a set, prefs)

(FR-23, AD-22)

**Given** an archived Project
**When** I look for the Mistakes card
**Then** it is hidden and its Mistakes are kept; after Restore the card returns when the count is above 0 (FR-23, FR-9).

**Given** generation is running when I archive
**When** it finishes
**Then** it still saves to History, because the job's save path never calls `require_active` (FR-23, FR-26, AD-20).

**Given** an open phone link for the Project
**When** I archive it
**Then** the link is revoked through `phone.revoke_for_project` (FR-21, FR-23, AD-24).

**Given** my last-opened Project is archived
**When** I sign in
**Then** I land on my most recent active Project (FR-2).

### Story 7.2: Delete a Project, restore it, or delete it forever

As a student,
I want deleted Projects kept for 30 days before they are gone,
So that I can recover from a mistake but still control my data.

**Acceptance Criteria:**

**Given** an active or archived Project
**When** I choose "Delete project" and confirm, from the Sidebar menu or Settings › Your data
**Then** the dialog first says it moves to Deleted projects and is permanently deleted after 30 days (confirm with Button (primary), no typing). After confirming:
- the Project moves to "Deleted projects ({n})" with "Deleted · {n} days left"
- running generation is cancelled (`jobs.cancel_for_project`)
- the phone link is revoked

(FR-24, AD-20, AD-22, AD-24)

**Given** I deleted the open Project
**When** the dialog closes
**Then** I land on my most recent other active Project, or the Projects page (empty) if none is left (FR-24).

**Given** a deleted Project
**When** I open it
**Then** it is read-only like an archived one, with the Deleted banner (days left, Restore, "Delete forever"). Restore returns it to the active list exactly as it was, even if it was archived before (FR-24).

**Given** "Delete forever"
**When** I confirm the dialog (which lists what is lost and ends in Button (danger))
**Then** `projects.purge` cancels and waits for jobs, deletes the Project with every child row (cascade), and then deletes its Storage prefix after commit, all at once (FR-24, §5.4, AD-22).

**Given** a Project deleted more than 30 days ago
**When** the in-process purge task runs (at startup, then hourly)
**Then** it is permanently deleted in the same way, and reads already treat it as gone, so a host that slept never shows it. An automated test covers a purge racing a running job (FR-24, AD-22).

### Story 7.3: Manage my account in Settings

As a student,
I want one place to manage my name, password, sign-in methods, language, and data,
So that I stay in control of my Account.

**Acceptance Criteria:**

**Given** the Account menu (this story adds its Settings entry)
**When** I choose Settings
**Then** I see three sections: Account, Language, and Your data (FR-27, UX-DR11).

**Given** an email Account
**When** I edit my first name in place
**Then** it saves and shows at once. For a Google-linked Account, the name and picture come from Google and are read-only (FR-27, AD-19).

**Given** an Account with a password
**When** I choose "Change password"
**Then** I can change it without a verified email, and the old password then fails (FR-27).

**Given** an unverified email Account
**When** I look at "Link Google account"
**Then** it shows "Verify your email first" (muted, not an error) with "Resend verification email". Resending sends a new 24 h link and invalidates older ones, and shows "We've sent a new link. It works for 24 hours." (FR-1, FR-27, AD-19).

**Given** a verified email Account
**When** I choose "Link Google account" and complete consent
**Then** Google is linked and both methods work. A link made without verification is removed by the backend (`email_not_verified`); an identity linked elsewhere shows the "already linked" error; cancelled consent changes nothing (FR-19, FR-27, AD-19).

**Given** Settings › Language
**When** I pick English or Norsk
**Then** the interface switches at once and the choice is saved to my Account (FR-29).

**Given** Settings › Your data
**When** I open "Delete a project"
**Then** it lists my Projects, each with a Delete action that opens the Story 7.2 dialog (FR-27).

### Story 7.4: Delete my account

As a student,
I want to permanently delete my Account and everything in it,
So that my data is gone when I leave.

**Acceptance Criteria:**

**Given** Settings › Your data
**When** I choose "Delete my account and all my files"
**Then** the dialog names what is lost (files, mistakes, generated material, including Projects in Deleted projects) and that it can't be undone. Button (danger) stays disabled until I type DELETE (SLETT in Norwegian) (FR-28, UX-DR11).

**Given** I confirm
**When** `DELETE /api/me` runs
**Then** it deletes everything at once, including Mistake history:
1. `jobs.cancel_for_account` runs, and the backend waits for it
2. the Storage prefix `{account_id}/` is deleted
3. `auth.admin.delete_user` runs, and app tables cascade

(FR-28, §5.4, AD-16, AD-19)

**Given** deletion succeeds
**When** the session ends
**Then** I see the Login screen with "Your account and files have been deleted.", and an automated test confirms the same email can register again (FR-28).

### Story 7.5: Complete the bilingual interface (FR-29)

As a student,
I want every screen, message, and limit notice in my chosen language,
So that the whole app reads naturally in English or Norwegian.

**Acceptance Criteria:**

**Given** every V1 surface built in Epics 1–7
**When** an automated check compares `en.json` and `nb.json`
**Then** every key exists in both, with singular and plural forms where counts appear. No user-facing string is hard-coded outside `frontend/src/i18n/`, and every API error code has a translation (FR-29, AD-26).

**Given** the interface in Norwegian
**When** I walk through UJ-1 to UJ-5 and the Settings, deletion, error, limit, and generation states
**Then** every visible string is in Norwegian, using the glossary terms (Samtale, Treningskort, Repetisjon av feil, emner), while generated content stays in the material's own language (FR-29, UX-DR17).

**Given** this story is built and tested
**When** it is reviewed for "done"
**Then** it **is not done until Ihor and Cristoffer have both signed `ux-designs/ux-AI-StudyBuddy-2026-10-13/norwegian-strings-signoff.md`**, deciding D1–D6 and ticking every flow. The (proposed) tags are then removed and the signed wording is in `nb.json`.

*Acceptance dependency:* the Norwegian sign-off. It does not block building or testing this story, or any earlier story that uses the draft strings.
