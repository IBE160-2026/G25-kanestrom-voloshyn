import { Dialog } from 'radix-ui'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SIGNED_OUT_CODES } from '../api/client.js'
import { errorText } from '../i18n/errors.js'
import InlineError from './InlineError.jsx'
import styles from './DeleteProjectDialog.module.css'
import own from './PurgeProjectDialog.module.css'

// Confirm dialog (delete forever) (FR-24, Story 7.2b; EXPERIENCE.md › Strings; DESIGN.md › Confirm
// dialog (delete forever)). Opened from "Delete forever" in a deleted row's "···" menu or the Deleted
// banner. The title names the Project; what is lost sits in an inset box, then a bold "This can't be
// undone." The
// final button is Button (danger), with no typing. Focus starts on Cancel; Esc or Cancel closes it
// with nothing changed and focus back on the opener. While deleting, both buttons are disabled; a
// failure keeps it open with the error line (a signed-out session is the app's).
//
// `project`: the Project to delete forever, or null (closed). `onPurge(project)` returns a promise that
// rejects on failure; `onClose()` is called on Cancel or Esc, and after a purge.
// `returnFocus`: the element focus goes back to when nothing was deleted (the row's "···" trigger).
// `onFocusLost()`: called when that element is gone after the dialog closes (the row left the list).
export default function PurgeProjectDialog({ project, onPurge, onClose, returnFocus = null, onFocusLost }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(null)
  const cancel = useRef(null)
  const opener = useRef(null)
  // The last Project shown, so the title doesn't go blank while the dialog closes.
  const [shown, setShown] = useState(project)
  if (project && project !== shown) setShown(project)
  const name = shown?.name ?? t('projects.placeholder')

  async function confirm() {
    if (busy || !project) return
    setBusy(true)
    setFailed(null)
    try {
      await onPurge(project)
      onClose()
    } catch (error) {
      if (!SIGNED_OUT_CODES.has(error?.code)) setFailed(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root
      open={project !== null}
      onOpenChange={(next) => {
        if (next || busy) return
        setFailed(null)
        onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.scrim} />
        <Dialog.Content
          className={styles.dialog}
          onOpenAutoFocus={(event) => {
            opener.current = returnFocus ?? document.activeElement
            setFailed(null)
            event.preventDefault()
            cancel.current?.focus()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus()
            else onFocusLost?.()
          }}
        >
          <Dialog.Title className={styles.title}>{t('projects.purgeDialog.title', { name })}</Dialog.Title>
          <Dialog.Description asChild>
            <div className={own.description}>
              <p className={own.losses}>{t('projects.purgeDialog.lost')}</p>
              <p className={own.final}>{t('projects.purgeDialog.final')}</p>
            </div>
          </Dialog.Description>
          {failed && <InlineError>{errorText(t, failed)}</InlineError>}
          <div className={styles.actions}>
            <Dialog.Close asChild>
              <button ref={cancel} type="button" className={styles.ghost} disabled={busy}>
                {t('projects.purgeDialog.cancel')}
              </button>
            </Dialog.Close>
            <button type="button" className={own.danger} disabled={busy} aria-busy={busy} onClick={confirm}>
              {t('projects.purgeDialog.confirm')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
