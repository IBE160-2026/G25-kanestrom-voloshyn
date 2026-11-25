import { useCallback, useEffect, useRef, useState } from 'react'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'

// The "is ready" notices on the Project home (Story 3.1b, FR-26, AD-20; EXPERIENCE.md ›
// Finished-generation message): quizzes, Mistake Review rounds (Story 3.4), flashcard sets (Story 4.1),
// and summaries (Story 4.3), under the same rules.
//
// - Opening the Project reads its jobs once; while any `quiz`, `flashcards`, `summary`, or `review_round` job is queued or
//   running, it reads them again every 2 s, and stops when none is (or when the page goes away).
// - Each completed job of those kinds not yet seen is a notice, newest first. Failed and
//   cancelled ones are left alone, and other job kinds keep their own handling.
// - A failed read is tried again every 2 s until one succeeds.
// - `open(job)` hides the notice at once and marks the job seen in the background; `dismiss(job)`
//   marks it seen and drops the notice only once that worked.
export const NOTICE_POLL_MS = 2000
const KINDS = new Set(['quiz', 'flashcards', 'summary', 'review_round'])
const ACTIVE = new Set(['queued', 'running'])

export function useQuizNotices(projectId) {
  const [read, setRead] = useState(null) // { id, jobs }: the Project's quiz and review jobs as last listed
  const [hidden, setHidden] = useState(() => new Set()) // jobs marked seen in this visit

  useEffect(() => {
    const handle = { live: true, timer: null, active: false }
    const tick = async () => {
      try {
        const list = await apiFetch(`/api/projects/${projectId}/jobs`)
        if (!handle.live) return
        const jobs = (Array.isArray(list) ? list : []).filter((job) => KINDS.has(job.kind))
        setRead({ id: projectId, jobs })
        handle.active = jobs.some((job) => ACTIVE.has(job.status))
      } catch (err) {
        if (!handle.live || SIGNED_OUT_CODES.has(err?.code)) return
        // A failed read (also the first one) is tried again on the next tick.
        handle.timer = setTimeout(tick, NOTICE_POLL_MS)
        return
      }
      if (handle.live && handle.active) handle.timer = setTimeout(tick, NOTICE_POLL_MS)
    }
    tick()
    return () => {
      handle.live = false
      clearTimeout(handle.timer)
    }
  }, [projectId])

  const hide = useCallback((job) => setHidden((ids) => new Set(ids).add(job.id)), [])
  const opened = useRef(new Set()) // jobs Open was clicked for, so a second click does nothing

  // Open: hides the notice at once and marks the job seen in the background (a failure is ignored; the
  // notice may come back on a later visit). True the first time for a job, so the caller navigates once.
  const open = useCallback(
    (job) => {
      if (opened.current.has(job.id)) return false
      opened.current.add(job.id)
      hide(job)
      apiFetch(`/api/jobs/${job.id}/seen`, { method: 'POST' }).catch(() => {})
      return true
    },
    [hide],
  )

  // ×: marks the job seen and drops the notice once that worked; after a failure the notice stays for
  // the next try. Resolves true when dismissed.
  const dismiss = useCallback(
    async (job) => {
      try {
        await apiFetch(`/api/jobs/${job.id}/seen`, { method: 'POST' })
        hide(job)
        return true
      } catch {
        return false
      }
    },
    [hide],
  )

  const jobs = read?.id === projectId ? read.jobs : []
  // The server lists oldest first; newest finished first here.
  const notices = jobs
    .map((job, index) => ({ job, index }))
    .filter(({ job }) => job.status === 'completed' && job.result_ref && !hidden.has(job.id))
    .sort((x, y) => finished(y) - finished(x) || y.index - x.index)
    .map(({ job }) => job)

  return { notices, open, dismiss }
}

function finished({ job }) {
  const at = Date.parse(job.finished_at ?? job.created_at ?? '')
  return Number.isNaN(at) ? 0 : at
}
