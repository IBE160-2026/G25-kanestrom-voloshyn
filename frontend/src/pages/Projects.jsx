import { useTranslation } from 'react-i18next'
import { Navigate, useOutletContext } from 'react-router'
import styles from './Projects.module.css'

// Projects page (FR-4, FR-8; DESIGN.md › Projects page (empty)). When the Account has a last opened
// active Project, it goes there (login lands on it). Otherwise, with no active Project, it shows the
// empty state: one muted sentence and "Create your first project", which creates a Project and
// opens it. Nothing shows until the profile and the Projects have loaded.
export default function Projects() {
  const { t } = useTranslation()
  const { me, activeProjects, creating, createProject } = useOutletContext()

  if (me?.last_project_id) return <Navigate to={`/projects/${me.last_project_id}`} replace />
  if (!me || !activeProjects) return null
  // No usable last Project but active ones exist: open the most recent (EXPERIENCE.md › No Projects).
  if (activeProjects.length > 0) return <Navigate to={`/projects/${activeProjects[0].id}`} replace />

  return (
    <section className={styles.empty}>
      <p className={styles.body}>{t('projects.empty.body')}</p>
      <button type="button" className={styles.primary} aria-busy={creating} onClick={createProject}>
        {t('projects.empty.create')}
      </button>
    </section>
  )
}
