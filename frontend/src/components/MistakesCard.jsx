import { useTranslation } from 'react-i18next'
import styles from './MistakesCard.module.css'

// Mistakes card (Stories 3.3 + 3.4, FR-9, FR-17; DESIGN.md › Mistakes card; EXPERIENCE.md › Mistakes card):
// a surface card with an amber left edge and "{n} mistakes to review" ("1 mistake to review") in amber
// semibold, at the top of the chat, with a ghost "Start" on the right (`onStart`) that opens Mistake
// Review. The caller shows it only when `count` > 0 and the Project is active; it never reads "0". A polite
// live region (role="status"), so a new count is announced.
export default function MistakesCard({ count, onStart }) {
  const { t } = useTranslation()
  if (!Number.isInteger(count) || count <= 0) return null
  return (
    <div className={styles.card} role="status" data-testid="mistakes-card">
      <p className={styles.headline}>{t('mistakes.card', { count })}</p>
      {onStart && (
        <button type="button" className={styles.start} onClick={onStart}>
          {t('mistakes.start')}
        </button>
      )}
    </div>
  )
}
