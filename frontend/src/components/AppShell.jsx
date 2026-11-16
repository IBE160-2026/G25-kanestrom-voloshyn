import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useNavigate, useParams } from 'react-router'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import { errorText } from '../i18n/errors.js'
import ErrorLine from './ErrorLine.jsx'
import ProjectName from './ProjectName.jsx'
import Sidebar from './Sidebar.jsx'
import TopBar from './TopBar.jsx'
import styles from './AppShell.module.css'

// Below this width the Sidebar starts collapsed, whatever the saved preference (DESIGN.md › Layout).
const NARROW_MAX = 1024

function isNarrow() {
  return typeof window !== 'undefined' && window.innerWidth < NARROW_MAX
}

function isActive(project) {
  return !project.archived_at && !project.deleted_at
}

// The shell of the signed-in pages (DESIGN.md › Layout & Spacing): the Sidebar (or its strip), the
// Top bar with the open Project's name, and the page. It loads the profile and the Projects once
// and shares them with the pages through the outlet context. When the session has ended,
// api/client.js and RequireSession take the student to Login, so no error is shown for that.
export default function AppShell() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projectId } = useParams()
  const [me, setMe] = useState(null)
  const [projects, setProjects] = useState(null) // null until loaded
  const [loadError, setLoadError] = useState(null)
  const [narrow] = useState(isNarrow)
  const [collapsedChoice, setCollapsedChoice] = useState(null) // null until the student toggles
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState(null) // { apiError, attempt }
  const createAttempt = useRef(0)
  const inFlight = useRef(false)

  useEffect(() => {
    let live = true
    const fail = (err) => {
      if (live && !SIGNED_OUT_CODES.has(err?.code)) setLoadError((current) => current ?? err)
    }
    apiFetch('/api/me')
      .then((profile) => live && setMe(profile))
      .catch(fail)
    apiFetch('/api/projects')
      .then((list) => live && setProjects(Array.isArray(list) ? list : []))
      .catch(fail)
    return () => {
      live = false
    }
  }, [])

  // A failed create belongs to the page it happened on; moving to another Project clears it.
  // (Adjusting state during render when the route changes, instead of an effect.)
  const [errorFor, setErrorFor] = useState(projectId)
  if (errorFor !== projectId) {
    setErrorFor(projectId)
    setCreateError(null)
  }

  const collapsed = collapsedChoice ?? (narrow || me?.ui_prefs?.sidebar_collapsed === true)

  function toggleSidebar() {
    const next = !collapsed
    setCollapsedChoice(next)
    // Saved to the Account; a failed save only loses persistence, the switch still holds.
    apiFetch('/api/me/prefs', { method: 'PATCH', body: { sidebar_collapsed: next } }).catch(() => {})
  }

  /** Add or replace a Project in the list (newest first for new ones). */
  const upsertProject = useCallback((project) => {
    setProjects((list) => {
      const current = list ?? []
      return current.some((p) => p.id === project.id)
        ? current.map((p) => (p.id === project.id ? project : p))
        : [project, ...current]
    })
  }, [])

  /** The Project was opened: login lands here next time (the server has recorded it). */
  const markOpened = useCallback((id) => {
    setMe((profile) => (profile ? { ...profile, last_project_id: id } : profile))
  }, [])

  /** The Project is gone or not this Account's: drop it, and never land on it again. */
  const forgetProject = useCallback((id) => {
    setProjects((list) => (list ? list.filter((p) => p.id !== id) : list))
    setMe((profile) => (profile?.last_project_id === id ? { ...profile, last_project_id: null } : profile))
  }, [])

  /**
   * Create a Project and open it (FR-4). `revealSidebar` (from the Sidebar strip) also shows the
   * Sidebar, so the new Project is visible at the top of the list; it isn't saved as the student's
   * collapse choice (Cristoffer, 2026-11-17).
   */
  async function createProject({ revealSidebar = false } = {}) {
    if (inFlight.current) return
    inFlight.current = true
    setCreating(true)
    setCreateError(null)
    try {
      const project = await apiFetch('/api/projects', { method: 'POST' })
      upsertProject(project)
      if (revealSidebar === true) setCollapsedChoice(false)
      navigate(`/projects/${project.id}`)
    } catch (err) {
      if (!SIGNED_OUT_CODES.has(err?.code)) {
        createAttempt.current += 1
        setCreateError({ apiError: err, attempt: createAttempt.current })
      }
    } finally {
      inFlight.current = false
      setCreating(false)
    }
  }

  const activeProjects = projects ? projects.filter(isActive) : null
  const current = projectId ? projects?.find((p) => p.id === projectId) : null
  const title = current ? <ProjectName key={current.id} project={current} onRenamed={upsertProject} /> : null

  return (
    <div className={styles.shell}>
      <Sidebar
        projects={activeProjects ?? []}
        currentId={projectId}
        collapsed={collapsed}
        onToggle={toggleSidebar}
        onCreate={createProject}
        creating={creating}
        onRenamed={upsertProject}
      />
      <div className={styles.column}>
        <TopBar me={me} ready={Boolean(me || loadError)} title={title} />
        <main className={styles.main} aria-busy={!loadError && (!me || !projects)}>
          {(loadError || createError) && (
            <div className={styles.alerts}>
              {loadError && <ErrorLine>{errorText(t, loadError)}</ErrorLine>}
              {createError && <ErrorLine key={createError.attempt}>{errorText(t, createError.apiError)}</ErrorLine>}
            </div>
          )}
          <Outlet
            context={{ me, activeProjects, creating, createProject, upsertProject, markOpened, forgetProject }}
          />
        </main>
      </div>
    </div>
  )
}
