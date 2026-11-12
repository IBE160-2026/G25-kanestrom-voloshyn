import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import LanguageToggle from './LanguageToggle.jsx'
import styles from './AuthLayout.module.css'

// Shared by Login, Create account, and (later) Password reset: one centred column with the wordmark,
// tagline, the screen's own content, a link to the other auth screen (`switchTo`), the privacy line,
// and the footer credit; EN | NO top right (DESIGN.md › Layout & Spacing › Login).
export default function AuthLayout({ children, switchTo }) {
  const { t } = useTranslation()

  return (
    <div className={styles.page}>
      <header className={styles.corner}>
        <LanguageToggle />
      </header>
      <main className={styles.column}>
        <h1 className={styles.wordmark}>{t('login.wordmark')}</h1>
        <p className={styles.tagline}>{t('login.tagline')}</p>
        {children}
        {switchTo && (
          <p className={styles.switch}>
            <Link to={switchTo.to}>{switchTo.label}</Link>
          </p>
        )}
        <p className={styles.privacy}>{t('login.privacy')}</p>
      </main>
      <footer className={styles.credit}>{t('footer.credit')}</footer>
    </div>
  )
}
