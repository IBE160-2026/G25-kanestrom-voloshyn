// Shared render helper: wraps components with the real i18n instance and catalogues.
// Never mock react-i18next (spine › Tests).
import { render } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n/index.js'

/** Clear saved state and return to English. setup.js runs it before every test. */
export async function resetI18n() {
  try {
    window.localStorage.clear()
  } catch {
    // a test may have blocked storage; it restores its own stubs
  }
  await i18n.changeLanguage('en')
}

export function renderWithI18n(ui, options) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>, options)
}

export { i18n }
