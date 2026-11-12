// Per-test reset, run by setup.js. Kept apart from render.jsx so the setup file never loads the
// routes (and through them api/client.js and auth/) before a test file's vi.mock calls apply.
import i18n from '../i18n/index.js'

/** Clear saved state and return to English. */
export async function resetI18n() {
  try {
    window.localStorage.clear()
  } catch {
    // a test may have blocked storage; it restores its own stubs
  }
  await i18n.changeLanguage('en')
}
