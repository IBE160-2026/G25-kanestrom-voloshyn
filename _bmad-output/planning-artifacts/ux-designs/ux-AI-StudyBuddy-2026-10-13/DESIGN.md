---
title: "Design: AI Study Buddy"
status: final
created: 2026-10-13
updated: 2026-10-14
sources:
  - ../../prds/prd-AI-StudyBuddy-2026-10-06/prd.md
  - ../../briefs/brief-AI-StudyBuddy-2026-09-16/brief.md
name: Study Buddy
description: Calm, minimal, dark desktop web study tool. Chat is the project home. One indigo accent, amber for mistakes, red for system errors (plus two documented exceptions), no gamification. Paired with EXPERIENCE.md.
colors:
  # Confirmed (memlog).
  background: '#0F1115'
  surface: '#171A21'
  text: '#E6E8EE'
  text-muted: '#9AA3B2'
  primary: '#6C7CFF'
  on-primary: '#0F1115'
  correct: '#4ADE80'
  mistake: '#F5A524'
  error: '#EF5B5B'
  border-control: '#6A6C73'    # confirmed (memlog): text at 40% over surface; control boundaries (3:1 non-text)
  # Tints and lines from mocks [ASSUMPTION: from mock]
  border: '#E6E8EE14'          # text at 8%: hairlines, dividers, card edges (decorative)
  border-strong: '#E6E8EE24'   # text at 14%: ghost buttons, chips, segmented controls, dashed drop zone (decorative)
  hover: '#E6E8EE0D'           # text at 5%: menu-item hover
  primary-subtle: '#6C7CFF1F'  # primary at 12%: active sidebar item, selected segment, selected chip
  primary-wash: '#6C7CFF14'    # primary at 8%: topic chip being edited
  mistake-wash: '#F5A5240F'    # mistake at 6%: picked-wrong answer fill
  mistake-edge: '#F5A5248C'    # mistake at 55%: picked-wrong answer border
  correct-wash: '#4ADE800F'    # correct at 6%: correct answer fill
  correct-edge: '#4ADE808C'    # correct at 55%: correct answer border
  error-edge: '#EF5B5B59'      # error at 35%: inline error box border
  scrim: '#08090CB8'           # behind modal dialogs
typography:
  # Family confirmed (memlog); fallback stack in Typography. Scale from mocks [ASSUMPTION: from mock]
  wordmark:
    fontFamily: Inter
    fontSize: 17px
    fontWeight: '650'
    letterSpacing: -0.01em
  wordmark-lg:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: '650'
    letterSpacing: -0.02em
  display:
    fontFamily: Inter
    fontSize: 44px
    fontWeight: '600'
    lineHeight: '1.1'
    letterSpacing: -0.03em
  card-term:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    letterSpacing: -0.02em
  title-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    letterSpacing: -0.02em
  title:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: '600'
    letterSpacing: -0.015em
  question:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '500'
    lineHeight: '1.45'
    letterSpacing: -0.01em
  title-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    letterSpacing: -0.01em
  card-answer:
    fontFamily: Inter
    fontSize: 17px
    fontWeight: '400'
    lineHeight: '1.7'
  heading:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '600'
  body-reading:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: '1.75'
  body:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.55'
  ui:
    fontFamily: Inter
    fontSize: 13.5px
    fontWeight: '400'
  button:
    fontFamily: Inter
    fontSize: 13.5px
    fontWeight: '600'
  caption:
    fontFamily: Inter
    fontSize: 12.5px
    fontWeight: '400'
  overline:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    letterSpacing: 0.06em
  key-hint:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
  mobile-title:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    letterSpacing: -0.015em
  mobile-button:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '600'
rounded:
  # 8–12px confirmed (memlog). xs and full from mocks [ASSUMPTION: from mock]
  xs: 5px
  md: 8px
  lg: 10px
  xl: 12px
  full: 9999px
spacing:
  # Spacious and calm, and focus ring, confirmed (memlog). Other values from mocks [ASSUMPTION: from mock]
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 24px
  '6': 32px
  '7': 48px
  sidebar-width: 248px
  sidebar-collapsed-width: 56px   # collapsed Sidebar strip, "about 56px" [ASSUMPTION: logged as assumption]
  files-panel-width: 340px
  chat-width: 760px
  reading-width: 860px
  setup-width: 640px
  auth-panel-width: 380px
  content-x: 48px
  input-height: 42px
  auth-button-height: 44px
  phone-gutter: 16px
  touch-target-min: 44px
  focus-ring-width: 2px
  focus-ring-offset: 2px
  accent-edge-width: 3px
  avatar-sm: 30px
  avatar-lg: 56px
