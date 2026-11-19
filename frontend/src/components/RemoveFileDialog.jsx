import { Dialog } from 'radix-ui'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SIGNED_OUT_CODES } from '../api/client.js'
import { errorText } from '../i18n/errors.js'
import InlineError from './InlineError.jsx'
import styles from './RemoveFileDialog.module.css'

// Remove file dialog (FR-20, AD-23; EXPERIENCE.md › Remove file dialog; DESIGN.md › Remove file dialog,
// Modal dialog, Button (danger)). Opened from a file row's "···" menu. Title names the file; the body
// says what stays, or for a Reading… file the short "Reading stops…" sentence. Focus starts on Cancel;
// Esc or Cancel closes it with nothing removed and focus back on the opener. While removing, both
// buttons are disabled; a failure keeps it open with the Inline error and "Try again", except a
// read-only Project (its message, no "Try again": retrying can't help) and a signed-out session (the
// app handles it). `onRemove` resolves for `not_found`, so a file already gone just closes the dialog.
// When the file has outstanding Mistakes (`mistakeCount` > 0), the unchecked checkbox "Also remove its
// mistakes from my review" shows; checked, the removal also withdraws them (Story 3.3, FR-20). It starts
// unchecked each time the dialog opens.
//
// `material`: the live file, or null (closed: also when the file leaves the list).
// `onRemove(material, { withdrawMistakes })` returns a promise; `onClose()` is called on Cancel or Esc.
// `returnFocus`: the element focus goes back to when nothing was removed (the row's "···" trigger).
export default function RemoveFileDialog({ material, onRemove, onClose, returnFocus = null, mistakeCount = 0 }) {
  const { t } = useTranslation()
  const checkboxId = useId()
  const [busy, setBusy] = useState(false)
  const [withdraw, setWithdraw] = useState(false)
  const offerWithdraw = mistakeCount > 0
  const [failed, setFailed] = useState(null) // { retry: boolean, error }
  const cancel = useRef(null)
  const content = useRef(null)
  const opener = useRef(null)
  const open = material !== null
  const file = material

  // "Try again" takes focus after a failure (EXPERIENCE.md › Inline error).
  useEffect(() => {
    if (failed?.retry) content.current?.querySelector('[role="alert"] button')?.focus()
  }, [failed])

  async function remove() {
    if (busy || !material) return
    setBusy(true)
    setFailed(null)
    try {
      // On success the row leaves the list, which closes the dialog (the caller moves focus).
      await onRemove(material, { withdrawMistakes: offerWithdraw && withdraw })
    } catch (error) {
      if (!SIGNED_OUT_CODES.has(error?.code)) {
        setFailed({ retry: error?.code !== 'project_read_only', error })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => {
        if (next || busy) return
        setFailed(null)
        onClose()
      }}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.scrim} />
        <Dialog.Content
          ref={content}
          className={styles.dialog}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            opener.current = returnFocus ?? document.activeElement
            setFailed(null)
            setWithdraw(false)
            event.preventDefault()
            cancel.current?.focus()
          }}
          // Focus returns to the "···" trigger that opened the menu. After a removal the trigger is gone
          // with its row, and the caller has moved focus.
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (opener.current instanceof HTMLElement && opener.current.isConnected) {
              opener.current.focus()
            }
          }}
        >
          <Dialog.Title className={styles.title}>{t('files.remove.title', { name: file?.file_name })}</Dialog.Title>
          <p className={styles.body}>
            {file?.status === 'processing' ? t('files.remove.reading') : t('files.remove.body')}
          </p>
          {offerWithdraw && (
            <div className={styles.check}>
              <input
                id={checkboxId}
                type="checkbox"
                className={styles.checkbox}
                checked={withdraw}
                disabled={busy}
                onChange={(event) => setWithdraw(event.target.checked)}
              />
              <label htmlFor={checkboxId}>{t('files.remove.withdrawMistakes')}</label>
            </div>
          )}
          {failed?.retry && <InlineError onRetry={remove}>{t('files.remove.failed')}</InlineError>}
          {failed && !failed.retry && <InlineError>{errorText(t, failed.error)}</InlineError>}
          <div className={styles.actions}>
            <Dialog.Close asChild>
              <button ref={cancel} type="button" className={styles.ghost} disabled={busy}>
                {t('files.remove.cancel')}
              </button>
            </Dialog.Close>
            <button type="button" className={styles.danger} disabled={busy} aria-busy={busy} onClick={remove}>
              {t('files.remove.confirm')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
