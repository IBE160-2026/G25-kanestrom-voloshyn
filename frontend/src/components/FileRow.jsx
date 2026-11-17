import { useTranslation } from 'react-i18next'
import styles from './FileRow.module.css'

// File row (DESIGN.md › File row, File status; EXPERIENCE.md › State Patterns › Study Material):
// a file-type tile, the name, and the status line, with a muted note when partly unreadable and the
// reason in the error colour when rejected. The Topic count and the "···" menu arrive with Stories
// 2.6 and 2.7.
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

export default function FileRow({ material }) {
  const { t, i18n } = useTranslation()
  const state = fileState(material)
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