components:
  focus-ring:
    outline: '{spacing.focus-ring-width} solid {colors.primary}'
    offset: '{spacing.focus-ring-offset}'
  button-primary:
    background: '{colors.primary}'
    foreground: '{colors.on-primary}'
    radius: '{rounded.md}'
    typography: '{typography.button}'
    disabled-opacity: '0.38'
  button-ghost:
    background: transparent
    foreground: '{colors.text}'
    border: '1px solid {colors.border-strong}'
    radius: '{rounded.md}'
    typography: '{typography.button}'
  button-danger:
    # Red exception: final Delete or Remove button only; Color-role rule 3 (memlog)
    background: '{colors.error}'
    foreground: '{colors.on-primary}'
    radius: '{rounded.md}'
    typography: '{typography.button}'
  overflow-menu:
    trigger-foreground: '{colors.text-muted}'
    trigger-size: '{spacing.touch-target-min}'
    trigger-radius: '{rounded.md}'
    background: '{colors.surface}'
    border: '1px solid {colors.border-strong}'
    radius: '{rounded.lg}'
    item-foreground: '{colors.text}'
    item-hover: '{colors.hover}'
    item-height: '{spacing.touch-target-min}'
    typography: '{typography.ui}'
  key-hint:
    border: '1px solid {colors.border-strong}'
    foreground: '{colors.text-muted}'
    radius: '{rounded.xs}'
    typography: '{typography.key-hint}'
  source-label:
    border: '1px solid {colors.border-strong}'
    foreground: '{colors.text-muted}'
    radius: '{rounded.full}'
    typography: '{typography.caption}'
  progress-bar:
    track: '{colors.surface}'
    fill: '{colors.primary}'
    fill-mistake-review: '{colors.mistake}'
    height: 4px
  progress-steps:
    current: '{colors.text}'
    pending: '{colors.text-muted}'
    marker: '{colors.primary}'
  skeleton:
    # Mock uses text at 7%, mapped to the nearest token [ASSUMPTION: from mock]
    fill: '{colors.border}'
    radius: '{rounded.xs}'
  inline-error:
    background: '{colors.surface}'
    border: '1px solid {colors.error-edge}'
    radius: '{rounded.lg}'
    message: '{colors.error}'
    reassurance: '{colors.text-muted}'
    action: '{components.button-ghost}'
  undo-message:
    background: '{colors.surface}'
    border: '1px solid {colors.border}'
    radius: '{rounded.lg}'
    foreground: '{colors.text}'
    action: '{colors.primary}'
    typography: '{typography.body}'
  empty-state:
    heading: '{typography.title-sm}'
    body: '{colors.text-muted}'
  modal-dialog:
    background: '{colors.surface}'
    border: '1px solid {colors.border-strong}'
    radius: '{rounded.xl}'
    scrim: '{colors.scrim}'
    title: '{typography.title-sm}'
  checkbox-and-radio:
    border: '1px solid {colors.border-control}'
    checked: '{colors.primary}'
  sidebar:
    background: '{colors.surface}'
    width: '{spacing.sidebar-width}'
    border-right: '1px solid {colors.border}'
    item-foreground: '{colors.text-muted}'
    item-active-background: '{colors.primary-subtle}'
    item-active-foreground: '{colors.text}'
    item-radius: '{rounded.md}'
    new-project-border: '1px dashed {colors.border-strong}'
    collapse-button-size: '{spacing.touch-target-min}'
    collapse-button-radius: '{rounded.md}'
  sidebar-strip:
    # Collapsed Sidebar, Files strip treatment [ASSUMPTION: button and tooltip styling not confirmed]
    background: '{colors.surface}'
    width: '{spacing.sidebar-collapsed-width}'
    border-right: '1px solid {colors.border}'
    button-size: '{spacing.touch-target-min}'
    button-radius: '{rounded.md}'
    button-border: '1px solid {colors.border-strong}'
    icon-foreground: '{colors.text-muted}'
    tooltip-background: '{colors.surface}'
    tooltip-border: '1px solid {colors.border-strong}'
    tooltip-radius: '{rounded.md}'
    tooltip-typography: '{typography.caption}'
  archived-group:
    label: '{typography.ui}'
    label-foreground: '{colors.text-muted}'
    item-foreground: '{colors.text-muted}'
  top-bar:
    border-bottom: '1px solid {colors.border}'
    title: '{typography.title}'
  archived-banner:
    background: '{colors.surface}'
    border: '1px solid {colors.border}'
    radius: '{rounded.lg}'
    foreground: '{colors.text-muted}'
    action: '{components.button-primary}'
  account-menu:
    background: '{colors.surface}'
    border: '1px solid {colors.border-strong}'
    radius: '{rounded.lg}'
    logout-hover-foreground: '{colors.error}'
  avatar:
    background: '{colors.border}'
    border: '1px solid {colors.border-strong}'
    radius: '{rounded.full}'
    size-menu: '{spacing.avatar-sm}'
    size-settings: '{spacing.avatar-lg}'
  language-switch:
    border: '1px solid {colors.border-strong}'
    selected: '{colors.primary-subtle}'
    radius: '{rounded.md}'
  mistakes-card:
    background: '{colors.surface}'
    border: '1px solid {colors.border}'
    border-left: '{spacing.accent-edge-width} solid {colors.mistake}'
    radius: '{rounded.lg}'
    headline: '{colors.mistake}'
  chat-bar:
    typography: '{typography.caption}'
    foreground: '{colors.text-muted}'
  scope-control:
    border: '1px solid {colors.border-strong}'
    selected: '{colors.primary-subtle}'
    radius: '{rounded.md}'
  history-link:
    foreground: '{colors.primary}'
    typography: '{typography.caption}'
  chat-message:
    student-background: '{colors.surface}'
    student-border: '1px solid {colors.border}'
    student-radius: '{rounded.xl}'
    answer-background: transparent
    answer-typography: '{typography.body-reading}'
    pending-foreground: '{colors.text-muted}'
  tool-buttons-row:
    button: '{components.button-ghost}'
    lead-foreground: '{colors.text-muted}'
  composer:
    background: '{colors.surface}'
    border: '1px solid {colors.border-strong}'
    radius: '{rounded.xl}'
  limit-notice:
    foreground: '{colors.text}'
    dot: '{colors.text-muted}'
    typography: '{typography.caption}'
  upload-drop-zone:
    border: '1px dashed {colors.border-strong}'
    radius: '{rounded.xl}'
  files-panel:
    background: '{colors.surface}'
    width: '{spacing.files-panel-width}'
    border-left: '1px solid {colors.border}'
  files-strip:
    # Collapsed Files panel. Width is the 48px scale step [ASSUMPTION: "thin strip" confirmed, width not; the mock uses 56px]
    background: '{colors.surface}'
    width: '{spacing.7}'
    border-left: '1px solid {colors.border}'
    count: '{typography.caption}'
    count-foreground: '{colors.text-muted}'
    warning-partly-unreadable: '{colors.text-muted}'
    warning-rejected: '{colors.error}'
  upload-buttons:
    button: '{components.button-ghost}'
  file-row:
    background: '{colors.background}'
    border: '1px solid {colors.border}'
    radius: '{rounded.lg}'
  file-status:
    reading-dot: '{colors.primary}'
    reading-dot-style: pulsing
    reading-foreground: '{colors.text-muted}'
    ready-dot: '{colors.primary}'
    ready-foreground: '{colors.text}'
    partly-unreadable-dot: '{colors.text-muted}'
    partly-unreadable-dot-style: hollow
    partly-unreadable-foreground: '{colors.text-muted}'
    rejected-dot: '{colors.error}'
    rejected-foreground: '{colors.error}'
  topic-chip:
    border: '1px solid {colors.border-strong}'
    radius: '{rounded.full}'
    typography: '{typography.caption}'
    editing-border: '1px solid {colors.primary}'
    editing-background: '{colors.primary-wash}'
    selected-border: '1px solid {colors.primary}'
    selected-background: '{colors.primary-subtle}'
  remove-file-dialog:
    dialog: '{components.modal-dialog}'
    checkbox: '{components.checkbox-and-radio}'
    cancel: '{components.button-ghost}'
    confirm: '{components.button-danger}'
  activity-header:
    border-bottom: '1px solid {colors.border}'
    title: '{typography.heading}'
    back-border: '1px solid {colors.border-strong}'
    back-foreground: '{colors.text}'
    back-radius: '{rounded.md}'
  topic-scope-picker:
    chip: '{components.topic-chip}'
  count-picker:
    # Shared by Quiz and Flashcards setup: 5 / 10 / 20
    border: '1px solid {colors.border-control}'
    radius: '{rounded.lg}'
    foreground: '{colors.text-muted}'
    selected-border: '{colors.primary}'
    selected-background: '{colors.primary-subtle}'
    selected-foreground: '{colors.text}'
    min-size: '{spacing.touch-target-min}'
  too-little-material-note:
    foreground: '{colors.text-muted}'
    typography: '{typography.caption}'
    action: '{colors.primary}'
  summarize-setup:
    width: '{spacing.setup-width}'
    file-option-background: '{colors.background}'
    file-option-border: '1px solid {colors.border}'
    file-option-radius: '{rounded.lg}'
    file-option-selected-border: '{colors.primary}'
    file-option-selected-background: '{colors.primary-subtle}'
    radio: '{components.checkbox-and-radio}'
    topic: '{components.topic-chip}'
    action: '{components.button-primary}'
  answer-option:
    background: '{colors.surface}'
    border: '1px solid {colors.border}'
    radius: '{rounded.lg}'
    correct-background: '{colors.correct-wash}'
    correct-border: '1px solid {colors.correct-edge}'
    mistake-background: '{colors.mistake-wash}'
    mistake-border: '1px solid {colors.mistake-edge}'
  feedback-panel:
    background: '{colors.surface}'
    border-left-mistake: '{spacing.accent-edge-width} solid {colors.mistake}'
    border-left-correct: '{spacing.accent-edge-width} solid {colors.correct}'
    radius: '{rounded.lg}'
    typography: '{typography.body-reading}'
    next: '{components.button-primary}'
  score-summary:
    score: '{typography.display}'
    note-edge: '{spacing.accent-edge-width} solid {colors.mistake}'
  flashcard:
    background: '{colors.surface}'
    border: '1px solid {colors.border-strong}'
    radius: '{rounded.xl}'
    front: '{typography.card-term}'
    back: '{typography.card-answer}'
  flashcard-end-screen:
    headline: '{typography.title-lg}'
    headline-foreground: '{colors.text}'
    action-primary: '{components.button-primary}'
    action-secondary: '{components.button-ghost}'
  summary-view:
    width: '{spacing.reading-width}'
    typography: '{typography.body-reading}'
  mistake-review-session:
    progress: '{components.progress-bar}'
    context-edge: '{spacing.accent-edge-width} solid {colors.mistake}'
  all-cleared-panel:
    headline: '{typography.title-lg}'
    headline-foreground: '{colors.primary}'
    action-primary: '{components.button-primary}'
    action-secondary: '{components.button-ghost}'
  history-filter:
    border: '1px solid {colors.border-strong}'
    selected: '{colors.primary-subtle}'
    radius: '{rounded.md}'
    typography: '{typography.ui}'
  history-row:
    background: '{colors.surface}'
    border: '1px solid {colors.border}'
    radius: '{rounded.lg}'
    hover: '{colors.hover}'
    title: '{typography.ui}'
    meta: '{typography.caption}'
    meta-foreground: '{colors.text-muted}'
  projects-page-empty:
    state: '{components.empty-state}'
  login-screen:
    wordmark: '{typography.wordmark-lg}'
    tagline: '{typography.body-reading}'
  auth-panel:
    background: '{colors.surface}'
    border: '1px solid {colors.border}'
    radius: '{rounded.xl}'
    width: '{spacing.auth-panel-width}'
  google-button:
    button: '{components.button-ghost}'
    height: '{spacing.auth-button-height}'
  text-input:
    background: '{colors.background}'
    border: '1px solid {colors.border-control}'
    radius: '{rounded.md}'
    height: '{spacing.input-height}'
  language-toggle-login:
    foreground: '{colors.text-muted}'
    selected: '{colors.text}'
    typography: '{typography.caption}'
  error-line:
    foreground: '{colors.error}'
    dot: '{colors.error}'
  create-account-screen:
    panel: '{components.auth-panel}'
    input: '{components.text-input}'
  password-reset-screens:
    panel: '{components.auth-panel}'
    input: '{components.text-input}'
  settings-section:
    background: '{colors.surface}'
    border: '1px solid {colors.border}'
    radius: '{rounded.xl}'
  confirm-dialog-delete-project:
    dialog: '{components.modal-dialog}'
    losses-background: '{colors.background}'
    cancel: '{components.button-ghost}'
    confirm: '{components.button-danger}'
  confirm-dialog-delete-account:
    dialog: '{components.modal-dialog}'
    losses-background: '{colors.background}'
    input: '{components.text-input}'
    cancel: '{components.button-ghost}'
    confirm: '{components.button-danger}'
  qr-dialog:
    dialog: '{components.modal-dialog}'
    tile-background: '{colors.text}'
    tile-foreground: '{colors.background}'
    tile-radius: '{rounded.lg}'
  phone-action-button:
    background: '{colors.surface}'
    border: '1px solid {colors.border-strong}'
    radius: '{rounded.xl}'
    height: 56px
    typography: '{typography.mobile-button}'
  photo-thumbnail:
    radius: '{rounded.md}'
    border: '1px solid {colors.border-strong}'
    remove-target: '{spacing.touch-target-min}'
  phone-send-button:
    background: '{colors.primary}'
    foreground: '{colors.on-primary}'
    radius: '{rounded.xl}'
    height: 52px
  link-countdown:
    foreground: '{colors.text-muted}'
    typography: '{typography.caption}'
  expired-notice:
    background: '{colors.surface}'
    radius: '{rounded.xl}'
    foreground: '{colors.text}'
  phone-footer-credit:
    foreground: '{colors.text-muted}'
