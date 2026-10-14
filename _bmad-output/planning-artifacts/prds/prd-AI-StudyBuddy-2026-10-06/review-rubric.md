# PRD Quality Review — AI Study Buddy (2026-10-14 update)

## Overall verdict

The update absorbed a large amount of UX-approved scope (FR-19 to FR-29, UJ-4, UJ-5, §5.3 to §5.6) without losing the PRD's best qualities: an explicit thesis, honest scope growth stated in the Vision, single-persona journeys that actually drive FRs, and a clean split where the PRD states capabilities and EXPERIENCE.md/DESIGN.md own UI detail. Every finding from the previous review was closed. The risk now sits in the seams between the new features: what happens to an outstanding Mistake whose Study Material was removed (FR-20 vs FR-18 vs §5.1) is undefined and arguably contradictory, and Mistake Review's own generation lifecycle and wrong-answer behavior are thinner than the Quiz/Flashcards/Summary path it sits beside. Fix the one high finding before architecture; the rest can be carried as story-level clarifications.

## Decision-readiness — strong

Decisions are stated as decisions and trade-offs are named with their cost. §1 Vision owns the scope growth rather than hiding it: "These supports add no new way to study, but they do make V1 larger than the brief's 'six features and nothing more', and the team accepts that cost knowingly." This matches the memlog override C5. Competitive framing remains honest ("StudyFetch in particular already does this at real scale"). The security trade-off in §5.5 explains why the unverified-email takeover rule exists ("prevent someone from pre-registering another person's email to block or capture their Google sign-in"), which is exactly the kind of reasoning a reviewer pushing back needs to see. Every limit in §5.2 now carries a rationale.

§9 is honest: "No product decision is outstanding" is followed by three genuinely open items, each routed to a named owner (architecture, architecture, UX sign-off). `[NOTE FOR PM]` sits at a real tension (FR-7/§5.1 extraction thresholds), not at a safe checkpoint.

No findings.

## Substance over theater — strong

One persona (Emma) across five journeys, each journey tied to specific FRs via "Realizes UJ-X" tags; no persona inflation. NFRs are product-specific (60-second generation, 50 messages/day, 25 images/day, 100-Topic ceiling with "100 Topics covers about 500 pages, a full textbook"). No boilerplate "scalable/secure" language; §5.5 Account Security lists concrete rules rather than adjectives. The Vision could not be swapped into a generic study-app PRD because it names the mistake-loop differentiation and disclaims novelty.

### Findings
- **low** Leftover placeholder (title, line 13) — "*Working title — confirm.*" is still present in a document that has been finalized once and is now on its second revision. *Fix:* confirm the name or remove the line.

## Strategic coherence — adequate

The thesis — "upload once, study many ways, review what you got wrong" — still organizes the document, and the new supports are explicitly framed as serving "saved and resumed" rather than as new study modes. Counter-metrics now include SM-C2, which closes a real gaming path (removing material or archiving to make Mistakes "disappear"). SM-1 was extended to cover image and phone upload, and SM-3 to cover restore — the metrics followed the scope.

The weak link is the metric that validates the thesis's distinctive clause. SM-2 ("of Projects that accumulate at least one Mistake, the student opens Mistake Review at least once") has no target threshold, so it cannot pass or fail. SM-5 likewise has no cohort size or pass rate, while SM-1 does (5 users).

### Findings
- **medium** SM-2 has no target (§8, SM-2) — the one metric that validates "review what you got wrong", the PRD's stated differentiation, is a definition without a bar. "Opens Mistake Review at least once" also measures opening, not clearing. *Fix:* set a target against the SM-1 demo cohort (for example, "at least 4 of 5 test users with Mistakes open Mistake Review and clear at least one Mistake") and tag it `[ASSUMPTION]` if it is a round number.
- **low** SM-5 lacks a cohort size and pass rate (§8, SM-5), and lists no validated FRs, unlike SM-1 to SM-4. *Fix:* reuse SM-1's cohort ("all 5 first-time test users complete UJ-1 without being told how") and list FR-1, FR-4, FR-6, FR-10, FR-11.

## Done-ness clarity — adequate

Most FRs now have crisp, testable consequences: FR-6's slot accounting ("a processing file that is then rejected frees its slot"), FR-19's four account-matching cases, FR-21's per-photo decline behavior, FR-22's Topic rules (minimum 3 at detection, merge down to 1, last Topic undeletable), FR-24's 30-day lifecycle. The previous review's FR-4, FR-12-NFR, and SM-1 gaps are closed. The extraction-threshold gap is now honestly routed via `[NOTE FOR PM]`.

