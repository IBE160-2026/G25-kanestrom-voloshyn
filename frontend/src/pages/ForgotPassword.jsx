import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiFetch } from '../api/client.js'
import { isEmail } from '../auth/email.js'
import styles from '../components/AuthForm.module.css'
import AuthLayout from '../components/AuthLayout.jsx'
import ErrorLine from '../components/ErrorLine.jsx'
import { errorText } from '../i18n/errors.js'

// Password reset, request step (FR-3, DESIGN.md › Password reset screens). POST
// /api/auth/password-reset answers the same whether or not the email has an Account, so the
// screen always shows the same "sent" text in place of the form.
export default function ForgotPassword() {
  const { t, i18n } = useTranslation()
  const id = useId()
  const emailRef = useRef(null)

  const [email, setEmail] = useState('')
  const [error, setError] = useState(null) // { kind, apiError?, attempt }
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const inFlight = useRef(false)
  const attempt = useRef(0)

  function fail(kind, apiError) {
    // A new attempt number remounts the Error line, so a repeated message is announced again.
    attempt.current += 1
    setError({ kind, apiError, attempt: attempt.current })
    emailRef.current?.focus()
  }

  async function onSubmit(event) {
    event.preventDefault()
    if (inFlight.current) return
    const address = email.trim()
    if (!address) return fail('emailRequired')
    if (!isEmail(address)) return fail('emailInvalid')

    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/api/auth/password-reset', {
        method: 'POST',
        auth: false,
        body: { email: address, language: i18n.resolvedLanguage },
      })
      setSent(true)
    } catch (err) {
      fail('api', err)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const message = error && (error.kind === 'api' ? errorText(t, error.apiError) : t(`signup.errors.${error.kind}`))

  return (
    <AuthLayout switchTo={{ to: '/', label: t('login.submit') }}>
      <section className={styles.panel} aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`} className={styles.title}>
          {t('reset.request.title')}
        </h2>
        {/* Mounted empty, so the text is announced when it replaces the form. */}
        <p role="status" className={sent ? styles.muted : undefined}>
          {sent ? t('reset.request.sent') : null}
        </p>
        {!sent && (
          <form onSubmit={onSubmit} noValidate>
            <div className={styles.field}>
              <label htmlFor={`${id}-email`} className={styles.label}>
                {t('login.email')}
              </label>
              <input
                id={`${id}-email`}
                ref={emailRef}
                className={styles.input}
                type="email"
                name="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            {error && <ErrorLine key={error.attempt}>{message}</ErrorLine>}
            <button type="submit" className={styles.primary} aria-busy={busy} disabled={busy}>
              {t('reset.request.submit')}
            </button>
          </form>
        )}
      </section>
    </AuthLayout>
  )
}