---

# Study Buddy — Design Spine

Visual identity for Study Buddy. Behavior lives in [EXPERIENCE.md](EXPERIENCE.md). Mocks in `mockups/` illustrate this spine; **the spines win on conflict with any mock.**

## Brand & Style

Study Buddy is a quiet place to study from your own material: "upload once, study many ways, review what you got wrong" (brief). The look is minimal, sleek, calm, and focused. Content comes first, whitespace is generous, and nothing competes with the question on screen.

- **Dark theme only in V1.** Every color is a token, so a light theme (stretch goal) can follow. A user-selectable theme color is deferred to V2.
- **No gamification and no playful illustration.** No badges, streaks, points, confetti, or mascots. Warmth comes from the words (EXPERIENCE.md Voice and Tone), not from decoration.
- **Wordmark:** the text "Study Buddy" in `{typography.wordmark}` (sidebar, phone page) or `{typography.wordmark-lg}` (login, create account, password reset). No logo. In-app text always says "Study Buddy"; "AI Study Buddy" stays in planning documents.
- **Footer credit, verbatim:** `© 2026 Sherlock and Watson Inc. · All mysteries solved, all rights reserved.` "Sherlock and Watson" is the course-group label and does not affect the look. Small (11px) `{colors.text-muted}` text at the bottom of the sidebar and the bottom center of the login screen [ASSUMPTION: placement and size from mock], and at the bottom of the phone upload page (confirmed), below the countdown [ASSUMPTION: position from mock].
- **Inspiration:** mindgrasp.ai was a mood reference for "dark study tool" only. No palette or type was taken from it.

