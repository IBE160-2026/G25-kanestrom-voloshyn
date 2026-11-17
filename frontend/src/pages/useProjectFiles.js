// The open Project's Study Materials (FR-6, FR-8, AD-5, AD-20): the list, uploads, and live status.
//
// - Uploads go one file per request, one after another; every chosen file shows as "Reading…" at once.
// - Type and size are checked here first as a hint only; the server enforces every limit (AD-5).
// - While any file is Reading…, the jobs endpoint is polled every 2 s. When a processing job finishes,
//   the list is fetched again and the job is marked seen. Nothing is polled otherwise.
// - `remove(material)` removes a file (FR-20, AD-23): the row leaves only once the server has said 204
//   (or `not_found`: it is gone already). Removed ids are remembered per Project, so a list request
//   sent before the removal committed can't bring the row back when it answers later.
import { useCallback, useEffect, useRef, useState } from 'react'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'

export const POLL_MS = 2000
export const MAX_BYTES = 50 * 1024 * 1024
export const ACCEPT = '.pdf,.docx,.pptx,.txt,.md'
const EXTENSIONS = ACCEPT.split(',')
const ACTIVE = new Set(['queued', 'running'])
const KIND = 'material_processing'

// Refusals that name a rule: trying the same file again can't help.
const RULES = new Set([
  'unsupported_file_type',
  'file_too_large',
  'material_limit_reached',
  'project_read_only',
  'not_found',
  'invalid_request',
  // The Privacy notice isn't accepted (Story 2.3): retrying sends the same refusal.
  'privacy_notice_required',
])

export function isRuleRefusal(error) {
  return RULES.has(error?.code)
}

/** The same refusal the server would give, or null (a UX hint; the server decides). */
export function precheck(file) {
  const name = String(file?.name ?? '').toLowerCase()
  if (!EXTENSIONS.some((ext) => name.endsWith(ext))) return { code: 'unsupported_file_type', params: {} }
  if (file.size > MAX_BYTES) return { code: 'file_too_large', params: {} }
  return null
}

/** Slot-holding files: Reading… and Ready count toward 10, Rejected doesn't (AD-5). */
export function slotCount(materials) {
  return (materials ?? []).filter((m) => m.status !== 'rejected').length
}

let nextKey = 0

