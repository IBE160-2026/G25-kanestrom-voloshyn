import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { googleEnabled, signInWithGoogle } from '../auth/index.js'
import styles from './GoogleSignIn.module.css'

// The Google part of the Auth panel (DESIGN.md › Auth panel, Google button; FR-19): "Sign in with
// Google" and the "or" divider before the email form. Rendered only when /api/config reports
// `google_enabled` (AD-17), so it never appears without keys. `onFailed()` reports a sign-in that
// couldn't start; `disabled` follows the email form's busy state.
export default function GoogleSignIn({ onFailed, disabled = false }) {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    googleEnabled().then((on) => live && setEnabled(on))
    return () => {
      live = false
    }
  }, [])

  // Back from Google's consent screen through the back/forward cache: the page is restored as it
  // was left, busy, so make the button usable again.
  useEffect(() => {
    const onPageShow = (event) => {
      if (event.persisted) setBusy(false)
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

  if (!enabled) return null

  async function start() {
    if (busy) return
    setBusy(true)
    const result = await signInWithGoogle()
    // On success the browser is leaving for Google's consent screen; stay busy until it does.
    if (result.error) {
      setBusy(false)
      onFailed?.()
    }
  }

  return (
    <>
      <button
        type="button"
        className={styles.google}
        onClick={start}
        aria-busy={busy}
        disabled={busy || disabled}
      >
        {t('login.google')}
      </button>
      <p className={styles.or}>{t('login.or')}</p>
    </>
  )
}
