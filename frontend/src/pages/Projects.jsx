import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { apiFetch } from '../api/client.js'
import ErrorLine from '../components/ErrorLine.jsx'
import { errorText } from '../i18n/errors.js'
import styles from './Projects.module.css'

const SIGNED_OUT = new Set(['unauthorized', 'session_expired'])

// Projects page, empty (Story 1.3): the greeting from GET /api/me and the empty-state heading.
// Nothing shows until /api/me answers. Signed out, it goes back to Login; Story 1.4 adds the
// session-expired message and the return route. The "Create your first project" action arrives
// with Story 2.1, the Account menu with Story 1.4.
export default function Projects() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [me, setMe] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    apiFetch('/api/me')
      .then((profile) => live && setMe(profile))
      .catch((err) => {
        if (!live) return
        if (SIGNED_OUT.has(err?.code)) navigate('/', { replace: true })
        else setError(err)
      })
    return () => {
      live = false
    }
  }, [navigate])

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        {me?.first_name && (
          <span className={styles.greeting}>{t('projects.welcome', { firstName: me.first_name })}</span>
        )}
      </header>
      <main className={styles.main} aria-busy={!me && !error}>
        {me && (
          <section className={styles.empty}>
            <h1 className={styles.heading}>{t('projects.empty.heading')}</h1>
          </section>
        )}
        {error && <ErrorLine>{errorText(t, error)}</ErrorLine>}
      </main>
    </div>
  )
}