## Colors

One accent. Every other chromatic color has exactly one job.

| Token | Hex | Job |
|---|---|---|
| `background` | `#0F1115` | App canvas, file rows inside the Files panel, text inputs |
| `surface` | `#171A21` | Sidebar, Files panel, cards, dialogs, menus, composer, banners |
| `text` | `#E6E8EE` | Primary text, QR tile |
| `text-muted` | `#9AA3B2` | Secondary text, metadata, key hints, the partly-unreadable warning, the expired phone link, archived projects and the archived banner label |
| `primary` | `#6C7CFF` | The single accent: primary buttons, focus ring, active and selected states, links and text actions ("Undo", "History"), progress, **Ready** and **Reading…** dots, "All cleared! Nice work." |
| `on-primary` | `#0F1115` | Label on `primary` and `error` fills |
| `correct` | `#4ADE80` | Correct answers: answer option, "Answer" in the score list, "Cleared" line |
| `mistake` | `#F5A524` | Quiz mistakes: picked-wrong answer, "It stays in your review.", mistakes card, Mistake Review |
| `error` | `#EF5B5B` | System errors: sign-in failure, rejected upload, daily limit reached, network or AI failure, plus the two exceptions in rule 3 |
| `border-control` | `#6A6C73` | Boundary of controls whose edge is their only visual cue: text inputs, checkboxes, radios, count-picker options |

**Color-role rules**

1. **One accent.** `{colors.primary}` is the only accent color. Never use it for decoration, mistakes, or errors.
2. **Amber means "review this", not "you failed".** Reserved for Quiz mistakes, so a wrong answer never looks like an error. Never use it for warnings, errors, or limits.
3. **Red is for system errors only.** Never use it for wrong answers, warnings, running-low notices, or menu items such as "Remove", "Archive", or "Delete project". There are exactly two documented exceptions:
   - **Log out** turns `{colors.error}` on desktop hover in the account menu. Touch devices have no hover, so it stays normal text.
   - **The final irreversible Delete or Remove button** in a delete dialog (delete project, delete account, remove file) is filled `{colors.error}` with a dark `{colors.on-primary}` label (Button (danger)). The menu items that open these dialogs stay normal text.
4. **The partly-unreadable warning is muted gray** (`{colors.text-muted}` text with a hollow dot), not amber and not red.
5. **Green is for correct answers only**, never generic success. File status Ready uses an indigo dot.
6. **Flashcards use no green and no amber.** "Got it" is primary and "Not yet" is neutral; flashcards are not a right-or-wrong moment.
7. **Finishing Mistake Review is indigo.** "All cleared! Nice work." uses `{colors.primary}`, not amber and not green.
8. **Archived is muted.** Archived projects and the archived banner label use `{colors.text-muted}`; only the banner's "Restore" button takes `{colors.primary}`. Archiving is reversible, so it never takes red or amber.
9. **Controls meet 3:1 non-text contrast (WCAG 2.2 SC 1.4.11).** A boundary that is a control's only visual cue uses `{colors.border-control}`. Decorative lines (dividers, card edges, hairlines) use `{colors.border}` and `{colors.border-strong}`.

**Borders and tints** are base colors at low opacity (values in the frontmatter). The memlog confirms only "thin subtle borders"; the exact values come from the mocks [ASSUMPTION: from mock]. `border-control` is confirmed (text at 40% over `surface`).

**Contrast (WCAG 2.2, checked on `background` and `surface`)**

| Pair | Ratio | Result |
|---|---|---|
| `text` on background / surface | 14.2:1 or higher | AA pass |
| `text-muted` on background / surface | 6.8:1 or higher | AA pass |
| `primary` as text on background / surface | 4.95:1 or higher | AA pass |
| `correct` on background / surface | 10.0:1 or higher | AA pass |
| `mistake` on background / surface | 8.5:1 or higher | AA pass |
| `error` on background / surface | 5.68:1 / 5.24:1 | AA pass |
| `on-primary` on `primary` | 5.37:1 | AA pass |
| `on-primary` on `error` (Button (danger)) | 5.68:1 (recomputed in review) | AA pass |
| `border-control` on surface / background | 3.32:1 / 3.34:1 | Non-text 3:1 pass (SC 1.4.11) |
| Light text (`#E6E8EE`) on `primary` | 2.87:1 | **Fails.** Never put light text on indigo. |

## Typography

Inter for every role, falling back to the system sans-serif stack (`system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`). The ramp comes from the mocks [ASSUMPTION: from mock].

