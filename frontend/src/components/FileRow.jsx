import { DropdownMenu } from 'radix-ui'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './FileRow.module.css'
import { IMAGE_TYPES } from '../pages/useProjectFiles.js'
import TopicList from './TopicList.jsx'
import { fileState, tileLabel } from './fileStatus.js'

// File row (DESIGN.md › File row, File status; EXPERIENCE.md › State Patterns › Study Material):
// a file-type tile, the name, and the status line, with a muted note when partly unreadable and the
// reason in the error colour when rejected. A Ready file (also partly unreadable) shows its Topic count
// ("{n} topics") as muted metadata and its Topic list under the row (Story 2.6a, FR-22); Reading… and
// Rejected files show neither.
//
// Removal (Story 2.7, FR-20): Reading…, Ready, and partly-readable rows get a "···" Overflow menu with
// "Remove", which calls `onRemove(material, trigger)` to open the Remove file dialog. Rejected rows get
// a ghost "Remove" that calls `onRemoveNow(material)` at once. Without the handlers (a read-only
// Project) or an id (still uploading), the row offers neither.
//
// Topic edits (Story 2.6b): with `onEditTopics(materialId, edit)` (an active Project), the Topic list
// offers rename, delete, merge, and add; without it the list is read-only. With 2+ Topics the "···"
// menu also offers "Merge topics", which starts the list's merge mode (Ctrl+click or Space on a chip
// starts it too); Cancel returns focus to "···", or to the chip that started it.
/** The rejection note's key: an unreadable photo (FR-7), or a phone batch of them (FR-21), has its own
 * "too blurry" copy. */
function reasonKey(material) {
  if (material.reject_reason === 'unreadable' && IMAGE_TYPES.has(material.file_type)) return 'files.reason.unreadable_image'
  return `files.reason.${material.reject_reason}`
}

export default function FileRow({ material, onRemove, onRemoveNow, onEditTopics, removing = false }) {
  const { t, i18n } = useTranslation()
  const trigger = useRef(null)
  const state = fileState(material)
  const removable = Boolean(material.id)
  const topics = state === 'ready' || state === 'warning' ? (material.topics ?? []) : []
  const [mergeMode, setMergeMode] = useState(false)
  const canMerge = Boolean(onEditTopics) && removable && topics.length >= 2
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
          {topics.length > 0 && <p className={styles.meta}>{t('files.topics.count', { count: topics.length })}</p>}
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
                {canMerge && (
                  <DropdownMenu.Item className={styles.item} onSelect={() => setMergeMode(true)}>
                    {t('files.topics.mergeTopics')}
                  </DropdownMenu.Item>
                )}
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
          {t(reasonKey(material), { defaultValue: t('files.reason.processing_failed') })}
        </p>
      )}
      {topics.length > 0 && (
        <TopicList
          topics={topics}
          onEdit={onEditTopics && material.id ? (edit) => onEditTopics(material.id, edit) : undefined}
          mergeMode={canMerge && mergeMode}
          onMergeStart={canMerge ? () => setMergeMode(true) : undefined}
          onMergeEnd={({ cancelled, returnFocus }) => {
            setMergeMode(false)
            if (cancelled && returnFocus) trigger.current?.focus()
          }}
        />
      )}
    </li>
  )
}
