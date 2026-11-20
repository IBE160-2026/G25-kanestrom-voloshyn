import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import { setNewPassword } from '../auth/index.js'
import ErrorLine from '../components/ErrorLine.jsx'
import { errorText } from '../i18n/errors.js'
import styles from './Settings.module.css'

const MIN_PASSWORD = 8 // FR-1; Supabase enforces the same minimum (config.toml)

// Settings › Change password (FR-27, Story 7.3a): for an Account with an email identity; never
// disabled, verified or not. The form asks for the current password and the new one twice. The client
// checks the length and that both copies match; the server checks the current password
// (POST /api/me/password/check); then the browser sets the new one with supabase-js `updateUser`, so the
// student stays signed in. Success clears the fields, closes the form, and says "Your password is
// changed." Passwords are never stored or logged.
export default function ChangePassword() {
  const { t } = useTranslation()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState(null) // { text, attempt }
  const [busy, setBusy] = useState(false)
  const [changed, setChanged] = useState(false)
  const attempt = useRef(0)
  const inFlight = useRef(false)
  const opener = useRef(null)
  const currentRef = useRef(null)
  const nextRef = useRef(null)
  const repeatRef = useRef(null)

  function fail(text, field) {
    // A new attempt number remounts the Error line, so a repeated message is announced again.
    attempt.current += 1
    setError({ text, attempt: attempt.current })
    field?.current?.focus()
  }

  function reset() {
    setCurrent('')
    setNext('')
    setRepeat('')
    setError(null)
  }

  function close() {
    reset()
    setOpen(false)
    // The opener mounts again with the next render.
    setTimeout(() => opener.current?.focus(), 0)
  }

  async function onSubmit(event) {
    event.preventDefault()
    if (inFlight.current) return
    if (!current) return fail(t('settings.password.currentRequired'), currentRef)
    if (next.length < MIN_PASSWORD) return fail(t('signup.errors.passwordTooShort'), nextRef)
    if (next === current) return fail(t('settings.password.samePassword'), nextRef)
    if (next !== repeat) return fail(t('settings.password.mismatch'), repeatRef)

    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      try {
        await apiFetch('/api/me/password/check', { method: 'POST', body: { current_password: current } })
      } catch (err) {
        // A signed-out session is the app's: api/client.js takes the student to Login.
        if (SIGNED_OUT_CODES.has(err?.code)) return
        return fail(errorText(t, err), err?.code === 'wrong_password' ? currentRef : null)
      }
      const result = await setNewPassword(next)
      if (result.error) {
        const message = {
          password_too_short: 'signup.errors.passwordTooShort',
          same_password: 'settings.password.samePassword',
        }[result.error]
        return fail(t(message ?? 'errors.generic'), nextRef)
      }
      setChanged(true)
      close()
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <div className={styles.row}>
      {/* Mounted empty, so the confirmation is announced when it arrives. */}
      <p role="status" className={styles.status}>
        {changed && t('settings.password.changed')}
      </p>
      {!open ? (
        <button
          ref={opener}
          type="button"
          className={styles.ghost}
          onClick={() => {
            setChanged(false)
            setOpen(true)
            setTimeout(() => currentRef.current?.focus(), 0)
          }}
        >
          {t('settings.password.open')}
        </button>
      ) : (
        <form className={styles.passwordForm} onSubmit={onSubmit} noValidate aria-label={t('settings.password.open')}>
          <div className={styles.field}>
            <label htmlFor={`${id}-current`} className={styles.label}>
              {t('settings.password.current')}
            </label>
            <input
              id={`${id}-current`}
              ref={currentRef}
              className={styles.input}
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor={`${id}-new`} className={styles.label}>
              {t('settings.password.new')}
            </label>
            <input
              id={`${id}-new`}
              ref={nextRef}
              className={styles.input}
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor={`${id}-repeat`} className={styles.label}>
              {t('settings.password.repeat')}
            </label>
            <input
              id={`${id}-repeat`}
              ref={repeatRef}
              className={styles.input}
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
            />
          </div>
          {error && <ErrorLine key={error.attempt}>{error.text}</ErrorLine>}
          <div className={styles.actions}>
            <button type="button" className={styles.ghost} disabled={busy} onClick={close}>
              {t('settings.password.cancel')}
            </button>
            <button type="submit" className={styles.primary} disabled={busy} aria-busy={busy}>
              {t('settings.password.save')}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
