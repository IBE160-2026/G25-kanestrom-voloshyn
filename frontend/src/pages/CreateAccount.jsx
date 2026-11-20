import { useEffect, useId, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { apiFetch } from '../api/client.js'
import { isEmail } from '../auth/email.js'
import { hasSession, signUp } from '../auth/index.js'
import AuthLayout from '../components/AuthLayout.jsx'
import ErrorLine from '../components/ErrorLine.jsx'
import PasswordInput from '../components/PasswordInput.jsx'
import { errorText } from '../i18n/errors.js'
import styles from '../components/AuthForm.module.css'

const MIN_PASSWORD = 8 // FR-1; Supabase enforces the same minimum (config.toml)
const MAX_FIRST_NAME = 100 // the API's limit for first_name

// Create account screen (FR-1, DESIGN.md › Create account screen). Signs up through supabase-js,
// then tells the backend the first name and language (POST /api/auth/after-sign-in, AD-19).
// "Sign in with Google" (FR-19) is on Login only, not here: this screen is for creating an email Account
// (Cristoffer, 2026-11-20). The password is typed twice, and both must match (Cristoffer,
// 2026-11-20); both fields have the eye and the Caps Lock hint (PasswordInput).
export default function CreateAccount() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const id = useId()
  const refs = { firstName: useRef(null), email: useRef(null), password: useRef(null), repeatPassword: useRef(null) }

  const [firstName, setFirstName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [error, setError] = useState(null) // { kind, apiError?, attempt }
  const [busy, setBusy] = useState(false)
  // Guards a double submit before React re-renders with busy=true.
  const inFlight = useRef(false)
  const attempt = useRef(0)
  // Set once the Account exists: a retry after a failed after-sign-in only repeats that call,
  // so the email and password are locked (read-only) from then on.
  const [signedUp, setSignedUp] = useState(false)

  // Already signed in (for example Back after a sign-up): go straight in, as Login does, so a
  // second submit can't create another Account and replace the session.
  useEffect(() => {
    const run = { live: true }
    hasSession()
      .then((has) => {
        if (run.live && has && !inFlight.current) navigate('/projects', { replace: true })
      })
      .catch(() => {})
    return () => {
      run.live = false
    }
  }, [navigate])

  function fail(kind, field, apiError) {
    // A new attempt number remounts the Error line, so a repeated message is announced again.
    attempt.current += 1
    setError({ kind, apiError, attempt: attempt.current })
    refs[field]?.current?.focus()
  }

  async function onSubmit(event) {
    event.preventDefault()
    if (inFlight.current) return
    const name = firstName.trim()
    const address = email.trim()
    if (!name) return fail('firstNameRequired', 'firstName')
    if (!address) return fail('emailRequired', 'email')
    if (!isEmail(address)) return fail('emailInvalid', 'email')
    if (password.length < MIN_PASSWORD) return fail('passwordTooShort', 'password')
    if (repeatPassword !== password) return fail('passwordMismatch', 'repeatPassword')

    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      if (!signedUp) {
        const result = await signUp({ email: address, password })
        if (result.error === 'duplicate') return fail('duplicate', 'email')
        if (result.error === 'email_invalid') return fail('emailInvalid', 'email')
        if (result.error === 'password_too_short') return fail('passwordTooShort', 'password')
        if (result.error) return fail('api', 'firstName')
        setSignedUp(true)
      }
      await apiFetch('/api/auth/after-sign-in', {
        method: 'POST',
        body: { first_name: name, language: i18n.resolvedLanguage },
      })
      // Replace: Back from Projects must not return to the filled-in form.
      navigate('/projects', { replace: true })
    } catch (err) {
      fail('api', 'firstName', err)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  function errorMessage() {
    if (!error) return null
    if (error.kind === 'duplicate') {
      return <Trans i18nKey="signup.errors.duplicate" components={{ login: <Link to="/" /> }} />
    }
    if (error.kind === 'api') return errorText(t, error.apiError)
    return t(`signup.errors.${error.kind}`)
  }

  const field = (name, type, autoComplete, value, setValue, extra = {}) => {
    const Input = type === 'password' ? PasswordInput : 'input'
    return (
    <div className={styles.field}>
      <label htmlFor={`${id}-${name}`} className={styles.label}>
        {t(`signup.${name}`)}
      </label>
      <Input
        id={`${id}-${name}`}
        ref={refs[name]}
        className={styles.input}
        type={type}
        name={name}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        {...extra}
      />
    </div>
    )
  }

  return (
    <AuthLayout switchTo={{ to: '/', label: t('signup.logIn') }}>
      <form className={styles.panel} aria-label={t('signup.submit')} onSubmit={onSubmit} noValidate>
        {field('firstName', 'text', 'given-name', firstName, setFirstName, { maxLength: MAX_FIRST_NAME })}
        {field('email', 'email', 'email', email, setEmail, { readOnly: signedUp })}
        {field('password', 'password', 'new-password', password, setPassword, { readOnly: signedUp })}
        {field('repeatPassword', 'password', 'new-password', repeatPassword, setRepeatPassword, { readOnly: signedUp })}
        {error && <ErrorLine key={error.attempt}>{errorMessage()}</ErrorLine>}
        <button type="submit" className={styles.primary} aria-busy={busy} disabled={busy}>
          {t('signup.submit')}
        </button>
      </form>
    </AuthLayout>
  )
}
