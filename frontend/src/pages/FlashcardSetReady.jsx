import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import InlineError from '../components/InlineError.jsx'
import { errorText } from '../i18n/errors.js'
import styles from './QuizSetup.module.css'

// A finished flashcard set (Story 4.1, FR-13), until Story 4.2 replaces this page with the first card:
// the Activity header, "Your flashcards are ready: {n} cards.", "Only {n} cards were possible from this
// material." when the set holds fewer than were asked for, and "← Back to chat". A read, so an archived
// or deleted Project's set still opens. A missing Project goes to /projects; a missing set, or one that
// failed to load, shows the Inline error (with "Try again" unless the set is missing).
export default function FlashcardSetReady() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projectId, setId } = useParams()
  const key = `${projectId}/${setId}`
  const [loaded, setLoaded] = useState(null) // { key, set }
  const [loadError, setLoadError] = useState(null) // { key, error }
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    Promise.allSettled([
      apiFetch(`/api/projects/${projectId}`),
      apiFetch(`/api/projects/${projectId}/flashcard-sets/${setId}`),
    ]).then(([project, set]) => {
      if (!live) return
      const failed = project.status === 'rejected' ? project.reason : set.status === 'rejected' ? set.reason : null
      if (failed) {
        if (SIGNED_OUT_CODES.has(failed?.code)) return
        if (project.status === 'rejected' && failed?.code === 'not_found') navigate('/projects', { replace: true })
        else setLoadError({ key, error: failed })
        return
      }
      setLoaded({ key, set: set.value })
    })
    return () => {
      live = false
    }
  }, [projectId, setId, key, navigate, attempt])

  const set = loaded?.key === key ? loaded.set : null
  const failedLoad = loadError?.key === key ? loadError.error : null
  const retry = () => {
    setLoadError(null)
    setAttempt((n) => n + 1)
  }

  return (
    <div className={styles.activity} aria-busy={!set && !failedLoad}>
      <div className={styles.header}>
        <button type="button" className={styles.back} onClick={() => navigate(`/projects/${projectId}`)}>
          {t('activity.back')}
        </button>
        {/* Not a heading: the Top bar holds the page's h1 (the Project name). */}
        <p className={styles.title}>{t('tools.flashcards')}</p>
      </div>
      <section className={styles.setup}>
        {failedLoad && (
          <InlineError onRetry={failedLoad.code === 'not_found' ? undefined : retry}>{errorText(t, failedLoad)}</InlineError>
        )}
        {!set && !failedLoad && <div className={styles.skeleton} aria-hidden="true" />}
        {set && (
          <>
            <h2 className={styles.heading}>{t('flashcards.ready', { count: set.card_count })}</h2>
            {set.card_count < set.requested_count && (
              <p className={styles.cancelled}>{t('flashcards.fewer', { count: set.card_count })}</p>
            )}
          </>
        )}
      </section>
    </div>
  )
}
