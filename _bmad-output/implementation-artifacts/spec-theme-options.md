---
title: 'Theme options: light and dark themes and accent colours'
type: 'feature'
created: '2026-11-20'
status: 'done'
baseline_commit: '88abad8647b2ccb436c1fe6020f687e647ad41a7'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The app is dark-only with a fixed indigo accent. Students who prefer a light screen, or another accent colour, have no choice. This is a V2 item (PRD §7.2 "A light theme and user-chosen theme colors"). Cristoffer approved building it now on 2026-11-20. The final docs (PRD §7.2, DESIGN.md "Dark theme only in V1", spine "Dark theme only, with no theme switch") get proposed wording for Cristoffer or Ihor to apply; they are not edited here.

**Decisions (Cristoffer, 2026-11-20):** light and dark themes plus "Match system", and a choice of accent colour. The control is a new Settings section, saved to the Account. Before sign-in, the app follows the system setting.

**Amended by Cristoffer after the browser test (2026-11-20). This amendment wins over the Approach and Matrix below where they differ:**
- **Themes are Default / Light / Dark** (Standard / Lyst / Mørkt). "Match system" is removed.
  - **Default** is today's palette, and every Account that hasn't chosen gets it.
  - **Dark** is a new, clearly darker (near-black) palette.
  - Signed-out pages use Default with the default accent. The values are `theme: "default" | "light" | "dark"`; an unknown saved value (such as an old `"system"`) reads as Default.
- **Light needs more contrast:** the Sidebar and other surface panels must stand clearly apart from the main background. Use a visibly grey background with white surfaces and stronger hairlines. The contrast test adds surface against background at least 1.15:1 in Light.
- **The "Default" accent (Standard) is the current theme's own accent** (Cristoffer, 2026-11-20): today's indigo in Default, a light-tuned one in Light, and a near-black-tuned one in Dark. The stored value is `"default"`, and an old `"indigo"` reads as Default. Blue, Violet and Cyan stay fixed choices with values for each theme.

**Approach:**
- **Tokens:** `tokens.css` keeps today's dark values as the default. `:root[data-theme="light"]` overrides every colour token with a light palette, and `color-scheme` follows. `:root[data-accent="…"]` overrides `--color-primary`, `-subtle`, `-wash` and `--color-on-primary`, with a value per theme.
- **Accents:** indigo, blue, violet and cyan. **Indigo is the default for every Account** and for every signed-out page, until the student picks another (Cristoffer, 2026-11-20). Each keeps its meaning apart from green (correct), amber (mistake) and red (error) (DESIGN.md Color-role rules 1–3, 5).
- **Contrast in both themes:** text on background and on surface is at least 4.5:1 (WCAG AA). Controls (`--color-border-control`) are at least 3:1. `on-primary` on `primary` is at least 4.5:1 for every accent in every theme.
- **Applying it:** a small `frontend/src/theme/` module sets `data-theme` and `data-accent` on `<html>`.
  - "Match system" resolves through `matchMedia('(prefers-color-scheme: light)')` and follows live changes.
  - Signed-out pages (Login, Create account, password reset, the phone page) use the system theme and the default accent.
  - Signed-in pages use the Account's choice from `me.ui_prefs`. The last choice is cached in `localStorage` (per-viewer convenience), so a reload doesn't flash the wrong theme. Signing out returns to the system theme.
- **Saved:** `PATCH /api/me/prefs` accepts `theme` (`"system" | "light" | "dark"`) and `accent` (`"indigo" | "blue" | "violet" | "cyan"`), merged into `ui_prefs` with no migration. An Account with no `theme` saved stays **dark**, so nobody's app changes until they choose.
- **Settings:** a new section **Appearance** / **Utseende** between Language and Your data.
  - **Theme** / **Tema**: Match system / Light / Dark (Følg systemet / Lyst / Mørkt), as a radio group like the Language switch.
  - **Accent colour** / **Aksentfarge**: four round swatches. Each is a radio with its name as the label: Indigo, Blue/Blå, Violet/Fiolett, Cyan.
  - A choice applies at once and saves. A failed save keeps the choice and shows an error line, as Language does.
  - Lead line: "How Study Buddy looks on this and your other devices." / "Hvordan Study Buddy ser ut på denne og de andre enhetene dine."
- **New copy, pending Cristoffer's approval:** every string above.

## Boundaries & Constraints

**Always:**
- Components keep using only `var(--…)`. No colour value appears outside `tokens.css`.
- Mistake amber, correct green and error red keep their meanings in both themes.
- Strings go through i18n.
- The theme applies before the first paint where possible: an inline-free early read in `main.jsx`, before render.

