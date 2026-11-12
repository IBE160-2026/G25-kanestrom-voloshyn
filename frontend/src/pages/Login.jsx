import { useTranslation } from 'react-i18next'
import AuthLayout from '../components/AuthLayout.jsx'

// Login screen. Static parts (Story 1.2) plus the "Create account" link (Story 1.3).
// The email form, Google button, and "Forgot password?" arrive with Stories 1.4-1.6.
export default function Login() {
  const { t } = useTranslation()
  return <AuthLayout switchTo={{ to: '/signup', label: t('login.createAccount') }} />
}
