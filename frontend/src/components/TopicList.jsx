import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SIGNED_OUT_CODES } from '../api/client.js'
import { errorText } from '../i18n/errors.js'
import InlineError from './InlineError.jsx'
import styles from './TopicList.module.css'

// Topic list (Story 2.6a/2.6b, FR-22, AD-21; DESIGN.md › Topic list, Topic chip, Grouped-topics note;
// EXPERIENCE.md › Topic list): a Ready file's Topics as chips, in the server's order. Topics with a
// `group_label` sit under group rows (a chapter or part): buttons with `aria-expanded`, named
// "{chapter}, {n} topics", that Enter or Space toggles. Above 20 Topics the groups start collapsed. The
// list scrolls inside the file row and can be reached with Tab. At the 100-topic ceiling the
// Grouped-topics note shows below it.
//
// Editing (Story 2.6b), only with `onEdit(edit)` (an active Project; it resolves with the file's new
// Topic list or rejects with the ApiError):
// - each chip is a button: a click or Enter opens an inline rename field (Enter saves, Esc cancels, an
//   unchanged or blank label closes without saving);
// - each chip has a × that deletes it, except a file's last chip;
// - "+ Add topic" opens the same field, and Enter adds;
// - Ctrl+click or Space selects chips; with 2 or more selected a ghost "Merge" appears, and the merged
//   Topic then opens for rename.
// A failed edit leaves the Topics as they were and shows the Inline error under the list: "Try again"
// for a network or server failure, only the message for a refusal that names a rule.
export const COLLAPSE_ABOVE = 20
export const TOPICS_MAX = 100
const LABEL_MAX = 100

// Refusals that name a rule: sending the same edit again can't help.
const RULES = new Set([
  'invalid_name',
  'invalid_request',
  'not_found',
  'project_read_only',
  'topic_limit_reached',
  'topic_last_cannot_delete',
  'topic_merge_cross_material',
])

/** Consecutive runs of Topics with the same group, in server order; ungrouped runs have label null. */
function groupTopics(topics) {
  const runs = []
  for (const topic of topics) {
    const label = topic.group_label ?? null
    const last = runs[runs.length - 1]
    if (last && last.label === label) last.items.push(topic)
    else runs.push({ label, items: [topic] })
  }
  return runs
}

function ReadOnlyChips({ topics, id }) {
  return (
    <ul className={styles.chips} id={id}>
      {topics.map((topic) => (
        <li key={topic.id} className={styles.chip} title={topic.label}>
          {topic.label}
        </li>
      ))}
    </ul>
  )
}

function LabelField({ value, onChange, onCommit, onCancel, label }) {
  const input = useRef(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  return (
    <input
      ref={input}
      className={styles.input}
      value={value}
      maxLength={LABEL_MAX}
      aria-label={label}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          onCommit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onCancel(true)
        }
      }}
      onBlur={() => onCancel(false)}
    />
  )
}

