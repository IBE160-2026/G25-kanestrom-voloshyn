import { useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import InlineError from '../components/InlineError.jsx'
import QuestionView from '../components/QuestionView.jsx'
import { errorText } from '../i18n/errors.js'
import styles from './QuizPage.module.css'

// Taking a Quiz (Story 3.2, FR-11, AD-9; DESIGN.md › Answer option, Feedback panel, Score summary,
// Progress bar, Key hint, Source label; EXPERIENCE.md › Answer option, Feedback panel, Score summary,
// Keyboard shortcuts; mock key-quiz-feedback.html states 1-2).
//
// - One question at a time with a progress bar and four Answer options (the shared QuestionView, also
//   used by Mistake Review). Keys 1–4 or a click answer (desktop Key hints; keys are ignored while focus
//   is in a text input or a modifier is held).
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
const SUMMARY = 'summary'
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
  const focusScore = useRef(false) // the score heading takes focus after "See results"
  const scoreHeading = useRef(null)

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
      focusScore.current = true
      setAt({ key, index: SUMMARY })
    } else {
      setAt({ key, index: index + 1 })
    }
  }

  // The score heading takes focus after "See results" (EXPERIENCE.md › Accessibility); the question
  // view moves focus between questions itself.
  useEffect(() => {
    if (!focusScore.current) return
    focusScore.current = false
    scoreHeading.current?.focus()
  })

  const backToChat = () => navigate(`/projects/${projectId}`)
  const retryLoad = () => {
    setLoadError(null)
    setAttempt((n) => n + 1)
  }
  const optionText = (q, id) => q.options.find((o) => o.id === id)?.text ?? ''

  function renderQuestion() {
    return (
      <section className={styles.quiz}>
        {index === 0 && data.quiz.question_count < data.quiz.requested_count && (
          <p className={styles.muted}>{t('quiz.fewer', { count: data.quiz.question_count })}</p>
        )}
        {readOnly && <InlineError>{errorText(t, { code: 'project_read_only' })}</InlineError>}
        <QuestionView
          progressText={t('quiz.progress', { n: index + 1, total })}
          answered={answeredCount}
          total={total}
          question={question}
          answer={answer}
          disabled={saving || readOnly}
          onAnswer={submit}
          error={
            failedSave
              ? {
                  message: errorText(t, failedSave.error),
                  onRetry: failedSave.rule ? undefined : () => submit(failedSave.optionId),
                }
              : null
          }
          canMove={canMove}
          nextLabel={isLast ? t('quiz.seeResults') : t('quiz.next')}
          onNext={next}
        />
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
