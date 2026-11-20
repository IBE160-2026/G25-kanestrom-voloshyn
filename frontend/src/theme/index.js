// The theme and accent (Settings › Appearance): set on <html> as `data-theme` ("light" | "dark") and
// `data-accent`, which tokens.css turns into the colour tokens. "system" follows the operating
// system's setting live. Signed-out pages use the system theme and the default accent; signed-in pages
// use the Account's choice (`me.ui_prefs.theme` / `.accent`), cached in localStorage so a reload of a
// signed-in page paints it before the profile arrives (a per-viewer convenience only).

export const THEMES = ['system', 'light', 'dark']
export const ACCENTS = ['indigo', 'blue', 'violet', 'cyan']
export const DEFAULT_ACCENT = 'indigo'
// An Account that never chose keeps the dark theme, as before the choice existed.
export const ACCOUNT_DEFAULT = { theme: 'dark', accent: DEFAULT_ACCENT }
export const SIGNED_OUT = { theme: 'system', accent: DEFAULT_ACCENT }

const CACHE_KEY = 'studybuddy.theme'
const LIGHT_QUERY = '(prefers-color-scheme: light)'

let current = SIGNED_OUT
let media = null // the MediaQueryList "system" listens to, while it does

function lightQuery() {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(LIGHT_QUERY) : null
  } catch {
    return null
  }
}

function paint() {
  const root = document.documentElement
  const resolved = current.theme === 'system' ? (lightQuery()?.matches ? 'light' : 'dark') : current.theme
  root.dataset.theme = resolved
  root.dataset.accent = current.accent
}

function onSystemChange() {
  if (current.theme === 'system') paint()
}

function listen(on) {
  if (on && !media) {
    media = lightQuery()
    media?.addEventListener?.('change', onSystemChange)
  } else if (!on && media) {
    media.removeEventListener?.('change', onSystemChange)
    media = null
  }
}

/** A valid `{ theme, accent }`: unknown or missing values fall back to `fallback`'s. */
export function normalize(choice, fallback = ACCOUNT_DEFAULT) {
  return {
    theme: THEMES.includes(choice?.theme) ? choice.theme : fallback.theme,
    accent: ACCENTS.includes(choice?.accent) ? choice.accent : fallback.accent,
  }
}

/** The Account's choice from its `ui_prefs`; no saved theme means dark, no saved accent indigo. */
export function accountChoice(uiPrefs) {
  return normalize(uiPrefs ?? {}, ACCOUNT_DEFAULT)
}

/** Apply `{ theme, accent }` to <html> now; "system" also follows later changes of the system setting. */
export function applyTheme(choice) {
  current = normalize(choice, SIGNED_OUT)
  listen(current.theme === 'system')
  paint()
}

/** Apply a signed-in Account's choice and remember it for the next reload. */
export function applyAccountTheme(choice) {
  applyTheme(choice)
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(current))
  } catch {
    // storage blocked: only the next reload may briefly show the system theme
  }
}

/** The cached choice of the last signed-in Account on this browser, or null. */
export function cachedTheme() {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    return raw ? normalize(JSON.parse(raw), ACCOUNT_DEFAULT) : null
  } catch {
    return null
  }
}

/** Signed out: forget the cached choice and follow the system theme with the default accent. */
export function applySignedOutTheme({ forget = false } = {}) {
  if (forget) {
    try {
      window.localStorage.removeItem(CACHE_KEY)
    } catch {
      // storage blocked: nothing was cached
    }
  }
  applyTheme(SIGNED_OUT)
}

/**
 * Before the first render (main.jsx): a signed-in page (under /projects) paints the cached choice, or
 * the Account default until the profile arrives; every other page is signed out and follows the system.
 */
export function applyInitialTheme(pathname = window.location.pathname) {
  if (pathname === '/projects' || pathname.startsWith('/projects/')) applyTheme(cachedTheme() ?? ACCOUNT_DEFAULT)
  else applyTheme(SIGNED_OUT)
}