export default function TopicList({ topics, onEdit }) {
  const { t } = useTranslation()
  const baseId = useId()
  // Open state by run index, overriding the default (collapsed above 20).
  const [open, setOpen] = useState(() => new Map())
  const [editing, setEditing] = useState(null) // { id } while renaming, { add: true } while adding
  const [draft, setDraft] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [failure, setFailure] = useState(null) // { error, retry: () => void | null }
  const busy = useRef(false)
  const chipRefs = useRef(new Map())
  const addButton = useRef(null)
  const errorBox = useRef(null)
  const region = useRef(null)
  const focusNext = useRef(null) // a Topic id or 'add', focused after the next render

  useEffect(() => {
    const target = focusNext.current
    if (!target) return
    focusNext.current = null
    // A chip inside a collapsed group has no element: focus "+ Add topic" (or the list) instead.
    const element = target === 'add' ? addButton.current : chipRefs.current.get(target)
    ;(element ?? addButton.current ?? region.current)?.focus()
  })
  // "Try again" takes focus after a failure (EXPERIENCE.md › Inline error).
  useEffect(() => {
    if (failure?.retry) errorBox.current?.querySelector('button')?.focus()
  }, [failure])

  if (!topics?.length) return null

  const editable = typeof onEdit === 'function'
  const groups = groupTopics(topics)
  const grouped = groups.some((group) => group.label !== null)
  const collapsedByDefault = topics.length > COLLAPSE_ABOVE
  const isOpen = (index) => open.get(index) ?? !collapsedByDefault
  const chosen = topics.filter((topic) => selected.has(topic.id))

  function close(focus) {
    setEditing(null)
    setDraft('')
    if (focus) focusNext.current = focus
  }

  async function send(edit, onDone, focusOnRule) {
    if (busy.current) return
    busy.current = true
    setFailure(null)
    try {
      const next = await onEdit(edit)
      onDone(next)
    } catch (error) {
      setEditing(null)
      if (!SIGNED_OUT_CODES.has(error?.code)) {
        const rule = RULES.has(error?.code)
        setFailure({ error, retry: rule ? null : () => send(edit, onDone, focusOnRule) })
        if (rule && focusOnRule) focusNext.current = focusOnRule
      }
    } finally {
      busy.current = false
    }
  }

  function startRename(topic) {
    setEditing({ id: topic.id })
    setDraft(topic.label)
  }

  function commit() {
    const label = draft.trim()
    if (editing?.add) {
      if (!label) return close('add')
      return send({ type: 'add', label }, () => close('add'), 'add')
    }
    const topic = topics.find((item) => item.id === editing?.id)
    if (!topic || !label || label === topic.label) return close(topic?.id)
    return send({ type: 'rename', topicId: topic.id, label }, () => close(topic.id), topic.id)
  }

  function cancel(fromKeyboard) {
    // A blur while the edit is being sent keeps the field until the answer comes.
    if (busy.current) return
    if (!editing) return
    close(fromKeyboard ? (editing.add ? 'add' : editing.id) : null)
  }

  function toggleSelected(id) {
    setSelected((ids) => {
      const next = new Set(ids)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function remove(topic) {
    const index = topics.findIndex((item) => item.id === topic.id)
    send(
      { type: 'delete', topicId: topic.id },
      (next) => {
        setSelected((ids) => {
          const rest = new Set(ids)
          rest.delete(topic.id)
          return rest
        })
        // Focus stays in the list: the chip now at that place, or the one before it.
        const neighbour = next[Math.min(index, next.length - 1)]
        focusNext.current = neighbour?.id ?? 'add'
      },
      topic.id,
    )
  }

  function merge() {
    if (chosen.length < 2) return
    // The server keeps the Topic with the lowest position; the list is in position order.
    const survivor = chosen[0]
    send({ type: 'merge', topicIds: chosen.map((topic) => topic.id) }, (next) => {
      setSelected(new Set())
      const merged = next.find((topic) => topic.id === survivor.id)
      if (merged) startRename(merged)
    })
  }

  function editableChips({ items, id }) {
    const deletable = topics.length > 1
    return (
      <ul className={styles.chips} id={id}>
        {items.map((topic) => {
          const isEditing = editing?.id === topic.id
          const isSelected = selected.has(topic.id)
          const classes = [styles.chip, styles.editable]
          if (isSelected) classes.push(styles.selected)
          if (isEditing) classes.push(styles.editing)
          return (
            <li key={topic.id} className={classes.join(' ')}>
              {isEditing ? (
                <LabelField
                  value={draft}
                  onChange={setDraft}
                  onCommit={commit}
                  onCancel={cancel}
                  label={t('files.topics.rename')}
                />
              ) : (
                <button
                  type="button"
                  ref={(el) => {
                    if (el) chipRefs.current.set(topic.id, el)
                    else chipRefs.current.delete(topic.id)
                  }}
                  className={styles.chipLabel}
                  title={topic.label}
                  aria-pressed={isSelected}
                  onClick={(event) => {
                    if (event.ctrlKey || event.metaKey) toggleSelected(topic.id)
                    else startRename(topic)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === ' ') {
                      event.preventDefault()
                      toggleSelected(topic.id)
                    } else if (event.key === 'Enter') {
                      event.preventDefault()
                      startRename(topic)
                    }
                  }}
                  // Space selects on key down; the key up must not also click (which would rename).
                  onKeyUp={(event) => {
                    if (event.key === ' ') event.preventDefault()
                  }}
                >
                  {topic.label}
                </button>
              )}
              {deletable && !isEditing && (
                <button
                  type="button"
                  className={styles.remove}
                  aria-label={t('files.topics.delete', { label: topic.label })}
                  onClick={() => remove(topic)}
                >
                  <svg viewBox="0 0 8 8" aria-hidden="true" focusable="false">
                    <path d="M1.5 1.5 6.5 6.5 M6.5 1.5 1.5 6.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
                  </svg>
                </button>
              )}
            </li>
          )
        })}
      </ul>
    )
  }

  // Rendered as a function, not a component, so the chips keep their DOM nodes (and focus) across renders.
  const chips = (items, id) =>
    editable ? editableChips({ items, id }) : <ReadOnlyChips topics={items} id={id} />

  return (
    <div className={styles.topics}>
      {/* Focusable so the keyboard can scroll it (WCAG 2.1.1); named by the Topic count. */}
      <div ref={region} className={styles.scroll} tabIndex={0} role="region" aria-label={t('files.topics.count', { count: topics.length })}>
        {!grouped && chips(topics)}
        {grouped &&
          groups.map((group, index) => {
            if (group.label === null) return <div key={index}>{chips(group.items)}</div>
            const expanded = isOpen(index)
            const bodyId = `${baseId}-g${index}`
            return (
              <div key={index} className={styles.group}>
                <button
                  type="button"
                  className={styles.groupRow}
                  aria-expanded={expanded}
                  aria-controls={expanded ? bodyId : undefined}
                  aria-label={t('files.topics.group', { chapter: group.label, count: group.items.length })}
                  onClick={() => setOpen((prev) => new Map(prev).set(index, !expanded))}
                >
                  <svg
                    className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`}
                    viewBox="0 0 8 8"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M2.5 1 5.5 4 2.5 7" fill="none" stroke="currentColor" strokeWidth="1.3" />
                  </svg>
                  <span className={styles.groupName}>{group.label}</span>
                  <span className={styles.groupCount} aria-hidden="true">
                    {group.items.length}
                  </span>
                </button>
                {expanded && chips(group.items, bodyId)}
              </div>
            )
          })}
        {editable && (
          <div className={styles.actions}>
            {editing?.add ? (
              <span className={`${styles.chip} ${styles.editable} ${styles.editing}`}>
                <LabelField value={draft} onChange={setDraft} onCommit={commit} onCancel={cancel} label={t('files.topics.new')} />
              </span>
            ) : (
              <button
                ref={addButton}
                type="button"
                className={styles.add}
                onClick={() => {
                  setEditing({ add: true })
                  setDraft('')
                }}
              >
                {t('files.topics.add')}
              </button>
            )}
            {chosen.length >= 2 && (
              <button type="button" className={styles.merge} onClick={merge}>
                {t('files.topics.merge')}
              </button>
            )}
          </div>
        )}
      </div>
      {failure && (
        <div ref={errorBox} className={styles.error}>
          <InlineError onRetry={failure.retry ?? undefined}>
            {failure.retry ? t('files.topics.failed') : failure.error?.code === 'invalid_name' ? t('files.topics.invalidName') : errorText(t, failure.error)}
          </InlineError>
        </div>
      )}
      {topics.length >= TOPICS_MAX && <p className={styles.note}>{t('files.topics.grouped')}</p>}
    </div>
  )
}
