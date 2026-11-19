// The open Project's outstanding Mistakes (Story 3.3: FR-9, FR-12, FR-20, AD-10).
//
// - Reads `GET /api/projects/{id}/mistakes/summary` → `{outstanding, by_material}` when the Project
//   opens. Coming back from a Quiz ("← Back to chat") mounts the chat again, so the count is fresh then
//   too, with no reload.
// - `refresh()` reads it again (after a file removal, and when the Remove file dialog opens).
// - Every read is numbered; only the latest one's answer is kept, so an older answer arriving late never
//   overwrites a newer one, and a read for another Project is ignored.
// - `known` is false until a read has answered for this Project. A failed read keeps the last value:
//   the card is a hint, and the server holds the count.
// - The summary is a read, so it answers for an archived or deleted Project; the page hides the card.
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../api/client.js'

export function useMistakes(projectId) {
  const [loaded, setLoaded] = useState({ id: null, summary: null })
  const latest = useRef(0)

  const refresh = useCallback(() => {
    latest.current += 1
    const seq = latest.current
    return apiFetch(`/api/projects/${projectId}/mistakes/summary`)
      .then((summary) => {
        if (seq === latest.current && Number.isInteger(summary?.outstanding)) setLoaded({ id: projectId, summary })
      })
      .catch(() => {})
  }, [projectId])

  useEffect(() => {
    refresh()
    // Leaving the Project makes any read in flight stale.
    return () => {
      latest.current += 1
    }
  }, [refresh])

  const summary = loaded.id === projectId ? loaded.summary : null

  return {
    known: summary !== null,
    outstanding: summary?.outstanding ?? 0,
    byMaterial: summary?.by_material ?? {},
    refresh,
  }
}
