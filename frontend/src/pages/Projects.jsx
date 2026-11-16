import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import ErrorLine from '../components/ErrorLine.jsx'
import TopBar from '../components/TopBar.jsx'
import { errorText } from '../i18n/errors.js'
import styles from './Projects.module.css'

// Projects page, empty (Story 1.3): the top bar with the Account menu (Story 1.4) and the
// empty-state heading. Nothing shows until /api/me answers. When the session has ended,
// api/client.js and RequireSession take the student to Login, so no error is shown here.
// The "Create your first project" action arrives with Story 2.1.
export default function Projects() {
  const { t } = useTranslation()
  const [me, setMe] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    apiFetch('/api/me')
      .then((profile) => live && setMe(profile))
      .catch((err) => {
        if (live && !SIGNED_OUT_CODES.has(err?.code)) setError(err)
      })
    return () => {
      live = false
    }
  }, [])

  return (
    <div className={styles.page}>
      <TopBar me={me} ready={Boolean(me || error)} />
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
