---
title: "Reconciliation: PRD vs Product Brief — AI Study Buddy"
created: 2026-10-06
---

# Reconciliation: PRD vs Product Brief — AI Study Buddy

Source brief: `briefs/brief-AI-StudyBuddy-2026-09-16/brief.md` (status: final)
Checked document: `prds/prd-AI-StudyBuddy-2026-10-06/prd.md` (status: draft)

This checks qualitative/emphasis content, not literal facts (feature list, limits, formats — all confirmed carried over correctly). Each item below is rated **Preserved / Strengthened / Weakened / Dropped**.

---

## 1. Problem framing — PRESERVED, near-verbatim

- Brief, Executive Summary (lines 12, 14) and The Problem (line 20): "a pile of digital material," "turning that material into something they can actually study *from*... takes real time and effort," the loop "designed to close on itself rather than end at 'here's your quiz,'" and the observation that without mistake-tracking "the same gaps in understanding resurface every time."
- PRD §1 Vision (lines 17–19) reuses this almost word-for-word: "turning that material into active practice... takes time most students don't spend, so they fall back on passive re-reading" / "The loop closes on itself rather than ending at 'here's your quiz'."

**Verdict:** Preserved, essentially a faithful restatement anchored to PRD vocabulary (Project, Study Material). No gap.

---

## 2. The "we are not first to this space" differentiation stance — WEAKENED

- Brief gives this its own heading, "What Makes This Different" (lines 30–34), and states it twice for emphasis: "AI Study Buddy is not the first tool to let students study from AI-generated content off their own material" and, as a standalone sentence, **"This brief makes no claim of category novelty."** It also names a specific competitive admission: "StudyFetch in particular combines uploads, quizzes, flashcards, and a document-grounded tutor at real scale" — i.e., it concedes a named competitor already does something close to all of V1, not just "parts of this space." The section then pivots to a specific differentiation claim: Mistake Review as "first-class, always-connected... rather than a bolted-on extra," and explicitly contrasts "a workflow a student can pick up with no explanation, not a longer list of capabilities than the competition."
- PRD folds this into one paragraph inside §1 Vision (line 21) and drops it to a subordinate clause: "AI Study Buddy does not claim to be the first tool to do this (NotebookLM, Quizlet, StudyFetch, Quizgecko, and Revisely already cover parts of this space); the bet is on tight integration between generation and mistake-driven review, not novelty." There is no dedicated "What Makes This Different" section/heading anywhere in the PRD.

