import { useTranslation } from 'react-i18next'
import styles from './ChatMessage.module.css'

// Chat message (Story 4.4; DESIGN.md › Chat message): the student's message is a right-aligned surface
// bubble with a hairline border. An answer has no bubble: a muted "Study Buddy" label, the text in
// `body-reading` (paragraphs at blank lines), and its Source labels below ("file · slide N"). An answer
// the material doesn't cover has no Source labels.
export default function ChatMessage({ role, text, sources = [] }) {
  const { t } = useTranslation()
  if (role === 'user') {
    return (
      <div className={styles.me} data-testid="chat-question">
        <p className={styles.bubble}>{text}</p>
      </div>
    )
  }
  return (
    <div className={styles.answer} data-testid="chat-answer">
      <div className={styles.who}>{t('chat.who')}</div>
      <AnswerText text={text} />
      {sources.length > 0 && (
        <ul className={styles.sources}>
          {sources.map((source) => (
            <li key={source.label} className={styles.source}>
              {source.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The answer's text, split into paragraphs at blank lines; single line breaks are kept. */
export function AnswerText({ text }) {
  const paragraphs = text.split(/\n\s*\n/).filter((part) => part.trim())
  return paragraphs.map((part, index) => (
    <p key={index} className={styles.text}>
      {part.trim()}
    </p>
  ))
}
