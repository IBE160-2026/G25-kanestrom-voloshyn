import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import InlineError from '../components/InlineError.jsx'
import { errorText } from '../i18n/errors.js'
import styles from './FlashcardSession.module.css'

// Studying a flashcard set (Story 4.2, FR-14, AD-8, AD-22; DESIGN.md › Flashcard, Flashcard end screen,
// Progress bar, Key hint, Source label; EXPERIENCE.md › Flashcard, Flashcard end screen, Keyboard
// shortcuts; mock key-flashcards.html states 2-4).
//
// - The server owns the session: GET returns the cards, the `queue` of card ids still to show, and
//   `done_count` / `second_try_count`; each mark returns the same shape. The page shows `queue[0]` and
//   waits for the server on every mark, so the queue never drifts from the stored marks.
// - "{n} of {total}" (n = done + 1) over the Progress bar (filled with done / total). On the first card a
//   set with fewer cards than asked shows the `flashcards.fewer` note.
// - The card front shows the "Term" overline, the question, and "Click to flip" with the Space hint. A
//   click or Space flips it; the back (a polite live region) shows the question small and muted, the
//   answer, and its Source labels. "Got it" (→) and "Not yet" (←) appear once flipped; "Stop for now"
//   is always there and, like "← Back to chat", returns to the chat writing nothing.
// - Keys work on desktop only (`@media (hover: none)` hides the hints) and never while focus is in a text
//   input or a modifier is held. Space on a focused button is left to the button.
// - End screen (the queue is empty or the set has ended): "{n} cards done. {m} needed a second try",
//   "Make more cards" (primary, opens Flashcards setup) and "← Back to chat". An ended set opens here.
// - A failed save keeps the card and shows the Inline error with "Try again" (which takes focus). A
//   refusal that names a rule shows only its message; `project_read_only` turns the page read-only (cards
//   still flip, the mark buttons are disabled); `flashcard_set_ended` reloads the set, which then opens on
//   the end screen. A missing Project goes to /projects; a missing set shows the Inline error with no
//   "Try again".
// - Focus: the next card after a mark, the end headline once the set ends; never on the first render.
const TEXT_INPUT = /^(INPUT|TEXTAREA|SELECT)$/
const NATIVE_SPACE = /^(BUTTON|A|SUMMARY)$/
// Save refusals that name a rule: sending the same mark again can't help.
const SAVE_RULES = new Set(['not_found'])

