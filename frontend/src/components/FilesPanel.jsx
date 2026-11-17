import { useEffect, useId, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { SIGNED_OUT_CODES } from '../api/client.js'
import { errorText } from '../i18n/errors.js'
import ErrorLine from './ErrorLine.jsx'
import FileRow from './FileRow.jsx'
import InlineError from './InlineError.jsx'
import RemoveFileDialog from './RemoveFileDialog.jsx'
import styles from './FilesPanel.module.css'
import { useDropTarget } from './useDropTarget.js'

// Files panel (DESIGN.md › Files panel; EXPERIENCE.md › Component Patterns › Files panel): header
// "Files · n of 10", the Upload button, the supported-types hint, upload refusals as Inline errors,
// and the file rows (or the empty box). Accepts dropped files. Rows update live (polite live region).
// "Hide files" collapses it to the Files strip: "Show files", a files icon, "{n} of 10", and a
// warning icon when a file is partly unreadable or rejected (Story 2.2b). "Upload from phone"
// arrives with Epic 6.
//
// Removing a file (Story 2.7, FR-20): a row's "···" → Remove opens the Remove file dialog, which shows
// the live file (it closes if the file leaves the list); a Rejected row's "Remove" goes at once, several
// may be in flight, and each failure shows its own Inline error ("Try again" unless the Project is
// read-only). After a removal the row leaves, the count updates, and focus goes to the Upload button.
// A read-only Project removes nothing. ProjectHome keys the panel by Project, so none of this state
// carries over to another Project.
export default function FilesPanel({ files, loading, readOnly, onBrowse, collapsed = false, onToggle, onPrivacyInfo }) {
  const { t } = useTranslation()
  const heading = useId()
  const { materials, pending, failures, loadError, upload, retry, remove } = files
  const canRemove = !readOnly && typeof remove === 'function'
  const [target, setTarget] = useState(null) // { id, trigger } while the dialog is open
  const [removingNow, setRemovingNow] = useState(() => new Set()) // ids of Rejected files in flight
  const [removeErrors, setRemoveErrors] = useState([]) // [{ material, error, retry }]
  const uploadButton = useRef(null)
  const focusUpload = useRef(false)
  // The dialog shows the file as it is now; once it leaves the list (removed), the dialog closes and
  // focus goes to Upload (the row's "···" trigger left with it).
  const targetMaterial = target ? ((materials ?? []).find((m) => m.id === target.id) ?? null) : null
  const targetGone = target !== null && targetMaterial === null
  useEffect(() => {
    if (targetGone) uploadButton.current?.focus()
  }, [targetGone])
  useEffect(() => {
    if (!focusUpload.current || targetMaterial !== null) return
    focusUpload.current = false
    uploadButton.current?.focus()
  })
  const editRemoving = (id, inFlight) =>
    setRemovingNow((ids) => {
      const next = new Set(ids)
      if (inFlight) next.add(id)
      else next.delete(id)
      return next
    })
  async function removeNow(material) {
    setRemoveErrors((list) => list.filter((e) => e.material.id !== material.id))
    editRemoving(material.id, true)
    try {
      await remove(material)
      focusUpload.current = true
    } catch (error) {
      if (!SIGNED_OUT_CODES.has(error?.code)) {
        const retry = error?.code !== 'project_read_only'
        setRemoveErrors((list) => [...list, { material, error, retry }])
      }
    } finally {
      editRemoving(material.id, false)
    }
  }
  const { over, handlers } = useDropTarget(upload, !readOnly && !loading)
  // Reading… counts toward 10, also while the file is still uploading (AD-5).
  const count = (materials ?? []).filter((m) => m.status !== 'rejected').length + pending.length
  const rows = [
    ...(materials ?? []).map((material) => ({ key: material.id, material })),
    ...pending.map((item) => ({ key: item.key, material: { file_name: item.name, status: 'processing' } })),
  ]
  const listed = materials !== null
  // A problem is never hidden behind the strip: a rejected file (error colour), or a partly
  // unreadable file, a refused upload, or a failed list load (muted) shows the warning icon.
  const anyRejected = (materials ?? []).some((m) => m.status === 'rejected')
  const attention =
    anyRejected ||
    failures.length > 0 ||
    Boolean(loadError) ||
    (materials ?? []).some((m) => m.status === 'ready' && m.warning)

  // After a toggle, focus moves to the button that replaced the one pressed.
  const showButton = useRef(null)
  const hideButton = useRef(null)
  const toggled = useRef(false)
  useEffect(() => {
    if (!toggled.current) return
    toggled.current = false
    ;(collapsed ? showButton : hideButton).current?.focus()
  }, [collapsed])
  const toggle = () => {
    toggled.current = true
    onToggle?.()
  }

  if (collapsed) {
    return (
      <aside className={styles.strip} aria-label={t('files.show')} {...handlers}>
        <button
          ref={showButton}
          type="button"
          className={styles.stripButton}
          aria-label={t('files.show')}
          aria-expanded="false"
          onClick={toggle}
        >
          <Chevron direction="left" />
          <span className={styles.tip} aria-hidden="true">
            {t('files.show')}
          </span>
        </button>
        <FilesIcon />
        {listed && (
          <p className={styles.stripCount}>
            <Trans i18nKey="files.stripCount" values={{ n: count }} components={{ of: <span className={styles.of} /> }} />
          </p>
        )}
        {attention && (
          <span className={`${styles.attention} ${anyRejected ? styles.attentionError : ''}`} role="img" aria-label={t('files.attention')} title={t('files.attention')}>
            <WarningIcon />
          </span>
        )}
      </aside>
    )
  }

  return (
    <aside className={`${styles.panel} ${over ? styles.over : ''}`} aria-labelledby={heading} {...handlers}>
      <div className={styles.header}>
        <h2 id={heading} className={styles.heading}>
          <Trans i18nKey="files.header" values={{ n: count }} components={{ muted: <span className={styles.muted} /> }} />
        </h2>
        {onToggle && (
          <button
            ref={hideButton}
            type="button"
            className={styles.collapse}
            aria-label={t('files.hide')}
            aria-expanded="true"
            onClick={toggle}
          >
            <Chevron direction="right" />
          </button>
        )}
      </div>
      {!loading && (
        <>
          <button ref={uploadButton} type="button" className={styles.upload} onClick={onBrowse} disabled={readOnly}>
            {t('files.upload')}
          </button>
          <p className={styles.hint}>{t('files.types')}</p>
          {onPrivacyInfo && (
            <button type="button" className={styles.privacyLink} onClick={onPrivacyInfo}>
              {t('privacyNotice.link')}
            </button>
          )}
        </>
      )}
      {loadError && <ErrorLine>{errorText(t, loadError)}</ErrorLine>}
      {(failures.length > 0 || removeErrors.length > 0) && (
        <div className={styles.errors}>
          {removeErrors.map(({ material, error, retry: canRetry }) => (
            <InlineError key={`remove-${material.id}`} onRetry={canRetry ? () => removeNow(material) : undefined}>
              <span className={styles.failedName}>{material.file_name}</span>
              {canRetry ? t('files.remove.failed') : errorText(t, error)}
            </InlineError>
          ))}
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
            <FileRow
              key={key}
              material={material}
              onRemove={canRemove ? (m, trigger) => setTarget({ id: m.id, trigger }) : undefined}
              onRemoveNow={canRemove ? removeNow : undefined}
              removing={removingNow.has(material.id)}
            />
          ))}
        </ul>
      )}
      <RemoveFileDialog
        material={targetMaterial}
        returnFocus={target?.trigger ?? null}
        onRemove={remove}
        onClose={() => setTarget(null)}
      />
    </aside>
  )
}

function Chevron({ direction }) {
  const d = direction === 'left' ? 'M6 1L2 5l4 4' : 'M2 1l4 4-4 4'
  return (
    <svg className={styles.icon} viewBox="0 0 8 10" aria-hidden="true" focusable="false">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function FilesIcon() {
  return (
    <svg className={styles.filesIcon} viewBox="0 0 16 18" aria-hidden="true" focusable="false">
      <path d="M3 1h7l4 4v12H3z M10 1v4h4" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function WarningIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 1.5L15 14H1z M8 6v4 M8 11.5v1" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}
