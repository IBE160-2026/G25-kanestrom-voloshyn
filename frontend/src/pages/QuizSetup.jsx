import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import GenerationProgress from '../components/GenerationProgress.jsx'
import InlineError from '../components/InlineError.jsx'
import { COLLAPSE_ABOVE, groupTopics } from '../components/topicGroups.js'
import { errorText } from '../i18n/errors.js'
import styles from './QuizSetup.module.css'
import { COUNTS, requestCount } from './quizCounts.js'

// Quiz setup and generation (Story 3.1a, FR-10, FR-26, AD-7, AD-20; DESIGN.md › Activity header, Topic
// scope picker, Count picker, Too-little-material note, Progress steps, Inline error; EXPERIENCE.md ›
// Quiz, State Patterns › Generating; mock key-quiz-feedback.html states 0a-0c).
//
// - Setup: "Which topics?" with "All topics" first, then each Ready file's Topic chips, grouped like the
//   Topic list; "How many questions?" with 5 / 10 / 20 (default 10). The capacity endpoint says how many
//   questions the scope supports; below the chosen count the Too-little-material note offers that many
//   and the primary button stays disabled until the count fits. Until the capacity is known the button
//   stays disabled: a failed capacity read shows the Inline error with "Try again" (read it again), and
//   a scope with no Ready material says so. The API takes only 5, 10, or 20, so an offered count is sent
//   as the next of those up; the server freezes the count cut to the capacity.
// - "Make {n} questions" queues the job (202 {job_id}); the Progress steps (the shared
//   GenerationProgress) then follow its `progress_step`, polled every 2 s, never moving backwards.
//   Opening the page while a quiz job of this Project is still running (leaving and coming back, or a
//   reload) shows that job's progress instead of a new setup.
// - Cancel sends the cancel, then reads the job again: cancelled -> back to setup with the choices kept
//   and "Cancelled. Your choices are kept."; completed meanwhile -> the Quiz page; still running
//   -> it stays on the progress view until the next poll sees it end. A failed cancel request shows the
//   Inline error on the progress view.
// - A failed job or request shows the Inline error on the setup with "Try again" (which starts a new job
//   from the same choices); a rule (`scope_too_large`, `insufficient_material`, `material_removed`, ...)
//   shows only its message.
// - Done: the page moves on to the Quiz page (Story 3.2), which opens at the first question and says
//   when fewer questions were possible. It replaces the setup in the history, so Back returns to chat.
// - Focus moves with the view: to the progress steps, and back to the setup heading after a cancel (or
//   to "Try again" after a failure).
// - Archived or deleted: read-only, nothing can be made.
export const POLL_MS = 2000
export const DEFAULT_COUNT = 10
const STEPS = ['reading', 'writing', 'checking']
const ACTIVE = new Set(['queued', 'running'])
const GONE = new Set(['not_found', 'invalid_request'])
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

