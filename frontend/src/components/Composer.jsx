import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './Composer.module.css'

// Limit notice (DESIGN.md › Limit notice): shown under the composer at 10 or fewer messages left today.
export const MESSAGE_NOTICE_AT = 10

// Composer (Story 4.4; DESIGN.md › Composer; EXPERIENCE.md › Composer): a surface box with the text
// field ("Ask about your material") and a primary Send inside. Enter sends and Shift+Enter starts a new
// line. The composer is off while `disabled` (no Ready file, or read-only) and while `busy` (an answer is
// pending or streaming); once the answer ends, focus returns to the field. An empty field turns off only
// Send and Enter. Below it, the Limit notice: "{n} messages left today" with a small muted dot, and at 0
// the error-coloured "You've used today's 50 messages…" instead. It is a plain line, not a live region,
// so only the answer is announced when it completes.
export default function Composer({ value, onChange, onSend, disabled, busy, left }) {
  const { t } = useTranslation()
  const out = left === 0
  const off = disabled || busy
  const canSend = !off && !out && value.trim() !== ''
  const field = useRef(null)
  const wasBusy = useRef(false)
  useEffect(() => {
    if (wasBusy.current && !busy && !disabled) field.current?.focus()
    wasBusy.current = busy
  }, [busy, disabled])
  const submit = () => {
    if (canSend) onSend(value)
  }
  return (
    <div className={styles.wrap}>
      <form
        className={`${styles.composer} ${off ? styles.off : ''}`}
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <textarea
          ref={field}
          className={styles.field}
          rows={1}
          value={value}
          placeholder={t('chat.placeholder')}
          aria-label={t('chat.placeholder')}
          disabled={off}
          maxLength={2000}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <button type="submit" className={styles.send} disabled={!canSend}>
          {t('chat.send')}
        </button>
      </form>
      {!disabled && left !== null && left <= MESSAGE_NOTICE_AT && (
        <p className={`${styles.limit} ${out ? styles.limitOut : ''}`} data-testid="limit-notice">
          <span className={styles.limitDot} aria-hidden="true" />
          {out ? t('chat.limitReached') : t('limits.messagesLeft', { count: left })}
        </p>
      )}
    </div>
  )
}
