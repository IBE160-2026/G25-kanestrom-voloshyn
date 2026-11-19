import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import InlineError from '../components/InlineError.jsx'
import QuestionView from '../components/QuestionView.jsx'
import { errorText } from '../i18n/errors.js'
import layout from './QuizPage.module.css'
import styles from './ReviewSession.module.css'

// A Mistake Review session (Story 3.5, FR-18, AD-9, AD-10, AD-11; DESIGN.md › Mistake Review session,
// All cleared panel, Round done panel; EXPERIENCE.md › Mistake Review session, All cleared panel, Round
// done panel; mock key-mistake-review.html).
//
// - One practice question at a time, like a Quiz question (the shared QuestionView): keys 1–4, the
//   Feedback panel with its sources, no auto-advance, "Next mistake" (→). Above it, the context card:
//   the original question and "Your earlier answer" with that answer's text (and, once answered, the
//   original's correct answer), plus "The file this came from was removed." when it was.
// - The progress line reads "{n} of {m} cleared": a Mistake counts as cleared only once the server has
//   saved the correct answer. A failed save shows the Inline error with "Try again"; the Mistake stays
//   counted. A refusal that names a rule shows only its message; `project_read_only` makes it read-only.
// - "Stop for now" and "← Back to chat" return to the chat with "Your progress is saved." (no panel).
// - Round done panel: once every item is answered and Mistakes remain, "Round done. {n} mistakes still
//   to review." with "Review mistakes" (a new round, Progress steps first) and "← Back to chat".
// - All cleared panel: only once the last outstanding Mistake's clear is saved, "All cleared! Nice
//   work." with "Make a new quiz" and "← Back to chat"; the Mistakes card is then gone. No animation.
// - Reopening a round part-way starts at its first unanswered item. A round still being made goes to the
//   progress view; a failed or cancelled one shows its message.
// - A `from_original` item (the same question as the Quiz's) shows "Your earlier answer" only once answered.
const SAVE_RULES = new Set(['project_read_only', 'not_found'])

/** Where a reopened round starts: its first unanswered item, else its last (with the end panel). */
function startAt(items) {
  const index = items.findIndex((item) => !item.answer)
  return index === -1 ? items.length - 1 : index
}

