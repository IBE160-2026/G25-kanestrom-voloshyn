import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import ScopeControl from './ScopeControl.jsx'
import styles from './ChatBar.module.css'

// Chat bar (Stories 4.4, 4.5, 5.1; DESIGN.md › Chat bar, New chat button, History link): a muted caption
// row above the thread with "Answer from" and the Scope control on the left, and "New chat" and the
// History link on the right. "New chat" is disabled exactly when the composer is (`newChatDisabled`) and
// keeps focus after the click. The History link (to `historyHref`) is a text action that is never
// disabled, so it also works in a read-only Project.
export default function ChatBar({ scope, files, disabled, onScope, newChatDisabled, onNewChat, historyHref }) {
  const { t } = useTranslation()
  return (
    <div className={styles.bar} data-testid="chat-bar">
      <div className={styles.scope}>
        <span aria-hidden="true">{t('chat.answerFrom')}</span>
        <ScopeControl scope={scope} files={files} disabled={disabled} onChange={onScope} />
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.newChat} disabled={newChatDisabled} onClick={onNewChat}>
          {t('chat.newChat')}
        </button>
        <Link to={historyHref} className={styles.newChat}>
          {t('history.link')}
        </Link>
      </div>
    </div>
  )
}
