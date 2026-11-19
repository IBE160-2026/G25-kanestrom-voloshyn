import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './GenerationProgress.module.css'

// Progress steps (DESIGN.md › Progress steps; EXPERIENCE.md › Progress steps, Strings › Progress status
// lines, Progress step line), shared by every generation (Quiz, Flashcards, Summary, Mistake Review start).
//
// Centred: a spinning loop (static under reduced motion), a status line picked at random from the
// approved lines every LINE_MS (never the same twice in a row; the last two lines only during the
// final step), and a muted "Step {n} of {total} · {label}" naming the real step. Ghost Cancel below.
// Screen readers hear only the real step when it changes: the rotating line is aria-hidden, the step
// line is the polite live region. `ref` goes to that live region, so the page can focus it on start.
// `children` (for example an Inline error) shows above Cancel.
export const LINE_MS = 2500
// The approved lines end with the two that belong to the final step only.
const FINAL_ONLY = 2

function pick(count, previous) {
  if (count <= 1) return 0
  if (previous === null) return Math.floor(Math.random() * count)
  // Never the same line twice in a row.
  const next = Math.floor(Math.random() * (count - 1))
  return next >= previous ? next + 1 : next
}

export default function GenerationProgress({ steps, current, onCancel, cancelling = false, children, ref }) {
  const { t } = useTranslation()
  const all = t('progress.lines', { returnObjects: true })
  const lines = Array.isArray(all) ? all : []
  const step = Math.min(Math.max(current, 0), steps.length - 1)
  const final = step === steps.length - 1
  const count = final ? lines.length : Math.max(lines.length - FINAL_ONLY, 1)
  const [line, setLine] = useState(() => pick(count, null))

  useEffect(() => {
    const timer = setInterval(() => setLine((previous) => pick(count, previous < count ? previous : null)), LINE_MS)
    return () => clearInterval(timer)
  }, [count])

  // A final-step line left over after the step changed back is never shown.
  const shown = line < count ? line : 0

  return (
    <section className={styles.progress}>
      <span className={styles.spinner} aria-hidden="true" />
      <p className={styles.line} aria-hidden="true" data-testid="progress-line">
        {lines[shown] ?? ''}
      </p>
      <p ref={ref} tabIndex={-1} className={styles.step} role="status" aria-live="polite">
        {t('progress.step', { n: step + 1, total: steps.length, label: steps[step] })}
      </p>
      {children}
      <button type="button" className={styles.cancel} onClick={onCancel} disabled={cancelling}>
        {t('progress.cancel')}
      </button>
    </section>
  )
}
