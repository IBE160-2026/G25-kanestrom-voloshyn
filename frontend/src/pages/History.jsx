import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import InlineError from '../components/InlineError.jsx'
import { errorText } from '../i18n/errors.js'
import { formatDate } from './historyDates.js'
import quiz from './QuizSetup.module.css'
import styles from './History.module.css'

// History (Story 5.1, FR-25, FR-8; DESIGN.md › History filter, History row, Skeleton; EXPERIENCE.md ›
// History; mock key-project-home.html sections 5-8): everything made in the Project, newest first, in
// place of the chat.
//
// - The Activity header "← Back to chat", then the History filter (All · Chats · Quizzes · Flashcards ·
//   Summaries; `aria-pressed`, usable while loading), then the list at most chat width.
// - Each row is a button: the type label, the title (ellipsis), a muted meta line, and a muted date.
//   A quiz, set, or summary opens its own page; a chat is opened with GET /api/chats/{id} (it becomes the
//   chat last opened), then the Project home shows it.
// - Loading: static skeleton rows, and screen readers hear "Loading history". Empty (or no match for the
//   filter): "Nothing here yet" and one line. A failed load: the Inline error with "Try again", which takes
//   focus; a missing or foreign Project shows it with no "Try again". "Show more" appends the next page.
// - A read: it also works in an archived or deleted Project. The titles and file names are plain text.
const FILTERS = ['all', 'chat', 'quiz', 'flashcards', 'summary']
const SKELETON_ROWS = 4

