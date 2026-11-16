import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import { hasSession, signIn } from '../auth/index.js'
import { takeRememberedRoute } from '../auth/returnTo.js'
import panel from '../components/AuthForm.module.css'
import AuthLayout from '../components/AuthLayout.jsx'
import ErrorLine from '../components/ErrorLine.jsx'
import { LANGUAGES, setLanguage } from '../i18n/index.js'
import styles from './Login.module.css'

const HOME = '/projects' // until Epic 2 lands on the last Project

// Login screen (FR-2, DESIGN.md › Login screen): email and password through supabase-js, then
// POST /api/auth/after-sign-in, whose profile carries the Account's language (FR-29). Every
// refusal shows one message that never says whether the email exists. After the session ended
// mid-use, it shows the signed-out notice and returns to the remembered route.
// "Forgot password?" arrives with Story 1.5, the Google button with Story 1.6.
export default function Login() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const id = useId()
  const refs = { email: useRef(null), password: useRef(null) }

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null) // { kind: 'credentials' | 'failed', attempt }
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(false)
  const inFlight = useRef(false)
  const attempt = useRef(0)
  // Set once signIn succeeded but after-sign-in did not: a retry only repeats after-sign-in, so
  // the email and password are locked (read-only) meanwhile.
  const [signedIn, setSignedIn] = useState(false)
  const sessionExpired = location.state?.sessionExpired === true

  // Still signed in (sessions last 30 days): go straight in. A refused session has been signed
  // out locally before it comes back here, so this cannot loop.
  useEffect(() => {
    const run = { live: true }
    hasSession()
      .then((has) => {
        if (run.live && has && !inFlight.current) navigate(takeRememberedRoute() ?? HOME, { replace: true })
      })
      .catch(() => {})
    return () => {
      run.live = false
    }
  }, [navigate])

  // The signed-out notice: its live region is mounted empty and the text is added after mount, so
  // it is announced. The history state is then cleared, so a reload doesn't show it again.
  useEffect(() => {
    if (!sessionExpired) return
    const timer = setTimeout(() => {
      setNotice(true)
      navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
    }, 0)
    return () => clearTimeout(timer)
  },[sessionExpired, location.pathname, location.search, navigate])

  function fail(kind, field) {
    // A new attempt number remounts the Error line, so a repeated message is announced again.
    attempt.current += 1
    setError({ kind, attempt: attempt.current })
    refs[field]?.current?.focus()
  }

  async function onSubmit(event) {
    event.preventDefault()
    if (inFlight.current) return
    const address = email.trim()
    // Blank fields fail like any other refusal, without a request.
    if (!address) return fail('credentials', 'email')
    if (!password) return fail('credentials', 'password')

    inFlight.current = true
    setBusy(true)
    setError(null)
    setNotice(false)
    try {
      if (!signedIn) {
        const result = await signIn({ email: address, password })
        if (result.error) return fail(result.error === 'credentials' ? 'credentials' : 'failed', 'password')
        setSignedIn(true)
      }
      try {
        const profile = await apiFetch('/api/auth/after-sign-in', {
          method: 'POST',
          body: { language: i18n.resolvedLanguage },
        })
        // The Account's language wins over this browser's (it follows the student, FR-29).
        if (LANGUAGES.includes(profile?.language)) await setLanguage(profile.language)
      } catch (err) {
        // The session is kept (an auth outage never signs out, AD-2); a retry repeats only this
        // step. If the backend refused the session, api/client.js has signed out: log in again.
        if (SIGNED_OUT_CODES.has(err?.code)) setSignedIn(false)
        return fail('failed', 'password')
      }
      navigate(takeRememberedRoute() ?? HOME, { replace: true })
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const field = (name, type, autoComplete, value, setValue) => (
    <div className={panel.field}>
      <label htmlFor={`${id}-${name}`} className={panel.label}>
        {t(`login.${name}`)}
      </label>
      <input
        id={`${id}-${name}`}
        ref={refs[name]}
        className={panel.input}
        type={type}
        name={name}
        autoComplete={autoComplete}
        value={value}
        readOnly={signedIn}
        onChange={(event) => setValue(event.target.value)}
      />
    </div>
  )

  const showNotice = notice && !error
  return (
    <AuthLayout switchTo={{ to: '/signup', label: t('login.createAccount') }}>
      <form className={panel.panel} aria-label={t('login.submit')} onSubmit={onSubmit} noValidate>
        <p role="status" className={showNotice ? styles.notice : undefined}>
          {showNotice ? t('session.expired') : null}
        </p>
        {field('email', 'email', 'email', email, setEmail)}
        {field('password', 'password', 'current-password', password, setPassword)}
        {error && <ErrorLine key={error.attempt}>{t(`login.errors.${error.kind}`)}</ErrorLine>}
        <button type="submit" className={panel.primary} aria-busy={busy} disabled={busy}>
          {t('login.submit')}
        </button>
      </form>
    </AuthLayout>
  )
}
