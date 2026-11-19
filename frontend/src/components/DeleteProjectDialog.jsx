import { Dialog } from 'radix-ui'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SIGNED_OUT_CODES } from '../api/client.js'
import { errorText } from '../i18n/errors.js'
import InlineError from './InlineError.jsx'
import styles from './DeleteProjectDialog.module.css'

// Confirm dialog (delete project) (FR-24, Story 7.2a; EXPERIENCE.md › Strings; DESIGN.md › Confirm
// dialog (delete project)). Opened from "Delete project" in an active or archived row's "···" menu.
// The title names the Project; the body says it moves to Deleted projects for 30 days. A soft delete,
// so the final button is Button (primary), and no typing is needed. Focus starts on Cancel; Esc or
// Cancel closes it with nothing changed and focus back on the opener. While deleting, both buttons are
// disabled; a failure keeps it open with the error line (a signed-out session is the app's).
//
// `project`: the Project to delete, or null (closed). `onDelete(project)` returns a promise that
// rejects on failure; `onClose()` is called on Cancel or Esc, and after a delete.
// `returnFocus`: the element focus goes back to when nothing was deleted (the row's "···" trigger).
// `onFocusLost()`: called when that element is gone after the dialog closes (the row left the list).
export default function DeleteProjectDialog({ project, onDelete, onClose, returnFocus = null, onFocusLost }) {
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
      await onDelete(project)
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
          <Dialog.Title className={styles.title}>{t('projects.deleteDialog.title', { name })}</Dialog.Title>
          <Dialog.Description className={styles.body}>{t('projects.deleteDialog.body', { name })}</Dialog.Description>
          {failed && <InlineError>{errorText(t, failed)}</InlineError>}
          <div className={styles.actions}>
            <Dialog.Close asChild>
              <button ref={cancel} type="button" className={styles.ghost} disabled={busy}>
                {t('projects.deleteDialog.cancel')}
              </button>
            </Dialog.Close>
            <button type="button" className={styles.primary} disabled={busy} aria-busy={busy} onClick={confirm}>
              {t('projects.deleteDialog.confirm')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
