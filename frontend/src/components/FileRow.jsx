import { DropdownMenu } from 'radix-ui'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './FileRow.module.css'

// File row (DESIGN.md › File row, File status; EXPERIENCE.md › State Patterns › Study Material):
// a file-type tile, the name, and the status line, with a muted note when partly unreadable and the
// reason in the error colour when rejected. The Topic count arrives with Story 2.6.
//
// Removal (Story 2.7, FR-20): Reading…, Ready, and partly-readable rows get a "···" Overflow menu with
// "Remove", which calls `onRemove(material, trigger)` to open the Remove file dialog. Rejected rows get
// a ghost "Remove" that calls `onRemoveNow(material)` at once. Without the handlers (a read-only
// Project) or an id (still uploading), the row offers neither.
function fileState(material) {
  if (material.status === 'processing') return 'processing'
  if (material.status === 'rejected') return 'rejected'
  return material.warning ? 'warning' : 'ready'
}

const TILE = { pdf: 'PDF', docx: 'DOCX', pptx: 'PPTX', txt: 'TXT', md: 'MD' }

function tileLabel(material) {
  if (material.file_type) return TILE[material.file_type] ?? material.file_type.toUpperCase()
  const ext = String(material.file_name).split('.').pop()
  return ext ? ext.toUpperCase().slice(0, 4) : ''
}

export default function FileRow({ material, onRemove, onRemoveNow, removing = false }) {
  const { t, i18n } = useTranslation()
  const trigger = useRef(null)
  const state = fileState(material)
  const removable = Boolean(material.id)
  const pages = material.warning_pages ?? []
  const pageList = new Intl.ListFormat(i18n.language, { style: 'long', type: 'conjunction' }).format(
    pages.map(String),
  )

  return (
    <li className={styles.row}>
      <div className={styles.main}>
        <span className={styles.tile} aria-hidden="true">
          {tileLabel(material)}
        </span>
        <div className={styles.body}>
          <p className={styles.name} title={material.file_name}>
            {material.file_name}
          </p>
          <p className={`${styles.status} ${styles[state]}`}>
            <span className={styles.dot} aria-hidden="true" />
            {t(`files.status.${state}`)}
          </p>
        </div>
        {removable && state === 'rejected' && onRemoveNow && (
          <button type="button" className={styles.removeNow} disabled={removing} onClick={() => onRemoveNow(material)}>
            {t('files.remove.item')}
          </button>
        )}
        {removable && state !== 'rejected' && onRemove && (
          // Not modal, like the Account menu; the dialog it opens takes focus itself.
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger
              ref={trigger}
              className={styles.more}
              aria-label={t('files.remove.menu', { name: material.file_name })}
            >
              <svg className={styles.dots} viewBox="0 0 16 4" aria-hidden="true" focusable="false">
                <circle cx="2" cy="2" r="1.5" fill="currentColor" />
                <circle cx="8" cy="2" r="1.5" fill="currentColor" />
                <circle cx="14" cy="2" r="1.5" fill="currentColor" />
              </svg>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className={styles.menu}
                align="end"
                sideOffset={4}
                // The dialog takes focus and later returns it to the trigger.
                onCloseAutoFocus={(event) => event.preventDefault()}
              >
                <DropdownMenu.Item className={styles.item} onSelect={() => onRemove(material, trigger.current)}>
                  {t('files.remove.item')}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
      </div>
      {state === 'warning' && (
        <p className={styles.note}>
          {[t('files.note.warning'), pages.length > 0 && t('files.note.pages', { count: pages.length, pages: pageList })]
            .filter(Boolean)
            .join(' ')}
        </p>
      )}
      {state === 'rejected' && (
        <p className={`${styles.note} ${styles.noteError}`}>
          {t(`files.reason.${material.reject_reason}`, { defaultValue: t('files.reason.processing_failed') })}
        </p>
      )}
    </li>
  )
}
