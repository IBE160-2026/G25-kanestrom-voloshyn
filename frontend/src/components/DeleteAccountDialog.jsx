import { Dialog } from 'radix-ui'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SIGNED_OUT_CODES } from '../api/client.js'
import { errorText } from '../i18n/errors.js'
import InlineError from './InlineError.jsx'
import own from './DeleteAccountDialog.module.css'
import styles from './DeleteProjectDialog.module.css'
import purge from './PurgeProjectDialog.module.css'

// Confirm dialog (delete account) (FR-28, Story 7.4; EXPERIENCE.md › Strings; DESIGN.md › Confirm dialog
// (delete account)). Opened from Settings › Your data. What is lost sits in an inset box (the purge
// dialog's), then a bold "This can't be undone.", then a Text input: the final Button (danger) stays
// disabled until the typed word, trimmed, is exactly DELETE (SLETT in Norwegian, following the interface
// language). Focus starts in the input; Esc or Cancel closes it with nothing changed and focus back on
// the opener. While deleting, everything is disabled; a failure keeps it open with the error line (a
// signed-out session is the app's). On success the caller leaves the page (Login), so it isn't closed.
//
// `open`: whether it shows. `onDelete()` returns a promise that rejects on failure; `onClose()` is
// called on Cancel or Esc.
export default function DeleteAccountDialog({ open, onDelete, onClose }) {
  const { t } = useTranslation()
  const id = useId()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(null)
  const input = useRef(null)
  const opener = useRef(null)
  const word = t('settings.deleteAccountDialog.word')
  const matches = typed.trim() === word

  async function confirm() {
    if (busy || !matches) return
    setBusy(true)
    setFailed(null)
    try {
      await onDelete()
    } catch (error) {
      if (!SIGNED_OUT_CODES.has(error?.code)) setFailed(error)
      setBusy(false)
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next || busy) return
        onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.scrim} />
        <Dialog.Content
          className={styles.dialog}
          onOpenAutoFocus={(event) => {
            opener.current = document.activeElement
            setTyped('')
            setFailed(null)
            event.preventDefault()
            input.current?.focus()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus()
          }}
        >
          <Dialog.Title className={styles.title}>{t('settings.deleteAccountDialog.title')}</Dialog.Title>
          <Dialog.Description asChild>
            <div className={purge.description}>
              <p className={purge.losses}>{t('settings.deleteAccountDialog.lost')}</p>
              <p className={purge.final}>{t('settings.deleteAccountDialog.final')}</p>
            </div>
          </Dialog.Description>
          <form
            className={own.form}
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              confirm()
            }}
          >
            <div>
              <label htmlFor={`${id}-word`} className={own.label}>
                {t('settings.deleteAccountDialog.label', { word })}
              </label>
              <input
                id={`${id}-word`}
                ref={input}
                className={own.input}
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                value={typed}
                readOnly={busy}
                onChange={(event) => setTyped(event.target.value)}
              />
            </div>
            {failed && <InlineError>{errorText(t, failed)}</InlineError>}
            <div className={styles.actions}>
              <Dialog.Close asChild>
                <button type="button" className={styles.ghost} disabled={busy}>
                  {t('settings.deleteAccountDialog.cancel')}
                </button>
              </Dialog.Close>
              <button
                type="submit"
                className={`${purge.danger} ${matches ? '' : own.notYet}`}
                disabled={busy || !matches}
                aria-busy={busy}
              >
                {t('settings.deleteAccountDialog.confirm')}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