The remaining gaps cluster around Mistake Review and around interactions between new features and old ones, which is where story creation will stumble.

### Findings
- **high** Outstanding Mistakes from removed Study Material have no defined grounding (§4.2 FR-20, §4.7 FR-18, §5.1, §5.4) — FR-20 keeps a removed material's Mistakes outstanding by default, and §5.4 says the material "is removed at once". FR-18 then requires practice questions "targeting the specific content/topic of each outstanding Mistake" whose feedback "identifies the Study Material ... that it is drawn from", and §5.1 forbids generating from material that is not present. An engineer cannot tell whether extracted text survives removal for review purposes, whether practice is built only from the stored original question and explanation, or whether such Mistakes are skipped. SM-4 ("each names a source that actually contains it") cannot pass for these Mistakes as written. EXPERIENCE.md (Remove file dialog, State Patterns) does not resolve it either. *Fix:* add one FR-18 or FR-20 consequence stating what review practice for a removed-material Mistake is built from (for example, "from the stored original question, answer, and explanation only; its feedback names the removed file as its source") and align §5.4 on whether extracted text is retained.
- **medium** Mistake Review wrong answers and selection are unspecified (§4.7 FR-18) — FR-18 defines what a correct practice answer does but not an incorrect one (does the Mistake stay outstanding unchanged? is a new Mistake recorded? FR-12 says Mistakes come from Quiz only). It also does not say how many practice questions target each Mistake, or which Mistakes are chosen when more than 20 are outstanding. *Fix:* add consequences: "An incorrect practice answer keeps the Mistake outstanding and creates no new Mistake"; "each round targets the oldest outstanding Mistakes first, one question each" (or whatever rule is intended).
- **medium** Mistake Review generation sits outside FR-26 (§4.8 FR-26, §4.3 NFR) — FR-26's lifecycle (continues when leaving, cancel, failure keeps choices, 60-second target) names only "Quiz, Flashcard, and Summary generation". Mistake Review generation is a generation under §5.2 but has no latency target, no cancel/failure behavior, and no rule for archiving mid-generation. Ask AI answer latency is also unbounded. *Fix:* extend FR-26 to Mistake Review generation, or state why it differs; add a rough Ask AI response target or mark it `[ASSUMPTION]`.
- **medium** "Run again" after the source material is removed is undefined (§4.8 FR-25, §4.2 FR-20) — FR-25 reruns a completed Quiz or Flashcard set "with the same count, Topics, and Study Material", while FR-20 keeps that Study Content in History after its material is removed. *Fix:* add a consequence: run again is unavailable (with a reason shown) when any of its Study Material has been removed, or it runs on what remains.
- **medium** Password reset link has no lifetime (§4.1 FR-3, §5.5) — "A reset link expires" is untestable without a duration, while the verification link next to it is specified at 24 hours. *Fix:* state a lifetime (for example, 1 hour) and whether a successful reset ends other sessions, matching the takeover rule in FR-19.
- **medium** Topic-count rule is undefined for unpaginated formats (§4.2 FR-22) — "about 1 Topic per 5 pages or slides, where each photo counts as one page" does not say what a "page" is for .txt, .md, or a reflowable .docx, and the server is required to calculate and enforce it. *Fix:* define a page equivalent (for example, "per 500 words of extracted text") for formats without fixed pages.
- **medium** Output language for mixed-language input is ambiguous (§4.9 FR-29, §5.6) — "Generated Study Content and chat answers are written in the language of the source Study Material" does not say which language wins when a Selection Scope spans an English and a Norwegian file, or when the student asks Ask AI in Norwegian about English material. The memlog records no decision on this rule. *Fix:* add a tie-break (for example, "the language of the majority of the scope; Ask AI answers in the language of the question") or tag it `[ASSUMPTION]`.
- **low** "Per day" has no boundary (§5.2, FR-7, FR-16) — the 50-message and 25-image daily limits do not say when a day resets (UTC midnight, local midnight, rolling 24 hours), and the server must enforce them. *Fix:* one line in §5.2.
- **low** Account rules for a linked Account are unclear (§4.9 FR-27, §3 Account) — FR-27 says an "email-and-password Account" can edit its name and a "Google Account" follows the Google profile; an Account with both methods fits both. Whether a Google-only Account can add a password, or any Account can change its email, is also unstated. *Fix:* one consequence for linked Accounts; add "adding a password to a Google-only Account" and "changing email" to §7.2 if they are out of scope.
- **low** FR-11 does not require the wrong-answer list that UJ-1 promises (§4.3 FR-11 vs UJ-1 Climax "which answers were wrong"). *Fix:* add the consequence to FR-11.

