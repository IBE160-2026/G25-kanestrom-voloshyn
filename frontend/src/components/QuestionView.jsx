import { useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import InlineError from './InlineError.jsx'
import styles from './QuestionView.module.css'

// One multiple-choice question, shared by the Quiz (Story 3.2) and Mistake Review (Stories 3.4 + 3.5)
// (FR-11, FR-18, AD-9; DESIGN.md › Progress bar, Answer option, Feedback panel, Key hint, Source label;
// EXPERIENCE.md › Answer option, Feedback panel, Keyboard shortcuts).
//
// - A muted progress line over the Progress bar (filled with `answered` of `total`; the mistake colour
//   in Mistake Review), `before` (the review context card), the question, and four Answer options.
// - Keys 1–4 or a click answer (`onAnswer(optionId)`), never while focus is in a text input or a
//   modifier is held; → moves on (`onNext`) once `canMove`. Desktop Key hints show "1–4 answer" or
//   "→ next".
// - Once `answer` is set, the options read "Your answer" / "Correct answer" and the others dim, and
//   the Feedback panel shows in a polite live region: "Correct", or "Not quite" + "It stays in your
//   review." in the mistake colour, then the explanation and its Source labels. No auto-advance.
// - `error` ({message, onRetry}) shows the Inline error under the options; its "Try again" takes focus.
// - Below: `secondary` (left, e.g. "Stop for now"), the key hints, and the primary `nextLabel` button
//   while `canMove`. `footer`, when given, replaces that row (the Mistake Review end panels).
// - Focus: the first option when the question changes, the primary button once an answer arrives.
const KEYS = { 1: 0, 2: 1, 3: 2, 4: 3 }
const ARROW = '→'
const TEXT_INPUT = /^(INPUT|TEXTAREA|SELECT)$/

export default function QuestionView({
  progressText,
  answered,
  total,
  tone = 'primary',
  before = null,
  question,
  answer,
  disabled = false,
  onAnswer,
  error = null,
  canMove,
  nextLabel,
  onNext,
  secondary = null,
  footer = null,
}) {
  const { t } = useTranslation()
  const progressId = useId()
  const firstOption = useRef(null)
  const nextButton = useRef(null)
  const errorBox = useRef(null)
  const shown = useRef({ id: question.id, answered: Boolean(answer) })

  // Focus follows the student's step (EXPERIENCE.md › Accessibility); never on the first render.
  useEffect(() => {
    const previous = shown.current
    shown.current = { id: question.id, answered: Boolean(answer) }
    if (previous.id !== question.id) firstOption.current?.focus()
    else if (!previous.answered && answer) nextButton.current?.focus()
  }, [question.id, answer])

  // "Try again" takes focus after a failed save (EXPERIENCE.md › Inline error).
  useEffect(() => {
    if (error?.onRetry) errorBox.current?.querySelector('button')?.focus()
  }, [error])

  // Keys 1–4 answer, → moves on (EXPERIENCE.md › Keyboard shortcuts); never while typing.
  useEffect(() => {
    const onKey = (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const target = event.target
      if (target && (TEXT_INPUT.test(target.tagName ?? '') || target.isContentEditable)) return
      if (event.key in KEYS) {
        const option = question.options[KEYS[event.key]]
        if (option && !answer && !disabled) {
          event.preventDefault()
          onAnswer(option.id)
        }
      } else if (event.key === 'ArrowRight' && canMove && onNext) {
        event.preventDefault()
        onNext()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [question, answer, disabled, canMove, onAnswer, onNext])

  function optionState(option) {
    if (!answer) return null
    if (option.id === answer.correct_option_id) return 'correct'
    if (option.id === answer.submitted_option_id) return 'mistake'
    return 'dim'
  }

  return (
    <>
      <div id={progressId} className={styles.progressLine} aria-live="polite">
        {progressText}
      </div>
      <div
        className={styles.bar}
        role="progressbar"
        aria-labelledby={progressId}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={answered}
      >
        <span
          className={`${styles.fill} ${tone === 'mistake' ? styles.fillMistake : ''}`}
          style={{ width: `${total > 0 ? (answered / total) * 100 : 0}%` }}
        />
      </div>

      {before}

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
                disabled={Boolean(answer) || disabled}
                onClick={() => onAnswer(option.id)}
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

      {error && (
        <div ref={errorBox} className={styles.error}>
          <InlineError onRetry={error.onRetry}>{error.message}</InlineError>
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

      {footer ?? (
        <div className={styles.actions}>
          {secondary && <div className={styles.secondary}>{secondary}</div>}
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
            <button type="button" ref={nextButton} className={styles.primary} onClick={onNext}>
              {nextLabel}
              <kbd className={`${styles.key} ${styles.onPrimary}`} aria-hidden="true">
                {ARROW}
              </kbd>
            </button>
          )}
        </div>
      )}
    </>
  )
}
