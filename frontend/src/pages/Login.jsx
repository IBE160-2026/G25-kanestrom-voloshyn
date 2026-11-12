import { useTranslation } from 'react-i18next'
import LanguageToggle from '../components/LanguageToggle.jsx'
import styles from './Login.module.css'

// Login screen, static parts only (Story 1.2): wordmark, tagline, privacy line, footer credit, and the
// EN | NO toggle top right (DESIGN.md › Layout & Spacing › Login). The Auth panel arrives with Stories 1.3-1.6.
export default function Login() {
  const { t } = useTranslation()

  return (
    <div className={styles.page}>
      <header className={styles.corner}>
        <LanguageToggle />
      </header>
      <main className={styles.column}>
        <h1 className={styles.wordmark}>{t('login.wordmark')}</h1>
        <p className={styles.tagline}>{t('login.tagline')}</p>
        <p className={styles.privacy}>{t('login.privacy')}</p>
      </main>
      <footer className={styles.credit}>{t('footer.credit')}</footer>
    </div>
  )
}
