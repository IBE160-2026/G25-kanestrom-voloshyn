import { useTranslation } from 'react-i18next'
import ScopeControl from './ScopeControl.jsx'
import styles from './ChatBar.module.css'

// Chat bar (Stories 4.4, 4.5; DESIGN.md › Chat bar, New chat button): a muted caption row above the
// thread with "Answer from" and the Scope control on the left, and "New chat" on the right (the History
// link joins it with Epic 5). "New chat" is disabled exactly when the composer is (`newChatDisabled`) and
// keeps focus after the click.
export default function ChatBar({ scope, files, disabled, onScope, newChatDisabled, onNewChat }) {
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
      </div>
    </div>
  )
}
