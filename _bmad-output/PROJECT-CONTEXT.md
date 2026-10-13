---
title: "Project Context: AI Study Buddy"
purpose: "Onboarding doc for a teammate starting a fresh Claude Code chat on this project"
updated: 2026-10-13
---

# Project Context: AI Study Buddy

> **Read this first if you're picking up this project in a new chat.** This file compacts
> everything decided so far so you don't have to re-read the full planning history. The
> underlying documents (linked below) still have the full detail if you need to check wording,
> rationale, or an exact requirement.

## 1. What this project is

**Course:** IBE160 Programmering med KI, Høgskolen i Molde, høst 2026. Group "G25" / team name
"Sherlock and Watson". Members: Cristoffer Mathias Kanestrøm, Ihor Voloshyn.

**Product:** AI Study Buddy — a desktop web app where university/college students upload their
own study material (PDFs, lecture slides, Word docs, notes, and photos of handwritten notes) and
use AI to study directly from it: generate quizzes and flashcards, get summaries, ask free-form
questions, and get mistakes automatically tracked and turned into targeted practice.

**Honesty constraint that applies to every document in this project:** we do not claim to be the
first or only tool doing this. Competitors (NotebookLM, Quizlet, StudyFetch, Quizgecko, Revisely)
are named explicitly in both the brief and the PRD. Differentiation is simplicity and integration,
not novelty.

## 2. Where things are

This project uses the **BMAD-METHOD v6.12.0** framework (already installed — skills under
`.claude/skills/bmad-*`, config under `_bmad/`). Planning artifacts live under
`_bmad-output/planning-artifacts/`:

- **Product Brief (final):**
  `_bmad-output/planning-artifacts/briefs/brief-AI-StudyBuddy-2026-09-16/brief.md`
  (+ `.memlog.md` — full decision audit trail)
- **PRD (final):**
  `_bmad-output/planning-artifacts/prds/prd-AI-StudyBuddy-2026-10-06/prd.md`
  (+ `.memlog.md`, `review-rubric.md`, `reconcile-brief.md` — review/audit trail)

Both carry `status: final` in their frontmatter. Nothing past the PRD has been started yet.

## 3. Current status

| Phase | Status | Notes |
|---|---|---|
| Product Brief | **Final** | ~1–2 pages, approved as-is |
| PRD | **Final** | 18 FRs, 3 UJs, reviewer-gate passed after fixes |
| UX spec | Not started | Natural next step (`bmad-ux`) |
| Architecture | Not started | Natural next step (`bmad-architecture`); one `[NOTE FOR PM]` in the PRD is routed here |
| Epics/Stories | Not started | Comes after UX/architecture (`bmad-create-epics-and-stories`) |

## 4. Product Brief — condensed

- **Problem:** students have the material but lack time/energy to turn it into study activities;
  nothing tracks what they got wrong.
- **Solution:** upload material → Quiz, Flashcards, Summarize, Ask AI, all grounded in that
  material; Mistake Review turns wrong quiz/flashcard answers into follow-up practice; Saved
  Projects ties it all together so the student can resume later.
- **V1 scope (6 features):** Quiz, Flashcards, Summarize, Ask AI, Mistake Review, Saved Projects.
- **Explicitly out of V1:** progress analytics, spaced repetition, adaptive learning, cross-document
  knowledge linking, advanced recommendations, exam planning.
- **Success criteria:** the full upload → generate → quiz → mistake-review → resume loop works, and
  two conditions apply throughout: generated content stays relevant to the uploaded material, and
  the workflow needs no instruction to use.
- **Vision (post-V1):** personalized study system — per-topic performance tracking, weak-area
  detection, adaptive questions, spaced repetition, cross-document intelligence.

## 5. PRD — condensed

**Structure:** §0 Document Purpose → §1 Vision → §2 Users → §3 User Journeys → §4 Features (FRs)
→ §5 Cross-Cutting Constraints and Guardrails → §6 Non-Goals → §7 MVP Scope → §8 Success Metrics
→ §9 Open Questions → §10 Assumptions Index.

### User Journeys (named protagonists, 3 total)
- **UJ-1** — Quiz-taking and automatic mistake capture.
- **UJ-2** — Mistake Review session (targeted practice from past wrong answers).
- **UJ-3** — Summarize a chapter, then Ask AI a follow-up question grounded in the material;
  chat history persists with the project.

