import { useTranslation } from 'react-i18next'
import styles from './InlineError.module.css'

// Inline error (DESIGN.md › Inline error; EXPERIENCE.md › Component Patterns): a surface box with the
// message in the error colour. With `onRetry` (a network or server failure), it also shows the
// reassurance and a ghost "Try again"; a refusal that names a rule shows the message only.
export default function InlineError({ children, onRetry }) {
  const { t } = useTranslation()
  return (
    <div role="alert" className={styles.box}>
      <div className={styles.text}>
        <p className={styles.message}>{children}</p>
        {onRetry && <p className={styles.reassurance}>{t('inlineError.reassurance')}</p>}
      </div>
      {onRetry && (
        <button type="button" className={styles.retry} onClick={onRetry}>
          {t('inlineError.retry')}
        </button>
      )}
    </div>
  )
}
