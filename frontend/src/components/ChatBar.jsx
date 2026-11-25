import { useTranslation } from 'react-i18next'
import ScopeControl from './ScopeControl.jsx'
import styles from './ChatBar.module.css'

// Chat bar (Story 4.4; DESIGN.md › Chat bar): a muted caption row above the thread with "Answer from"
// and the Scope control on the left. New chat (Story 4.5) and the History link (Epic 5) join it on the
// right with their stories.
export default function ChatBar({ scope, files, disabled, onScope }) {
  const { t } = useTranslation()
  return (
    <div className={styles.bar} data-testid="chat-bar">
      <div className={styles.scope}>
        <span aria-hidden="true">{t('chat.answerFrom')}</span>
        <ScopeControl scope={scope} files={files} disabled={disabled} onChange={onScope} />
      </div>
    </div>
  )
}