export default function FlashcardSession() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projectId, setId } = useParams()
  const key = `${projectId}/${setId}`
  const [loaded, setLoaded] = useState(null) // { key, project, set }
  const [loadError, setLoadError] = useState(null) // { key, error }
  const [attempt, setAttempt] = useState(0) // load attempts ("Try again")
  const [flipped, setFlipped] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null) // { cardId, mark, error, rule }
  const [refusedKey, setRefusedKey] = useState(null) // the set whose save said project_read_only
  const moved = useRef(false) // a mark was saved: focus follows to the next card or the end headline
  const progressId = useId()
  const cardButton = useRef(null)
  const endHeading = useRef(null)
  const errorBox = useRef(null)

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
      setLoaded({ key, project: project.value, set: set.value })
      setFlipped(false)
    })
    return () => {
      live = false
    }
  }, [projectId, setId, key, navigate, attempt])

  const data = loaded?.key === key ? loaded : null
  const failedLoad = loadError?.key === key ? loadError.error : null
  const set = data?.set ?? null
  const project = data?.project ?? null
  const readOnly = Boolean(project?.archived_at || project?.deleted_at || refusedKey === key)
  const queue = set?.queue ?? []
  const ended = Boolean(set && (set.ended_at || queue.length === 0))
  const card = set && !ended ? (set.cards.find((c) => c.id === queue[0]) ?? null) : null
  const failedSave = saveError && saveError.cardId === card?.id ? saveError : null
  const canMark = Boolean(card && flipped && !saving && !readOnly)

  // Callers gate on the flip (the buttons show only when flipped, the keys check `canMark`).
  async function submit(mark) {
    if (!card || saving || readOnly) return
    const cardId = card.id
    setSaving(true)
    setSaveError(null)
    try {
      const next = await apiFetch(`/api/projects/${projectId}/flashcard-sets/${setId}/cards/${cardId}/mark`, {
        method: 'POST',
        body: { mark },
      })
      moved.current = true
      setLoaded((current) => (current?.key === key ? { ...current, set: next } : current))
      setFlipped(false)
    } catch (err) {
      if (SIGNED_OUT_CODES.has(err?.code)) return
      if (err?.code === 'project_read_only') setRefusedKey(key)
      else if (err?.code === 'flashcard_set_ended') await reloadEnded(cardId, mark)
      else setSaveError({ cardId, mark, error: err, rule: SAVE_RULES.has(err?.code) })
    } finally {
      setSaving(false)
    }
  }

  // The set ended meanwhile (left idle, or another set was opened): read it again for the end screen. If
  // that read fails, "Try again" sends the mark again, which is refused and reads again.
  async function reloadEnded(cardId, mark) {
    try {
      const fresh = await apiFetch(`/api/projects/${projectId}/flashcard-sets/${setId}`)
      moved.current = true
      setLoaded((current) => (current?.key === key ? { ...current, set: fresh } : current))
    } catch (err) {
      if (!SIGNED_OUT_CODES.has(err?.code)) setSaveError({ cardId, mark, error: err, rule: false })
    }
  }

  // "Try again" works from either side: it shows the back again and resends the mark.
  function retry(mark) {
    setFlipped(true)
    submit(mark)
  }

  const flip = () => {
    if (card && !saving) setFlipped((f) => !f)
  }

  // Space flips, → is "Got it", ← is "Not yet" (EXPERIENCE.md › Keyboard shortcuts); never while typing.
  useEffect(() => {
    if (!card) return undefined
    const onKey = (event) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const target = event.target
      const tag = target?.tagName ?? ''
      if (target && (TEXT_INPUT.test(tag) || target.isContentEditable)) return
      if (event.key === ' ') {
        if (NATIVE_SPACE.test(tag)) return // the focused button handles its own Space
        event.preventDefault()
        if (saving) return
        setFlipped((f) => !f)
      } else if (event.key === 'ArrowRight' && canMark) {
        event.preventDefault()
        submit('got_it')
      } else if (event.key === 'ArrowLeft' && canMark) {
        event.preventDefault()
        submit('not_yet')
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  // After a mark, focus moves to the next card, or to the end headline (EXPERIENCE.md › Accessibility).
  useEffect(() => {
    if (!moved.current || !set) return
    moved.current = false
    if (ended) endHeading.current?.focus()
    else cardButton.current?.focus()
  })

  // "Try again" takes focus after a failed save (EXPERIENCE.md › Inline error).
  useEffect(() => {
    if (failedSave && !failedSave.rule) errorBox.current?.querySelector('button')?.focus()
  }, [failedSave])

  const backToChat = () => navigate(`/projects/${projectId}`)
  const retryLoad = () => {
    setLoadError(null)
    setAttempt((n) => n + 1)
  }

  function renderCard() {
    const total = set.card_count
    const done = set.done_count
    const first = done === 0 && set.second_try_count === 0
    return (
      <section className={styles.session}>
        <div id={progressId} className={styles.progressLine}>
          {t('flashcards.session.progress', { n: done + 1, total })}
        </div>
        <div
          className={styles.bar}
          role="progressbar"
          aria-labelledby={progressId}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
        >
          <span className={styles.fill} style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }} />
        </div>
        {first && set.card_count < set.requested_count && (
          <p className={styles.muted}>{t('flashcards.fewer', { count: set.card_count })}</p>
        )}
        {readOnly && <InlineError>{errorText(t, { code: 'project_read_only' })}</InlineError>}

        <button
          type="button"
          ref={cardButton}
          className={styles.card}
          aria-expanded={flipped}
          data-testid="flashcard"
          onClick={flip}
        >
          {/* Re-keyed on flip, so the subtle turn plays once per side (none under reduced motion). */}
          <span key={flipped ? 'back' : 'front'} className={styles.face}>
            {flipped ? (
              <span className={styles.termSmall}>{card.question}</span>
            ) : (
              <>
                <span className={styles.overline}>{t('flashcards.session.term')}</span>
                <span className={styles.term}>{card.question}</span>
                <span className={styles.flipHint}>
                  {t('flashcards.session.flip')}
                  <kbd className={styles.key} aria-hidden="true">
                    {t('flashcards.session.spaceKey')}
                  </kbd>
                </span>
              </>
            )}
            {flipped && (
              <span className={styles.back}>
                <span className={styles.answer}>{card.answer}</span>
                {card.sources.length > 0 && (
                  <span className={styles.sources}>
                    {card.sources.map((source) => (
                      <span key={source.label} className={styles.source}>
                        {source.label}
                      </span>
                    ))}
                  </span>
                )}
              </span>
            )}
          </span>
        </button>
        {/* One persistent polite live region outside the card: flipping announces the answer once. */}
        <div role="status" aria-live="polite" className={styles.srOnly} data-testid="flashcard-live">
          {flipped ? [card.answer, ...card.sources.map((source) => source.label)].join(' · ') : ''}
        </div>

        {failedSave && (
          <div ref={errorBox}>
            <InlineError onRetry={failedSave.rule ? undefined : () => retry(failedSave.mark)}>
              {errorText(t, failedSave.error)}
            </InlineError>
          </div>
        )}

        <div className={styles.under}>
          <button type="button" className={styles.ghost} onClick={backToChat}>
            {t('flashcards.session.stop')}
          </button>
          {flipped && (
            <div className={styles.pair}>
              <button type="button" className={styles.ghost} disabled={!canMark} onClick={() => submit('not_yet')}>
                <kbd className={styles.key} aria-hidden="true">
                  {'←'}
                </kbd>
                {t('flashcards.session.notYet')}
              </button>
              <button type="button" className={styles.primary} disabled={!canMark} onClick={() => submit('got_it')}>
                {t('flashcards.session.gotIt')}
                <kbd className={`${styles.key} ${styles.onPrimary}`} aria-hidden="true">
                  {'→'}
                </kbd>
              </button>
            </div>
          )}
        </div>
      </section>
    )
  }

  function renderEnd() {
    return (
      <section className={styles.end}>
        <h2 ref={endHeading} tabIndex={-1} className={styles.headline}>
          {t('flashcards.session.end', { count: set.done_count, m: set.second_try_count })}
        </h2>
        <div className={styles.endActions}>
          <button type="button" className={styles.primary} onClick={() => navigate(`/projects/${projectId}/flashcards`)}>
            {t('flashcards.session.more')}
          </button>
          <button type="button" className={styles.ghost} onClick={backToChat}>
            {t('activity.back')}
          </button>
        </div>
      </section>
    )
  }

  return (
    <div className={styles.activity} aria-busy={!set && !failedLoad}>
      <div className={styles.header}>
        <button type="button" className={styles.backButton} onClick={backToChat}>
          {t('activity.back')}
        </button>
        {/* Not a heading: the Top bar holds the page's h1 (the Project name). */}
        <p className={styles.title}>{t('tools.flashcards')}</p>
      </div>

      {failedLoad && (
        <div className={styles.session}>
          <InlineError onRetry={failedLoad.code === 'not_found' ? undefined : retryLoad}>
            {errorText(t, failedLoad)}
          </InlineError>
        </div>
      )}
      {!set && !failedLoad && (
        <div className={styles.session}>
          <div className={styles.skeleton} aria-hidden="true" />
        </div>
      )}
      {card && renderCard()}
      {set && ended && renderEnd()}
    </div>
  )
}
