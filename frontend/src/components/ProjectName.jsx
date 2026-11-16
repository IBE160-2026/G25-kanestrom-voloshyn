import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import { errorText } from '../i18n/errors.js'
import ErrorLine from './ErrorLine.jsx'
import styles from './ProjectName.module.css'

// The Project name with inline rename (FR-5, EXPERIENCE.md › Top bar, Sidebar), shared by the Top
// bar and the Sidebar row. Enter saves through PATCH /api/projects/{id}; Esc restores the old name
// and sends nothing. The server trims, refuses a blank name (invalid_name), and cuts at 100
// characters; a refusal shows under the field and keeps the old name.
//
// `variant="title"`: shows the name as the page title; clicking it starts a rename (not while the
// Project is archived or deleted). `variant="sidebar"`: only the field, opened by the row's menu.
// `editing`/`onEditingChange` make the editing state controlled (the Sidebar's menu opens it).
export default function ProjectName({ project, onRenamed, variant = 'title', editing, onEditingChange }) {
  const { t } = useTranslation()
  const id = useId()
  const [ownEditing, setOwnEditing] = useState(false)
  const isEditing = editing ?? ownEditing
  const setEditing = onEditingChange ?? setOwnEditing
  const [value, setValue] = useState(() => project.name ?? '')
  const [error, setError] = useState(null) // { apiError, attempt }
  const [busy, setBusy] = useState(false)
  const attempt = useRef(0)
  const input = useRef(null)
  // Set when the field closes, so the title button takes focus back once it renders (keyboard
  // users don't fall to <body>). The Sidebar returns focus to the row's "···" trigger itself.
  const refocus = useRef(false)
  const active = !project.archived_at && !project.deleted_at
  const name = project.name ?? t('projects.placeholder')

  // Opening the field starts from the saved name, with no old error. A field that mounts open (the
  // Sidebar's) starts from the saved name too.
  function startEditing() {
    setValue(project.name ?? '')
    setError(null)
    setEditing(true)
  }

  function close() {
    refocus.current = true
    setEditing(false)
  }

  async function save(event) {
    event.preventDefault()
    if (busy) return
    // Nothing changed (including an untouched unnamed Project): close without a request.
    if (value.trim() === (project.name ?? '')) return close()
    setBusy(true)
    try {
      const updated = await apiFetch(`/api/projects/${project.id}`, { method: 'PATCH', body: { name: value } })
      onRenamed?.(updated)
      close()
    } catch (err) {
      if (SIGNED_OUT_CODES.has(err?.code)) return
      attempt.current += 1
      setError({ apiError: err, attempt: attempt.current })
      input.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    // A save in flight decides the outcome; Esc can't cancel it any more.
    if (busy) return
    close()
  }

  if (isEditing) {
    return (
      <form className={`${styles.form} ${variant === 'title' ? styles.titleField : styles.sidebarField}`} onSubmit={save} noValidate>
        <input
          ref={input}
          className={styles.input}
          // The field opens on request (a click or the menu's Rename), so taking focus is expected.
          autoFocus
          onFocus={(event) => event.target.select()}
          aria-label={t('projects.rename')}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          value={value}
          readOnly={busy}
          aria-busy={busy}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {error && (
          <div id={`${id}-error`} className={styles.error}>
            <ErrorLine key={error.attempt}>{errorText(t, error.apiError)}</ErrorLine>
          </div>
        )}
      </form>
    )
  }

  if (variant !== 'title') return <span className={styles.text}>{name}</span>
  if (!active || !onRenamed) return <h1 className={styles.title}>{name}</h1>
  return (
    <>
      <h1 className={styles.title}>
        <button
          ref={(element) => {
            if (element && refocus.current) {
              refocus.current = false
              element.focus()
            }
          }}
          type="button"
          className={styles.titleButton}
          aria-describedby={`${id}-hint`}
          onClick={startEditing}
        >
          {name}
        </button>
      </h1>
      <span id={`${id}-hint`} className={styles.hidden}>
        {t('projects.rename')}
      </span>
    </>
  )
}
