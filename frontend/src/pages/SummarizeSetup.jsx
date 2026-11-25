import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import InlineError from '../components/InlineError.jsx'
import { tileLabel } from '../components/fileStatus.js'
import { COLLAPSE_ABOVE, groupTopics } from '../components/topicGroups.js'
import { errorText } from '../i18n/errors.js'
import GenerationJobProgress from './GenerationJobProgress.jsx'
import styles from './QuizSetup.module.css'
import own from './SummarizeSetup.module.css'
import { SUMMARY } from './generationKinds.js'
import { useGenerationJob } from './useGenerationJob.js'

// Summarize setup and generation (Story 4.3, FR-15, FR-26, AD-7, AD-20; DESIGN.md › Activity header,
// Summarize setup, Progress steps, Inline error; EXPERIENCE.md › Summarize setup, State Patterns ›
// Generating; mock key-summary.html).
//
// - "Make a summary", then "Which file?": one radio row per Ready file (file-type tile, name, and its
//   Topic count as muted metadata), the first preselected; the selected row uses the primary border on
//   primary-subtle. Then "Narrow to one topic (optional)": a radio group of Topic chips led by "Whole
//   file" (the default), grouped and collapsed like the Topic list. The Topic choices follow the file:
//   choosing another file resets the Topic to "Whole file". Both are native radio groups, so arrow keys
//   move inside a group and Tab leaves it. There is no Count picker.
// - Nothing is sent until "Make summary", which queues a `summary` job `{material_id, topic_id}`; the
//   shared generation lifecycle (useGenerationJob) shows the Progress steps ("Writing the summary"),
//   resumes a running summary job, and handles Cancel and failure with both choices kept. Done opens
//   the Summary view, replacing the setup in the history.
// - No Ready file: the Inline error says there isn't enough ready material; the button stays disabled.
//   Archived or deleted: read-only, nothing can be made.
const GONE = new Set(['not_found', 'invalid_request'])

