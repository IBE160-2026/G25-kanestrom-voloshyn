import { Trans, useTranslation } from 'react-i18next'
import styles from './ReadyNotice.module.css'

// Finished-generation message (Story 3.1b, FR-26; DESIGN.md › Chat message › Finished-generation
// message; EXPERIENCE.md › Microcopy): "Your quiz on {topic} is ready · Open" in body type with "Open"
// as an underlined primary-coloured link, and a × ("Dismiss"). No badge, no fill; not a chat message.
// The caller puts it in a polite live region. The Topic labels come from model output, so the {topic}
// text is a React text child, never part of the string <Trans> parses. A `review_round` job (Story 3.4)
// reads "Your practice questions are ready · Open" instead.
export default function ReadyNotice({ kind = 'quiz', labels, onOpen, onDismiss }) {
  const { t } = useTranslation()
  const open = <button type="button" className={styles.open} data-notice-open="" onClick={onOpen} />
  return (
    <div className={styles.notice}>
      <p className={styles.text}>
        {kind === 'review_round' ? (
          <Trans i18nKey="review.ready" components={{ open }} />
        ) : (
          <Trans i18nKey="quiz.ready.message" components={{ topic: <Plain text={topicText(t, labels)} />, open }} />
        )}
      </p>
      <button type="button" className={styles.dismiss} aria-label={t('quiz.ready.dismiss')} onClick={onDismiss}>
        <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">
          <path d="M2 2 8 8M8 2 2 8" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>
    </div>
  )
}

/** Renders `text` as plain text, whatever children <Trans> passes in. */
function Plain({ text }) {
  return text
}

/** The {topic} text: no labels -> "all topics"; one -> it; two -> "A and B"; more -> "A and {n} more".
 * Empty or non-text labels are left out first. */
function topicText(t, labels) {
  const kept = (Array.isArray(labels) ? labels : []).filter((label) => typeof label === 'string' && label.trim())
  if (kept.length === 0) return t('quiz.ready.allTopics')
  if (kept.length === 1) return kept[0]
  if (kept.length === 2) return t('quiz.ready.two', { a: kept[0], b: kept[1] })
  return t('quiz.ready.more', { a: kept[0], n: kept.length - 1 })
}