export default function History() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { projectId } = useParams()
  const [filter, setFilter] = useState('all')
  const key = `${projectId}/${filter}`
  // Each piece of state carries the `key` it belongs to, so a reply for an earlier filter is ignored.
  const [list, setList] = useState(null) // { key, items, next } once the first page is in
  const [loadError, setLoadError] = useState(null) // { key, error, more }
  const [attempt, setAttempt] = useState(0)
  const [moreKey, setMoreKey] = useState(null) // the key "Show more" is loading for
  const [openError, setOpenError] = useState(null)
  // After "Show more", focus moves to the first appended row: { key, index }.
  const focusRow = useRef(null)
  const rowRefs = useRef([])

  const pagePath = useCallback(
    (cursor) => {
      const query = new URLSearchParams()
      if (filter !== 'all') query.set('type', filter)
      if (cursor) query.set('cursor', cursor)
      const qs = query.toString()
      return `/api/projects/${projectId}/history${qs ? `?${qs}` : ''}`
    },
    [projectId, filter],
  )

  useEffect(() => {
    let current = true
    apiFetch(pagePath(null)).then(
      (page) => {
        if (current) setList({ key, items: page.items, next: page.next_cursor })
      },
      (error) => {
        if (!current || SIGNED_OUT_CODES.has(error?.code)) return
        setLoadError({ key, error, more: false })
      },
    )
    return () => {
      current = false
    }
  }, [pagePath, key, attempt])

  const shown = list?.key === key ? list : null
  useEffect(() => {
    const wanted = focusRow.current
    if (!wanted || wanted.key !== shown?.key) return
    focusRow.current = null
    rowRefs.current[wanted.index]?.focus()
  }, [shown])
  const failed = loadError?.key === key ? loadError : null

  const more = moreKey === key
  const loadMore = () => {
    if (!shown?.next || more) return
    const at = key
    const from = shown.items.length
    setMoreKey(at)
    setLoadError(null)
    apiFetch(pagePath(shown.next)).then(
      (page) => {
        setList((prev) =>
          prev?.key === at ? { key: at, items: [...prev.items, ...page.items], next: page.next_cursor } : prev,
        )
        if (page.items.length > 0) focusRow.current = { key: at, index: from }
        setMoreKey((prev) => (prev === at ? null : prev))
      },
      (error) => {
        setMoreKey((prev) => (prev === at ? null : prev))
        if (!SIGNED_OUT_CODES.has(error?.code)) setLoadError({ key: at, error, more: true })
      },
    )
  }

  const retry = () => {
    if (failed?.more) {
      loadMore()
      return
    }
    setLoadError(null)
    setAttempt((n) => n + 1)
  }

  const choose = (next) => {
    if (next === filter) return
    setOpenError(null)
    setLoadError(null)
    focusRow.current = null
    setFilter(next)
  }

  const open = async (item) => {
    setOpenError(null)
    const base = `/projects/${projectId}`
    if (item.type === 'quiz') navigate(`${base}/quizzes/${item.id}`)
    else if (item.type === 'flashcards') navigate(`${base}/flashcard-sets/${item.id}`)
    else if (item.type === 'summary') navigate(`${base}/summaries/${item.id}`)
    else {
      try {
        // Opening the chat makes it the one last opened, which the Project home then shows.
        await apiFetch(`/api/chats/${item.id}`)
        navigate(base)
      } catch (error) {
        if (!SIGNED_OUT_CODES.has(error?.code)) setOpenError(error)
      }
    }
  }

  const loading = !shown && !failed

  return (
    <div className={quiz.activity}>
      <div className={quiz.header}>
        <button type="button" className={quiz.back} onClick={() => navigate(`/projects/${projectId}`)}>
          {t('activity.back')}
        </button>
        {/* Not a heading: the Top bar holds the page's h1 (the Project name). */}
        <p className={quiz.title}>{t('history.title')}</p>
      </div>

      <section className={styles.history}>
        <div role="group" aria-label={t('history.filter.label')} className={styles.filter}>
          {FILTERS.map((name) => (
            <button
              key={name}
              type="button"
              className={`${styles.segment} ${filter === name ? styles.on : ''}`}
              aria-pressed={filter === name}
              onClick={() => choose(name)}
            >
              {t(`history.filter.${name}`)}
            </button>
          ))}
        </div>

        {openError && <InlineError>{errorText(t, openError)}</InlineError>}

        {/* Always mounted, so screen readers announce the text when loading starts. */}
        <p role="status" className={styles.srOnly}>
          {loading ? t('history.loading') : ''}
        </p>

        {loading && (
          <div className={styles.rows} aria-busy="true">
            {Array.from({ length: SKELETON_ROWS }, (_, n) => (
              <div key={n} className={`${styles.row} ${styles.skeletonRow}`} aria-hidden="true">
                <span className={`${styles.bone} ${styles.boneType}`} />
                <span className={styles.main}>
                  <span className={`${styles.bone} ${styles.boneTitle}`} />
                  <span className={`${styles.bone} ${styles.boneMeta}`} />
                </span>
                <span className={`${styles.bone} ${styles.boneDate}`} />
              </div>
            ))}
          </div>
        )}

        {shown && shown.items.length === 0 && (
          <div className={styles.empty}>
            <h2 className={styles.emptyTitle}>{t('history.emptyTitle')}</h2>
            <p className={styles.emptyBody}>{t('history.emptyBody')}</p>
          </div>
        )}

        {shown && shown.items.length > 0 && (
          <ul className={styles.rows} aria-label={t('history.title')} aria-busy={more}>
            {shown.items.map((item, index) => (
              <li key={`${item.type}-${item.id}`}>
                <button
                  ref={(el) => {
                    rowRefs.current[index] = el
                  }}
                  type="button"
                  className={styles.row}
                  onClick={() => open(item)}
                >
                  <span className={styles.type}>{t(`history.type.${item.type}`)}</span>
                  <span className={styles.main}>
                    <span className={styles.title}>{titleOf(t, item)}</span>
                    <span className={styles.meta}>{metaOf(t, item)}</span>
                  </span>
                  <span className={styles.date}>{formatDate(t, item.created_at, i18n.language)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {failed && (
          <InlineError onRetry={failed.error?.code === 'not_found' ? undefined : retry} focusRetry>
            {failed.error?.code === 'not_found' ? errorText(t, failed.error) : t('history.loadError')}
          </InlineError>
        )}

        {shown?.next && !failed && (
          <button type="button" className={styles.more} onClick={loadMore} disabled={more}>
            {t('history.showMore')}
          </button>
        )}
      </section>
    </div>
  )
}

function titleOf(t, item) {
  if (item.title) return item.title
  if (item.type === 'quiz' || item.type === 'flashcards') return t('history.allTopics')
  return ''
}

function metaOf(t, item) {
  if (item.type === 'quiz') {
    const total = item.question_count
    if (total > 0 && item.answered_count >= total) return t('history.correct', { c: item.correct_count, t: total })
    return t('history.unfinished', { n: item.answered_count, total })
  }
  if (item.type === 'flashcards') return t('history.cards', { count: item.card_count })
  if (item.type === 'chat') {
    return t('history.messages', { count: item.message_count, scope: item.scope_file_name ?? t('history.allMaterials') })
  }
  return item.file_name
}