## Scope honesty — strong

Non-Goals (§6) and Out of Scope (§7.2) do real work and were updated with the new scope: the phone page is named as the narrow exception to "Not a mobile or native app" (override C1), and §7.2 now lists genuine adjacent omissions (Flashcard resume, profile-photo upload, light theme, other languages). De-scoping and scope growth are both stated openly. Seven `[ASSUMPTION]` tags, two `[NOTE FOR PM]` (FR-7, §5.1), and three routed Open Questions is a reasonable open-items density for a course-project PRD feeding architecture; none blocks a build start except the extraction thresholds, which are correctly assigned to architecture.

No findings beyond the omissions noted under Done-ness (linked-Account rules, email change).

## Downstream usability — adequate

The Glossary grew to cover every new noun (Active Project, Archived Project, Deleted projects, Topic, Unfinished Quiz, Chat, History, Phone upload link, Interface language, Settings) and the terms are used consistently in FRs, §5, and §8. FR, UJ, and SM IDs are unique and contiguous; §0 explains why FR-19 onward appears out of numeric order, which prevents a story-writer from assuming gaps. FR-to-UJ and SM-to-FR traceability is complete. The PRD defers UI detail to the spines by section name instead of duplicating it (FR-22 Topic pickers, §5.6 microcopy and accessibility floor).

### Findings
- **low** Cross-reference to a non-section (§4.2 FR-22) — "owned by EXPERIENCE.md › Topic list" points to a component name used in EXPERIENCE.md tables, not a heading; "Voice and Tone" and "Accessibility Floor" (§5.6) resolve to real headings. *Fix:* point to the containing EXPERIENCE.md section (the components table) or add a "Topic list" heading there.
- **low** UX copy duplicated in the PRD (§4.1 FR-19) — "(UX copy: 'Your account now signs in with Google.', see EXPERIENCE.md.)" is the only place the PRD quotes microcopy, contrary to §0's own division of ownership. It was a deliberate consistency-check decision, so it is low. *Fix:* keep the behavior ("told once") and drop the quoted string, or accept it as an intentional exception.

## Shape fit — strong

A consumer product with meaningful UX, sitting at the top of a UX → architecture → stories chain: five UJs with a named protagonist carrying context inline, each with edge cases that map to FR consequences, is the right weight. The previous gap (Summarize, Ask AI, and Flashcards without journeys) is closed by UJ-3 and UJ-5, and the new phone flow has its own UJ-4. The PRD is not over-formalized: Settings, deletion, and language are handled as capability FRs tied to §1 Vision rather than given artificial journeys.

No findings.

## Mechanical notes

- **ID continuity:** FR-1 to FR-29 unique and contiguous; UJ-1 to UJ-5; SM-1 to SM-5, SM-C1, SM-C2. No dangling FR references found (every FR-n cited in UJs, §5, §7, §8 exists).
- **Assumptions Index roundtrip:** 7 inline `[ASSUMPTION]` tags (FR-21, FR-24, §4.3 NFR, FR-28, FR-29, §5.3, SM-1) and 7 index entries; clean roundtrip. The memlog's 2026-10-14 change entry says "10 assumptions indexed", which does not match the document; the document is correct and the memlog line is stale.
- **Glossary drift:** "Deleted projects" keeps a lowercase "projects" (matching the UI label) while "Project" is capitalized everywhere else; acceptable but worth a note in the Glossary entry so extractors don't treat it as drift. "Chat" (Glossary) and "chat"/"chats" (FRs) are used interchangeably; harmless.
- **Section headings vs reading order:** FRs in §4.1 and §4.2 appear as FR-1, 2, 3, 19 and FR-4 to 9, 20 to 24, as announced in §0. Fine.
- **Required sections:** all present for a chain-top consumer PRD. Frontmatter `status: draft` is correct for an in-progress update.
- **Links:** brief, EXPERIENCE.md, and DESIGN.md paths in frontmatter and §0 resolve.
