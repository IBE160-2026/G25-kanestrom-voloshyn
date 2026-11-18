import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './TopicList.module.css'

// Topic list (Story 2.6a, FR-22; DESIGN.md › Topic list, Topic chip, Grouped-topics note; EXPERIENCE.md ›
// Topic list): a Ready file's Topics as read-only chips, in the server's order. Topics with a
// `group_label` sit under group rows (a chapter or part): buttons with `aria-expanded`, named
// "{chapter}, {n} topics", that Enter or Space toggles. Above 20 Topics the groups start collapsed. The
// list scrolls inside the file row and can be reached with Tab. At the 100-topic ceiling the
// Grouped-topics note shows below it. Editing (rename, merge, delete, add) arrives with Story 2.6b.
export const COLLAPSE_ABOVE = 20
export const TOPICS_MAX = 100

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

function Chips({ topics, id }) {
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

export default function TopicList({ topics }) {
  const { t } = useTranslation()
  const baseId = useId()
  // Open state by run index, overriding the default (collapsed above 20).
  const [open, setOpen] = useState(() => new Map())
  if (!topics?.length) return null

  const groups = groupTopics(topics)
  const grouped = groups.some((group) => group.label !== null)
  const collapsedByDefault = topics.length > COLLAPSE_ABOVE
  const isOpen = (index) => open.get(index) ?? !collapsedByDefault

  return (
    <div className={styles.topics}>
      {/* Focusable so the keyboard can scroll it (WCAG 2.1.1); named by the Topic count. */}
      <div className={styles.scroll} tabIndex={0} role="region" aria-label={t('files.topics.count', { count: topics.length })}>
        {!grouped && <Chips topics={topics} />}
        {grouped &&
          groups.map((group, index) => {
            if (group.label === null) return <Chips key={index} topics={group.items} />
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
                {expanded && <Chips topics={group.items} id={bodyId} />}
              </div>
            )
          })}
      </div>
      {topics.length >= TOPICS_MAX && <p className={styles.note}>{t('files.topics.grouped')}</p>}
    </div>
  )
}