**What's lost:**
- The standalone, emphatic "makes no claim of category novelty" sentence — now a parenthetical.
- The specific, more self-critical admission about StudyFetch operating "at real scale" (the brief's honesty goes further than "parts of this space"; the PRD flattens all five competitors to the same vague overlap).
- The "always-connected... not a bolted-on extra" characterization of Mistake Review, and the explicit "not a longer list of capabilities than the competition" framing — both dropped, leaving only "tight integration... not novelty," a thinner version of the same claim.
- No heading-level prominence: in the brief this is a load-bearing, named section; in the PRD it is one clause in a Vision paragraph that also carries three other jobs (problem restatement, workflow description, scope-narrowness claim).

**Verdict:** Weakened — the substance (admission of non-novelty) survives, but the brief's deliberately candid, self-critical tone and its structural prominence do not.

---

## 3. Success criteria — MIXED (strengthened in rigor, weakened in priority/framing)

- Brief's Success Criteria (lines 36–47) is a dedicated section: six concrete, sequential bullet points phrased as one workflow a student completes, followed by a flat, non-negotiable closing statement: **"Two conditions apply throughout:"** relevance to uploaded material, and simplicity without instruction. The word "throughout" signals these two conditions govern *every* criterion above them, not an independent or lesser concern.
- PRD §8 Success Metrics (lines 290–303) is more rigorous: five numbered, FR-traceable metrics (SM-1–SM-5) plus a counter-metric (SM-C1) warning not to trade explanation quality for speed. This is a genuine strengthening in testability and traceability.
- However, the brief's "applies throughout" relevance and simplicity conditions are demoted: they appear only as **SM-4** and **SM-5**, both explicitly bucketed under **"Secondary"** (line 297), below the "Primary" metrics SM-1–SM-3 (workflow completion, mistake follow-through, resume integrity). The brief never subordinates relevance/simplicity to the workflow-completion criteria — it treats them as blanket, always-on conditions sitting outside and above the six-item list. The PRD's Primary/Secondary split inverts that: relevance and no-instruction-needed usability read as nice-to-haves checked after the fact, not as gating conditions on everything else.
- Minor fidelity issue: PRD line 299 (SM-5) attributes a quote to the brief — "per the brief's 'simple enough to use without much explanation' criterion" — that doesn't match the brief's actual wording. The brief says "the workflow must be simple enough to use without instruction" (line 47) and, separately, "a workflow a student can pick up with no explanation" (line 34). The PRD's quoted phrase is a blended paraphrase presented as a direct quote from the brief.

**Verdict:** Strengthened on measurability; weakened on the brief's explicit "applies throughout / non-negotiable" status for relevance and simplicity, which the PRD recasts as secondary/optional-feeling metrics. Also flag the misquote at PRD §8 line 299 vs. brief lines 34/47.

---

## 4. Explicit scope boundaries — PRESERVED and STRENGTHENED

- Brief Scope (lines 49–53): in-V1 list (six features) and an explicit out-of-V1 list — "detailed progress analytics, spaced repetition, advanced adaptive learning, cross-document knowledge linking, advanced study recommendations, and full exam planning" — with the framing "These are plausible future directions, not MVP requirements."
- PRD §7.1/§7.2 (lines 265–288) reproduces this list exactly and adds several more explicit exclusions the brief only implied (email verification, image formats beyond the four listed, multi-user/mobile), closing with "All items above are candidates for post-V1 versions per the brief's long-term Vision, not MVP requirements" (line 288) — matching the brief's own closing framing almost verbatim.
- PRD §6 Non-Goals (lines 254–261) goes further than the brief by naming a concrete contrast case ("unlike Khanmigo") and adding categories the brief left implicit (not a note-taking tool, not an academic-integrity checker).

**Verdict:** Preserved and meaningfully strengthened — no gap here.

---

## 5. Long-term vision — DROPPED from the PRD's own content, reframed negatively

- Brief's Vision section (lines 55–57) is forward-looking and aspirational in tone: "If Version 1 proves the core workflow, AI Study Buddy can grow into a more personalized study system: tracking performance by topic, identifying a student's weak areas, adapting questions based on past mistakes, introducing spaced repetition, and connecting knowledge across a student's multiple course documents." This is phrased as growth/opportunity.
- The PRD's §1 is also titled "Vision" (line 15) but its content is actually a description of the *current* V1 product, not the brief's forward-looking vision — this is a heading-name collision that could mislead a reader expecting the PRD's "Vision" section to carry the brief's long-term aspiration forward.
- The brief's actual long-term vision content is never restated in the PRD's own prose. It is only pointed to twice, both times inside negatively-framed sections:
  - §6 Non-Goals (line 261): "...no cross-document intelligence (see §7.2; may become true post-V1 per the brief's Vision)."
  - §7.2 Out of Scope (line 288): "All items above are candidates for post-V1 versions per the brief's long-term Vision, not MVP requirements."
- This is a deliberate, stated choice per PRD §0 Document Purpose (line 13): "It builds on the existing Product Brief — problem, users, and vision are not repeated here beyond what's needed for context." So the omission is intentional, not an oversight.

**What's lost regardless of intent:** the brief's vision is written as an exciting growth story ("can grow into a more personalized study system"); the PRD only ever surfaces the same content as exclusions/non-goals — a "what we are explicitly not building" framing. A reader of the PRD alone (without going back to the brief) gets the negative-space version of the vision but never the positive, standalone statement of where V1 is meant to lead. For a document meant to inform "whoever picks up architecture and implementation planning next" (§0), this risks the long-term direction being invisible unless they separately read the brief.

**Verdict:** Dropped as standalone content (by explicit design) and reframed in tone from aspirational to exclusionary everywhere it does surface.

---

## 6. Memorable tagline / rhetorical framing — DROPPED

- Brief Executive Summary closing line (line 16): **"upload once, study many ways, review what you got wrong"** — a deliberate three-beat tagline summarizing the whole product, paired with "The bet is that a simple, understandable, end-to-end workflow... is worth more to a student right now than a longer feature list."
- PRD has no equivalent tagline anywhere. §1 Vision (line 21) states the "deliberately narrow... competing on a simple, understandable, end-to-end workflow rather than feature count" idea, which preserves the *argument*, but the specific memorable phrase ("upload once, study many ways, review what you got wrong") is not carried over in any form.

**Verdict:** Dropped — a minor but real loss of a deliberately crafted, quotable summary line; the underlying argument survives, the phrasing doesn't.

---

## Summary Table

| Brief emphasis | Brief location | PRD location | Verdict |
|---|---|---|---|
| Problem framing (material exists, time/energy is the gap, loop closes on mistakes) | Exec Summary L12,14; Problem L20 | §1 Vision L17–19 | Preserved |
| "Not first to this space" / honest non-novelty stance | "What Makes This Different" heading, L30–34 | §1 Vision, one clause, L21 | Weakened |
| Success criteria (6-step workflow + 2 universal conditions) | "Success Criteria" heading, L36–47 | §8 Success Metrics, L290–303 | Mixed (stronger metrics, demoted priority; misquote at L299) |
| Explicit scope boundaries (in/out V1 list) | "Scope" heading, L49–53 | §7.1/§7.2, L265–288; §6, L254–261 | Preserved/Strengthened |
| Long-term vision (personalization, spaced repetition, cross-document) | "Vision" heading, L55–57 | Only referenced, not restated: §6 L261, §7.2 L288 | Dropped (by design) / reframed negatively |
| Tagline "upload once, study many ways, review what you got wrong" | Exec Summary L16 | — | Dropped |

Written: `prds/prd-AI-StudyBuddy-2026-10-06/reconcile-brief.md`