export default function QuizSetup() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { projectId } = useParams()
  const [loaded, setLoaded] = useState(null) // { id, project, materials }
  const [loadError, setLoadError] = useState(null) // { id, error }
  const [allTopics, setAllTopics] = useState(true)
  const [chosen, setChosen] = useState([]) // Topic ids, when not "All topics"
  const [count, setCount] = useState(DEFAULT_COUNT)
  const [capacity, setCapacity] = useState(null) // { key, max } or { key, error }
  const [open, setOpen] = useState(() => new Map()) // group rows the student toggled
  const [phase, setPhase] = useState('setup') // setup | sending | generating
  const [job, setJob] = useState(null) // { id, reached: index of the furthest step seen }
  const [failure, setFailure] = useState(null) // { message, retry }
  const [cancelled, setCancelled] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState(null)
  const [capacityAttempt, setCapacityAttempt] = useState(0)
  const errorBox = useRef(null)
  const setupHeading = useRef(null)
  const progressRegion = useRef(null)
  const shownPhase = useRef(null)

  useEffect(() => {
    let live = true
    // A quiz job still running for this Project (the student left and came back) resumes its progress.
    const running = apiFetch(`/api/projects/${projectId}/jobs`).then(
      (list) => (Array.isArray(list) ? list : []).find((job) => job.kind === 'quiz' && ACTIVE.has(job.status)),
      () => null,
    )
    Promise.all([apiFetch(`/api/projects/${projectId}`), apiFetch(`/api/projects/${projectId}/materials`), running])
      .then(([project, materials, active]) => {
        if (!live) return
        setLoaded({ id: projectId, project, materials: Array.isArray(materials) ? materials : [] })
        if (active) {
          setJob({ id: active.id, reached: Math.max(0, STEPS.indexOf(active.progress_step)) })
          setPhase('generating')
        }
      })
      .catch((err) => {
        if (!live || SIGNED_OUT_CODES.has(err?.code)) return
        if (GONE.has(err?.code)) navigate('/projects', { replace: true })
        else setLoadError({ id: projectId, error: err })
      })
    return () => {
      live = false
    }
  }, [projectId, navigate])

  const data = loaded?.id === projectId ? loaded : null
  const failedLoad = loadError?.id === projectId ? loadError.error : null
  const project = data?.project ?? null
  const readOnly = Boolean(project?.archived_at || project?.deleted_at)
  const files = (data?.materials ?? []).filter((m) => m.status === 'ready' && m.topics?.length)
  const anyReady = (data?.materials ?? []).some((m) => m.status === 'ready')
  const topics = files.flatMap((file) => file.topics)
  const scope = allTopics ? { all_topics: true } : { topic_ids: chosen }
  const scopeKey = JSON.stringify(scope)

  // Capacity for the chosen scope (AD-7): deterministic on the server, no AI call.
  useEffect(() => {
    if (!data || !anyReady) return undefined
    const request = { live: true }
    apiFetch(`/api/projects/${projectId}/capacity?scope=${encodeURIComponent(scopeKey)}`)
      .then((answer) => request.live && setCapacity({ key: scopeKey, max: answer?.max_questions ?? null }))
      .catch((err) => request.live && !SIGNED_OUT_CODES.has(err?.code) && setCapacity({ key: scopeKey, error: err }))
    return () => {
      request.live = false
    }
  }, [data, anyReady, projectId, scopeKey, capacityAttempt])

  const known = capacity?.key === scopeKey ? capacity : null
  const maxQuestions = known && !known.error ? known.max : null
  const tooLittle = maxQuestions !== null && maxQuestions < count
  const capacityError = known?.error && !SIGNED_OUT_CODES.has(known.error.code) ? known.error : null
  const noMaterial = (data && !anyReady) || capacityError?.code === 'insufficient_material'
  const canMake = phase === 'setup' && Boolean(data) && !readOnly && maxQuestions !== null && !tooLittle
  const retryCapacity = () => {
    setCapacity(null)
    setCapacityAttempt((attempt) => attempt + 1)
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
      if (isLive()) navigate(`/projects/${projectId}/quizzes/${found.result_ref}`, { replace: true })
      return true
    } else if (found?.status === 'cancelled') {
      setCancelled(true)
      setPhase('setup')
    } else {
      // Failed, or no longer listed: the Inline error on the setup, with the choices kept.
      const code = found?.error_code
      const rule = RULES.has(code)
      setFailure({ message: rule ? errorText(t, { code }) : t('quiz.failed'), retry: !rule })
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

  async function make() {
    setFailure(null)
    setCancelled(false)
    setPhase('sending')
    try {
      const answer = await apiFetch(`/api/projects/${projectId}/quizzes`, {
        method: 'POST',
        body: { scope, count: requestCount(count) },
      })
      setJob({ id: answer.job_id, reached: 0 })
      setPhase('generating')
    } catch (err) {
      setPhase('setup')
      if (SIGNED_OUT_CODES.has(err?.code)) return
      const rule = RULES.has(err?.code)
      setFailure({ message: rule ? errorText(t, err) : t('quiz.failed'), retry: !rule })
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

  function pickAll() {
    setAllTopics(true)
    setChosen([])
  }

  function toggleTopic(id) {
    const next = chosen.includes(id) ? chosen.filter((item) => item !== id) : [...chosen, id]
    // Keep the server's order, so the same choice is always the same scope.
    const ordered = topics.map((topic) => topic.id).filter((item) => next.includes(item))
    setChosen(ordered)
    setAllTopics(ordered.length === 0)
  }

  const backToChat = () => navigate(`/projects/${projectId}`)
  const scopeLabel = allTopics
    ? t('quiz.allTopics')
    : new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(
        topics.filter((topic) => chosen.includes(topic.id)).map((topic) => topic.label),
      )
  const showScope = phase === 'generating'

  function chip(topic) {
    const selected = !allTopics && chosen.includes(topic.id)
    return (
      <li key={topic.id}>
        <button
          type="button"
          className={`${styles.chip} ${selected ? styles.selected : ''}`}
          aria-pressed={selected}
          title={topic.label}
          onClick={() => toggleTopic(topic.id)}
        >
          {topic.label}
        </button>
      </li>
    )
  }

  function fileTopics(file) {
    const runs = groupTopics(file.topics)
    const collapsed = file.topics.length > COLLAPSE_ABOVE
    return runs.map((run, index) => {
      if (run.label === null) {
        return (
          <ul key={index} className={styles.chips}>
            {run.items.map(chip)}
          </ul>
        )
      }
      const key = `${file.id}:${index}`
      const expanded = open.get(key) ?? !collapsed
      const bodyId = `quiz-group-${file.id}-${index}`
      return (
        <div key={index} className={styles.group}>
          <button
            type="button"
            className={styles.groupRow}
            aria-expanded={expanded}
            aria-controls={expanded ? bodyId : undefined}
            aria-label={t('files.topics.group', { chapter: run.label, count: run.items.length })}
            onClick={() => setOpen((prev) => new Map(prev).set(key, !expanded))}
          >
            <svg className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`} viewBox="0 0 8 8" aria-hidden="true" focusable="false">
              <path d="M2.5 1 5.5 4 2.5 7" fill="none" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            <span className={styles.groupName}>{run.label}</span>
            <span aria-hidden="true">{run.items.length}</span>
          </button>
          {expanded && (
            <ul id={bodyId} className={`${styles.chips} ${styles.groupChips}`}>
              {run.items.map(chip)}
            </ul>
          )}
        </div>
      )
    })
  }

  return (
    <div className={styles.activity} aria-busy={!data && !failedLoad}>
      <div className={styles.header}>
        <button type="button" className={styles.back} onClick={backToChat}>
          {t('activity.back')}
        </button>
        {/* Not a heading: the Top bar holds the page's h1 (the Project name). */}
        <p className={styles.title}>
          {t('tools.quiz')}
          {showScope && <span className={styles.scope}>{` · ${scopeLabel}`}</span>}
        </p>
      </div>

      {failedLoad && (
        <div className={styles.setup}>
          <InlineError>{errorText(t, failedLoad)}</InlineError>
        </div>
      )}
      {!data && !failedLoad && <div className={styles.setup}><div className={styles.skeleton} aria-hidden="true" /></div>}

      {data && (phase === 'setup' || phase === 'sending') && (
        <section className={styles.setup}>
          <h2 ref={setupHeading} tabIndex={-1} className={styles.heading}>
            {t('quiz.title')}
          </h2>
          {readOnly && <InlineError>{errorText(t, { code: 'project_read_only' })}</InlineError>}
          {cancelled && (
            <p className={styles.cancelled} role="status">
              {t('quiz.cancelled')}
            </p>
          )}

          <fieldset className={styles.field}>
            <legend className={styles.label}>{t('quiz.topics')}</legend>
            <div className={styles.picker}>
              <ul className={styles.chips}>
                <li>
                  <button
                    type="button"
                    className={`${styles.chip} ${allTopics ? styles.selected : ''}`}
                    aria-pressed={allTopics}
                    onClick={pickAll}
                  >
                    {t('quiz.allTopics')}
                  </button>
                </li>
              </ul>
              {files.map((file) => (
                <div key={file.id} className={styles.file}>
                  {files.length > 1 && <p className={styles.fileName}>{file.file_name}</p>}
                  {fileTopics(file)}
                </div>
              ))}
            </div>
          </fieldset>

          <fieldset className={styles.field}>
            <legend className={styles.label}>{t('quiz.count')}</legend>
            <div className={styles.counts}>
              {COUNTS.map((n) => (
                <label key={n} className={`${styles.count} ${count === n ? styles.countOn : ''}`}>
                  <input
                    type="radio"
                    name="quiz-count"
                    className={styles.radio}
                    value={n}
                    checked={count === n}
                    onChange={() => setCount(n)}
                  />
                  {n}
                </label>
              ))}
            </div>
            {capacityError && capacityError.code !== 'insufficient_material' && (
              <div className={styles.error}>
                <InlineError onRetry={retryCapacity}>{errorText(t, capacityError)}</InlineError>
              </div>
            )}
            {!readOnly && noMaterial && (
              <div className={styles.error}>
                <InlineError>{errorText(t, { code: 'insufficient_material' })}</InlineError>
              </div>
            )}
            {tooLittle && (
              <p className={styles.note} role="status">
                {t('quiz.tooLittle', { count: maxQuestions })}{' '}
                <button type="button" className={styles.offer} onClick={() => setCount(maxQuestions)}>
                  {t('quiz.makeInstead', { count: maxQuestions })}
                </button>
              </p>
            )}
          </fieldset>

          {failure && (
            <div ref={errorBox} className={styles.error}>
              <InlineError onRetry={failure.retry ? make : undefined}>{failure.message}</InlineError>
            </div>
          )}

          <button type="button" className={styles.primary} disabled={!canMake} onClick={make}>
            {t('quiz.make', { count })}
          </button>
        </section>
      )}

      {phase === 'generating' && job && (
        <GenerationProgress
          ref={progressRegion}
          steps={STEPS.map((step) => t(`quiz.steps.${step}`))}
          current={job.reached}
          onCancel={cancel}
          cancelling={cancelling}
        >
          {cancelError && (
            <div className={styles.error}>
              <InlineError onRetry={cancel}>{errorText(t, cancelError)}</InlineError>
            </div>
          )}
        </GenerationProgress>
      )}
    </div>
  )
}
