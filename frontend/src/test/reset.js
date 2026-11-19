// Per-test reset, run by setup.js. Kept apart from render.jsx so the setup file never loads the
// routes (and through them api/client.js and auth/) before a test file's vi.mock calls apply.
import { resetTakeoverNotice } from '../components/takeoverNotice.js'
import i18n from '../i18n/index.js'

/** Clear saved state (language, return route) and return to English. */
export async function resetI18n() {
  try {
    window.localStorage.clear()
    window.sessionStorage.clear()
  } catch {
    // a test may have blocked storage; it restores its own stubs
  }
  resetTakeoverNotice()
  await i18n.changeLanguage('en')
}
