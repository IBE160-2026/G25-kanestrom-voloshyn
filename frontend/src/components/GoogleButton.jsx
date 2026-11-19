import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isGoogleEnabled, signInWithGoogle } from '../auth/index.js'
import styles from './GoogleButton.module.css'

// Google button and "or" divider (DESIGN.md › Auth panel, Google button; FR-19) at the top of the
// Login and Create account panels. Shown only when /api/config says Google is configured, so the
// rest of the form works the same without it. The browser leaves for Google's consent screen;
// `onFail()` is called when sign-in can't start, so the page shows its Error line.
export default function GoogleButton({ onFail }) {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)

  // Back from Google's page can restore this page from the back/forward cache, still busy.
  useEffect(() => {
    const onPageShow = (event) => {
      if (!event.persisted) return
      inFlight.current = false
      setBusy(false)
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

  useEffect(() => {
    let live = true
    isGoogleEnabled()
      .then((on) => live && setEnabled(on === true))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  async function onClick() {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    const result = await signInWithGoogle()
    if (result?.error) {
      inFlight.current = false
      setBusy(false)
      onFail?.()
    }
    // On success the browser is on its way to Google; the button stays busy.
  }

  if (!enabled) return null
  return (
    <>
      <button type="button" className={styles.button} aria-busy={busy} disabled={busy} onClick={onClick}>
        {t('login.google')}
      </button>
      <p className={styles.or}>{t('login.or')}</p>
    </>
  )
}