| Role | Token | Size / weight | Where |
|---|---|---|---|
| Wordmark | `wordmark` | 17 / 650 | Top of sidebar, phone upload page |
| Wordmark, large | `wordmark-lg` | 30 / 650 | Login, create account, and password reset screens |
| Display | `display` | 44 / 600 | Quiz score number |
| Card term | `card-term` | 32 / 600 | Flashcard front |
| Large title | `title-lg` | 24 / 600 | Flashcard end screen, All cleared panel, phone "sent" screen |
| Title | `title` | 22 / 600 | Project name and "Settings" in the top bar |
| Question | `question` | 20 / 500, line height 1.45 | Quiz and Mistake Review questions, setup headings |
| Small title | `title-sm` | 18 / 600 | Dialog titles, empty-state headings |
| Card answer | `card-answer` | 17 / 400, line height 1.7 | Flashcard back |
| Heading | `heading` | 15 / 600 | Panel and section headings ("Files", "Account", "History"), feedback headline, activity title, summary section headings |
| Reading body | `body-reading` | 15 / 400, line height 1.75 | Chat answers, summaries, explanations, login tagline |
| Body | `body` | 14 / 400, line height 1.55 | Default UI text, undo message |
| UI | `ui` | 13.5 / 400 | Sidebar items, menu items |
| Button | `button` | 13.5 / 600 | Button labels |
| Caption | `caption` | 12.5 / 400 | File metadata, notes, source labels, limit notices, countdown, field labels |
| Overline | `overline` | 11 / 600, uppercase, 0.06em tracking | "PROJECTS", "FROM YOUR PHONE", "TERM" |
| Key hint | `key-hint` | 11 / 600 | Keyboard key caps |
| Mobile title | `mobile-title` | 20 / 600 | Project name on the phone upload page |
| Mobile button | `mobile-button` | 15 / 600 | Phone action and send buttons |

The generous line height of `body-reading` expresses the "spacious and calm" decision on reading-heavy surfaces.

## Layout & Spacing

Spacious and calm: whitespace favors focus over density. There is **no tab row**.

- **Desktop shell:** fixed left sidebar (`{spacing.sidebar-width}`) on `{colors.surface}`, main column on `{colors.background}` [ASSUMPTION: from mock]. Collapsed, the sidebar becomes the Sidebar strip (`{spacing.sidebar-collapsed-width}`) and the main column takes the freed width.
- **Sidebar, top to bottom:** wordmark, "PROJECTS" overline, active project list; at the bottom, the collapsed "Archived (n)" group, "+ New project", and the footer credit.
- **Project home:** chat column centered at `{spacing.chat-width}` maximum; collapsible Files panel on the right at `{spacing.files-panel-width}`. Collapsed, the panel becomes the Files strip and the chat column takes the freed width. Chat column, top to bottom: archived banner (archived project only), mistakes card (when present), chat bar, thread, tool buttons row, composer. [ASSUMPTION: widths and order from mock; archived banner position from `mockups/key-delete-project.html`]
- **Activities** (Quiz, Flashcards, Summarize, Mistake Review) and **History:** the activity header sits under the top bar. Activity content centers at `{spacing.reading-width}` with `{spacing.content-x}` side padding; setup screens center at `{spacing.setup-width}`. History replaces the chat: filter row on top, list below at `{spacing.chat-width}` maximum. [ASSUMPTION: from mock]
- **Narrow desktop window** (below 1024px): the sidebar and the Files panel start collapsed to their strips, the account menu trigger shows the avatar only, and content columns shrink to the available width. Behavior: EXPERIENCE.md Component Patterns › Sidebar strip, Files strip. There is no separate mobile layout.
- **Login, create account, and password reset:** one centered column: wordmark, tagline, `{spacing.auth-panel-width}` Auth panel, privacy line, footer credit at the bottom; EN | NO toggle top right.
- **Projects page (empty):** the shell with an empty state centered in the main column. [ASSUMPTION: not mocked]
- **Settings:** stacked section cards in a left-aligned column at `{spacing.chat-width}` maximum. [ASSUMPTION: from mock]
- **Scale:** 4 / 8 / 12 / 16 / 24 / 32 / 48 px. Large gaps (32–48) separate sections; small gaps (8–12) separate related items such as file rows and answer options. [ASSUMPTION: from mock]
- **Phone upload page:** one column, `{spacing.phone-gutter}` side gutters, actions stacked, Send pinned at the bottom with the countdown beneath it. Touch targets at least `{spacing.touch-target-min}`.

→ Composition reference: [`mockups/key-project-home.html`](mockups/key-project-home.html).

## Elevation & Depth

No heavy shadows. Depth comes from tone and hairlines only:

- `{colors.surface}` is raised against `{colors.background}`; inside the Files panel, file rows drop back to `{colors.background}`.
- Lines are 1px `{colors.border}` or `{colors.border-strong}`, and 1px `{colors.border-control}` on control boundaries.
- A `{spacing.accent-edge-width}` left edge in `{colors.mistake}` or `{colors.correct}` marks the mistakes card, the review context card, feedback panels, and the quiz-end "stay in your review" note.
- Modal dialogs sit on `{colors.scrim}` with no drop shadow. [ASSUMPTION: from mock]

## Shapes

| Token | Value | Use |
|---|---|---|
| `rounded.md` | 8px | Buttons, inputs, sidebar items, segmented controls, photo thumbnails |
| `rounded.lg` | 10px | File rows, history rows, answer options, feedback panels, mistakes card, archived banner, undo message, inline error, menus, count options, QR tile |
| `rounded.xl` | 12px | Dialogs, flashcard, Settings sections, auth panel, drop zone, composer, phone buttons |
| `rounded.full` | 9999px | Pills: topic chips, source labels, avatar, account-menu trigger outline |
| `rounded.xs` | 5px | Keyboard key hints, skeleton blocks |

The confirmed range is 8–12px. `full` and `xs` come from the mocks. [ASSUMPTION: from mock]

## Components

Visual specs only. Behavior lives in EXPERIENCE.md Component Patterns, which uses the same component names in the same groups. Rows marked *(visual only)* have no behavior row. Frontmatter keys are the kebab-case form of these names and hold each component's tokens; a row repeats a token only where it marks a part or a state. Every focusable element shows the Focus ring, and every disabled control uses the Button (primary) disabled treatment.

**Shared**

