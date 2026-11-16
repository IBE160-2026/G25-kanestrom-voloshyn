import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate } from 'react-router'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import { hasSession, signIn } from '../auth/index.js'
import { takeRememberedRoute } from '../auth/returnTo.js'
import panel from '../components/AuthForm.module.css'
import AuthLayout from '../components/AuthLayout.jsx'
import ErrorLine from '../components/ErrorLine.jsx'
import { LANGUAGES, setLanguage } from '../i18n/index.js'
import styles from './Login.module.css'

// The Projects page; it forwards to the last opened Project when there is one (FR-8).
const HOME = '/projects'

// Login screen (FR-2, DESIGN.md › Login screen): email and password through supabase-js, then
// POST /api/auth/after-sign-in, whose profile carries the Account's language (FR-29). Every
// refusal shows one message that never says whether the email exists. After the session ended
// mid-use, it shows the signed-out notice and returns to the remembered route; after a password
// reset, the password-changed notice. "Forgot password?" leads to the reset request (FR-3).
// The Google button arrives with Story 1.6.
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
  const [notice, setNotice] = useState(null) // the catalogue key of the notice shown, or null
  const inFlight = useRef(false)
  const attempt = useRef(0)
  // Set once signIn succeeded but after-sign-in did not: a retry only repeats after-sign-in, so
  // the email and password are locked (read-only) meanwhile.
  const [signedIn, setSignedIn] = useState(false)
  // A notice handed over by navigation: the session ended mid-use, or the password was reset.
  const noticeKey =
    location.state?.passwordChanged === true
      ? 'reset.saved'
      : location.state?.sessionExpired === true
        ? 'session.expired'
        : null

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

  // The notice: its live region is mounted empty and the text is added after mount, so it is
  // announced. The history state is then cleared, so a reload doesn't show it again.
  useEffect(() => {
    if (!noticeKey) return
    const timer = setTimeout(() => {
      setNotice(noticeKey)
      navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
    }, 0)
    return () => clearTimeout(timer)
  }, [noticeKey, location.pathname, location.search, navigate])

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
    setNotice(null)
    try {
      if (!signedIn) {
        const result = await signIn({ email: address, password })
        if (result.error) return fail(result.error === 'credentials' ? 'credentials' : 'failed', 'password')
        setSignedIn(true)
      }
      let landing = HOME
      try {
        const profile = await apiFetch('/api/auth/after-sign-in', {
          method: 'POST',
          body: { language: i18n.resolvedLanguage },
        })
        // The Account's language wins over this browser's (it follows the student, FR-29).
        if (LANGUAGES.includes(profile?.language)) await setLanguage(profile.language)
        // Land on the last opened active Project (FR-8); a remembered route still wins.
        if (typeof profile?.last_project_id === 'string') landing = `/projects/${profile.last_project_id}`
      } catch (err) {
        // The session is kept (an auth outage never signs out, AD-2); a retry repeats only this
        // step. If the backend refused the session, api/client.js has signed out: log in again.
        if (SIGNED_OUT_CODES.has(err?.code)) setSignedIn(false)
        return fail('failed', 'password')
      }
      navigate(takeRememberedRoute() ?? landing, { replace: true })
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  // `aside` (the "Forgot password?" link) sits after the input, so Tab goes from the email to the
  // password first; the grid shows it on the label's line, as in the mock.
  const field = (name, type, autoComplete, value, setValue, aside = null) => (
    <div className={`${panel.field} ${styles.field}`}>
      <label htmlFor={`${id}-${name}`} className={`${panel.label} ${styles.label}`}>
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
      {aside}
    </div>
  )

  const showNotice = notice && !error
  return (
    <AuthLayout switchTo={{ to: '/signup', label: t('login.createAccount') }}>
      <form className={panel.panel} aria-label={t('login.submit')} onSubmit={onSubmit} noValidate>
        <p role="status" className={showNotice ? styles.notice : undefined}>
          {showNotice ? t(notice) : null}
        </p>
        {field('email', 'email', 'email', email, setEmail)}
        {field(
          'password',
          'password',
          'current-password',
          password,
          setPassword,
          <Link to="/forgot-password" className={styles.inlineLink}>
            {t('login.forgotPassword')}
          </Link>,
        )}
        {error && <ErrorLine key={error.attempt}>{t(`login.errors.${error.kind}`)}</ErrorLine>}
        <button type="submit" className={panel.primary} aria-busy={busy} disabled={busy}>
          {t('login.submit')}
        </button>
      </form>
    </AuthLayout>
  )
}
