# PRD Quality Review — AI Study Buddy

## Overall verdict

This PRD is well above the bar typical of a course project: it has a stated thesis, honest competitive framing, clean Glossary/ID discipline, and Success Metrics that validate the thesis rather than measure activity. It holds up on strategic coherence, theater-avoidance, and downstream traceability. It is weakest exactly where the rubric says to be unforgiving — done-ness clarity — because the cross-cutting Content Integrity guardrail (§5.1/FR-7) leaves its own pass/fail thresholds undefined, and the Cost Controls section (§5.2) names a real unbounded-cost risk (uncapped OCR) but resolves it with an `[ASSUMPTION]` tag instead of surfacing it as an open decision. Fixing those two items, plus giving Summarize and Ask AI their own UJs, would move this from adequate to strong across the board.

## Decision-readiness — adequate

The Vision (§1) states a real trade-off and owns it: "a simple, understandable, end-to-end workflow is worth more to a student right now than a longer feature list," and the brief names direct competitors (NotebookLM, Quizlet, Quizgecko, Revisely, StudyFetch) rather than claiming novelty — this is a decision stated as a decision, not smoothed over. Non-Goals (§6) and Out of Scope (§7.2) likewise read as owned de-scoping, not silent omission.

But §9 Open Questions claims "None outstanding as of this revision — every question raised during drafting was resolved directly into Functional Requirements, §5 guardrails, or the Glossary." That claim doesn't hold up against §5.2's own text: Image text extraction (OCR) is specified as "uncapped" directly beneath a section titled "Cost Controls (Generation Limits)," with the rationale given as an `[ASSUMPTION]` ("interpreted from 'OCR as long as you have the opportunity to ask the AI, you can use the OCR' as no hard cap on extraction calls"). An unbounded-cost input sitting under a cost-controls heading is a live tension, not a resolved one — it reads like it was pattern-matched into the Assumptions Index to clear the Open Questions list rather than actually settled. See the matching Scope Honesty finding below for the full detail.

### Findings
- **medium** Open Questions count may be overstated (§9) — "None outstanding" is asserted while §5.2 contains an unresolved cost risk (see Scope Honesty finding). *Fix:* either downgrade the OCR-uncapped item to a genuine Open Question, or add a one-line rationale for why uncapped OCR is an acceptable cost risk for a course-project budget.
- **medium** Generation limits (20 quiz questions, 50 flashcards, 50 Ask AI messages/day — §5.2) are stated as decisions with no visible rationale or trade-off (why 20 and not 10 or 30; what breaks if a student needs more). *Fix:* one sentence per limit on what it's protecting against (API cost per generation, demo reliability, etc.) so a reviewer can tell these are reasoned choices, not round numbers.

## Substance over theater — strong

No findings. The single persona (Emma) is used consistently and drives FR-level "Realizes UJ-X" tags rather than sitting decoratively; there is no persona inflation. The Vision explicitly disclaims category novelty and names the five closest competitors by name, including one (StudyFetch) doing this "at real scale" — the opposite of innovation theater. NFRs are kept minimal and the one soft NFR present (FR-12, "a few minutes end-to-end") is self-flagged as unquantified rather than dressed up as a commitment. No boilerplate "must be scalable/secure" language appears anywhere.

## Strategic coherence — strong