| Component | Visual spec |
|---|---|
| **Focus ring** | `{spacing.focus-ring-width}` `{colors.primary}` outline at `{spacing.focus-ring-offset}` offset. The offset keeps it visible on indigo buttons. |
| **Button (primary)** *(visual only)* | `{colors.primary}` fill, `{colors.on-primary}` label. Disabled: opacity 0.38, never red; all disabled buttons and controls use this. [ASSUMPTION: opacity value from mock] |
| **Button (ghost)** *(visual only)* | Transparent, `{colors.text}` label, 1px `{colors.border-strong}`. For secondary actions: "Start", "Stop for now", "Upload", "Upload from phone", "Not yet", "Cancel", "Close", "Try again". |
| **Button (danger)** *(visual only)* | `{colors.error}` fill, dark `{colors.on-primary}` label. Only for the final Delete or Remove button in the Confirm dialog (delete project), Confirm dialog (delete account), and Remove file dialog (Color-role rule 3). |
| **Overflow menu** | Trigger: "···" in `{colors.text-muted}`, `{spacing.touch-target-min}` square hit area. Menu: a `{colors.surface}` panel; items in `{colors.text}`, each at least `{spacing.touch-target-min}` tall, hover `{colors.hover}`. |
| **Key hint** | Small outlined key cap in `{colors.text-muted}`. On a primary button it takes `{colors.on-primary}`; on a revealed answer it takes that answer's color. |
| **Source label** | Muted pill with the file name in `{colors.text}`: "filename · slide N". |
| **Progress bar** | 4px. Fill `{colors.primary}` in Quiz and Flashcards, `{colors.mistake}` in Mistake Review. [ASSUMPTION: from mock] |
| **Progress steps** | Vertical list of three steps: done steps carry a check, the current step is `{colors.text}` with a `{colors.primary}` marker, pending steps are muted. Ghost Cancel below, then a muted line saying the student can go back to the chat. |
| **Skeleton** | Static `{colors.border}` blocks shaped like the content they stand for. No shimmer. [ASSUMPTION: fill and shape from the History loading mock] |
| **Inline error** | Surface box with a `{colors.error-edge}` border. Message in `{colors.error}` `{typography.body}`, a muted reassurance line below ("Nothing you've made is lost."), and a small ghost "Try again" on the right. |
| **Undo message** | Surface box with a hairline border and "Undo" as a `{colors.primary}` text action. No color fill. |
| **Empty state** | Centered `{typography.title-sm}` heading, muted body, one action. No illustration. |
| **Modal dialog** | Surface panel on `{colors.scrim}`, `{typography.title-sm}` title, footer actions right-aligned. |
| **Checkbox and radio** | `{colors.border-control}` boundary on `{colors.background}`; checked or selected fill `{colors.primary}` with an `{colors.on-primary}` mark. Label beside it in `{typography.body}` `{colors.text}`. |

**Shell**

| Component | Visual spec |
|---|---|
| **Sidebar** | Project items in muted `{typography.ui}`, truncated with an ellipsis, each with an Overflow menu; active item `{colors.primary-subtle}` fill with `{colors.text}`. "+ New project" in a dashed box. [ASSUMPTION: from mock] Collapse button: `{spacing.touch-target-min}` hit area. [ASSUMPTION: button position not confirmed] Order: Layout & Spacing › Sidebar. |
| **Sidebar strip** | Same treatment as the Files strip, on the left edge, `{spacing.sidebar-collapsed-width}` wide. Top to bottom: expand button, "+ New project" icon button. Each is an outlined square with a muted icon and a caption-size tooltip on a surface panel. [ASSUMPTION: button order and tooltip styling not confirmed] |
| **Archived group** | Row "Archived (n)" in muted `{typography.ui}` with an expand chevron; archived projects listed in muted text. An open archived project takes the active-item fill, with its label still muted. |
| **Top bar** | Project or page name in `{typography.title}` left, account menu right, hairline below. |
| **Archived banner** | Full-width surface row: "Archived" in `{colors.text-muted}` and a small Button (primary) "Restore" on the right. |
| **Account menu** | Trigger: `{spacing.avatar-sm}` avatar, "Welcome, [first name]", chevron; open, it takes `{colors.surface}` and a `{colors.border-strong}` pill outline. Dropdown items: Settings, Language (Language switch), hairline divider, Log out; hover `{colors.hover}`. Log out color: Color-role rule 3. |
| **Avatar** | Circle, `{spacing.avatar-sm}` in the account menu and `{spacing.avatar-lg}` in Settings. Google profile photo, or initials on `{colors.border}` with a `{colors.border-strong}` ring for email accounts. |
| **Language switch** | Two-segment control, "English" and "Norsk"; selected segment `{colors.primary-subtle}` with `{colors.text}`, other segment muted. |

**Chat (project home)**

| Component | Visual spec |
|---|---|
| **Mistakes card** | Surface card with a `{colors.mistake}` left edge. "{n} mistakes to review" in `{colors.mistake}` semibold, muted supporting line, ghost "Start" on the right. |
| **Chat bar** | Muted caption-size row: "Answer from" and the Scope control on the left, History link on the right. [ASSUMPTION: row layout from mock] |
| **Scope control** | Segmented control: "All materials" and "One file ▾"; selected segment `{colors.primary-subtle}`. |
| **History link** | The word "History" in `{colors.primary}`, caption size. |
| **Chat message** | Student: right-aligned surface bubble with a hairline border. Study Buddy: no bubble, muted "Study Buddy" label, `{typography.body-reading}`, source labels below. [ASSUMPTION: from mock] Pending: muted "Study Buddy is thinking…" with three soft muted dots in the answer's place. Finished-generation message: `{typography.body}`, "Open" as a `{colors.primary}` link; no badge, no color fill. |
| **Tool buttons row** | Muted lead label ("Study this material" [ASSUMPTION: copy from mock]), then three ghost buttons: Quiz, Flashcards, Summarize. |
| **Composer** | Surface box with muted placeholder and a primary Send inside. |
| **Limit notice** | Caption text: small muted dot, `{colors.text}` label ("{n} messages left today"). At zero: `{colors.error}`. |
| **Upload drop zone** | Dashed box filling the chat area of an empty project: centered heading "Upload your notes to start" at `{typography.title-sm}` scale, muted body with "browse" in `{colors.primary}`, supported-types caption, then "or" and a ghost "Upload from phone". |

**Files panel**