**Never:**
- Custom colour pickers.
- Per-Project themes.
- A new database column.
- Edits to the final PRD, DESIGN.md or spine (the proposed wording goes in Implementation Notes).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Existing Account | no `theme` in ui_prefs | dark, indigo (unchanged) | N/A |
| Choose Light | Settings › Light | `data-theme="light"` at once; saved; reload stays light | save fails → error line, choice kept |
| Match system | system is light, then switches to dark | follows live | N/A |
| Accent | pick Violet | primary buttons, focus ring, links and Ready dot turn violet in both themes | save fails → error line |
| Other device | sign in elsewhere | the saved theme and accent apply after sign-in | N/A |
| Signed out | Login, phone page | system theme, indigo | N/A |
| Log out | from a light choice | Login follows the system | N/A |
| Contrast | every theme × accent | the ratios in Approach hold | test fails |
| Bad prefs | `PATCH {theme:"pink"}` | `422 invalid_request` | N/A |
| Norwegian | nb | the section in Norwegian | N/A |

</frozen-after-approval>

## Code Map

- `frontend/src/styles/tokens.css` -- the colour block (L11–32). Add the light palette and the accent blocks. Every other token stays.
- `frontend/src/main.jsx` -- apply the cached or system theme before `createRoot`.
- `frontend/src/theme/` (new) -- `applyTheme({theme, accent})`, system listener, cache, `THEMES` and `ACCENTS`.
- `frontend/src/components/AppShell.jsx` -- apply `me.ui_prefs` when the profile loads (L120 reads `ui_prefs` today). `frontend/src/components/accountActions.js` -- `useLogOut` and the delete-account sign-out return to the system theme.
- `frontend/src/pages/Settings.jsx` -- an `AppearanceSection` modelled on `LanguageSection` (radio group, error line). It saves via `apiFetch('/api/me/prefs', {method:'PATCH'})` and updates `me` through `setMe`.
- `backend/app/api/me.py` -- `PrefsUpdate` (L60) gains `theme` / `accent` Literals; widen `_not_empty`. `backend/app/services/identity.py` `set_prefs` is unchanged.
- `backend/tests/` -- prefs tests (find the existing `PATCH /api/me/prefs` tests) for the new keys and the 422.
- `frontend/src/i18n/en.json`, `nb.json`, `frontend/src/test/fakeApi.js`.
- New `frontend/src/theme/theme.test.js` -- a contrast-ratio test that parses `tokens.css` and checks every theme × accent pair in Approach. New `frontend/src/pages/Appearance.test.jsx` -- the frontend matrix rows.

## Tasks & Acceptance

**Execution:**
- [x] `frontend/src/styles/tokens.css` -- the light palette and accents, meeting the contrast rules.
- [x] `frontend/src/theme/`, `main.jsx`, `AppShell.jsx`, `accountActions.js` -- applying, caching, system follow, sign-out reset.
- [x] `backend/app/api/me.py` + a backend prefs test -- `theme` and `accent`.
- [x] `frontend/src/pages/Settings.jsx`, i18n, fakeApi -- the Appearance section.
- [x] `frontend/src/theme/theme.test.js`, `frontend/src/pages/Appearance.test.jsx` -- contrast and the matrix rows.

**Acceptance Criteria:**
- Given an Account that chose Light and Violet, when it signs in on another browser, then every signed-in page is light with violet primary buttons, and Login before sign-in followed the system.
- Given any theme and accent, when the contrast test runs, then every pair meets the stated ratio.

## Implementation Notes

**Palette (tokens.css), after Cristoffer's browser test.** Three themes on `data-theme`: **Default** is the `:root` block unchanged (background `#0F1115`, surface `#171A21`). **Dark** (`:root[data-theme='dark']`) is near-black: background `#07080A`, surface `#0E1014`, hairlines `#E6E8EE12` / `#E6E8EE21`, hover `#E6E8EE0B`, scrim `#000000C7`, control border `#6A6C73`; text and semantic colours stay the Default's. **Light** (`:root[data-theme='light']`): a visibly grey background `#E8EBF0` under white surfaces `#FFFFFF` (1.20:1, so the Sidebar and panels stand apart), firmer hairlines `#1A1D2421` / `#1A1D2438`, text `#1A1D24`, muted `#525A68`, control border `#757A84`, correct `#116B32`, mistake `#A14A07`, error `#B42525` (darkened to read as text on the grey).

**Accents.** `accent` is `"default" | "blue" | "violet" | "cyan"`. "default" is the current theme's own accent: each theme block sets `--color-theme-primary`, `-on-primary`, `-primary-subtle`, `-primary-wash` (Default `#6C7CFF` on `#0F1115`, today's values; Dark `#7F8CFF` on `#07080A`; Light `#4F5BD5` on `#FFFFFF`), and `--color-primary` etc. resolve to them (`var(--color-theme-…)`) unless `data-accent` picks another. `[data-accent='default']` maps back to the theme's own values, so the Settings "Default" swatch shows the current theme's accent even when `<html>` has another. Blue / Violet / Cyan: `#4C9AFF` / `#A78BFA` / `#22D3EE` on `#0F1115` in Default and Dark (they pass on near-black too), `#1D64D8` / `#7C3AED` / `#0E7490` on `#FFFFFF` in Light. An unknown or old saved value (`"indigo"`, `"system"`) reads as "default"; the backend refuses both with 422.

