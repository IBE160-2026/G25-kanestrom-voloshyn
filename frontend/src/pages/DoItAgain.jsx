import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import InlineError from '../components/InlineError.jsx'
import { errorText } from '../i18n/errors.js'

// "Do it again" (Story 5.2, FR-25, AD-7, AD-20): a ghost button on the Quiz Score summary and the
// Flashcard end screen. It POSTs `againPath`, which queues a normal job from the result's frozen setup,
// then replaces the page with `setupPath`, whose setup resumes the running job's progress and moves on
// to the new result.
//
// - `sourceRemoved`: disabled, with the muted caption "The file this came from was removed." beside it.
// - `readOnly`: disabled; the page's own read-only notice says why.
// - A failure shows the Inline error under the actions: a refusal that names a rule shows its message
//   only; anything else adds "Try again" (which takes focus).
//
// Render-prop shape: `children(button, note)` lets each page place the button among its own actions,
// and the error goes below them.
const RULES = new Set(['material_removed', 'project_read_only', 'not_found'])

export default function DoItAgain({ againPath, setupPath, sourceRemoved, readOnly, buttonClass, noteClass, children }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState(null) // { path, error, rule }
  const noteId = useId()

  async function start() {
    if (busy || sourceRemoved || readOnly) return
    setBusy(true)
    setFailure(null)
    try {
      const answer = await apiFetch(againPath, { method: 'POST' })
      // The setup follows exactly this job, even when it has already ended.
      navigate(setupPath, { replace: true, state: { job_id: answer?.job_id ?? null } })
    } catch (err) {
      if (SIGNED_OUT_CODES.has(err?.code)) return
      setFailure({ path: againPath, error: err, rule: RULES.has(err?.code) })
    } finally {
      setBusy(false)
    }
  }

  const shown = failure?.path === againPath ? failure : null
  const button = (
    <button
      type="button"
      className={buttonClass}
      disabled={busy || sourceRemoved || readOnly}
      aria-describedby={sourceRemoved ? noteId : undefined}
      onClick={start}
    >
      {t('history.again')}
    </button>
  )
  const note = sourceRemoved ? (
    <span id={noteId} className={noteClass}>
      {t('errors.material_removed')}
    </span>
  ) : null
  return (
    <>
      {children(button, note)}
      {shown && (
        <InlineError onRetry={shown.rule ? undefined : start} focusRetry>
          {errorText(t, shown.error)}
        </InlineError>
      )}
    </>
  )
}