### Functional Requirements (FR-1 through FR-18)
- **Account & access:** FR-1 account creation, FR-2 login (30-day persistent session), FR-3
  password reset (required in V1; email verification optional).
- **Projects & uploads:** FR-4 project creation (AI auto-named, student can rename), FR-5 project
  renaming, FR-6 Study Material upload (PDF, .docx, .pptx, .txt, .md, .jpg/.jpeg, .png, .heic; max
  10 files/project, 50 MB/file), FR-7 text extraction from images (three-tier accept/warn/reject —
  exact confidence thresholds deferred to architecture via `[NOTE FOR PM]`), FR-8 project resume,
  FR-9 mistake indicator (sourced from **both** Quiz and Flashcards).
- **Quiz:** FR-10 generation (max 20 questions/generation), FR-11 taking with immediate feedback,
  FR-12 automatic mistake capture.
- **Flashcards:** FR-13 generation (max 50/generation), FR-14 study + self-assessment
  (known/not-yet-known marking feeds Mistake Review).
- **Summarize / Ask AI:** FR-15 summary generation, FR-16 project-grounded chat (max 50
  messages/account/day, history persists within the project).
- **Mistake Review:** FR-17 session start, FR-18 targeted practice generation (a mistake leaves the
  active count once answered correctly; historical attempts stay stored).

### Cross-cutting constraints (§5)
- **Content integrity:** never hallucinate from unusable source material; process readable
  portions with a warning, reject what's too unreadable to use.
- **Cost controls:** Quiz 20 questions/generation · Flashcards 50/generation · Ask AI 50
  messages/account/day · OCR 25 images/account/day.

### Success Metrics (§8)
- SM-1–SM-3: primary (functional loop works end to end).
- SM-4/SM-5: **gating conditions** (relevance of generated content, no-instruction-needed
  usability) — explicitly not "secondary," they apply throughout per the brief.
- SM-C1: counter-metric.

### Open items
- §9 Open Questions: none requiring a product decision remain.
- One `[NOTE FOR PM]` outstanding, routed to architecture: the numeric confidence thresholds behind
  the FR-7 accept/warn/reject OCR behavior.
- §10 Assumptions Index: 6 entries, all round-trip-verified against inline `[ASSUMPTION]` tags in
  the document.

## 6. Working conventions established in this project

If you continue planning work here, these patterns were used throughout and should carry forward:

- **Collaborative, not assumed:** ask the user when information is missing rather than guessing —
  this was an explicit, repeated instruction for both the brief and the PRD.
- **Honesty about competitors:** never imply this is the first or only AI-study-from-uploads tool.
- **Stable IDs:** FRs, UJs, and SMs are globally numbered and referenced by ID (for example,
  "Realizes UJ-3") rather than by section position. If you add or remove one, every cross-reference
  needs updating — verify with `grep -c "^#### FR-"` etc. after any renumbering.
- **Inline tags:** `[ASSUMPTION: ...]` for inferences not directly confirmed (indexed in §10),
  `[NOTE FOR PM]` for decisions deliberately deferred to a later phase (such as architecture).
- **memlog audit trail:** every decision is appended to each workspace's `.memlog.md` via
  `uv run _bmad/scripts/memlog.py append --workspace <path> --type <decision|change|event> --text "..."`.
  Read it if you want the full blow-by-blow of *why* something ended up the way it did.
- **Reviewer Gate before finalizing:** both documents went through a full rubric review
  (structure + prose + a 7-dimension quality rubric) before being marked `status: final`.

## 7. Suggested next steps (not started — pick one and say so explicitly)

- **`bmad-ux`** — UX/experience spec, building on the PRD's User Journeys.
- **`bmad-architecture`** — technical design; this is where the FR-7 OCR confidence thresholds
  get decided.
- Either can come first; `bmad-create-epics-and-stories` naturally follows once one or both exist.

## 8. How to resume in a new chat

Point your Claude session at this file first (`_bmad-output/PROJECT-CONTEXT.md`), then at the brief
and PRD above if you need exact wording. From there, treat the brief and PRD as approved — to
change a final requirement, explain the conflict, propose the change, and wait for explicit
approval from Cristoffer or Ihor.
