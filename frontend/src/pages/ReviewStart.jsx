import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import GenerationProgress from '../components/GenerationProgress.jsx'
import InlineError from '../components/InlineError.jsx'
import { errorText } from '../i18n/errors.js'
import layout from './QuizPage.module.css'

// Starting a Mistake Review round (Story 3.4, FR-17, FR-18, FR-26, AD-11, AD-20; EXPERIENCE.md ›
// Mistake Review session, Progress steps, State Patterns › Generating).
//
// - Opened from the Mistakes card's "Start" (or "Review mistakes" on the Round done panel), never on
//   its own. It asks for a round (`POST .../review-rounds` → 202 {job_id, round_id}) and shows the
//   shared Progress steps "Looking at your mistakes → Writing practice questions", following the job's
//   `progress_step`, polled every 2 s.
// - A `review_round` job of this Project still queued or running (the student left and came back, or a
//   second start answered `409 review_in_progress`) is followed instead of starting another.
// - Done: the session page, replacing this one in the history. Cancel sends the cancel and returns to
//   the chat. "← Back to chat" leaves the job running; the chat then shows "Your practice questions are
//   ready · Open" when it finishes.
// - A failed job or request shows the Inline error with the generic message and "Try again" (which
//   takes focus and asks for a new round); the Mistakes count is unchanged. A refusal that names a rule
//   (read-only, nothing to review) shows only its message.
export const POLL_MS = 2000
const STEPS = ['reading', 'writing']
const KIND = 'review_round'
const ACTIVE = new Set(['queued', 'running'])
const RULES = new Set(['project_read_only', 'insufficient_material', 'not_found', 'invalid_request'])

export default function ReviewStart() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projectId } = useParams()
  const [job, setJob] = useState(null) // { id, reached: index of the furthest step seen }
  const [failure, setFailure] = useState(null) // { code, retry }: a rule's code, or null for the generic text
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState(null)
  const [attempt, setAttempt] = useState(0) // start attempts ("Try again")
  const progressRegion = useRef(null)
  const errorBox = useRef(null)

  const chat = () => navigate(`/projects/${projectId}`)

  // Start: follow a running round of this Project, or ask for a new one.
  useEffect(() => {
    let live = true
    const findActive = async () => {
      const list = await apiFetch(`/api/projects/${projectId}/jobs`)
      return (Array.isArray(list) ? list : []).find((item) => item.kind === KIND && ACTIVE.has(item.status)) ?? null
    }
    const follow = (found) => setJob({ id: found.id, reached: Math.max(0, STEPS.indexOf(found.progress_step)) })
    ;(async () => {
      try {
        let active = await findActive().catch(() => null)
        if (!active) {
          try {
            const answer = await apiFetch(`/api/projects/${projectId}/review-rounds`, { method: 'POST' })
            if (live) setJob({ id: answer.job_id, reached: 0 })
            return
          } catch (err) {
            if (err?.code !== 'review_in_progress') throw err
            active = await findActive()
            if (!active) throw err
          }
        }
        if (live) follow(active)
      } catch (err) {
        if (!live || SIGNED_OUT_CODES.has(err?.code)) return
        const rule = RULES.has(err?.code)
        setFailure({ code: rule ? err.code : null, retry: !rule })
      }
    })()
    return () => {
      live = false
    }
  }, [projectId, attempt])

  // Poll the job while it runs (AD-20).
  const jobId = failure ? null : job?.id
  useEffect(() => {
    if (!jobId) return undefined
    const poll = { live: true, timer: null }
    const seen = () => apiFetch(`/api/jobs/${jobId}/seen`, { method: 'POST' }).catch(() => {})
    const tick = async () => {
      try {
        const list = await apiFetch(`/api/projects/${projectId}/jobs`)
        if (!poll.live) return
        const found = (Array.isArray(list) ? list : []).find((item) => item.id === jobId)
        if (found && ACTIVE.has(found.status)) {
          const step = STEPS.indexOf(found.progress_step)
          setJob((current) => (current?.id === jobId ? { ...current, reached: Math.max(current.reached, step) } : current))
        } else if (found?.status === 'completed') {
          await seen()
          if (poll.live) navigate(`/projects/${projectId}/review/${found.result_ref}`, { replace: true })
          return
        } else if (found?.status === 'cancelled') {
          navigate(`/projects/${projectId}`, { replace: true })
          return
        } else {
          // Failed, or no longer listed: the Inline error, with the count unchanged. A rule
          // (`insufficient_material`: nothing left to review) shows its message without "Try again".
          if (found) seen()
          const rule = RULES.has(found?.error_code)
          setFailure({ code: rule ? found.error_code : null, retry: !rule })
          return
        }
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
  }, [jobId, projectId, navigate])

  // Focus: the progress steps on open, "Try again" after a failure (EXPERIENCE.md › Accessibility).
  useEffect(() => {
    progressRegion.current?.focus()
  }, [])
  useEffect(() => {
    if (failure?.retry) errorBox.current?.querySelector('button')?.focus()
  }, [failure])

  function retry() {
    setFailure(null)
    setJob(null)
    setCancelError(null)
    setAttempt((n) => n + 1)
  }

  async function cancel() {
    const id = job?.id
    if (!id || cancelling) return
    setCancelling(true)
    setCancelError(null)
    try {
      await apiFetch(`/api/jobs/${id}/cancel`, { method: 'POST' })
      navigate(`/projects/${projectId}`, { replace: true })
    } catch (err) {
      setCancelling(false)
      if (!SIGNED_OUT_CODES.has(err?.code)) setCancelError(err)
    }
  }

  return (
    <div className={layout.activity}>
      <div className={layout.header}>
        <button type="button" className={layout.back} onClick={chat}>
          {t('activity.back')}
        </button>
      </div>
      {failure ? (
        <div ref={errorBox} className={layout.quiz}>
          <InlineError onRetry={failure.retry ? retry : undefined}>
            {failure.code ? errorText(t, { code: failure.code }) : t('errors.generic')}
          </InlineError>
        </div>
      ) : (
        <GenerationProgress
          ref={progressRegion}
          steps={STEPS.map((step) => t(`review.steps.${step}`))}
          current={job?.reached ?? 0}
          onCancel={cancel}
          cancelling={cancelling || !job}
        >
          {cancelError && <InlineError onRetry={cancel}>{errorText(t, cancelError)}</InlineError>}
        </GenerationProgress>
      )}
    </div>
  )
}
