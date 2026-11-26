import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useParams } from 'react-router'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import InlineError from '../components/InlineError.jsx'
import { COLLAPSE_ABOVE, groupTopics } from '../components/topicGroups.js'
import { errorText } from '../i18n/errors.js'
import styles from './QuizSetup.module.css'
import GenerationJobProgress from './GenerationJobProgress.jsx'
import { COUNTS, requestCount } from './quizCounts.js'
import { useGenerationJob } from './useGenerationJob.js'

// The shared setup and generation flow for a Quiz (Story 3.1a) and a flashcard set (Story 4.1) (FR-10,
// FR-13, FR-26, AD-7, AD-20; DESIGN.md › Activity header, Topic scope picker, Count picker,
// Too-little-material note, Progress steps, Inline error; EXPERIENCE.md › Quiz, Flashcards, State
// Patterns › Generating; mock key-quiz-feedback.html states 0a-0c). `kind` (generationKinds.js)
// names what differs: the job kind, the request endpoint, the capacity field, the copy's i18n section,
// and where a finished job goes.
//
// - Setup: "Which topics?" with "All topics" first, then each Ready file's Topic chips, grouped like the
//   Topic list; the count (5 / 10 / 20, default 10). The capacity endpoint says how many items the scope
//   supports; below the chosen count the Too-little-material note offers that many and the primary
//   button stays disabled until the count fits. Until the capacity is known the button stays disabled:
//   a failed capacity read shows the Inline error with "Try again" (read it again), and a scope with no
//   Ready material says so. The API takes only 5, 10, or 20, so an offered count is sent as the next of
//   those up; the server freezes the count cut to the capacity.
// - "Make {n} questions" / "Make {n} cards" queues the job; the generation lifecycle (progress, resuming
//   a running job, cancel, failure with "Try again", and moving on to the result: the Quiz page, or the
//   flashcard set's page) is the shared useGenerationJob, also used by Summarize (Story 4.3).
// - "Do it again" (Story 5.2) navigates here with `state.job_id`: the page follows exactly that job,
//   whatever its status (a finished one moves on to its result or shows its failure).
// - Archived or deleted: read-only, nothing can be made.
export { POLL_MS } from './useGenerationJob.js'
export const DEFAULT_COUNT = 10
const GONE = new Set(['not_found', 'invalid_request'])

export default function GenerationSetup({ kind }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { projectId } = useParams()
  // "Do it again" (Story 5.2) arrives with its job id: follow exactly that job.
  const againJobId = useLocation().state?.job_id ?? null
  const [loaded, setLoaded] = useState(null) // { id, project, materials }
  const [loadError, setLoadError] = useState(null) // { id, error }
  const [allTopics, setAllTopics] = useState(true)
  const [chosen, setChosen] = useState([]) // Topic ids, when not "All topics"
  const [count, setCount] = useState(DEFAULT_COUNT)
  const [capacity, setCapacity] = useState(null) // { key, max } or { key, error }
  const [open, setOpen] = useState(() => new Map()) // group rows the student toggled
  const [capacityAttempt, setCapacityAttempt] = useState(0)
  const generation = useGenerationJob(kind, projectId)
  const { phase, failure, cancelled, errorBox, setupHeading } = generation

  useEffect(() => {
    let live = true
    // A job of this kind still running for this Project (the student left and came back) resumes its progress.
    const running = generation.findActive(againJobId)
    Promise.all([apiFetch(`/api/projects/${projectId}`), apiFetch(`/api/projects/${projectId}/materials`), running])
      .then(([project, materials, active]) => {
        if (!live) return
        setLoaded({ id: projectId, project, materials: Array.isArray(materials) ? materials : [] })
        generation.resume(active)
      })
      .catch((err) => {
        if (!live || SIGNED_OUT_CODES.has(err?.code)) return
        if (GONE.has(err?.code)) navigate('/projects', { replace: true })
        else setLoadError({ id: projectId, error: err })
      })
    return () => {
      live = false
    }
    // `generation`'s helpers only use setters and the request helpers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, navigate, kind.kind, againJobId])

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
      .then((answer) => request.live && setCapacity({ key: scopeKey, max: answer?.[kind.capacity] ?? null }))
      .catch((err) => request.live && !SIGNED_OUT_CODES.has(err?.code) && setCapacity({ key: scopeKey, error: err }))
    return () => {
      request.live = false
    }
  }, [data, anyReady, projectId, scopeKey, capacityAttempt, kind.capacity])

  const known = capacity?.key === scopeKey ? capacity : null
  const maxItems = known && !known.error ? known.max : null
  const tooLittle = maxItems !== null && maxItems < count
  const capacityError = known?.error && !SIGNED_OUT_CODES.has(known.error.code) ? known.error : null
  const noMaterial = (data && !anyReady) || capacityError?.code === 'insufficient_material'
  const canMake = phase === 'setup' && Boolean(data) && !readOnly && maxItems !== null && !tooLittle
  const retryCapacity = () => {
    setCapacity(null)
    setCapacityAttempt((attempt) => attempt + 1)
  }

  const make = () => generation.make({ scope, count: requestCount(count) })

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
    ? t(`${kind.copy}.allTopics`)
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
      const bodyId = `${kind.kind}-group-${file.id}-${index}`
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
          {t(kind.tool)}
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
            {t(`${kind.copy}.title`)}
          </h2>
          {readOnly && <InlineError>{errorText(t, { code: 'project_read_only' })}</InlineError>}
          {cancelled && (
            <p className={styles.cancelled} role="status">
              {t(`${kind.copy}.cancelled`)}
            </p>
          )}

          <fieldset className={styles.field}>
            <legend className={styles.label}>{t(`${kind.copy}.topics`)}</legend>
            <div className={styles.picker}>
              <ul className={styles.chips}>
                <li>
                  <button
                    type="button"
                    className={`${styles.chip} ${allTopics ? styles.selected : ''}`}
                    aria-pressed={allTopics}
                    onClick={pickAll}
                  >
                    {t(`${kind.copy}.allTopics`)}
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
            <legend className={styles.label}>{t(`${kind.copy}.count`)}</legend>
            <div className={styles.counts}>
              {COUNTS.map((n) => (
                <label key={n} className={`${styles.count} ${count === n ? styles.countOn : ''}`}>
                  <input
                    type="radio"
                    name={`${kind.kind}-count`}
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
                {t(`${kind.copy}.tooLittle`, { count: maxItems })}{' '}
                <button type="button" className={styles.offer} onClick={() => setCount(maxItems)}>
                  {t(`${kind.copy}.makeInstead`, { count: maxItems })}
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
            {t(`${kind.copy}.make`, { count })}
          </button>
        </section>
      )}

      {phase === 'generating' && <GenerationJobProgress copy={kind.copy} generation={generation} />}
    </div>
  )
}