export default function SummarizeSetup() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projectId } = useParams()
  const [loaded, setLoaded] = useState(null) // { id, project, materials }
  const [loadError, setLoadError] = useState(null) // { id, error }
  const [fileId, setFileId] = useState(null) // null: the first Ready file
  const [topicId, setTopicId] = useState(null) // null: "Whole file"
  const [open, setOpen] = useState(() => new Map()) // group rows the student toggled
  const [running, setRunning] = useState(null) // the file name shown while generating
  const generation = useGenerationJob(SUMMARY, projectId)
  const { phase, failure, cancelled, errorBox, setupHeading } = generation

  useEffect(() => {
    let live = true
    // A summary job still running for this Project (the student left and came back) resumes its progress.
    const active = generation.findActive()
    Promise.all([apiFetch(`/api/projects/${projectId}`), apiFetch(`/api/projects/${projectId}/materials`), active])
      .then(([project, materials, job]) => {
        if (!live) return
        const list = Array.isArray(materials) ? materials : []
        setLoaded({ id: projectId, project, materials: list })
        if (job) {
          setRunning(job.file_name ?? null)
          // The resumed job's choices, so a cancel or a failure keeps (and "Try again" resends) them.
          const jobFile = list.find((m) => m.status === 'ready' && m.file_name === job.file_name)
          if (jobFile) {
            setFileId(jobFile.id)
            const label = job.topic_labels?.[0]
            const jobTopic = label === undefined ? null : (jobFile.topics ?? []).find((item) => item.label === label)
            if (jobTopic) setTopicId(jobTopic.id)
          }
        }
        generation.resume(job)
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
  }, [projectId, navigate])

  // Back on the setup after a cancel or a failure: read the files again, so a file removed meanwhile is
  // no longer offered (the choice then falls back to the first Ready file).
  const lastPhase = useRef(phase)
  useEffect(() => {
    const previous = lastPhase.current
    lastPhase.current = phase
    if (previous !== 'generating' || phase !== 'setup') return undefined
    let live = true
    apiFetch(`/api/projects/${projectId}/materials`)
      .then((materials) => {
        if (live && Array.isArray(materials)) {
          setLoaded((current) => (current?.id === projectId ? { ...current, materials } : current))
        }
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [phase, projectId])

  const data = loaded?.id === projectId ? loaded : null
  const failedLoad = loadError?.id === projectId ? loadError.error : null
  const project = data?.project ?? null
  const readOnly = Boolean(project?.archived_at || project?.deleted_at)
  const files = (data?.materials ?? []).filter((m) => m.status === 'ready')
  const file = files.find((f) => f.id === fileId) ?? files[0] ?? null
  const fileTopics = file?.topics ?? []
  const topic = fileTopics.find((item) => item.id === topicId) ?? null
  const canMake = phase === 'setup' && Boolean(data) && !readOnly && Boolean(file)

  function chooseFile(id) {
    setFileId(id)
    setTopicId(null)
  }

  const make = () => {
    if (!file) return
    setRunning(file.file_name)
    generation.make({ material_id: file.id, topic_id: topic?.id ?? null })
  }
  const backToChat = () => navigate(`/projects/${projectId}`)

  function chip(item) {
    const selected = topic?.id === item.id
    return (
      <li key={item.id}>
        <label className={`${styles.chip} ${own.chip} ${selected ? styles.selected : ''}`} title={item.label}>
          <input
            type="radio"
            name="summary-topic"
            className={styles.radio}
            value={item.id}
            checked={selected}
            onChange={() => setTopicId(item.id)}
          />
          {item.label}
        </label>
      </li>
    )
  }

  function topicRuns() {
    const runs = groupTopics(fileTopics)
    const collapsed = fileTopics.length > COLLAPSE_ABOVE
    return runs.map((run, index) => {
      if (run.label === null) {
        return (
          <ul key={index} className={styles.chips}>
            {run.items.map(chip)}
          </ul>
        )
      }
      const key = `${file.id}:${index}`
      // A group holding the chosen Topic stays open, so the checked radio is always shown.
      const holds = run.items.some((item) => item.id === topic?.id)
      const expanded = holds || (open.get(key) ?? !collapsed)
      const bodyId = `summary-group-${file.id}-${index}`
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
          {t(SUMMARY.tool)}
          {phase === 'generating' && running && <span className={styles.scope}>{` · ${running}`}</span>}
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
            {t('summary.title')}
          </h2>
          {readOnly && <InlineError>{errorText(t, { code: 'project_read_only' })}</InlineError>}
          {cancelled && (
            <p className={styles.cancelled} role="status">
              {t('summary.cancelled')}
            </p>
          )}

          <fieldset className={styles.field}>
            <legend className={styles.label}>{t('summary.file')}</legend>
            {files.length > 0 ? (
              <ul className={own.files}>
                {files.map((item) => {
                  const selected = file?.id === item.id
                  const count = item.topics?.length ?? 0
                  return (
                    <li key={item.id}>
                      <label className={`${own.file} ${selected ? own.fileOn : ''}`}>
                        <input
                          type="radio"
                          name="summary-file"
                          className={own.fileRadio}
                          value={item.id}
                          checked={selected}
                          onChange={() => chooseFile(item.id)}
                        />
                        <span className={own.tile} aria-hidden="true">
                          {tileLabel(item)}
                        </span>
                        <span className={own.body}>
                          <span className={own.name} title={item.file_name}>
                            {item.file_name}
                          </span>{' '}
                          {count > 0 && <span className={own.meta}>{t('files.topics.count', { count })}</span>}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            ) : (
              !readOnly && (
                <div className={styles.error}>
                  <InlineError>{errorText(t, { code: 'insufficient_material' })}</InlineError>
                </div>
              )
            )}
          </fieldset>

          {file && (
            <fieldset className={styles.field}>
              <legend className={styles.label}>{t('summary.topic')}</legend>
              <div className={styles.picker}>
                <ul className={styles.chips}>
                  <li>
                    <label className={`${styles.chip} ${own.chip} ${topic === null ? styles.selected : ''}`}>
                      <input
                        type="radio"
                        name="summary-topic"
                        className={styles.radio}
                        value=""
                        checked={topic === null}
                        onChange={() => setTopicId(null)}
                      />
                      {t('summary.wholeFile')}
                    </label>
                  </li>
                </ul>
                {topicRuns()}
              </div>
            </fieldset>
          )}

          {failure && (
            <div ref={errorBox} className={styles.error}>
              <InlineError onRetry={failure.retry ? make : undefined}>{failure.message}</InlineError>
            </div>
          )}

          <button type="button" className={styles.primary} disabled={!canMake} onClick={make}>
            {t('summary.make')}
          </button>
        </section>
      )}

      {phase === 'generating' && <GenerationJobProgress copy={SUMMARY.copy} generation={generation} />}
    </div>
  )
}