**Contrast test.** `theme.test.js` resolves `var()` and checks every theme × accent (3 × 4): text, muted, and the semantic colours on background and surface (4.5:1), control border and primary on them (3:1, focus ring and Ready dot), on-primary on primary and on error (4.5:1, danger buttons); plus Light surface vs. background at least 1.15:1, Dark darker than Default, and a distinct own accent per theme.

**Applying.** No system theme anywhere ("Match system" was removed). `applyInitialTheme()` in `main.jsx` paints the cached choice on `/projects…` paths, else Default + default accent. AppShell applies `me.ui_prefs` (and caches it) once the profile loads, and returns to the defaults and clears the cache when it unmounts (sign-out, ended session). Log out and Delete my account also clear the cache. Appearance saves send the full `{ theme, accent }`, one at a time; a choice made during a save is sent after it.

**QR tile.** In the light theme the tile (`--color-text` background, `--color-background` code) would invert to light code on a dark tile, which many phone cameras can't read; `QrDialog.module.css` keeps dark code on a light tile there with a `:root[data-theme='light']` override (tokens only).

**fakeApi.** Its `PATCH /api/me/prefs` already merges any key, so no change was needed.

**Proposed wording for the final docs (for Cristoffer or Ihor to apply; not edited here):**
- PRD §7.2 (line 585, "A light theme and user-chosen theme colors."): move to V1 as an Extension, or remove from §7.2 with a note: "Built ahead of V2 on 2026-11-20 (Cristoffer): Default / Light / Dark themes and an accent colour (each theme's own Default, or Blue, Violet, Cyan), saved to the Account."
- DESIGN.md (line 592, "**Dark theme only in V1.** …"): "**Themes.** Settings › Appearance offers Default (today's dark palette) / Light / Dark (near-black), and an accent colour: Default (the theme's own accent), Blue, Violet, or Cyan. Default + Default stays the choice for every Account until it picks another. Every color is a token; the theme and accent blocks override them (tokens.css). Green, amber, and red keep their meanings in every theme." Add the Dark and Light palettes and the accent values to the frontmatter tokens.
- ARCHITECTURE-SPINE.md (line 630, "Dark theme only, with no theme switch."): "Default (dark) theme by default; Light and Dark themes and accent colours are set as `data-theme` / `data-accent` on `<html>` by `src/theme/` and override colour tokens in tokens.css; the choice lives in `profiles.ui_prefs` (`theme`, `accent`)."

- **Proposed EXPERIENCE.md wording** (added at review; for Cristoffer or Ihor to apply): L21 "Visual reference: DESIGN.md. Default (dark) theme by default; Light and Dark (near-black) themes and an accent colour (the theme's own Default, blue, violet, cyan) are chosen in Settings › Appearance." L831 row "Light theme" → remove from Out of scope. IA › Settings (L75): "one page, four sections: Account, Language, Appearance, Your data."

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | BH, EC, VG | overlapping single-key saves: out-of-order arrival, and a failed theme save dropped silently when a later accent save succeeds | medium | `body: change`; error ignored when superseded | patch — full `{theme, accent}`, one save at a time; tests |
| 2 | BH, EC, VG | a session ending without Log out keeps the cached theme for the next Account on the browser | medium | AppShell cleanup called `applySignedOutTheme()` without `forget` | patch — forget on unmount; test |
| 3 | VG | Delete account never checked to forget the cache | medium | no theme assertion in DeleteAccount tests | patch — test |
| 4 | BH | `themeKey` joins and re-splits two values with a space | low | fragile encoding | patch — two dependencies |
| 5 | BH | stale docs: `set_prefs` docstring, tokens.css header, no EXPERIENCE.md proposal | low | docstring and header outdated; spec omitted EXPERIENCE.md L21, L831, Settings IA | patch — docstring, header; EXPERIENCE.md wording added to Implementation Notes |
| 6 | BH | Settings header comment line too long | low | wrap width | patch |
| 7 | BH | a brief dark flash before `main.jsx` sets the theme (no inline head script / color-scheme meta) | low | the spec chose an inline-free early read | reject |
| 8 | BH | signed-in detection by path only (`/`, `/auth/callback` reloads show the system theme briefly) | low | corrected as soon as AppShell mounts | reject |
| 9 | BH | contrast tests skip translucent fills and the descendant swatch selector | low | washes are near the base colour; swatches read the same accent values | reject |
| 10 | BH | no keyboard test for the radio groups; backend `theme: null` case | low | native radios; `exclude_none` already drops nulls | reject |
| 11 | BH | radio groups spaced differently; swatch focus ring uses the accent | low | cosmetic | reject |
| 12 | EC | two tabs of one Account: a stale tab can overwrite the cache | low | rare; corrected on the next profile load | reject |

## Verification

**Commands:**
- `cd backend; uv run pytest` -- expected: all green with `LLM_MODE=mock`
- `cd frontend; npm test; npm run lint` -- expected: all green (from PowerShell)

**Manual checks:**
- At localhost:8000, each theme × accent: the quiz feedback (green/amber), an error line (red), the Sidebar and dialogs read clearly.
