import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation, useNavigate, useParams } from 'react-router'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import { errorText } from '../i18n/errors.js'
import Settings from '../pages/Settings.jsx'
import ErrorLine from './ErrorLine.jsx'
import ProjectName from './ProjectName.jsx'
import Sidebar from './Sidebar.jsx'
import TopBar from './TopBar.jsx'
import UndoMessage from './UndoMessage.jsx'
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
// Top bar with the open Project's name, the page, and the Settings overlay (Story 7.3a). It loads the profile and the Projects once
// and shares them with the pages through the outlet context. When the session has ended,
// api/client.js and RequireSession take the student to Login, so no error is shown for that.
export default function AppShell() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projectId } = useParams()
  // Settings is an overlay over the current page, opened from the Account menu; focus returns to the menu.
  const [settingsOpen, setSettingsOpen] = useState(false)
  const accountTrigger = useRef(null)
  // The error a return from Link Google account brought (Story 7.3b): `{ code, params }` or null.
  const [linkError, setLinkError] = useState(null)
  const closeSettings = useCallback(() => {
    setSettingsOpen(false)
    setLinkError(null)
  }, [])
  // /auth/callback lands here with `state.settings` after Link Google account: Settings opens with the
  // link's error, if any; then the state is cleared (replace), so a reload or Back doesn't reopen it.
  const location = useLocation()
  const settingsRequest = location.state?.settings ?? null
  const [settingsRequestKey, setSettingsRequestKey] = useState(null)
  if (settingsRequest && settingsRequestKey !== location.key) {
    setSettingsRequestKey(location.key)
    setSettingsOpen(true)
    setLinkError(settingsRequest.linkError ?? null)
  }
  useEffect(() => {
    if (settingsRequest) {
      navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: null })
    }
  }, [settingsRequest, navigate, location.pathname, location.search, location.hash])
  const [me, setMe] = useState(null)
  const [projects, setProjects] = useState(null) // null until loaded
  const [loadError, setLoadError] = useState(null)
  const [narrow] = useState(isNarrow)
  const [collapsedChoice, setCollapsedChoice] = useState(null) // null until the student toggles
  const [creating, setCreating] = useState(false)
  // A failed create, archive, or restore (a failed delete shows in its dialog): { apiError, attempt }
  // (the attempt re-announces a repeat).
  const [actionError, setActionError] = useState(null)
  const actionAttempt = useRef(0)
  // The archive Undo message (Story 7.1): { project, key } of the Project just archived.
  const [archived, setArchived] = useState(null)
  // Its live region mounts (empty) when the first archive starts, so the text that follows is announced.
  const [undoRegion, setUndoRegion] = useState(false)
  const closeArchived = useCallback(() => setArchived(null), [])
  // The Project just restored: the Sidebar moves focus to its link, then clears this.
  const [focusProjectId, setFocusProjectId] = useState(null)
  const clearFocusRequest = useCallback(() => setFocusProjectId(null), [])
  const inFlight = useRef(false)
  // The one-time Google takeover notice (AD-19): when the profile says so, its live region mounts
  // empty and the text follows, so it is announced; it is marked seen at once and shows 6 s. The
  // flag is latched, so a later `me` without it (a refresh, the seen answer) doesn't cut it short.
  const [takeoverPending, setTakeoverPending] = useState(false)
  if (me?.notice_google_takeover === true && !takeoverPending) setTakeoverPending(true)
  const [takeoverShown, setTakeoverShown] = useState(false)
  const takeoverSeen = useRef(false)
  const closeTakeover = useCallback(() => setTakeoverShown(false), [])

  useEffect(() => {
    if (!takeoverPending) return
    if (!takeoverSeen.current) {
      takeoverSeen.current = true
      // A failed save only means it may show once more next time.
      apiFetch('/api/me/notices/google-takeover/seen', { method: 'POST' }).catch(() => {})
    }
    const timer = setTimeout(() => setTakeoverShown(true), 0)
    return () => clearTimeout(timer)
  }, [takeoverPending])

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
    setActionError(null)
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

  /** Save one Project's Files panel collapse to the Account (merged per Project, Story 2.2b). */
  const saveFilesCollapsed = useCallback((id, collapsed) => {
    setMe((profile) =>
      profile
        ? {
            ...profile,
            ui_prefs: {
              ...profile.ui_prefs,
              files_collapsed: { ...profile.ui_prefs?.files_collapsed, [id]: collapsed },
            },
          }
        : profile,
    )
    // A failed save only loses persistence; the switch still holds.
    apiFetch('/api/me/prefs', { method: 'PATCH', body: { files_collapsed: { [id]: collapsed } } }).catch(() => {})
  }, [])

  /** The Privacy notice was accepted: it never blocks an upload again (Story 2.3). */
  const markPrivacyAccepted = useCallback(() => {
    setMe((profile) => (profile ? { ...profile, privacy_notice_accepted: true } : profile))
  }, [])

  /** The Project is gone or not this Account's: drop it, and never land on it again. */
  const forgetProject = useCallback((id) => {
    setProjects((list) => (list ? list.filter((p) => p.id !== id) : list))
    setMe((profile) => (profile?.last_project_id === id ? { ...profile, last_project_id: null } : profile))
  }, [])

  function showError(err) {
    if (SIGNED_OUT_CODES.has(err?.code)) return
    actionAttempt.current += 1
    setActionError({ apiError: err, attempt: actionAttempt.current })
  }

  /**
   * Archive a Project (FR-23): immediate, no confirmation, with the Undo message. Login no longer
   * lands on it (the server falls back to the most recent active Project; mirrored locally). A
   * failure leaves the row active and shows an error line.
   */
  async function archiveProject(id) {
    setActionError(null)
    setUndoRegion(true)
    try {
      const project = await apiFetch(`/api/projects/${id}/archive`, { method: 'POST' })
      upsertProject(project)
      setMe((profile) => (profile?.last_project_id === id ? { ...profile, last_project_id: null } : profile))
      setArchived({ project, key: Date.now() })
      return project
    } catch (err) {
      showError(err)
      return null
    }
  }

  /**
   * Delete a Project into Deleted projects (FR-24, Story 7.2a), from the Confirm dialog. Login no longer
   * lands on it. Deleting the open Project lands on the most recent other active Project, or the empty
   * Projects page; deleting another one stays on the current page. A failure rejects, so the dialog
   * stays open with its error line.
   */
  async function deleteProject(id) {
    const project = await apiFetch(`/api/projects/${id}/delete`, { method: 'POST' })
    const next = (projects ?? []).find((p) => p.id !== id && isActive(p))
    upsertProject(project)
    setMe((profile) => (profile?.last_project_id === id ? { ...profile, last_project_id: null } : profile))
    setArchived((shown) => (shown?.project.id === id ? null : shown))
    if (id === projectId) navigate(next ? `/projects/${next.id}` : '/projects')
    return project
  }

  /**
   * Delete a deleted Project forever (FR-24, Story 7.2b), from the Confirm dialog (delete forever). It
   * leaves the list (its group disappears at 0). From the open Project (the Deleted banner) it lands on
   * the most recent active Project, or the empty Projects page; from the Sidebar menu for another
   * Project it stays on the current page. `404 not_found` (purged meanwhile) counts as done; any other
   * failure rejects, so the dialog stays open with its error line.
   */
  async function purgeProject(id) {
    try {
      await apiFetch(`/api/projects/${id}/purge`, { method: 'POST' })
    } catch (err) {
      // Already gone (another tab, or the 30-day purge): the same as done.
      if (err?.code !== 'not_found') throw err
    }
    const next = (projects ?? []).find((p) => p.id !== id && isActive(p))
    forgetProject(id)
    if (id === projectId) navigate(next ? `/projects/${next.id}` : '/projects')
  }

  /**
   * Restore an archived or deleted Project to the active list (FR-23, FR-24), from the Undo message,
   * the Sidebar menu, or the banner. It stays on the current page, with no Undo message.
   */
  async function restoreProject(id) {
    setActionError(null)
    try {
      const project = await apiFetch(`/api/projects/${id}/restore`, { method: 'POST' })
      upsertProject(project)
      setArchived((shown) => (shown?.project.id === id ? null : shown))
      setFocusProjectId(id)
      return project
    } catch (err) {
      showError(err)
      return null
    }
  }

  /**
   * Create a Project and open it (FR-4). `revealSidebar` (from the Sidebar strip) also shows the
   * Sidebar, so the new Project is visible at the top of the list; it isn't saved as the student's
   * collapse choice (Cristoffer, 2026-11-17).
   */
  async function createProject({ revealSidebar = false } = {}) {
    if (inFlight.current) return
    inFlight.current = true
    setCreating(true)
    setActionError(null)
    try {
      const project = await apiFetch('/api/projects', { method: 'POST' })
      upsertProject(project)
      if (revealSidebar === true) setCollapsedChoice(false)
      navigate(`/projects/${project.id}`)
    } catch (err) {
      showError(err)
    } finally {
      inFlight.current = false
      setCreating(false)
    }
  }

  const activeProjects = projects ? projects.filter(isActive) : null
  // Archived but not deleted, and deleted (archived before or not), in the list's order (newest first).
  const archivedProjects = projects ? projects.filter((p) => p.archived_at && !p.deleted_at) : []
  const deletedProjects = projects ? projects.filter((p) => p.deleted_at) : []
  const current = projectId ? projects?.find((p) => p.id === projectId) : null
  let title = current ? <ProjectName key={current.id} project={current} onRenamed={upsertProject} /> : null

  return (
    <div className={styles.shell}>
      <Sidebar
        projects={activeProjects ?? []}
        archivedProjects={archivedProjects}
        deletedProjects={deletedProjects}
        onArchive={archiveProject}
        onRestore={restoreProject}
        onDelete={deleteProject}
        onPurge={purgeProject}
        focusProjectId={focusProjectId}
        onFocused={clearFocusRequest}
        currentId={projectId}
        collapsed={collapsed}
        onToggle={toggleSidebar}
        onCreate={createProject}
        creating={creating}
        onRenamed={upsertProject}
      />
      <div className={styles.column}>
        <TopBar
          me={me}
          ready={Boolean(me || loadError)}
          title={title}
          onOpenSettings={() => setSettingsOpen(true)}
          accountTriggerRef={accountTrigger}
        />
        <Settings
          open={settingsOpen}
          onClose={closeSettings}
          me={me}
          setMe={setMe}
          projects={projects}
          deleteProject={deleteProject}
          loadError={loadError}
          linkError={linkError}
          returnFocus={accountTrigger}
        />
        <main className={styles.main} aria-busy={!loadError && (!me || !projects)}>
          {(loadError || actionError) && (
            <div className={styles.alerts}>
              {loadError && <ErrorLine>{errorText(t, loadError)}</ErrorLine>}
              {actionError && <ErrorLine key={actionError.attempt}>{errorText(t, actionError.apiError)}</ErrorLine>}
            </div>
          )}
          <Outlet
            context={{
              me,
              setMe,
              projects,
              activeProjects,
              creating,
              createProject,
              upsertProject,
              markOpened,
              forgetProject,
              saveFilesCollapsed,
              markPrivacyAccepted,
              archiveProject,
              restoreProject,
              deleteProject,
              purgeProject,
            }}
          />
          {/* Mounted empty first, so a message that arrives is announced. */}
          {(takeoverPending || undoRegion) && (
            <div role="status" className={styles.undo}>
              {takeoverShown && <UndoMessage onClose={closeTakeover}>{t('account.googleTakeover')}</UndoMessage>}
              {archived && (
                <UndoMessage
                  key={archived.key}
                  onClose={closeArchived}
                  action={
                    <button type="button" className={styles.undoAction} onClick={() => restoreProject(archived.project.id)}>
                      {t('projects.undo')}
                    </button>
                  }
                >
                  {t('projects.archivedUndo', { name: archived.project.name ?? t('projects.placeholder') })}
                </UndoMessage>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