export default function ReviewSession() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projectId, roundId } = useParams()
  const key = `${projectId}/${roundId}`
  const [loaded, setLoaded] = useState(null) // { key, project, round }
  const [loadError, setLoadError] = useState(null) // { key, error }
  const [at, setAt] = useState(null) // { key, index }
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null) // { itemId, optionId, error, rule }
  const [refusedKey, setRefusedKey] = useState(null) // the round whose save said project_read_only
  const [attempt, setAttempt] = useState(0) // load attempts ("Try again")
  const panelHeading = useRef(null)
  const panelShown = useRef(false)

  useEffect(() => {
    let live = true
    Promise.allSettled([
      apiFetch(`/api/projects/${projectId}`),
      apiFetch(`/api/projects/${projectId}/review-rounds/${roundId}`),
    ]).then(([project, round]) => {
      if (!live) return
      const failed = project.status === 'rejected' ? project.reason : round.status === 'rejected' ? round.reason : null
      if (failed) {
        if (SIGNED_OUT_CODES.has(failed?.code)) return
        if (project.status === 'rejected' && failed?.code === 'not_found') navigate('/projects', { replace: true })
        else setLoadError({ key, error: failed })
        return
      }
      const items = Array.isArray(round.value?.items) ? round.value.items : []
      if (items.length === 0) {
        const status = round.value?.status
        // Still being made: the progress view, which follows the Project's running round.
        if (status === 'queued' || status === 'running') {
          navigate(`/projects/${projectId}/review`, { replace: true })
          return
        }
        // Failed or cancelled: its message (the generic one unless it names a rule); else not found.
        const failedRound = status === 'failed' || status === 'cancelled'
        const code = failedRound ? (round.value?.error_code ?? 'generic') : 'not_found'
        setLoadError({ key, error: { code, params: {} }, final: true })
        return
      }
      setLoaded({ key, project: project.value, round: { ...round.value, items } })
      setAt({ key, index: startAt(items) })
    })
    return () => {
      live = false
    }
  }, [projectId, roundId, key, navigate, attempt])

  const data = loaded?.key === key ? loaded : null
  const failedLoad = loadError?.key === key ? loadError.error : null
  const finalLoad = loadError?.key === key && loadError.final
  const project = data?.project ?? null
  const readOnly = Boolean(project?.archived_at || project?.deleted_at || refusedKey === key)
  const round = data?.round ?? null
  const items = round?.items ?? []
  const total = items.length
  const index = at?.key === key ? at.index : null
  const item = typeof index === 'number' ? items[index] : null
  const answer = item?.answer ?? null
  const isLast = typeof index === 'number' && index === total - 1
  const answeredCount = items.filter((i) => i.answer).length
  const remaining = round?.remaining_outstanding ?? 0
  const failedSave = saveError && saveError.itemId === item?.id ? saveError : null
  // All cleared: nothing is outstanding any more, once a clear is saved or the round has ended (also
  // when its Mistakes were withdrawn elsewhere). Round done: every item answered, some still left.
  const cleared = round?.cleared_count ?? 0
  const ended = answeredCount === total
  const panel = !round ? null : remaining === 0 && (cleared > 0 || ended) ? 'cleared' : ended ? 'done' : null

  // The end panel's headline takes focus when it appears (EXPERIENCE.md › Accessibility).
  useEffect(() => {
    if (panel && !panelShown.current) panelHeading.current?.focus()
    panelShown.current = Boolean(panel)
  }, [panel])

  async function submit(optionId) {
    if (!item || answer || saving || readOnly) return
    const itemId = item.id
    setSaving(true)
    setSaveError(null)
    try {
      const answered = await apiFetch(
        `/api/projects/${projectId}/review-rounds/${roundId}/items/${itemId}/answer`,
        { method: 'POST', body: { option_id: optionId } },
      )
      const shown = { ...answered }
      for (const field of ['cleared', 'cleared_count', 'remaining_outstanding']) delete shown[field]
      setLoaded((current) =>
        current?.key === key
          ? {
              ...current,
              round: {
                ...current.round,
                cleared_count: answered.cleared_count,
                remaining_outstanding: answered.remaining_outstanding,
                items: current.round.items.map((i) => (i.id === itemId ? shown : i)),
              },
            }
          : current,
      )
    } catch (err) {
      if (SIGNED_OUT_CODES.has(err?.code)) return
      if (err?.code === 'project_read_only') setRefusedKey(key)
      else setSaveError({ itemId, optionId, error: err, rule: SAVE_RULES.has(err?.code) })
    } finally {
      setSaving(false)
    }
  }

  function next() {
    if (isLast || panel || !(answer || readOnly)) return
    setAt({ key, index: index + 1 })
  }

  // Leaving part-way keeps every saved answer; the chat says so.
  const leave = () => navigate(`/projects/${projectId}`, { state: { reviewSaved: true } })
  const retryLoad = () => {
    setLoadError(null)
    setAttempt((n) => n + 1)
  }

  function renderContext() {
    const context = item.context ?? {}
    return (
      <div className={styles.context} data-testid="review-context">
        <p className={styles.contextQuestion}>{context.question}</p>
        {/* The original question served again: the earlier wrong pick would be a hint until answered. */}
        {(!item.from_original || item.answer) && (
          <p className={styles.contextLine}>
            <span>{t('review.earlierAnswer')}</span> <span className={styles.yours}>{context.earlier_answer_text}</span>
          </p>
        )}
        {context.correct_text && (
          <p className={styles.contextLine}>
            <span>{t('quiz.correctAnswer')}</span> <span className={styles.right}>{context.correct_text}</span>
          </p>
        )}
        {item.file_removed && <p className={styles.removed}>{t('review.fileRemoved')}</p>}
      </div>
    )
  }

  function renderPanel() {
    const allCleared = panel === 'cleared'
    return (
      <div className={styles.panel} data-testid="review-panel">
        <h2 ref={panelHeading} tabIndex={-1} className={`${styles.headline} ${allCleared ? styles.allCleared : ''}`}>
          {allCleared ? t('review.allCleared') : t('review.roundDone', { count: remaining })}
        </h2>
        <div className={styles.panelActions}>
          {allCleared ? (
            <button type="button" className={layout.primary} onClick={() => navigate(`/projects/${projectId}/quiz`)}>
              {t('review.newQuiz')}
            </button>
          ) : (
            <button
              type="button"
              className={layout.primary}
              onClick={() => navigate(`/projects/${projectId}/review`, { replace: true })}
            >
              {t('review.again')}
            </button>
          )}
          <button
            type="button"
            className={layout.ghost}
            onClick={() => navigate(`/projects/${projectId}`, allCleared ? undefined : { state: { reviewSaved: true } })}
          >
            {t('activity.back')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={layout.activity} aria-busy={!data && !failedLoad}>
      <div className={layout.header}>
        <button type="button" className={layout.back} onClick={leave}>
          {t('activity.back')}
        </button>
      </div>

      {failedLoad && (
        <div className={layout.quiz}>
          <InlineError onRetry={finalLoad || failedLoad?.code === 'not_found' ? undefined : retryLoad}>
            {errorText(t, failedLoad)}
          </InlineError>
        </div>
      )}
      {!data && !failedLoad && (
        <div className={layout.quiz}>
          <div className={layout.skeleton} aria-hidden="true" />
        </div>
      )}
      {data && item && (
        <section className={layout.quiz}>
          {readOnly && <InlineError>{errorText(t, { code: 'project_read_only' })}</InlineError>}
          <QuestionView
            progressText={t('review.progress', { n: cleared, m: total })}
            answered={answeredCount}
            total={total}
            tone="mistake"
            before={renderContext()}
            question={item}
            answer={answer}
            disabled={saving || readOnly}
            onAnswer={submit}
            error={
              failedSave
                ? {
                    message: failedSave.rule ? errorText(t, failedSave.error) : t('errors.generic'),
                    onRetry: failedSave.rule ? undefined : () => submit(failedSave.optionId),
                  }
                : null
            }
            canMove={Boolean(answer || readOnly) && !isLast && !panel}
            nextLabel={t('review.next')}
            onNext={next}
            secondary={
              <button type="button" className={layout.ghost} onClick={leave}>
                {t('review.stop')}
              </button>
            }
            footer={panel ? renderPanel() : null}
          />
        </section>
      )}
    </div>
  )
}