No findings. The thesis — "upload once, study many ways, review what you got wrong" (§1) — is explicit, and every feature in §4 traces back to one of its three clauses (Projects/Account for "upload once"; Quiz/Flashcards/Summarize/Ask AI for "study many ways"; Mistake/Mistake Review for "review what you got wrong"). Success Metrics (§8) validate the thesis directly — SM-1 end-to-end completion, SM-2 mistake-to-review follow-through, SM-3 resume integrity — rather than falling back on activity counts (no DAU/MAU-style metric appears). A counter-metric is named (SM-C1: don't shorten quiz explanations to speed up generation), which is exactly the self-check the rubric asks for. MVP scope reads as "problem-solving" shaped and the scope logic (§7) matches that framing consistently.

## Done-ness clarity — thin

This is the dimension with the PRD's real gaps, concentrated in one place: the Content Integrity guardrail. §5.1 and FR-7 both describe a three-way outcome (fully usable / partially usable / rejected) that applies to every Study Material format, not just images, but FR-7 states outright: "The exact confidence thresholds separating these three outcomes are an implementation detail, not specified at the PRD level." Because §5.1 generalizes this same three-way test to PDFs, docx, pptx, txt, and md as well ("a corrupted document" is given as an example of "mostly or entirely unusable"), an engineer has no way to know, for any format, what "done" looks like for the single guardrail every generation feature depends on.

A few smaller instances of the same pattern:
- FR-4's acceptance condition for auto-naming — "the generated name reflects the uploaded content's subject matter (e.g. slides on cell division auto-name the Project something recognizably related, not a generic 'Project 1')" — is a judgment call with no test a QA process could run deterministically.
- FR-12's NFR ("a few minutes end-to-end... per UJ-1's framing") is honestly flagged as having no numeric SLA, but for a PRD whose stakes are explicitly "should genuinely work and be demoable," an un-numbered latency bound on the first thing a student does (UJ-1) is a real risk, not just an assumption to log.
- SM-1's target — "works without failure for all test/demo users" — doesn't define what counts as a demo user, how many, or what counts as "failure" (a crash? a wrong answer? a slow response?), which weakens it as an actual go/no-go bar for the stated stakes.

### Findings
- **high** Content Integrity thresholds undefined across all formats (§5.1, FR-7) — the three-way usable/partial/reject test that every generation feature (Quiz, Flashcards, Summarize, Ask AI) depends on has no PRD-level criteria, and the gap isn't scoped to images only. *Fix:* either set rough, falsifiable thresholds now (e.g., "less than N extracted words per page counts as mostly unreadable") or add an explicit `[NOTE FOR PM]`/Open Question routing this decision to architecture, rather than silently calling it "an implementation detail."
- **medium** FR-4 auto-naming acceptance criterion ("recognizably related") is a subjective judgment call, not a testable condition. *Fix:* reframe as a process check (e.g., "name is derived from extracted text, not a static placeholder") that QA can verify without judgment.
- **medium** FR-12's generation-speed NFR has no numeric bound, for a project whose stakes require a working demo. *Fix:* pick even a rough number (e.g., "quiz generation completes within 60 seconds for a single lecture-deck-sized upload") — the `[ASSUMPTION]` tag logs the gap but doesn't close it.
- **low** SM-1's "works without failure for all test/demo users" doesn't define sample size or failure. *Fix:* name the demo cohort size and what "failure" means (crash/timeout vs. incorrect content) so SM-1 is a bar someone can actually check against at demo time.

## Scope honesty — adequate

Non-Goals (§6) and Out of Scope for MVP (§7.2) do real work and cross-reference each other and the FR notes consistently (e.g., email verification deferral traced from FR-1 Notes through to §7.2). The Assumptions Index (§10) round-trips cleanly: all five inline `[ASSUMPTION]` tags are indexed, and every index entry has a matching inline tag.

The gap is that one of those five assumptions is doing more work than "assumption" implies. §5.2's OCR-uncapped line is a genuine unresolved cost-risk decision wearing the PRD's inference-tag convention as camouflage: "Image text extraction (OCR): uncapped — every uploaded image Study Material is processed as needed... `[ASSUMPTION: interpreted from "OCR as long as you have the opportunity to ask the AI, you can use the OCR" as no hard cap on extraction calls]`." For a student-facing app where OCR calls are a real per-use AI cost, leaving this uncapped while every other generation surface (Quiz, Flashcards, Ask AI) is explicitly capped is the kind of asymmetry a reviewer pushing back would flag immediately — and the PRD gives them nothing to push back against because it's phrased as settled.

More broadly, the document never uses the `[NOTE FOR PM]` convention it sets up in §0 ("inline `[ASSUMPTION]` tags mark anything inferred... indexed in §10") — there are zero `[NOTE FOR PM]` callouts anywhere, even at the two genuine deferred-decision points (OCR cost ceiling, Content Integrity thresholds) that are exactly what that tag exists for.

### Findings
- **high** OCR cost ceiling resolved via `[ASSUMPTION]` rather than surfaced as an open cost-risk decision (§5.2) — undercuts the section's own "Cost Controls" framing, since every other generation path is capped and this one explicitly is not. *Fix:* either cap OCR calls (e.g., per upload or per day) consistent with the other limits, or convert this from an `[ASSUMPTION]` to an `[NOTE FOR PM]`/Open Question that names the cost exposure and asks for a budget decision.
- **low** `[NOTE FOR PM]` convention is introduced in §0 but never used, despite real deferred-decision points (Content Integrity thresholds, OCR cost ceiling) that fit it better than a plain `[ASSUMPTION]` tag. *Fix:* reserve `[NOTE FOR PM]` for the handful of places where the PM/architect genuinely needs to make a call, distinct from inferences that just needed logging.

## Downstream usability — strong

Glossary terms (§3) are used consistently and capitalized consistently across Features, Constraints, and Success Metrics — Study Material, Selection Scope, Study Content, Mistake, and Mistake Review all read the same way wherever they appear. FR IDs (FR-1 through FR-18) are contiguous with no gaps or duplicates across §4.1–4.7; UJ-1/UJ-2 and SM-1–SM-5 plus SM-C1 are likewise clean. Success Metrics explicitly list which FRs they validate (e.g., SM-2: "Validates FR-9, FR-12, FR-14, FR-17, FR-18"), which gives story-writers a ready-made traceability map rather than "see above." Both UJs name a protagonist (Emma) and carry context inline rather than floating.

One consistency gap: "Realizes UJ-X" tags are applied to some FRs (FR-1, FR-2, FR-4, FR-5, FR-8, FR-9, FR-10, FR-11, FR-12, FR-17) but not others (FR-6, FR-7, FR-13, FR-14, FR-15, FR-18), with no stated reason for the split — Flashcards (FR-13/14) and Summarize (FR-15) end up with no explicit UJ linkage at all, which matters more given the Shape Fit finding below about those features lacking their own journeys.

### Findings
- **low** Inconsistent "Realizes UJ-X" tagging (FR-6, FR-7, FR-13, FR-14, FR-15, FR-18 omit it while most other FRs have it). *Fix:* either tag every FR with its realizing UJ (or "supports §1 Vision" where no UJ fits) or drop the convention consistently — the current half-use makes it look like an oversight rather than a deliberate signal.

## Shape fit — adequate

For a consumer-facing, single-student product with meaningful UX, the overall calibration is right: UJs are present and load-bearing for the two journeys that exist (UJ-1, UJ-2), there's no persona inflation, and the NFR/guardrail weight (Content Integrity, Cost Controls) matches a real-but-not-enterprise deliverable rather than over- or under-building. Non-Goals correctly rule out mobile, multi-user, and adaptive-learning scope that would be out of place at this stakes level.

The one shape mismatch: the Vision (§1) frames this as "six integrated capabilities" (Account, Projects, Quiz, Flashcards, Summarize, Ask AI), but only Quiz (via UJ-1) and Mistake Review (via UJ-2) get a narrated journey. Flashcards, Summarize, and Ask AI are described only as FR prose (§4.4–4.6) with no UJ walking a student through them end to end. Per the rubric's own guidance for this product shape — "UJs with named protagonists are load-bearing" — two of the four generation features being UX-undescribed is a real under-formalization gap, not just a documentation nicety, since UX and architecture will have to infer those flows from FR bullets alone.

### Findings
- **medium** Summarize and Ask AI (and, to a lesser extent, Flashcards standalone use outside Mistake Review) have no dedicated UJ despite being two of the product's "six integrated capabilities" (§1) in a product type where the rubric treats UJs as load-bearing. *Fix:* add at least a short UJ (or extend UJ-1/UJ-2) showing Emma using Summarize and Ask AI, even briefly — downstream UX work will otherwise have to invent the journey from FR-15/FR-16 prose alone.

## Mechanical notes

- **Glossary drift:** SM-3 (§8) says a resumed Project shows "all previously uploaded Study Material and generated Study Content, including Ask AI chat history" — phrasing that implies Ask AI chat history is a subset of "Study Content." §3's Glossary defines Study Content as only "a Quiz, a Flashcard set, or a Summary," explicitly not chat. Minor, but worth a wording fix (e.g., "...and generated Study Content, and separately, Ask AI chat history...") so the term stays unambiguous for downstream extraction.
- **ID continuity:** FR-1–FR-18 contiguous, no gaps or duplicates. UJ-1/UJ-2, SM-1–SM-5, SM-C1 all clean. No issues found.
- **Assumptions Index roundtrip:** All 5 inline `[ASSUMPTION]` tags (§4.1 ×2, §4.3, §5.2 ×2) are indexed in §10, and all 5 index entries have a matching inline tag. Clean roundtrip.
- **UJ protagonist naming:** Both UJ-1 and UJ-2 name Emma and carry her context inline (student, course, return visit). Compliant.
- **Cross-references:** The §0 link to `../../briefs/brief-AI-StudyBuddy-2026-09-16/brief.md` resolves to an actual file on disk — verified, not broken.
- **Format inconsistency:** Most FRs have an explicit "Consequences (testable):" subsection, but FR-8, FR-9, FR-12, and FR-17 fold their testable condition into the main FR statement instead. Not a testability failure in itself, but inconsistent enough that a downstream process scripting off the "Consequences" heading would miss these four.
