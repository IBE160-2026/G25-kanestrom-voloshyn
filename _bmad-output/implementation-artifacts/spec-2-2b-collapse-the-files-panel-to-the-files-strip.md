---
title: 'Story 2.2b: Collapse the Files panel to the Files strip'
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

**Problem:** The Files panel always takes 340 px, so the student can't give its space back to the chat column. EXPERIENCE.md says it collapses to the Files strip, saved per Project. This was split from Story 2.2 by Cristoffer on 2026-11-17 (UX-DR5).

**Approach:**
- The Files panel header gets "Hide files", which collapses it to the Files strip (`sidebar-collapsed-width`, 56 px). Top to bottom, the strip shows the expand button ("Show files"), a files icon, the muted count "{n} of 10", and a warning icon ("A file needs your attention") when any file is partly unreadable or rejected.
- The choice is saved to the Account per Project as `ui_prefs.files_collapsed[project_id]` through `PATCH /api/me/prefs {files_collapsed: {"<project_id>": bool}}`, which merges into the map instead of replacing it. `sidebar_collapsed` becomes optional, so either key can be sent alone.
- Below 1024 px the panel always starts collapsed, overriding a saved "expanded". The change is instant under reduced motion. The count follows the panel's count, including files still uploading. All copy is EXPERIENCE.md's existing strings.

</frozen-after-approval>

## Implementation Notes

- Backend: `PrefsUpdate` takes `sidebar_collapsed` and/or `files_collapsed` (`{project_id: bool}`, 1–20 entries, both `StrictBool`); `profiles.merge_ui_prefs` merges `files_collapsed` one level deeper, so one Project's choice keeps the others. Project ownership isn't checked; the key is only a UI preference.
- Frontend: `ProjectHome` decides the collapse (this visit's choice, else collapsed below 1024 px, else `ui_prefs.files_collapsed[projectId]`) and `AppShell.saveFilesCollapsed` saves it. `FilesPanel` renders the Files strip: "Show files" with a tooltip as in the Sidebar strip, a files icon, "{n} of 10" once the list has loaded, and the warning icon (error colour for a rejected file; muted for partly unreadable, a refused upload, or a failed list load). Files can be dropped on the strip too. Focus moves to the replacing toggle after each switch.
- "Instant under reduced motion" holds because there is no animation at all.
- Tests: `FilesPanel.test.jsx` (strip, per-Project save, narrow start, warning icon and colour, focus, Norwegian, no count while loading) and `test_projects.py` (merge per Project, both keys, refusals incl. 21 entries and non-strict booleans). The tests fail when the per-Project choice or the loading guard is removed (checked).

## Review Triage Log

Blind Hunter only (the oneshot route skips the other layers).

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | Focus is lost after Hide/Show files | medium | Patched: focus moves to the replacing toggle; test |
| 2 | Refused uploads and a failed list load are hidden in the strip | medium | Patched: they turn on the warning icon; test |
| 3 | The strip shows "0 of 10" while loading | low | Patched: no count until the list loads; test |
| 4 | The strip doesn't accept dropped files | low | Patched: the drop handlers are spread on the strip too |
| 5 | The strip button lacks the Sidebar strip's tooltip; incomplete visually-hidden class | low | Patched: `aria-label` + caption tooltip, class removed |
| 6 | The landmark and its button share the name "Show files" | low | No approved noun; rejected |
| 7 | Without `onToggle` the strip button does nothing | false | `ProjectHome` always passes it; rejected |
| 8 | `Chevron` is copied from `Sidebar.jsx` | low | Two tiny SVGs; rejected |
| 9 | The saved map keeps keys of deleted Projects | low | Bounded by the student's own Projects; rejected |
| 10 | `sidebar_collapsed` accepts "yes" | low | Patched: `StrictBool`; test |
| 11 | The merge breaks if the stored value isn't an object | false | Only this code writes it, always as an object; rejected |
| 12 | Fast toggling can save out of order | low | Same as the Sidebar toggle; rejected |
| 13 | No test for 21 entries or for both keys | low | Patched: tests |
| 14 | A test name promises more than it checks; fragile count lookup | low | Patched |
| 15 | The warning colour is untested | low | Patched: test |
| 16 | `set_prefs` docstring is out of date | low | Patched |
| 17 | Stray blank line in both language files | low | Patched |
| 18 | The spec has no notes and doesn't say how reduced motion is met | low | Patched (these notes) |
| 19 | `isNarrow` duplicates AppShell's | low | Two one-liners; rejected |
