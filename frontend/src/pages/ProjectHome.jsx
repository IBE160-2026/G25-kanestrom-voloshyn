import { useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useOutletContext, useParams } from 'react-router'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import ErrorLine from '../components/ErrorLine.jsx'
import FilesPanel from '../components/FilesPanel.jsx'
import MistakesCard from '../components/MistakesCard.jsx'
import PrivacyNotice from '../components/PrivacyNotice.jsx'
import PurgeProjectDialog from '../components/PurgeProjectDialog.jsx'
import QrDialog from '../components/QrDialog.jsx'
import ReadyNotice from '../components/ReadyNotice.jsx'
import { daysLeft } from '../components/daysLeft.js'
import DropOverlay from '../components/DropOverlay.jsx'
import { useBlockWindowFileDrop, useDropTarget, useWindowFileDrop } from '../components/useDropTarget.js'
import { errorText } from '../i18n/errors.js'
import styles from './ProjectHome.module.css'
import ProjectChat from './ProjectChat.jsx'
import { useMistakes } from './useMistakes.js'
import { ACCEPT, useProjectFiles } from './useProjectFiles.js'
import { useQuizNotices } from './useQuizNotices.js'

// Codes that mean "no such Project here": a missing or foreign id, or one that isn't an id at all.
const GONE = new Set(['not_found', 'invalid_request'])

// Re-reading an unnamed Project for its auto-name: every 2 s, for at most 30 s (Story 2.4b).
export const NAME_POLL_MS = 2000
export const NAME_WAIT_MS = 30000

