import { useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import InlineError from '../components/InlineError.jsx'
import { errorText } from '../i18n/errors.js'
import quiz from './QuizSetup.module.css'
import styles from './SummaryView.module.css'

// The Summary view (Story 4.3, FR-15; DESIGN.md › Summary view, Source label; EXPERIENCE.md › Summary
// view; mock key-summary.html): a calm reading column at the reading width.
//
// - A muted scope line ("Summary of {file} · whole file", or "· {topic}"), the summary's title, then each
//   section's heading, its text in body-reading type, and a row of its Source labels ("file · label").
// - The title, headings, and text are the model's, in the material's language, and never translated;
//   they, the file name, and the Topic label are plain text, never part of a translated string.
// - It ends with a muted "Saved to History" line and "← Back to chat" (primary).
// - A read: a read-only Project's summary opens too. A missing Project goes to /projects; a missing or
//   foreign summary shows the Inline error; any other failed read offers "Try again".
// - Focus moves to the summary title once it shows.
export default function SummaryView() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projectId, summaryId } = useParams()
  const key = `${projectId}/${summaryId}`
  const [loaded, setLoaded] = useState(null) // { key, summary }
  const [loadError, setLoadError] = useState(null) // { key, error }
  const [attempt, setAttempt] = useState(0)
  const titleRef = useRef(null)

  useEffect(() => {
    let live = true
    Promise.allSettled([
      apiFetch(`/api/projects/${projectId}`),
      apiFetch(`/api/projects/${projectId}/summaries/${summaryId}`),
    ]).then(([project, summary]) => {
      if (!live) return
      const failed = project.status === 'rejected' ? project.reason : summary.status === 'rejected' ? summary.reason : null
      if (failed) {
        if (SIGNED_OUT_CODES.has(failed?.code)) return
        if (project.status === 'rejected' && failed?.code === 'not_found') navigate('/projects', { replace: true })
        else setLoadError({ key, error: failed })
        return
      }
      setLoaded({ key, summary: summary.value })
    })
    return () => {
      live = false
    }
  }, [projectId, summaryId, key, navigate, attempt])

  const summary = loaded?.key === key ? loaded.summary : null
  const failedLoad = loadError?.key === key ? loadError.error : null
  // Focus goes to the title once the summary shows (also after the setup replaced itself with this page).
  useEffect(() => {
    if (summary) titleRef.current?.focus()
  }, [summary])
  const backToChat = () => navigate(`/projects/${projectId}`)
  const retry = () => {
    setLoadError(null)
    setAttempt((n) => n + 1)
  }

  return (
    <div className={quiz.activity} aria-busy={!summary && !failedLoad}>
      <div className={quiz.header}>
        <button type="button" className={quiz.back} onClick={backToChat}>
          {t('activity.back')}
        </button>
        {/* Not a heading: the Top bar holds the page's h1 (the Project name). */}
        <p className={quiz.title}>{t('tools.summarize')}</p>
      </div>

      {failedLoad && (
        <div className={styles.reading}>
          <InlineError onRetry={failedLoad.code === 'not_found' ? undefined : retry}>
            {errorText(t, failedLoad)}
          </InlineError>
        </div>
      )}
      {!summary && !failedLoad && (
        <div className={styles.reading}>
          <div className={quiz.skeleton} aria-hidden="true" />
        </div>
      )}

      {summary && (
        <article className={styles.reading}>
          <header className={styles.top}>
            <p className={styles.scope}>
              <Trans
                i18nKey={summary.topic_label ? 'summary.scopeTopic' : 'summary.scopeWhole'}
                components={{ file: <Plain text={summary.file_name} />, topic: <Plain text={summary.topic_label ?? ''} /> }}
              />
            </p>
            <h2 ref={titleRef} tabIndex={-1} className={styles.title}>
              {summary.title}
            </h2>
          </header>
          {summary.sections.map((section, index) => (
            <section key={index} className={styles.section}>
              <h3 className={styles.heading}>{section.heading}</h3>
              {paragraphs(section.text).map((text, n) => (
                <p key={n} className={styles.text}>
                  {text}
                </p>
              ))}
              {section.sources.length > 0 && (
                <ul className={styles.sources}>
                  {section.sources.map((source) => (
                    <li key={source.label} className={styles.source}>
                      {source.label}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          <div className={styles.end}>
            <p className={styles.saved}>{t('summary.saved')}</p>
            <button type="button" className={quiz.primary} onClick={backToChat}>
              {t('activity.back')}
            </button>
          </div>
        </article>
      )}
    </div>
  )
}

/** Renders `text` as plain text, whatever children <Trans> passes in. */
function Plain({ text }) {
  return text
}

/** The model's text split into paragraphs at blank lines. */
function paragraphs(text) {
  const parts = String(text ?? '')
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.length ? parts : ['']
}
