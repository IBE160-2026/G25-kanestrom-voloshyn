import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import ChatMessage, { AnswerText } from './ChatMessage.jsx'
import messageStyles from './ChatMessage.module.css'
import styles from './ChatThread.module.css'

// The chat thread (Story 4.4, FR-16; DESIGN.md › Chat message; EXPERIENCE.md › Chat message, Accessibility):
// the stored messages in order, then the one being answered. Until its first words arrive, the answer's
// place shows "Study Buddy is thinking…" with three soft dots (static under reduced motion), in a polite
// live region; the text then streams in there in the normal answer style, with no caret, outside any
// live region, so screen readers aren't read each word. A completed answer is announced once ("Answer
// ready" and its text) from a separate polite region. An empty thread shows "Ask anything about your
// material." (`messages` is null while the chat loads.) The thread keeps its end in view as it grows.
function hasContent(children) {
  return (Array.isArray(children) ? children : [children]).some(Boolean)
}

export default function ChatThread({ messages, pending, announcement, children }) {
  const { t } = useTranslation()
  const end = useRef(null)
  const shown = messages ?? []
  const empty = messages !== null && shown.length === 0 && !pending && !hasContent(children)
  const thinking = pending !== null && pending.text === ''

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  }, [shown.length, pending])

  return (
    <div className={styles.thread} data-testid="chat-thread">
      {empty && <p className={styles.empty}>{t('chat.empty')}</p>}
      {shown.map((message) => (
        <ChatMessage key={message.id} role={message.role} text={message.text} sources={message.sources} />
      ))}
      {pending && <ChatMessage role="user" text={pending.question} />}
      {pending && !thinking && (
        <div className={messageStyles.answer} data-testid="chat-streaming">
          <div className={messageStyles.who}>{t('chat.who')}</div>
          <AnswerText text={pending.text} />
        </div>
      )}
      <div aria-live="polite" data-testid="chat-pending">
        {thinking && (
          <p className={styles.thinking}>
            {t('chat.thinking')}
            <span className={styles.dots} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </p>
        )}
      </div>
      {children}
      <div role="status" aria-live="polite" className={styles.srOnly} data-testid="chat-announce">
        {announcement && (
          // Keyed by answer: a new answer replaces the nodes, so even the same text is announced again.
          <span key={announcement.id}>
            <span>{t('chat.answerReady')}</span> <span>{announcement.text}</span>
          </span>
        )}
      </div>
      <div ref={end} />
    </div>
  )
}
