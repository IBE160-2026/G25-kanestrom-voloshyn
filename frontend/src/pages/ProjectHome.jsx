import { useEffect, useId, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate, useOutletContext, useParams } from 'react-router'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import ErrorLine from '../components/ErrorLine.jsx'
import { errorText } from '../i18n/errors.js'
import styles from './ProjectHome.module.css'

// Codes that mean "no such Project here": a missing or foreign id, or one that isn't an id at all.
const GONE = new Set(['not_found', 'invalid_request'])

// Project home (FR-4, FR-8; DESIGN.md › Layout › Project home, mock key-project-home.html). Opening it
// reads the Project through GET /api/projects/{id}, which records it as the last opened. Layout for
// later stories to fill: the chat column with the Upload drop zone heading and an empty tool buttons
// row, and the Files panel ("Files · 0 of 10") on the right. A static skeleton shows while it loads
// (EXPERIENCE.md › Project cold-load). A missing or foreign Project goes back to /projects.
export default function ProjectHome() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projectId } = useParams()
  const filesHeading = useId()
  const { upsertProject, markOpened, forgetProject } = useOutletContext()
  const [loaded, setLoaded] = useState(null) // { id, project } of the Project shown
  const [error, setError] = useState(null) // { id, apiError }

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

  const ready = loaded?.id === projectId
  const failed = error?.id === projectId ? error.apiError : null

  return (
    <div className={styles.home} aria-busy={!ready && !failed}>
      <section className={styles.chat}>
        <div className={styles.chatInner}>
          {failed && <ErrorLine>{errorText(t, failed)}</ErrorLine>}
          {ready ? (
            <div className={styles.dropZone}>
              <h2 className={styles.dropHeading}>{t('projectHome.dropZone.heading')}</h2>
            </div>
          ) : (
            !failed && <div className={`${styles.skeleton} ${styles.skeletonChat}`} aria-hidden="true" />
          )}
          {/* Tool buttons row: Quiz, Flashcards, and Summarize arrive with their stories. */}
          <div className={styles.tools} data-testid="tools-row" />
        </div>
      </section>
      <aside className={styles.files} aria-labelledby={filesHeading}>
        <h2 id={filesHeading} className={styles.filesHeading}>
          <Trans i18nKey="files.header" values={{ n: 0 }} components={{ muted: <span className={styles.muted} /> }} />
        </h2>
        {!ready && !failed && <div className={`${styles.skeleton} ${styles.skeletonRow}`} aria-hidden="true" />}
      </aside>
    </div>
  )
}
