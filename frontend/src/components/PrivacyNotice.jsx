import { Dialog } from 'radix-ui'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './PrivacyNotice.module.css'

// Privacy notice (FR-6, §5.3; EXPERIENCE.md › Privacy notice; DESIGN.md › Modal dialog). Before the
// Account's first upload it asks: "Cancel" or "Got it, upload" (primary). Reopened from "How your
// files are used", it shows the same text with only "Close". Focus is trapped while it's open, Esc
// acts as Cancel or Close, and focus returns to the opener. Calm: no error colour or icon.
//
// `mode`: 'ask' | 'info' | null (closed). `busy` disables the buttons while the acceptance saves.
export default function PrivacyNotice({ mode, onAccept, onClose, busy = false, error = null }) {
  const { t } = useTranslation()
  const opener = useRef(null)
  return (
    <Dialog.Root open={mode !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.scrim} />
        <Dialog.Content
          className={styles.dialog}
          aria-describedby={undefined}
          // There is no Dialog.Trigger (Upload, a drop, or the link opens it), so remember the opener
          // when it opens and give focus back to it when it closes.
          onOpenAutoFocus={() => {
            opener.current = document.activeElement
          }}
          onCloseAutoFocus={(event) => {
            if (opener.current instanceof HTMLElement && opener.current.isConnected) {
              event.preventDefault()
              opener.current.focus()
            }
          }}
        >
          <Dialog.Title className={styles.title}>{t('privacyNotice.title')}</Dialog.Title>
          <p className={styles.body}>{t('privacyNotice.body')}</p>
          {error && (
            <p className={styles.saveError} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            {mode === 'ask' ? (
              <>
                <Dialog.Close asChild>
                  <button type="button" className={styles.ghost} disabled={busy}>
                    {t('privacyNotice.cancel')}
                  </button>
                </Dialog.Close>
                <button type="button" className={styles.primary} disabled={busy} aria-busy={busy} onClick={onAccept}>
                  {t('privacyNotice.accept')}
                </button>
              </>
            ) : (
              <Dialog.Close asChild>
                <button type="button" className={styles.primary}>
                  {t('privacyNotice.close')}
                </button>
              </Dialog.Close>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