| Component | Visual spec |
|---|---|
| **Files panel** | Header: "Files" in `{typography.heading}`, muted " · n of 10", collapse button (28px outlined square). Below: Upload buttons, a muted supported-types hint, file rows. Empty: dashed box "No files yet. Your notes will show up here." [ASSUMPTION: layout and empty copy from mock] |
| **Files strip** | `{spacing.7}` wide [ASSUMPTION: width not confirmed; the mock uses 56px]. Top to bottom: expand button (same outlined square as the collapse button), files icon, muted caption count "n of 10" (number on one line, "of 10" below). Warning icon under the count: `{colors.text-muted}` for a partly unreadable file, `{colors.error}` when any file is rejected. |
| **Upload buttons** | "Upload" and "Upload from phone" as equal-width small ghost buttons side by side in the Files panel. In the Upload drop zone, "Upload from phone" appears alone. |
| **File row** | `{colors.background}` card. File-type tile (32px outlined square with type label), name (ellipsis), muted metadata, File status line, Overflow menu on the right. Notes and topics indent under the name in caption text. Rejected rows show a small ghost "Remove" instead of the Overflow menu. [ASSUMPTION: ghost style from mock] |
| **File status** | Dot plus label. **Reading…**: pulsing `{colors.primary}` dot, muted label. **Ready**: `{colors.primary}` dot, `{colors.text}` label. **Ready, partly unreadable**: hollow muted dot, muted label and note. **Rejected**: `{colors.error}` dot, label, and note. |
| **Topic chip** | Caption-size pill with × to delete. Editing: `{colors.primary}` border on `{colors.primary-wash}` with caret. "+ Add topic": dashed border, muted text. Selected (setup screens): `{colors.primary}` border on `{colors.primary-subtle}`. [ASSUMPTION: from mock] |
| **Remove file dialog** | Modal dialog. Title names the file; body in `{typography.body}`; one unchecked Checkbox and radio checkbox with its label; ghost Cancel and Button (danger) "Remove". Short variant (file still Reading…): one sentence and the two buttons. |

**Activities**

| Component | Visual spec |
|---|---|
| **Activity header** | Bar with a hairline below: outlined "← Back to chat", then the activity title in `{typography.heading}` with a muted "· scope". [ASSUMPTION: from mock] |
| **Topic scope picker** | Muted caption label, then a wrapping row of selectable Topic chips, "All topics" first. |
| **Count picker** | Three outlined boxes (5, 10, 20) in one row with `{colors.border-control}` boundaries, muted numerals, each at least `{spacing.touch-target-min}` tall; selected `{colors.primary}` border on `{colors.primary-subtle}` with `{colors.text}`. The row stays on one line in a narrow window. [ASSUMPTION: narrow-window layout not mocked] |
| **Too-little-material note** | Under the Count picker: a muted caption sentence with the offered count as a `{colors.primary}` action. |
| **Summarize setup** | Heading "Make a summary" in `{typography.question}`, muted lead line. "Which file?" label, then file options: each a `{colors.background}` row with a radio (Checkbox and radio), file-type tile, name, and muted metadata; selected row `{colors.primary}` border on `{colors.primary-subtle}`. "Narrow to one topic (optional)" label, then a row of selectable Topic chips, "Whole file" first. Button (primary) "Make summary" below. |
| **Answer option** | Surface row, key hint left. Correct: `{colors.correct-wash}` fill, `{colors.correct-edge}` border, "Correct answer" tag in `{colors.correct}`. Picked wrong: `{colors.mistake-wash}` fill, `{colors.mistake-edge}` border, "Your answer" tag in `{colors.mistake}`. Others dim. |
| **Feedback panel** | Surface panel with a left edge in `{colors.mistake}` after a wrong answer or `{colors.correct}` after a right one. Headline ("Not quite" after a wrong answer) in `{typography.heading}`; after a wrong answer, "It stays in your review." in `{colors.mistake}`; explanation in `{typography.body-reading}`; source label. In Mistake Review, a right answer adds a "Cleared" line with a `{colors.correct}` dot. Below the panel, right-aligned: muted key hints ("1–4 answer", "→ next") and a Button (primary) with a → key hint. Button labels: EXPERIENCE.md Component Patterns › Feedback panel. |
| **Score summary** | Score in `{typography.display}` with muted "of {total} correct"; muted one-line comment; "Questions you missed" rows on `{colors.surface}` with "You said" in `{colors.mistake}` and "Answer" in `{colors.correct}`; a note card with a `{colors.mistake}` edge; primary "← Back to chat" and ghost "New quiz". [ASSUMPTION: from mock] |
| **Flashcard** | One centered surface card with generous padding. Front: "TERM" overline, term in `{typography.card-term}`, muted "Click to flip" with a Space key hint. Back: term small and muted, answer in `{typography.card-answer}`, source label. Below the card: ghost "Stop for now" left; ghost "Not yet" (← hint) and primary "Got it" (→ hint) right. [ASSUMPTION: layout from mock; key hints per memlog] |
| **Flashcard end screen** | Centered headline "{n} cards done. {m} needed a second try" in `{typography.title-lg}` `{colors.text}`; primary "Make more cards" and ghost "← Back to chat". No score. [ASSUMPTION: layout from mock] |
| **Summary view** | Reading column: muted scope line ("Summary of {file} · whole file" or the chosen topic), summary title, then sections with `{typography.heading}` headings and `{typography.body-reading}` text, each ending with a row of Source labels. At the end: a muted "Saved to History" line and Button (primary) "← Back to chat". |
| **Mistake Review session** | Progress line ("{n} of {m} cleared · {k} left", cleared count in `{colors.mistake}`), Progress bar, context card with a `{colors.mistake}` edge and a "From your quiz on [date]" label, then question, answer options, Feedback panel, ghost "Stop for now" and primary "Next mistake", with the muted line "Your progress is saved." below. [ASSUMPTION: from mock] |
| **All cleared panel** | Same layout as the Flashcard end screen: headline "All cleared! Nice work." in `{typography.title-lg}` `{colors.primary}`; primary "Make a new quiz" and ghost "← Back to chat". |

**History**

| Component | Visual spec |
|---|---|
| **History filter** | Segmented control like the Scope control: "All", "Chats", "Quizzes", "Flashcards", "Summaries"; selected `{colors.primary-subtle}`. Wraps to a second line in a narrow window. [ASSUMPTION: labels from mock; wrapping not mocked] |
| **History row** | Full-width surface row, hover `{colors.hover}`. Type label and title in `{typography.ui}` `{colors.text}`, truncated with an ellipsis; muted date and scope in caption text; an unfinished quiz carries a muted "Unfinished · {n} of {total}" label. [ASSUMPTION: row contents from mock] |

**Sign-in and Settings**

