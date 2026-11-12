import { useId, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { apiFetch } from '../api/client.js'
import { signUp } from '../auth/index.js'
import AuthLayout from '../components/AuthLayout.jsx'
import ErrorLine from '../components/ErrorLine.jsx'
import { errorText } from '../i18n/errors.js'
import styles from './CreateAccount.module.css'

const MIN_PASSWORD = 8 // FR-1; Supabase enforces the same minimum (config.toml)
const MAX_FIRST_NAME = 100 // the API's limit for first_name
// A light check before Supabase sees the address: something@something, no spaces.
const EMAIL = /^[^\s@]+@[^\s@]+$/

// Create account screen (FR-1, DESIGN.md › Create account screen). Signs up through supabase-js,
// then tells the backend the first name and language (POST /api/auth/after-sign-in, AD-19).
// The Google button arrives with Story 1.6.
export default function CreateAccount() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const id = useId()
  const refs = { firstName: useRef(null), email: useRef(null), password: useRef(null) }

  const [firstName, setFirstName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null) // { kind, apiError?, attempt }
  const [busy, setBusy] = useState(false)
  // Guards a double submit before React re-renders with busy=true.
  const inFlight = useRef(false)
  const attempt = useRef(0)
  // Set once the Account exists: a retry after a failed after-sign-in only repeats that call,
  // so the email and password are locked (read-only) from then on.
  const [signedUp, setSignedUp] = useState(false)

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
    if (!EMAIL.test(address)) return fail('emailInvalid', 'email')
    if (password.length < MIN_PASSWORD) return fail('passwordTooShort', 'password')

    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      if (!signedUp) {
        const result = await signUp({ email: address, password })
        if (result.error === 'duplicate') return fail('duplicate', 'email')
        if (result.error === 'password_too_short') return fail('passwordTooShort', 'password')
        if (result.error) return fail('api', 'firstName')
        setSignedUp(true)
      }
      await apiFetch('/api/auth/after-sign-in', {
        method: 'POST',
        body: { first_name: name, language: i18n.resolvedLanguage },
      })
      navigate('/projects')
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

  const field = (name, type, autoComplete, value, setValue, extra = {}) => (
    <div className={styles.field}>
      <label htmlFor={`${id}-${name}`} className={styles.label}>
        {t(`signup.${name}`)}
      </label>
      <input
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

  return (
    <AuthLayout switchTo={{ to: '/', label: t('signup.logIn') }}>
      <form className={styles.panel} aria-label={t('signup.submit')} onSubmit={onSubmit} noValidate>
        {field('firstName', 'text', 'given-name', firstName, setFirstName, { maxLength: MAX_FIRST_NAME })}
        {field('email', 'email', 'email', email, setEmail, { readOnly: signedUp })}
        {field('password', 'password', 'new-password', password, setPassword, { readOnly: signedUp })}
        {error && <ErrorLine key={error.attempt}>{errorMessage()}</ErrorLine>}
        <button type="submit" className={styles.primary} aria-busy={busy} disabled={busy}>
          {t('signup.submit')}
        </button>
      </form>
    </AuthLayout>
  )
}