// Project home (FR-4, FR-6, FR-8; DESIGN.md › Layout › Project home, mock key-project-home.html).
// Opening it reads the Project through GET /api/projects/{id}, which records it as the last opened,
// and lists its files. The chat column shows the Upload drop zone until a file is Ready, then the chat
// (Story 4.4, ProjectChat); the tool buttons row holds Quiz, Flashcards, and Summarize; the Files panel is on the right.
// Files are uploaded from the drop zone's "browse", the panel's Upload button, or a drop on either.
// A static skeleton shows while it loads (EXPERIENCE.md › Project cold-load). A missing or foreign
// Project goes back to /projects. A read-only Project lists its files but takes no uploads.
// A quiz finished while the student was elsewhere shows "Your quiz on {topic} is ready · Open" at the
// top of the chat column (Story 3.1b; see useQuizNotices), also in a read-only Project; a flashcard set
// reads "Your flashcards on {topic} are ready · Open" and opens the set (Story 4.1), and a summary
// "Your summary of {file} is ready · Open" and opens the Summary view (Story 4.3).
// Above those, the Mistakes card "{n} mistakes to review" shows while the Project is active and has
// outstanding Mistakes (Story 3.3, FR-9; see useMistakes). It is read when the chat mounts, so coming
// back from a Quiz shows the new count, and again after a file removal (which may withdraw Mistakes).
// Its "Start" opens Mistake Review (Story 3.4). Leaving a review session ("Stop for now", "← Back to
// chat") comes back here with "Your progress is saved." under the card (Story 3.5); a review round
// finished while the student was elsewhere shows "Your practice questions are ready · Open".
// "Upload from phone" (Story 6.2, FR-21), in the Files panel and the empty-Project drop zone, opens
// the QR dialog (the Privacy notice first, until accepted); while it is open the files are polled, so
// a batch from the phone shows up live. Closing it ends the phone link.
// An archived Project shows the Archived banner, a deleted one the Deleted banner with its days left
// (Stories 7.1, 7.2a); both have Restore, and both are read-only. The Deleted banner also has "Delete
// forever", which opens the Confirm dialog (delete forever) (Story 7.2b); the shell then lands elsewhere.
export default function ProjectHome() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { projectId } = useParams()
  // "Your progress is saved." (Story 3.5): taken from the router state once, which is then cleared, so a
  // reload or a later Back doesn't show it again. It stays for this visit to this Project.
  const reviewSaved = location.state?.reviewSaved === true
  const [savedFor, setSavedFor] = useState(null)
  if (reviewSaved && savedFor !== projectId) setSavedFor(projectId)
  useEffect(() => {
    if (reviewSaved) navigate(location.pathname, { replace: true, state: null })
  }, [reviewSaved, location.pathname, navigate])
  const picker = useRef(null)
  const [phoneFor, setPhoneFor] = useState(null) // the Project whose QR dialog is open
  const phoneOpen = phoneFor === projectId
  const projectFiles = useProjectFiles(projectId, { live: phoneOpen })
  const quizNotices = useQuizNotices(projectId)
  const mistakes = useMistakes(projectId)
  const {
    me,
    projects,
    activeProjects,
    upsertProject,
    markOpened,
    forgetProject,
    saveFilesCollapsed,
    markPrivacyAccepted,
    restoreProject,
    purgeProject,
  } = useOutletContext()

  // Privacy notice (Story 2.3, FR-6, §5.3): until the Account has accepted it, Upload, "browse", and
  // a drop open it first; "Got it, upload" saves the acceptance and continues that action.
  const accepted = me?.privacy_notice_accepted === true
  const [notice, setNotice] = useState(null) // { mode: 'ask' | 'info', files?, picker?, phone? }
  const [noticeBusy, setNoticeBusy] = useState(false)
  const [noticeError, setNoticeError] = useState(null)
  const acceptance = useRef(null) // the pending save, which a picker upload waits for
  const gatedUpload = (list) => {
    const chosen = Array.from(list ?? [])
    if (chosen.length === 0) return
    if (accepted) return projectFiles.upload(chosen)
    setNoticeError(null)
    setNotice({ mode: 'ask', files: chosen })
  }
  // A removal may withdraw the file's Mistakes (Story 3.3): the count is read again once it's done.
  const removeFile = async (material, options) => {
    await projectFiles.remove(material, options)
    mistakes.refresh()
  }
  const files = { ...projectFiles, upload: gatedUpload, remove: removeFile }
  async function acceptNotice() {
    const pending = notice
    // The picker opens in this same click, while the browser still allows it.
    if (pending?.picker) picker.current?.click()
    setNoticeBusy(true)
    setNoticeError(null)
    // Resolves true once saved, false on failure; files picked meanwhile upload only if it's true.
    const saving = apiFetch('/api/me/privacy-notice', { method: 'POST' }).then(
      () => true,
      (err) => {
        if (!SIGNED_OUT_CODES.has(err?.code)) setNoticeError(errorText(t, err))
        return false
      },
    )
    acceptance.current = saving
    const saved = await saving
    setNoticeBusy(false)
    if (!saved) return
    acceptance.current = null
    markPrivacyAccepted?.()
    setNotice(null)
    if (pending?.files) projectFiles.upload(pending.files)
    if (pending?.phone) setPhoneFor(projectId)
  }
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

  // The shell's copy wins once loaded, so archiving or restoring from the Sidebar or the Undo
  // message shows here at once (Story 7.1).
  const project = loaded?.id === projectId ? (projects?.find((p) => p.id === projectId) ?? loaded.project) : null
  const failed = error?.id === projectId ? error.apiError : null
  const listed = files.materials !== null || files.loadError !== null
  // The profile must have loaded too: until then it isn't known whether the notice is needed.
  const ready = project !== null && listed && me !== null && me !== undefined
  const readOnly = Boolean(project?.archived_at || project?.deleted_at)
  const archived = Boolean(project?.archived_at && !project?.deleted_at)
  const deleted = Boolean(project?.deleted_at)
  // The Project whose restore is in flight, so another Project's banner is never busy.
  const [restoringId, setRestoringId] = useState(null)
  const restoring = restoringId === projectId
  const restore = async () => {
    if (restoring) return
    const id = projectId
    setRestoringId(id)
    // The shell's copy of the Project updates on success, which this page shows.
    await restoreProject?.(id)
    setRestoringId((current) => (current === id ? null : current))
  }
  // The Project whose delete-forever dialog is open (from the Deleted banner), or null.
  const [purging, setPurging] = useState(null)
  const anyReady = (files.materials ?? []).some((m) => m.status === 'ready')

  // Auto-naming (Story 2.4b, FR-4, AD-14): the server names an unnamed Project after a file turns
  // Ready. When a file turns Ready in this view while the Project has no name, the Project is read
  // again every 2 s, for at most 30 s, until it has one; the Top bar and the Sidebar then show it.
  // The first list of a Project is only the baseline, so opening one never starts re-reading.
  const shown = activeProjects?.find((p) => p.id === projectId) ?? project
  const unnamed = project !== null && !shown?.name
  const readyCount = files.materials ? files.materials.filter((m) => m.status === 'ready').length : null
  const [readySeen, setReadySeen] = useState({ id: null, count: 0 })
  const [naming, setNaming] = useState(null) // { id, round }: a new round restarts the 30 s
  if (readyCount !== null && (readySeen.id !== projectId || readySeen.count !== readyCount)) {
    const rose = readySeen.id === projectId && readyCount > readySeen.count
    setReadySeen({ id: projectId, count: readyCount })
    if (rose && unnamed) setNaming({ id: projectId, round: (naming?.round ?? 0) + 1 })
  }
  const namingRound = naming?.id === projectId && unnamed ? naming.round : null
  useEffect(() => {
    if (namingRound === null) return undefined
    let live = true
    const handle = { timer: null, tries: 0 }
    const tick = async () => {
      handle.tries += 1
      try {
        const fresh = await apiFetch(`/api/projects/${projectId}`)
        if (!live) return
        if (fresh?.name) {
          setLoaded((state) => (state?.id === projectId ? { id: projectId, project: fresh } : state))
          upsertProject(fresh)
          return
        }
      } catch (err) {
        if (SIGNED_OUT_CODES.has(err?.code) || GONE.has(err?.code)) return
        // anything else is retried on the next tick
      }
      if (live && handle.tries < NAME_WAIT_MS / NAME_POLL_MS) handle.timer = setTimeout(tick, NAME_POLL_MS)
    }
    handle.timer = setTimeout(tick, NAME_POLL_MS)
    return () => {
      live = false
      clearTimeout(handle.timer)
    }
  }, [namingRound, projectId, upsertProject])

  // After ×, focus goes to the notice that took its place (or the one above), else to the first
  // enabled tool button, else to the tools row itself (EXPERIENCE.md › Accessibility).
  const noticeBox = useRef(null)
  const toolsRow = useRef(null)
  const focusAfter = useRef(null) // { id, index } of the notice being dismissed
  const shownNotices = quizNotices.notices
  useEffect(() => {
    const pending = focusAfter.current
    if (!pending || shownNotices.some((job) => job.id === pending.id)) return
    focusAfter.current = null
    const opens = noticeBox.current?.querySelectorAll('[data-notice-open]') ?? []
    const target =
      opens[Math.min(pending.index, opens.length - 1)] ??
      toolsRow.current?.querySelector('button:not(:disabled)') ??
      toolsRow.current
    target?.focus()
  }, [shownNotices])

  const drop = useDropTarget(files.upload, ready && !readOnly)
  // Files dragged anywhere over the window: the full-screen drop overlay, uploading to this Project.
  const windowDrop = useWindowFileDrop(files.upload, ready && !readOnly)
  useBlockWindowFileDrop()

  const openPicker = () => {
    if (accepted) return picker.current?.click()
    setNoticeError(null)
    setNotice({ mode: 'ask', picker: true })
  }
  const openPhone = () => {
    if (readOnly) return
    if (accepted) return setPhoneFor(projectId)
    setNoticeError(null)
    setNotice({ mode: 'ask', phone: true })
  }

  return (
    <div className={styles.home} aria-busy={!ready && !failed}>
      {windowDrop.active && <DropOverlay handlers={windowDrop.handlers} />}
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
          const chosen = Array.from(event.target.files ?? [])
          event.target.value = ''
          // A picker opened by "Got it, upload" waits for the acceptance; if saving it failed, the
          // picked files are dropped (the server would refuse them).
          const saving = acceptance.current ?? Promise.resolve(true)
          saving.then((saved) => saved && projectFiles.upload(chosen))
        }}
      />
      <section className={styles.chat}>
        <div className={styles.chatInner}>
          {/* Archived banner (Story 7.1, FR-23): read-only until Restore. */}
          {archived && (
            <div className={styles.banner} data-testid="archived-banner">
              <span className={styles.bannerLabel}>{t('project.archivedBanner')}</span>
              <button type="button" className={styles.bannerRestore} onClick={restore} aria-busy={restoring}>
                {t('projects.restore')}
              </button>
            </div>
          )}
          {/* Deleted banner (Story 7.2a, FR-24): read-only, with the days left, until Restore. */}
          {deleted && (
            <div className={styles.banner} data-testid="deleted-banner">
              <span className={styles.bannerLabel}>{t('projects.daysLeft', { count: daysLeft(project) })}</span>
              <div className={styles.bannerActions}>
                <button type="button" className={styles.bannerRestore} onClick={restore} aria-busy={restoring}>
                  {t('projects.restore')}
                </button>
                <button
                  type="button"
                  className={styles.bannerPurge}
                  disabled={restoring}
                  onClick={() => setPurging(project)}
                >
                  {t('projects.purge')}
                </button>
              </div>
            </div>
          )}
          {/* Mistakes card (Story 3.3): only in an active Project, never at 0. */}
          {project !== null && !readOnly && (
            <MistakesCard count={mistakes.outstanding} onStart={() => navigate(`/projects/${projectId}/review`)} />
          )}
          {savedFor === projectId && (
            <p className={styles.saved} role="status">
              {t('review.saved')}
            </p>
          )}
          {/* A polite live region, present from the start so a notice that arrives is announced. */}
          <div ref={noticeBox} className={styles.notices} aria-live="polite" data-testid="ready-notices">
            {quizNotices.notices.map((job, index) => (
              <ReadyNotice
                key={job.id}
                kind={job.kind}
                labels={job.topic_labels}
                fileName={job.file_name}
                onOpen={() => {
                  if (!quizNotices.open(job)) return
                  if (job.kind === 'review_round') navigate(`/projects/${projectId}/review/${job.result_ref}`)
                  else if (job.kind === 'flashcards') navigate(`/projects/${projectId}/flashcard-sets/${job.result_ref}`)
                  else if (job.kind === 'summary') navigate(`/projects/${projectId}/summaries/${job.result_ref}`)
                  else navigate(`/projects/${projectId}/quizzes/${job.result_ref}`)
                }}
                onDismiss={async () => {
                  focusAfter.current = { id: job.id, index }
                  const dismissed = await quizNotices.dismiss(job)
                  // A failed × keeps the notice, and focus stays on its ×.
                  if (!dismissed && focusAfter.current?.id === job.id) focusAfter.current = null
                }}
              />
            ))}
          </div>
          {failed && <ErrorLine>{errorText(t, failed)}</ErrorLine>}
          {/* The chat (Story 4.4): Chat bar, thread, tool buttons row, composer. Until a file is Ready, the
              Upload drop zone (or the skeleton while loading) takes the Chat bar's and thread's place. */}
          <ProjectChat
            // Keyed by Project: a chat's thread, draft, and stream never carry over.
            key={projectId}
            projectId={projectId}
            enabled={ready && anyReady}
            readOnly={readOnly}
            materials={files.materials}
            placeholder={
              ready ? (
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
                        browse: (
                          <button type="button" className={styles.browse} onClick={openPicker} disabled={readOnly} />
                        ),
                      }}
                    />
                  </p>
                  <p className={styles.dropTypes}>{t('files.types')}</p>
                  <p className={styles.dropOr}>{t('login.or')}</p>
                  <button type="button" className={styles.phone} onClick={openPhone} disabled={readOnly}>
                    {t('files.uploadPhone')}
                  </button>
                </div>
              ) : failed ? null : (
                <div className={`${styles.skeleton} ${styles.skeletonChat}`} aria-hidden="true" />
              )
            }
            tools={
              // Tool buttons row, labelled "Study this material": Quiz (Story 3.1a), Flashcards (Story
              // 4.1), and Summarize (Story 4.3), disabled until a file is Ready and while read-only.
              <div
                ref={toolsRow}
                className={styles.tools}
                data-testid="tools-row"
                tabIndex={-1}
                role="group"
                aria-label={t('tools.label')}
              >
                <span className={styles.toolsLabel} aria-hidden="true">
                  {t('tools.label')}
                </span>
                <button
                  type="button"
                  className={styles.tool}
                  disabled={!ready || !anyReady || readOnly}
                  onClick={() => navigate(`/projects/${projectId}/quiz`)}
                >
                  {t('tools.quiz')}
                </button>
                <button
                  type="button"
                  className={styles.tool}
                  disabled={!ready || !anyReady || readOnly}
                  onClick={() => navigate(`/projects/${projectId}/flashcards`)}
                >
                  {t('tools.flashcards')}
                </button>
                <button
                  type="button"
                  className={styles.tool}
                  disabled={!ready || !anyReady || readOnly}
                  onClick={() => navigate(`/projects/${projectId}/summarize`)}
                >
                  {t('tools.summarize')}
                </button>
              </div>
            }
          />
        </div>
      </section>
      <FilesPanel
        // Keyed by Project: an open Remove dialog or a removal error never carries over (Story 2.7).
        key={projectId}
        files={files}
        // Null until the summary is known: the dialog's checkbox stays hidden until then (Story 3.3).
        mistakesByMaterial={mistakes.known ? mistakes.byMaterial : null}
        onRemoveOpen={mistakes.refresh}
        loading={!ready && !failed}
        readOnly={readOnly}
        onBrowse={openPicker}
        onPhone={openPhone}
        collapsed={filesCollapsed}
        onToggle={toggleFiles}
        onPrivacyInfo={() => {
          setNoticeError(null)
          setNotice({ mode: 'info' })
        }}
      />
      <PrivacyNotice
        mode={notice?.mode ?? null}
        busy={noticeBusy}
        error={noticeError}
        onAccept={acceptNotice}
        onClose={() => setNotice(null)}
      />
      <PurgeProjectDialog
        project={purging}
        onPurge={(target) => purgeProject(target.id)}
        onClose={() => setPurging(null)}
      />
      <QrDialog
        open={phoneOpen && ready && !readOnly}
        projectId={projectId}
        materials={files.materials}
        onClose={() => setPhoneFor(null)}
      />
    </div>
  )
}

// Below this width the Files panel starts collapsed, whatever the saved choice (DESIGN.md › Layout).
function isNarrow() {
  return typeof window !== 'undefined' && window.innerWidth < 1024
}
