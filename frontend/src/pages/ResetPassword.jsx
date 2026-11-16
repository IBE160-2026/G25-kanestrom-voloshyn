import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import { completeRecovery, setNewPassword, signOut } from '../auth/index.js'
import styles from '../components/AuthForm.module.css'
import AuthLayout from '../components/AuthLayout.jsx'
import ErrorLine from '../components/ErrorLine.jsx'

const MIN_PASSWORD = 8 // FR-1; Supabase enforces the same minimum (config.toml)

// Where the emailed reset link lands: /reset-password?token_hash=… (FR-3, DESIGN.md › Password
// reset screens). Keyed by the token hash, so another link starts from a clean screen.
export default function ResetPassword() {
  const [params] = useSearchParams()
  const tokenHash = params.get('token_hash')
  return <ResetPasswordLink key={tokenHash ?? ''} tokenHash={tokenHash} />
}

// The token is verified only from JavaScript, so a mail scanner that fetches the URL can't use it
// up. Supabase refusing it (expired, used, replaced, malformed) shows the expired state; a network
// failure shows "Sign-in didn't work. Try again." and saving checks the same link again. Verifying
// signs this browser in with a recovery session: leaving before saving signs it out again. After
// saving, every other session ends (POST /api/auth/after-password-reset), this one is signed out,
// and Login shows the saved notice.
function ResetPasswordLink({ tokenHash }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const id = useId()
  const passwordRef = useRef(null)

  const [step, setStep] = useState('checking') // 'checking' | 'form' | 'expired'
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null) // { kind, attempt }
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const attempt = useRef(0)
  // Set once the new password is saved: a retry only repeats after-password-reset, so the field
  // is locked meanwhile.
  const [changed, setChanged] = useState(false)
  // Whether this page holds the recovery session: 'none', 'held' (verified, not saved yet), or
  // 'done' (saved; finish() signs out).
  const session = useRef('none')
  // Mounted right now. React StrictMode unmounts and remounts once in development, so this is read
  // when a check settles, not when it starts.
  const alive = useRef(false)

  function showError(kind) {
    // A new attempt number remounts the Error line, so a repeated message is announced again.
    attempt.current += 1
    setError({ kind, attempt: attempt.current })
  }

  function fail(kind) {
    showError(kind)
    passwordRef.current?.focus()
  }

  /** Apply a link check. Returns true when the link is verified and this page is still open. */
  function applyCheck(result) {
    if (result.ok) {
      if (!alive.current) {
        signOut() // verified after the student left: end the session at once
        return false
      }
      session.current = 'held'
      setStep('form')
      return true
    }
    setStep(result.error === 'expired' ? 'expired' : 'form')
    if (result.error !== 'expired') showError('linkFailed')
    return false
  }

  // Leaving before saving (another page, "Log in", closing the route) ends the recovery session,
  // so Login doesn't let the student into /projects without a new password.
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (session.current === 'held') {
        session.current = 'none'
        signOut()
      }
    }
  }, [])

  useEffect(() => {
    // applyCheck only sets state and refs; it is defined in the component for readability.
    completeRecovery(tokenHash).then(applyCheck)
  }, [tokenHash])

  async function finish() {
    session.current = 'done'
    await signOut()
    navigate('/', { replace: true, state: { passwordChanged: true } })
  }

  async function onSubmit(event) {
    event.preventDefault()
    if (inFlight.current) return
    if (!changed && password.length < MIN_PASSWORD) return fail('passwordTooShort')

    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      if (session.current !== 'held' && !changed) {
        // The first check of the link failed on the network: check the same link again.
        const result = await completeRecovery(tokenHash)
        if (!applyCheck(result)) return
      }
      if (!changed) {
        const result = await setNewPassword(password)
        if (result.error) return fail(result.error === 'password_too_short' ? 'passwordTooShort' : 'failed')
        setChanged(true)
      }
      try {
        await apiFetch('/api/auth/after-password-reset', { method: 'POST' })
      } catch (err) {
        // The password is changed. If the backend refused this session, it is already gone
        // (api/client.js signed out): carry on to Login. Otherwise a retry repeats only this step.
        if (!SIGNED_OUT_CODES.has(err?.code)) return fail('failed')
      }
      await finish()
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const MESSAGES = {
    passwordTooShort: 'signup.errors.passwordTooShort',
    linkFailed: 'login.errors.failed',
    failed: 'errors.generic',
  }

  return (
    <AuthLayout switchTo={{ to: '/', label: t('login.submit') }}>
      <section className={styles.panel} aria-busy={step === 'checking'} aria-labelledby={`${id}-title`}>
        {step === 'expired' ? (
          <>
            <h2 id={`${id}-title`} className={styles.title}>
              {t('reset.expired')}
            </h2>
            <Link to="/forgot-password" className={styles.primaryLink}>
              {t('reset.sendNewLink')}
            </Link>
          </>
        ) : (
          <>
            <h2 id={`${id}-title`} className={styles.title}>
              {t('reset.newPassword.title')}
            </h2>
            {step === 'form' && (
              <form onSubmit={onSubmit} noValidate>
                <div className={styles.field}>
                  <label htmlFor={`${id}-password`} className={styles.label}>
                    {t('login.password')}
                  </label>
                  <input
                    id={`${id}-password`}
                    ref={passwordRef}
                    className={styles.input}
                    type="password"
                    name="password"
                    autoComplete="new-password"
                    value={password}
                    readOnly={changed}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </div>
                {error && <ErrorLine key={error.attempt}>{t(MESSAGES[error.kind])}</ErrorLine>}
                <button type="submit" className={styles.primary} aria-busy={busy} disabled={busy}>
                  {t('reset.newPassword.submit')}
                </button>
              </form>
            )}
          </>
        )}
      </section>
    </AuthLayout>
  )
}
