import { useTranslation } from 'react-i18next'
import { LANGUAGES, setLanguage } from '../i18n/index.js'
import styles from './LanguageToggle.module.css'

// The "EN | NO" toggle shown before sign-in (DESIGN.md › Language toggle (login)).
// Each segment is a native button, so mouse, Tab, Enter, and Space all work.
export default function LanguageToggle() {
  const { t, i18n } = useTranslation()
  const active = i18n.resolvedLanguage

  return (
    <div role="group" aria-label={t('language.label')} className={styles.toggle}>
      {LANGUAGES.map((lng, i) => (
        <span key={lng} className={styles.item}>
          {i > 0 && <span className={styles.separator} aria-hidden="true" />}
          <button
            type="button"
            lang={lng}
            aria-label={t(`language.name.${lng}`)}
            aria-pressed={active === lng}
            className={styles.segment}
            onClick={() => setLanguage(lng)}
          >
            {t(`language.toggle.${lng}`)}
          </button>
        </span>
      ))}
    </div>
  )
}
