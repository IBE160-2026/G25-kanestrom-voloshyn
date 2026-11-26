import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import { errorText } from '../i18n/errors.js'

// The generation lifecycle shared by every setup page that queues a job (Quiz and Flashcards through
// GenerationSetup, Stories 3.1a + 4.1; Summarize, Story 4.3) (FR-26, AD-20; EXPERIENCE.md › State
// Patterns › Generating, Progress steps, Inline error). `kind` (generationKinds.js) names the job kind,
// the request endpoint, the i18n section of the copy (`{copy}.failed`), and where a finished job goes.
//
// - `findActive()` reads the Project's jobs for one of this kind still queued or running (the student
//   left and came back, or reloaded); the page waits for it with its own first load and hands it to
//   `resume`, so the setup never flashes before the progress view.
// - `make(body)` queues the job (202 {job_id}); the progress then follows its `progress_step`, polled
//   every 2 s, never moving backwards.
// - `cancel()` sends the cancel, then reads the job again: cancelled -> back to setup with the choices
//   kept (`cancelled`); completed meanwhile -> the result page; still running -> it stays on the progress
//   view until the next poll sees it end. A failed cancel request sets `cancelError`.
// - A failed job or request sets `failure` ({ message, retry }): a rule (`scope_too_large`,
//   `insufficient_material`, `material_removed`, ...) shows only its message, anything else the kind's
//   failure line with "Try again".
// - Done: the page moves on to the result, replacing the setup in the history, so Back returns to chat.
// - Focus moves with the view: to the progress steps (`progressRegion`), back to the setup heading
//   (`setupHeading`) after a cancel, or to "Try again" in `errorBox` after a failure.
export const POLL_MS = 2000
export const STEPS = ['reading', 'writing', 'checking']
const ACTIVE = new Set(['queued', 'running'])
// Refusals that name a rule: sending the same request again can't help. A failed job's `error_code`
// is read the same way.
const RULES = new Set([
  'scope_too_large',
  'insufficient_material',
  'material_removed',
  'project_read_only',
  'not_found',
  'invalid_request',
])

export function useGenerationJob(kind, projectId) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [phase, setPhase] = useState('setup') // setup | sending | generating
  const [job, setJob] = useState(null) // { id, reached: index of the furthest step seen }
  const [failure, setFailure] = useState(null) // { message, retry }
  const [cancelled, setCancelled] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState(null)
  const errorBox = useRef(null)
  const setupHeading = useRef(null)
  const progressRegion = useRef(null)
  const shownPhase = useRef(null)

  /** The job of this kind still queued or running for this Project, or null (also when the read fails).
   * With `jobId` (a "Do it again" job, Story 5.2), exactly that job whatever its status, so one that
   * already ended moves on through `settle`; when it isn't listed, `{ id }` lets the poll settle it. */
  function findActive(jobId = null) {
    const fallback = jobId ? { id: jobId } : null
    return apiFetch(`/api/projects/${projectId}/jobs`).then(
      (list) => {
        const items = Array.isArray(list) ? list : []
        if (jobId) return items.find((item) => item.id === jobId) ?? fallback
        return items.find((item) => item.kind === kind.kind && ACTIVE.has(item.status)) ?? null
      },
      () => fallback,
    )
  }

  /** Show `active`'s progress instead of a new setup. */
  function resume(active) {
    if (!active) return
    setJob({ id: active.id, reached: Math.max(0, STEPS.indexOf(active.progress_step)) })
    setPhase('generating')
  }

  /** Act on the job as last read; true once it has ended (the view has moved on). */
  async function settle(found, jobId, isLive = () => true) {
    const seen = () => apiFetch(`/api/jobs/${jobId}/seen`, { method: 'POST' }).catch(() => {})
    if (found && ACTIVE.has(found.status)) {
      const step = STEPS.indexOf(found.progress_step)
      setJob((current) => (current?.id === jobId ? { ...current, reached: Math.max(current.reached, step) } : current))
      return false
    }
    if (found?.status === 'completed') {
      await seen()
      if (isLive()) navigate(kind.result(projectId, found.result_ref), { replace: true })
      return true
    } else if (found?.status === 'cancelled') {
      setCancelled(true)
      setPhase('setup')
    } else {
      // Failed, or no longer listed: the Inline error on the setup, with the choices kept.
      const code = found?.error_code
      const rule = RULES.has(code)
      setFailure({ message: rule ? errorText(t, { code }) : t(`${kind.copy}.failed`), retry: !rule })
      setPhase('setup')
    }
    setCancelling(false)
    setCancelError(null)
    if (found) seen()
    return true
  }

  // Poll the job while it runs (AD-20).
  const jobId = phase === 'generating' ? job?.id : null
  useEffect(() => {
    if (!jobId) return undefined
    const poll = { live: true, timer: null }
    const tick = async () => {
      try {
        const list = await apiFetch(`/api/projects/${projectId}/jobs`)
        if (!poll.live) return
        const found = (Array.isArray(list) ? list : []).find((item) => item.id === jobId)
        if (await settle(found, jobId, () => poll.live)) return
      } catch (err) {
        if (!poll.live || SIGNED_OUT_CODES.has(err?.code)) return
        // A failed poll is tried again on the next tick.
      }
      if (poll.live) poll.timer = setTimeout(tick, POLL_MS)
    }
    tick()
    return () => {
      poll.live = false
      clearTimeout(poll.timer)
    }
    // `settle` only uses setters and the request helpers; the poll restarts only with a new job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, projectId])

  // Focus follows the view (EXPERIENCE.md › Accessibility): the progress steps, or the setup heading
  // after a cancel ("Try again" takes it after a failure, below).
  useEffect(() => {
    const previous = shownPhase.current
    shownPhase.current = phase
    if (previous === null || previous === phase) return
    if (phase === 'generating') progressRegion.current?.focus()
    else if (phase === 'setup' && previous === 'generating' && !failure?.retry) setupHeading.current?.focus()
  }, [phase, failure])

  // "Try again" takes focus after a failure (EXPERIENCE.md › Inline error).
  useEffect(() => {
    if (failure?.retry) errorBox.current?.querySelector('button')?.focus()
  }, [failure])

  async function make(body) {
    setFailure(null)
    setCancelled(false)
    setPhase('sending')
    try {
      const answer = await apiFetch(`/api/projects/${projectId}/${kind.endpoint}`, { method: 'POST', body })
      setJob({ id: answer.job_id, reached: 0 })
      setPhase('generating')
    } catch (err) {
      setPhase('setup')
      if (SIGNED_OUT_CODES.has(err?.code)) return
      const rule = RULES.has(err?.code)
      setFailure({ message: rule ? errorText(t, err) : t(`${kind.copy}.failed`), retry: !rule })
    }
  }

  async function cancel() {
    const id = job?.id
    if (!id || cancelling) return
    setCancelling(true)
    setCancelError(null)
    try {
      await apiFetch(`/api/jobs/${id}/cancel`, { method: 'POST' })
      const list = await apiFetch(`/api/projects/${projectId}/jobs`)
      const found = (Array.isArray(list) ? list : []).find((item) => item.id === id)
      // Still running: the server ends it at its next step; the poll sees that.
      await settle(found, id)
    } catch (err) {
      setCancelling(false)
      if (!SIGNED_OUT_CODES.has(err?.code)) setCancelError(err)
    }
  }

  return {
    phase,
    job,
    failure,
    cancelled,
    cancelling,
    cancelError,
    findActive,
    resume,
    make,
    cancel,
    errorBox,
    setupHeading,
    progressRegion,
  }
}
