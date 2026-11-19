import { useEffect, useId, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import InlineError from '../components/InlineError.jsx'
import { errorText } from '../i18n/errors.js'
import styles from './QuizPage.module.css'

// Taking a Quiz (Story 3.2, FR-11, AD-9; DESIGN.md › Answer option, Feedback panel, Score summary,
// Progress bar, Key hint, Source label; EXPERIENCE.md › Answer option, Feedback panel, Score summary,
// Keyboard shortcuts; mock key-quiz-feedback.html states 1-2).
//
// - One question at a time with a progress bar and four Answer options. Keys 1–4 or a click answer
//   (desktop Key hints; keys are ignored while focus is in a text input or a modifier is held).
// - The answer is scored and saved by the server; the Feedback panel appears once the save returns, in
//   a polite live region: "Correct", or "Not quite" + "It stays in your review." in the mistake colour,
//   then the explanation and its Source labels. The options then read "Your answer" / "Correct
//   answer"; the others dim. No auto-advance: "Next question" (→), or "See results" on the last.
// - A failed save shows the Inline error with "Try again" (which takes focus); the question stays
//   unanswered. A refusal that names a rule shows only its message; `project_read_only` turns the page
//   read-only. A failed load offers "Try again" too, except for a missing Quiz (or one with no questions).
// - Opening part-way starts at the first unanswered question, or at the Score summary when all are
//   answered. One attempt per Quiz: there is no retake.
// - Score summary: "{correct} of {total} correct", each missed question with both answers, "Missed
//   questions stay in your review.", "← Back to chat" (primary) and "New quiz" (opens Quiz setup).
// - Archived or deleted: the Quiz is readable, its options disabled; "Next question" moves on without an
//   answer, and the summary counts unanswered questions as not correct (listed without "Your answer").
// - The progress bar fills with the answered count; the key hints show "1–4 answer" while the question
//   is open and "→ next" once the student can move on.
// - Focus: "Next question" after an answer, the next question's first option after →, the score after
//   "See results".
const KEYS = { 1: 0, 2: 1, 3: 2, 4: 3 }
const SUMMARY = 'summary'
const ARROW = '→'
const TEXT_INPUT = /^(INPUT|TEXTAREA|SELECT)$/
// Save refusals that name a rule: sending the same answer again can't help.
const SAVE_RULES = new Set(['project_read_only', 'not_found'])

/** Where a reopened Quiz starts: the first unanswered question, or the summary. */
function startAt(questions) {
  const index = questions.findIndex((q) => !q.answer)
  return index === -1 ? SUMMARY : index
}

export default function QuizPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projectId, quizId } = useParams()
  const key = `${projectId}/${quizId}`
  const [loaded, setLoaded] = useState(null) // { key, project, quiz }
  const [loadError, setLoadError] = useState(null) // { key, error }
  const [at, setAt] = useState(null) // { key, index } — a question index, or SUMMARY
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null) // { questionId, optionId, error, rule }
  const [refusedKey, setRefusedKey] = useState(null) // the Quiz whose save said project_read_only
  const [attempt, setAttempt] = useState(0) // load attempts ("Try again")
  const progressId = useId()
  const focusNext = useRef(null) // 'option' | 'next' | 'score': where focus goes after the next render
  const firstOption = useRef(null)
  const nextButton = useRef(null)
  const scoreHeading = useRef(null)
  const errorBox = useRef(null)

  useEffect(() => {
    let live = true
    Promise.allSettled([apiFetch(`/api/projects/${projectId}`), apiFetch(`/api/projects/${projectId}/quizzes/${quizId}`)])
      .then(([project, quiz]) => {
        if (!live) return
        const failed = project.status === 'rejected' ? project.reason : quiz.status === 'rejected' ? quiz.reason : null
        if (failed) {
          if (SIGNED_OUT_CODES.has(failed?.code)) return
          if (project.status === 'rejected' && failed?.code === 'not_found') navigate('/projects', { replace: true })
          else setLoadError({ key, error: failed })
          return
        }
        const questions = Array.isArray(quiz.value?.questions) ? quiz.value.questions : []
        // A Quiz with no questions has nothing to take: shown like a missing one.
        if (questions.length === 0) {
          setLoadError({ key, error: { code: 'not_found', params: {} } })
          return
        }
        setLoaded({ key, project: project.value, quiz: { ...quiz.value, questions } })
        setAt({ key, index: startAt(questions) })
      })
    return () => {
      live = false
    }
  }, [projectId, quizId, key, navigate, attempt])

  const data = loaded?.key === key ? loaded : null
  const failedLoad = loadError?.key === key ? loadError.error : null
  const project = data?.project ?? null
  const readOnly = Boolean(project?.archived_at || project?.deleted_at || refusedKey === key)
  const questions = data?.quiz.questions ?? []
  const total = questions.length
  const index = at?.key === key ? at.index : null
  const question = typeof index === 'number' ? questions[index] : null
  const answer = question?.answer ?? null
  const isLast = typeof index === 'number' && index === total - 1
  const canMove = Boolean(answer) || readOnly
  const answeredCount = questions.filter((q) => q.answer).length
  const failedSave = saveError && saveError.questionId === question?.id ? saveError : null

  async function submit(optionId) {
    if (!question || answer || saving || readOnly) return
    const questionId = question.id
    setSaving(true)
    setSaveError(null)
    try {
      const answered = await apiFetch(
        `/api/projects/${projectId}/quizzes/${quizId}/questions/${questionId}/answer`,
        { method: 'POST', body: { option_id: optionId } },
      )
      setLoaded((current) =>
        current?.key === key
          ? {
              ...current,
              quiz: { ...current.quiz, questions: current.quiz.questions.map((q) => (q.id === questionId ? answered : q)) },
            }
          : current,
      )
      focusNext.current = 'next'
    } catch (err) {
      if (SIGNED_OUT_CODES.has(err?.code)) return
      if (err?.code === 'project_read_only') setRefusedKey(key)
      else setSaveError({ questionId, optionId, error: err, rule: SAVE_RULES.has(err?.code) })
    } finally {
      setSaving(false)
    }
  }

  function next() {
    if (!canMove) return
    if (isLast) {
      focusNext.current = 'score'
      setAt({ key, index: SUMMARY })
    } else {
      focusNext.current = 'option'
      setAt({ key, index: index + 1 })
    }
  }

  // Keys 1–4 answer, → moves on (EXPERIENCE.md › Keyboard shortcuts); never while typing.
  useEffect(() => {
    if (!question) return undefined
    const onKey = (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const target = event.target
      if (target && (TEXT_INPUT.test(target.tagName ?? '') || target.isContentEditable)) return
      if (event.key in KEYS) {
        const option = question.options[KEYS[event.key]]
        if (option && !answer && !saving && !readOnly) {
          event.preventDefault()
          submit(option.id)
        }
      } else if (event.key === 'ArrowRight' && canMove) {
        event.preventDefault()
        next()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // `submit` and `next` read the same state listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question, answer, saving, readOnly, canMove, index, isLast])

  // Focus follows the student's step (EXPERIENCE.md › Accessibility).
  useEffect(() => {
    const target = focusNext.current
    if (!target) return
    focusNext.current = null
    if (target === 'option') firstOption.current?.focus()
    else if (target === 'next') nextButton.current?.focus()
    else if (target === 'score') scoreHeading.current?.focus()
  })

  // "Try again" takes focus after a failed save (EXPERIENCE.md › Inline error).
  useEffect(() => {
    if (saveError && !saveError.rule) errorBox.current?.querySelector('button')?.focus()
  }, [saveError])

  const backToChat = () => navigate(`/projects/${projectId}`)
  const retryLoad = () => {
    setLoadError(null)
    setAttempt((n) => n + 1)
  }
  const optionText = (q, id) => q.options.find((o) => o.id === id)?.text ?? ''

  function optionState(option) {
    if (!answer) return null
    if (option.id === answer.correct_option_id) return 'correct'
    if (option.id === answer.submitted_option_id) return 'mistake'
    return 'dim'
  }

  function renderQuestion() {
    return (
      <section className={styles.quiz}>
        {index === 0 && data.quiz.question_count < data.quiz.requested_count && (
          <p className={styles.muted}>{t('quiz.fewer', { count: data.quiz.question_count })}</p>
        )}
        {readOnly && <InlineError>{errorText(t, { code: 'project_read_only' })}</InlineError>}
        <div id={progressId} className={styles.progressLine} aria-live="polite">
          {t('quiz.progress', { n: index + 1, total })}
        </div>
        <div
          className={styles.bar}
          role="progressbar"
          aria-labelledby={progressId}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={answeredCount}
        >
          <span className={styles.fill} style={{ width: `${(answeredCount / total) * 100}%` }} />
        </div>

        <h2 className={styles.question}>{question.question}</h2>

        <ol className={styles.options}>
          {question.options.map((option, i) => {
            const state = optionState(option)
            return (
              <li key={option.id}>
                <button
                  type="button"
                  ref={i === 0 ? firstOption : undefined}
                  className={`${styles.option} ${state ? styles[state] : ''}`}
                  data-state={state ?? 'open'}
                  disabled={Boolean(answer) || saving || readOnly}
                  onClick={() => submit(option.id)}
                >
                  <kbd className={styles.key} aria-hidden="true">
                    {i + 1}
                  </kbd>
                  <span className={styles.optionText}>{option.text}</span>
                  {state === 'correct' && <span className={styles.tag}>{t('quiz.correctAnswer')}</span>}
                  {state === 'mistake' && <span className={styles.tag}>{t('quiz.yourAnswer')}</span>}
                </button>
              </li>
            )
          })}
        </ol>

        {failedSave && (
          <div ref={errorBox} className={styles.error}>
            <InlineError onRetry={failedSave.rule ? undefined : () => submit(failedSave.optionId)}>
              {errorText(t, failedSave.error)}
            </InlineError>
          </div>
        )}

        <div role="status" aria-live="polite" className={styles.live}>
          {answer && (
            <div className={`${styles.feedback} ${answer.is_correct ? styles.feedbackCorrect : styles.feedbackMistake}`}>
              <h3 className={styles.feedbackHead}>{answer.is_correct ? t('quiz.correct') : t('quiz.notQuite')}</h3>
              {!answer.is_correct && <p className={styles.stays}>{t('quiz.staysInReview')}</p>}
              <p className={styles.why}>{answer.explanation}</p>
              {answer.sources.length > 0 && (
                <ul className={styles.sources}>
                  {answer.sources.map((source) => (
                    <li key={source.label} className={styles.source}>
                      {source.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className={styles.actions}>
          <p className={styles.hints} aria-hidden="true" data-testid="key-hints">
            {canMove ? (
              <span>
                <kbd className={styles.key}>{ARROW}</kbd> {t('quiz.keys.next')}
              </span>
            ) : (
              <span>
                <kbd className={styles.key}>{'1'}</kbd>
                {'–'}
                <kbd className={styles.key}>{'4'}</kbd> {t('quiz.keys.answer')}
              </span>
            )}
          </p>
          {canMove && (
            <button type="button" ref={nextButton} className={styles.primary} onClick={next}>
              {isLast ? t('quiz.seeResults') : t('quiz.next')}
              <kbd className={`${styles.key} ${styles.onPrimary}`} aria-hidden="true">
                {ARROW}
              </kbd>
            </button>
          )}
        </div>
      </section>
    )
  }

  function renderSummary() {
    const correct = questions.filter((q) => q.answer?.is_correct).length
    const missed = questions.filter((q) => !q.answer?.is_correct)
    return (
      <section className={styles.quiz}>
        <h2 ref={scoreHeading} tabIndex={-1} className={styles.score}>
          <Trans
            i18nKey="quiz.score"
            values={{ correct, total }}
            components={{ score: <span className={styles.scoreNumber} />, muted: <span className={styles.scoreRest} /> }}
          />
        </h2>
        {missed.length > 0 && (
          <>
            <ol className={styles.missed}>
              {missed.map((q) => (
                <li key={q.id} className={styles.miss}>
                  <p className={styles.missQuestion}>{`${q.position + 1}. ${q.question}`}</p>
                  {/* Unanswered (read-only Project): no answer to show, and the key stays hidden. */}
                  {q.answer && (
                    <p className={styles.missAnswers}>
                      <span>
                        {t('quiz.yourAnswer')}{' '}
                        <span className={styles.yours}>{optionText(q, q.answer.submitted_option_id)}</span>
                      </span>
                      <span>
                        {t('quiz.correctAnswer')}{' '}
                        <span className={styles.right}>{optionText(q, q.answer.correct_option_id)}</span>
                      </span>
                    </p>
                  )}
                </li>
              ))}
            </ol>
            <p className={styles.note}>{t('quiz.missedStay')}</p>
          </>
        )}
        <div className={styles.foot}>
          <button type="button" className={styles.primary} onClick={backToChat}>
            {t('activity.back')}
          </button>
          <button type="button" className={styles.ghost} onClick={() => navigate(`/projects/${projectId}/quiz`)}>
            {t('quiz.newQuiz')}
          </button>
        </div>
      </section>
    )
  }

  return (
    <div className={styles.activity} aria-busy={!data && !failedLoad}>
      <div className={styles.header}>
        <button type="button" className={styles.back} onClick={backToChat}>
          {t('activity.back')}
        </button>
        {/* Not a heading: the Top bar holds the page's h1 (the Project name). */}
        <p className={styles.title}>{t('tools.quiz')}</p>
      </div>

      {failedLoad && (
        <div className={styles.quiz}>
          <InlineError onRetry={failedLoad?.code === 'not_found' ? undefined : retryLoad}>
            {errorText(t, failedLoad)}
          </InlineError>
        </div>
      )}
      {!data && !failedLoad && (
        <div className={styles.quiz}>
          <div className={styles.skeleton} aria-hidden="true" />
        </div>
      )}
      {data && question && renderQuestion()}
      {data && index === SUMMARY && renderSummary()}
    </div>
  )
}
