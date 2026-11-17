import { useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate, useOutletContext, useParams } from 'react-router'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import ErrorLine from '../components/ErrorLine.jsx'
import FilesPanel from '../components/FilesPanel.jsx'
import { useBlockWindowFileDrop, useDropTarget } from '../components/useDropTarget.js'
import { errorText } from '../i18n/errors.js'
import styles from './ProjectHome.module.css'
import { ACCEPT, useProjectFiles } from './useProjectFiles.js'

// Codes that mean "no such Project here": a missing or foreign id, or one that isn't an id at all.
const GONE = new Set(['not_found', 'invalid_request'])

// Project home (FR-4, FR-6, FR-8; DESIGN.md › Layout › Project home, mock key-project-home.html).
// Opening it reads the Project through GET /api/projects/{id}, which records it as the last opened,
// and lists its files. The chat column shows the Upload drop zone until a file is Ready (the chat
// arrives with its own story), then the empty tool buttons row; the Files panel is on the right.
// Files are uploaded from the drop zone's "browse", the panel's Upload button, or a drop on either.
// A static skeleton shows while it loads (EXPERIENCE.md › Project cold-load). A missing or foreign
// Project goes back to /projects. A read-only Project lists its files but takes no uploads.
export default function ProjectHome() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projectId } = useParams()
  const picker = useRef(null)
  const files = useProjectFiles(projectId)
  const { me, upsertProject, markOpened, forgetProject, saveFilesCollapsed } = useOutletContext()
  const [loaded, setLoaded] = useState(null) // { id, project } of the Project shown
  const [error, setError] = useState(null) // { id, apiError }
  // Files panel collapse (EXPERIENCE.md › Files strip): the student's choice in this visit, else
  // collapsed below 1024 px, else the choice saved to the Account for this Project (Story 2.2b).
  const [narrow] = useState(isNarrow)
  const [filesChoice, setFilesChoice] = useState({}) // { [projectId]: collapsed }
  const filesCollapsed =
    filesChoice[projectId] ?? (narrow || me?.ui_prefs?.files_collapsed?.[projectId] === true)
  const toggleFiles = () => {
    const next = !filesCollapsed
    setFilesChoice((choices) => ({ ...choices, [projectId]: next }))
    saveFilesCollapsed?.(projectId, next)
  }

  useEffect(() => {
    let live = true
    apiFetch(`/api/projects/${projectId}`)
      .then((project) => {
        if (!live) return
        setLoaded({ id: projectId, project })
        upsertProject(project)
        // The server lands login only on active Projects; mirror that locally.
        if (!project.archived_at && !project.deleted_at) markOpened(project.id)
      })
      .catch((err) => {
        if (!live || SIGNED_OUT_CODES.has(err?.code)) return
        if (GONE.has(err?.code)) {
          forgetProject(projectId)
          navigate('/projects', { replace: true })
        } else {
          setError({ id: projectId, apiError: err })
        }
      })
    return () => {
      live = false
    }
  }, [projectId, upsertProject, markOpened, forgetProject, navigate])

  const project = loaded?.id === projectId ? loaded.project : null
  const failed = error?.id === projectId ? error.apiError : null
  const listed = files.materials !== null || files.loadError !== null
  const ready = project !== null && listed
  const readOnly = Boolean(project?.archived_at || project?.deleted_at)
  const anyReady = (files.materials ?? []).some((m) => m.status === 'ready')
  const drop = useDropTarget(files.upload, ready && !readOnly)
  useBlockWindowFileDrop()

  const openPicker = () => picker.current?.click()

  return (
    <div className={styles.home} aria-busy={!ready && !failed}>
      <input
        ref={picker}
        type="file"
        multiple
        accept={ACCEPT}
        className={styles.picker}
        tabIndex={-1}
        aria-hidden="true"
        data-testid="file-picker"
        onChange={(event) => {
          files.upload(event.target.files)
          event.target.value = ''
        }}
      />
      <section className={styles.chat}>
        <div className={styles.chatInner}>
          {failed && <ErrorLine>{errorText(t, failed)}</ErrorLine>}
          {ready && !anyReady && (
            <div
              className={`${styles.dropZone} ${drop.over ? styles.over : ''}`}
              data-testid="drop-zone"
              {...drop.handlers}
            >
              <h2 className={styles.dropHeading}>{t('projectHome.dropZone.heading')}</h2>
              <p className={styles.dropBody}>
                <Trans
                  i18nKey="projectHome.dropZone.body"
                  components={{
                    browse: <button type="button" className={styles.browse} onClick={openPicker} disabled={readOnly} />,
                  }}
                />
              </p>
              <p className={styles.dropTypes}>{t('files.types')}</p>
            </div>
          )}
          {ready && anyReady && <div className={styles.thread} />}
          {!ready && !failed && <div className={`${styles.skeleton} ${styles.skeletonChat}`} aria-hidden="true" />}
          {/* Tool buttons row: Quiz, Flashcards, and Summarize arrive with their stories. */}
          <div className={styles.tools} data-testid="tools-row" />
        </div>
      </section>
      <FilesPanel
        files={files}
        loading={!ready && !failed}
        readOnly={readOnly}
        onBrowse={openPicker}
        collapsed={filesCollapsed}
        onToggle={toggleFiles}
      />
    </div>
  )
}

// Below this width the Files panel starts collapsed, whatever the saved choice (DESIGN.md › Layout).
function isNarrow() {
  return typeof window !== 'undefined' && window.innerWidth < 1024
}
