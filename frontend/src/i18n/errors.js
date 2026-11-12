// Render an API error from its code and params in the active language (AD-26).
// The server's `message` is a developer fallback and is never shown.
import i18n from './index.js'

const CODE = /^[a-z0-9_]+$/

/** Accepts the error object `{code, params}` or the whole envelope `{error: {...}}`. */
export function errorText(t, error) {
  const err = error?.error ?? error
  const code = typeof err?.code === 'string' ? err.code : ''
  const key = `errors.${code}`
  if (CODE.test(code) && i18n.exists(key)) return t(key, err.params ?? {})
  return t('errors.generic')
}