export function useProjectFiles(projectId) {
  const [loaded, setLoaded] = useState({ id: null, materials: null }) // the list of the Project shown
  const [loadError, setLoadError] = useState(null) // { id, error }
  const [pending, setPending] = useState([]) // [{ key, projectId, name }] queued or sending
  const [failures, setFailures] = useState([]) // [{ key, projectId, name, error, file }]
  const queue = useRef(Promise.resolve())
  const removedIds = useRef(new Map()) // { [projectId]: Set of removed Material ids }

  const withoutRemoved = useCallback((id, list) => {
    const gone = removedIds.current.get(id)
    const all = Array.isArray(list) ? list : []
    return gone ? all.filter((m) => !gone.has(m.id)) : all
  }, [])

  const materials = loaded.id === projectId ? loaded.materials : null

  const fetchList = useCallback(
    (id) =>
      apiFetch(`/api/projects/${id}/materials`).then((list) => {
        // Only while that Project is still the one shown.
        setLoaded((state) => (state.id === id ? { id, materials: withoutRemoved(id, list) } : state))
      }),
    [withoutRemoved],
  )

  // Load the list when a Project opens (FR-8).
  useEffect(() => {
    let live = true
    apiFetch(`/api/projects/${projectId}/materials`)
      .then((list) => live && setLoaded({ id: projectId, materials: withoutRemoved(projectId, list) }))
      .catch((error) => {
        // A missing or foreign Project is handled by the page (it goes back to /projects).
        if (live && !SIGNED_OUT_CODES.has(error?.code) && error?.code !== 'not_found' && error?.code !== 'invalid_request') {
          setLoadError({ id: projectId, error })
        }
      })
    return () => {
      live = false
    }
  }, [projectId, withoutRemoved])

  // Poll only while something is Reading… (AD-20).
  const processing = Boolean(materials?.some((m) => m.status === 'processing'))
  useEffect(() => {
    if (!processing) return undefined
    let live = true
    const handle = { timer: null }
    const tick = async () => {
      try {
        const jobs = await apiFetch(`/api/projects/${projectId}/jobs`)
        if (!live) return
        const ours = (Array.isArray(jobs) ? jobs : []).filter((job) => job.kind === KIND)
        const finished = ours.filter((job) => !ACTIVE.has(job.status))
        if (finished.length > 0 || !ours.some((job) => ACTIVE.has(job.status))) {
          await fetchList(projectId)
          for (const job of finished) {
            apiFetch(`/api/jobs/${job.id}/seen`, { method: 'POST' }).catch(() => {})
          }
        }
      } catch {
        // a failed poll is retried on the next tick
      }
      if (live) handle.timer = setTimeout(tick, POLL_MS)
    }
    handle.timer = setTimeout(tick, POLL_MS)
    return () => {
      live = false
      clearTimeout(handle.timer)
    }
  }, [processing, projectId, fetchList])

  const send = useCallback(async ({ key, projectId: id, file }) => {
    const form = new FormData()
    form.append('file', file)
    try {
      const { material } = await apiFetch(`/api/projects/${id}/materials`, { method: 'POST', body: form })
      // A poll may already have listed it: merge by id.
      setLoaded((state) => {
        if (state.id !== id) return state
        const list = state.materials ?? []
        return { id, materials: list.some((m) => m.id === material.id) ? list : [...list, material] }
      })
    } catch (error) {
      if (!SIGNED_OUT_CODES.has(error?.code)) {
        setFailures((list) => [...list, { key, projectId: id, name: file.name, error, file, retryable: !isRuleRefusal(error) }])
      }
    } finally {
      setPending((list) => list.filter((item) => item.key !== key))
    }
  }, [])

  /** Upload files one after another; each shows as Reading… at once. */
  const upload = useCallback(
    (files) => {
      const chosen = Array.from(files ?? [])
      if (chosen.length === 0) return
      setFailures((list) => list.filter((failure) => failure.projectId !== projectId))
      const refused = []
      const items = []
      for (const file of chosen) {
        const key = `upload-${(nextKey += 1)}`
        const error = precheck(file)
        if (error) refused.push({ key, projectId, name: file.name, error, file, retryable: false })
        else items.push({ key, projectId, name: file.name, file })
      }
      if (refused.length) setFailures((list) => [...list, ...refused])
      if (items.length === 0) return
      setPending((list) => [...list, ...items.map(({ key, projectId: id, name }) => ({ key, projectId: id, name }))])
      for (const item of items) {
        queue.current = queue.current.then(() => send(item))
      }
    },
    [projectId, send],
  )

  /** Try a failed upload again (network or server failure). */
  const retry = useCallback(
    (key) => {
      const failure = failures.find((f) => f.key === key)
      if (!failure) return
      setFailures((list) => list.filter((f) => f.key !== key))
      setPending((list) => [...list, { key, projectId: failure.projectId, name: failure.name }])
      queue.current = queue.current.then(() => send(failure))
    },
    [failures, send],
  )

  /** Remove a file; resolves once removed (the row leaves), rejects with the ApiError otherwise.
   * `not_found` counts as removed: the file is gone either way. */
  const remove = useCallback(
    async (material) => {
      const id = projectId
      try {
        await apiFetch(`/api/projects/${id}/materials/${material.id}`, { method: 'DELETE' })
      } catch (error) {
        if (error?.code !== 'not_found') throw error
      }
      if (!removedIds.current.has(id)) removedIds.current.set(id, new Set())
      removedIds.current.get(id).add(material.id)
      setLoaded((state) => (state.id === id ? { id, materials: withoutRemoved(id, state.materials) } : state))
    },
    [projectId, withoutRemoved],
  )

  return {
    materials,
    pending: pending.filter((item) => item.projectId === projectId),
    failures: failures.filter((failure) => failure.projectId === projectId),
    loadError: loadError?.id === projectId ? loadError.error : null,
    upload,
    retry,
    remove,
  }
}