| Component | Visual spec |
|---|---|
| **Projects page (empty)** | Empty state: heading, one muted sentence, Button (primary) "Create your first project". The sidebar shows only "+ New project". [ASSUMPTION: not mocked] |
| **Login screen** | Wordmark in `{typography.wordmark-lg}`, muted tagline, Auth panel, muted privacy line, footer credit. Layout: Layout & Spacing › Login. |
| **Auth panel** *(visual only)* | Surface panel, `{spacing.auth-panel-width}` wide, holding the Google button, an "or" divider (hairlines on either side), and the email form. Shared by the Login, Create account, and Password reset screens. |
| **Google button** | Full-width ghost button, `{spacing.auth-button-height}` tall, "Sign in with Google". [ASSUMPTION: from mock] |
| **Text input** | `{colors.background}` fill, `{colors.border-control}` boundary, `{spacing.input-height}` tall, muted placeholder; muted caption label above; inline link ("Forgot password?") in `{colors.primary}`. [ASSUMPTION: from mock] |
| **Language toggle (login)** | Small "EN \| NO" text toggle; selected in `{colors.text}` semibold, other muted. |
| **Error line** | `{colors.error}` text with a small `{colors.error}` dot, above the buttons in the Auth panel: "Sign-in didn't work. Try again." Also carries the duplicate-email and account-linking messages. [ASSUMPTION: the account-linking message uses the error line] |
| **Create account screen** | Login screen layout. Auth panel: Google button, "or" divider, Text inputs for first name, email, and password, full-width Button (primary) "Create account", Error line above it when needed. [ASSUMPTION: not mocked; reuses Login screen parts] |
| **Password reset screens** | Login screen layout, one Auth panel per step. Request: email Text input and Button (primary). Sent: muted confirmation text in place of the form. New password: password Text input and Button (primary). Expired link: "This link has expired" in `{colors.text}`, muted supporting text, Button (primary) "Send a new link". [ASSUMPTION: not mocked; reuses Login screen parts; button style not confirmed] |
| **Settings section** | Surface card: heading in `{typography.heading}`, muted lead line, rows separated by hairlines. Account row: `{spacing.avatar-lg}` avatar, name (a Text input for email accounts, plain text for Google accounts), muted email and sign-in method, ghost Log out. [ASSUMPTION: layout from mock] The account-linking message "This Google account is already linked to another Study Buddy account." is in `{colors.error}`. |
| **Confirm dialog (delete project)** | Modal dialog. Title "Delete {project}?", lead line, an inset `{colors.background}` box listing what is lost (its files, its mistakes, generated material) with muted detail beside each, bold "This can't be undone.", ghost Cancel and Button (danger) "Delete project". |
| **Confirm dialog (delete account)** | Modal dialog. Inset `{colors.background}` box listing what is lost, bold "This can't be undone.", Text input "Type DELETE to confirm", ghost Cancel and Button (danger) confirm. |

**Phone upload**

| Component | Visual spec |
|---|---|
| **QR dialog** | Modal dialog: title "Upload from your phone", muted lead naming the Project, centered QR tile (dark code on `{colors.text}`), muted expiry caption, then a "FROM YOUR PHONE" overline section: "Waiting for photos…" with a hollow `{colors.primary}` dot, and arrived batches as compact file rows on `{colors.background}`. Ghost Close. [ASSUMPTION: from mock] |
| **Phone action button** | Full-width, 56px surface buttons in `{typography.mobile-button}`: "Take photos", "Choose from gallery". [ASSUMPTION: from mock] |
| **Photo thumbnail** | 3:4, page-number badge bottom right. × remove icon (20px circle) top right with a touch target of at least `{spacing.touch-target-min}` square. |
| **Phone send button** | Full-width, 52px, `{colors.primary}` fill, `{colors.on-primary}` label. |
| **Link countdown** | Muted caption, centered under Send. No alarm color in the last minute. |
| **Expired notice** | Surface box: "This link has expired." in `{colors.text}`, "Scan a new code on your computer." muted. Thumbnails stay visible but dimmed. [ASSUMPTION: from mock] |
| **Phone footer credit** | The footer credit in small muted text. Placement: Brand & Style › Footer credit. |

→ Visual references:

- [`mockups/key-project-home.html`](mockups/key-project-home.html): shell, Sidebar strip, account menu, chat home, empty project, Files panel and strip, Remove file dialog, History (filter, rows, empty, loading skeleton, inline error).
- [`mockups/key-quiz-feedback.html`](mockups/key-quiz-feedback.html): Quiz setup, progress steps, answer options, feedback panel, key hints, score summary.
- [`mockups/key-mistake-review.html`](mockups/key-mistake-review.html): Mistake Review session, All cleared panel, chat with no mistakes card.
- [`mockups/key-flashcards.html`](mockups/key-flashcards.html): setup, flashcard front and back, flashcard end screen.
- [`mockups/key-summary.html`](mockups/key-summary.html): Summarize setup, progress steps, Summary view, inline error on setup.
- [`mockups/key-delete-project.html`](mockups/key-delete-project.html): sidebar "···" menu (Rename, Archive, Delete project), inline rename, Archived group, Undo message, archived view with banner, Confirm dialog (delete project).
- [`mockups/key-login.html`](mockups/key-login.html): login screen and its parts.
- [`mockups/key-settings.html`](mockups/key-settings.html): Settings sections, Confirm dialog (delete account).
- [`mockups/key-phone-upload.html`](mockups/key-phone-upload.html): QR dialog, phone page, sent and expired states.

Not mocked: Create account screen, Password reset screens, Projects page (empty), chat pending answer, project cold-load skeleton.

## Do's and Don'ts

Color jobs and exceptions are stated once, in Colors › Color-role rules. These rows add the rules that are not color roles.

| Do | Don't |
|---|---|
| Follow the Color-role rules for every color choice | Add a second accent or give a color a second job |
| Keep the count and a warning icon on the collapsed Files strip | Hide a partly-unreadable or rejected file behind a collapsed panel |
| Show the 2px + 2px focus ring on every focusable element | Remove outlines or rely on color change alone for focus |
| Define every color as a token | Hard-code hex values in components (blocks a later light theme) |
| Separate with tone and thin lines | Use heavy shadows, gradients, or glows |
| Give reading screens generous line height and whitespace | Pack content densely |
| Keep skeletons, the thinking dots, and the Reading… dot static under reduced motion | Shimmer or pulse when the operating system asks for reduced motion |
| Keep the wordmark text-only | Add a logo, mascot, or illustration |
| Let warmth live in the words | Add badges, streaks, points, confetti, or celebratory animation |
