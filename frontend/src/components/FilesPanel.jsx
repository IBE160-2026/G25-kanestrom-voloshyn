import { useId } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { errorText } from '../i18n/errors.js'
import ErrorLine from './ErrorLine.jsx'
import FileRow from './FileRow.jsx'
import InlineError from './InlineError.jsx'
import styles from './FilesPanel.module.css'
import { useDropTarget } from './useDropTarget.js'

// Files panel (DESIGN.md › Files panel; EXPERIENCE.md › Component Patterns › Files panel): header
// "Files · n of 10", the Upload button, the supported-types hint, upload refusals as Inline errors,
// and the file rows (or the empty box). Accepts dropped files. Rows update live (polite live region).
// The collapse to the Files strip arrives with Story 2.2b; "Upload from phone" with Epic 6.
export default function FilesPanel({ files, loading, readOnly, onBrowse }) {
  const { t } = useTranslation()
  const heading = useId()
  const { materials, pending, failures, loadError, upload, retry } = files
  const { over, handlers } = useDropTarget(upload, !readOnly && !loading)
  // Reading… counts toward 10, also while the file is still uploading (AD-5).
  const count = (materials ?? []).filter((m) => m.status !== 'rejected').length + pending.length
  const rows = [
    ...(materials ?? []).map((material) => ({ key: material.id, material })),
    ...pending.map((item) => ({ key: item.key, material: { file_name: item.name, status: 'processing' } })),
  ]
  const listed = materials !== null

  return (
    <aside className={`${styles.panel} ${over ? styles.over : ''}`} aria-labelledby={heading} {...handlers}>
      <h2 id={heading} className={styles.heading}>
        <Trans i18nKey="files.header" values={{ n: count }} components={{ muted: <span className={styles.muted} /> }} />
      </h2>
      {!loading && (
        <>
          <button type="button" className={styles.upload} onClick={onBrowse} disabled={readOnly}>
            {t('files.upload')}
          </button>
          <p className={styles.hint}>{t('files.types')}</p>
        </>
      )}
      {loadError && <ErrorLine>{errorText(t, loadError)}</ErrorLine>}
      {failures.length > 0 && (
        <div className={styles.errors}>
          {failures.map((failure) => (
            <InlineError
              key={failure.key}
              onRetry={failure.retryable ? () => retry(failure.key) : undefined}
            >
              <span className={styles.failedName}>{failure.name}</span>
              {errorText(t, failure.error)}
            </InlineError>
          ))}
        </div>
      )}
      {(loading || (!listed && !loadError)) && (
        <div className={styles.skeleton} aria-hidden="true" />
      )}
      {listed && rows.length === 0 && <p className={styles.empty}>{t('files.empty')}</p>}
      {rows.length > 0 && (
        <ul className={styles.list} aria-live="polite">
          {rows.map(({ key, material }) => (
            <FileRow key={key} material={material} />
          ))}
        </ul>
      )}
    </aside>
  )
}
