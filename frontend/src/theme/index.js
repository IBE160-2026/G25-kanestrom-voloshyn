// The theme and accent (Settings › Appearance): set on <html> as `data-theme` ("default" | "light" |
// "dark") and `data-accent`, which tokens.css turns into the colour tokens. Signed-out pages use the
// Default theme with the default accent; signed-in pages use the Account's choice
// (`me.ui_prefs.theme` / `.accent`), cached in localStorage so a reload of a signed-in page paints it
// before the profile arrives (a per-viewer convenience only).

export const THEMES = ['default', 'light', 'dark']
// "default" is the current theme's own accent (tokens.css), so it changes with the theme.
export const ACCENTS = ['default', 'blue', 'violet', 'cyan']
// An Account that never chose, and every signed-out page: the Default theme with its own accent.
export const DEFAULT_CHOICE = { theme: 'default', accent: 'default' }

const CACHE_KEY = 'studybuddy.theme'

/** A valid `{ theme, accent }`: unknown or missing values (such as an old "system" or
 * "indigo") read as the default. */
export function normalize(choice) {
  return {
    theme: THEMES.includes(choice?.theme) ? choice.theme : DEFAULT_CHOICE.theme,
    accent: ACCENTS.includes(choice?.accent) ? choice.accent : DEFAULT_CHOICE.accent,
  }
}

/** The Account's choice from its `ui_prefs`. */
export function accountChoice(uiPrefs) {
  return normalize(uiPrefs ?? {})
}

/** Apply `{ theme, accent }` to <html> now. */
export function applyTheme(choice) {
  const { theme, accent } = normalize(choice)
  const root = document.documentElement
  root.dataset.theme = theme
  root.dataset.accent = accent
}

/** Apply a signed-in Account's choice and remember it for the next reload. */
export function applyAccountTheme(choice) {
  const valid = normalize(choice)
  applyTheme(valid)
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(valid))
  } catch {
    // storage blocked: only the next reload may briefly show the Default theme
  }
}

/** The cached choice of the last signed-in Account on this browser, or null. */
export function cachedTheme() {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    return raw ? normalize(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

/** Signed out: the Default theme and accent; `forget` also drops the cached choice. */
export function applySignedOutTheme({ forget = false } = {}) {
  if (forget) {
    try {
      window.localStorage.removeItem(CACHE_KEY)
    } catch {
      // storage blocked: nothing was cached
    }
  }
  applyTheme(DEFAULT_CHOICE)
}

/**
 * Before the first render (main.jsx): a signed-in page (under /projects) paints the cached choice;
 * every other page, and a signed-in page with nothing cached, starts on the Default theme and accent.
 */
export function applyInitialTheme(pathname = window.location.pathname) {
  const signedIn = pathname === '/projects' || pathname.startsWith('/projects/')
  applyTheme((signedIn && cachedTheme()) || DEFAULT_CHOICE)
}
