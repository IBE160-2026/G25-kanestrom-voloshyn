import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import AuthLayout from '../components/AuthLayout.jsx'
import styles from './EmailVerified.module.css'

// Where the verification link lands (Story 1.3 part 2, FR-1). GET /api/auth/verify redirects here:
// `/email-verified` when the link worked, `?status=expired` when it was expired, used, replaced, or
// unknown. "Send a new link" arrives with Story 7.3; until then the screen only leads back to Login.
export default function EmailVerified() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const expired = params.get('status') === 'expired'

  return (
    <AuthLayout switchTo={{ to: '/', label: t('verify.logIn') }}>
      <section className={styles.panel}>
        <h2 className={styles.message}>{t(expired ? 'verify.expired' : 'verify.success')}</h2>
      </section>
    </AuthLayout>
  )
}
