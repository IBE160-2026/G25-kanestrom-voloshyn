import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './PasswordInput.module.css'

// A password Text input (Login, Create account, Password reset, Change password), with two helps
// asked for by Cristoffer on 2026-11-20:
// - an eye button that shows or hides what was typed ("Show password" / "Hide password", aria-pressed);
// - "Caps Lock is on." under the field while it has focus and Caps Lock is on. It's a muted hint, not
//   an error, and the input points to it with aria-describedby.
// Every other prop (id, ref, className, autoComplete, value, onChange, readOnly, …) goes to the <input>.
export default function PasswordInput({ ref, onKeyDown, onKeyUp, onFocus, onBlur, ...props }) {
  const { t } = useTranslation()
  const hintId = useId()
  const [shown, setShown] = useState(false)
  const [capsLock, setCapsLock] = useState(false)

  function readCapsLock(event) {
    if (typeof event.getModifierState === 'function') setCapsLock(event.getModifierState('CapsLock'))
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.box}>
        <input
          {...props}
          ref={ref}
          type={shown ? 'text' : 'password'}
          aria-describedby={capsLock ? hintId : undefined}
          autoCapitalize="off"
          spellCheck={false}
          onKeyDown={(event) => {
            readCapsLock(event)
            onKeyDown?.(event)
          }}
          onKeyUp={(event) => {
            readCapsLock(event)
            onKeyUp?.(event)
          }}
          onFocus={onFocus}
          onBlur={(event) => {
            setCapsLock(false)
            onBlur?.(event)
          }}
        />
        <button
          type="button"
          className={styles.eye}
          aria-label={t(shown ? 'password.hide' : 'password.show')}
          aria-pressed={shown}
          onClick={() => setShown((value) => !value)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
            {shown && <path d="M4 4l16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
          </svg>
        </button>
      </div>
      {capsLock && (
        <p id={hintId} className={styles.capsLock}>
          {t('password.capsLock')}
        </p>
      )}
    </div>
  )
}
