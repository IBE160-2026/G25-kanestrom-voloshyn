// The Project's chat (Story 4.4: FR-16, AD-25). Used by ProjectChat, which is keyed by Project, so all
// of this state starts fresh in another Project, and leaving aborts a stream in flight (the server then
// stores nothing and gives the message back).
//
// - Once `enabled` (a file is Ready), reads `GET /api/projects/{id}/chat` → `{id, current_scope,
//   messages}` and `GET /api/usage` → `messages_left_today`.
// - `send(text)` streams `POST /api/chats/{id}/messages` (api/stream.js): `pending` holds the question
//   and the text so far (empty until the first `delta`), and becomes a stored message pair on `done`.
//   On `done` the answer is announced once (`announcement`) and one message is counted off.
// - A failed stream (an `error` event, or a refused or broken request) drops the pending answer, puts
//   the question back in the composer, and sets `failure`; `retry()` sends it again, offered only when
//   sending again can help (`failure.retryable`). `quota_exceeded`
//   sets the messages left to 0 instead (the Limit notice turns into the limit message).
// - `setScope(scope)` saves `{"all_materials": true}` or `{"material_id": M}` for this chat.
import { useCallback, useEffect, useRef, useState } from 'react'
import { SIGNED_OUT_CODES, apiFetch } from '../api/client.js'
import { streamEvents } from '../api/stream.js'

export const ALL_MATERIALS = { all_materials: true }

// Refusals that sending again can't fix: the Inline error shows their message with no "Try again"
// (like GenerationSetup's RULES). Network failures, `llm_unavailable`, and `internal_error` keep it.
const RULES = new Set(['project_read_only', 'insufficient_material', 'not_found', 'chat_busy', 'quota_exceeded'])

export function useChat(projectId, { enabled }) {
  const [chat, setChat] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [loadRound, setLoadRound] = useState(0)
  const [left, setLeft] = useState(null) // messages left today, null until known
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(null) // { question, text }
  const [failure, setFailure] = useState(null) // { question, error }
  const [scopeError, setScopeError] = useState(null)
  const [announcement, setAnnouncement] = useState(null) // { id, text } of the last completed answer
  const controller = useRef(null)
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      controller.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!enabled) return undefined
    let current = true
    apiFetch(`/api/projects/${projectId}/chat`)
      .then((found) => {
        if (!current) return
        setChat(found)
        setLoadError(null)
      })
      .catch((err) => current && !SIGNED_OUT_CODES.has(err?.code) && setLoadError(err))
    apiFetch('/api/usage')
      .then((usage) => {
        if (current && Number.isInteger(usage?.messages_left_today)) setLeft(usage.messages_left_today)
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [enabled, projectId, loadRound])

  const reload = useCallback(() => {
    setLoadError(null)
    setLoadRound((n) => n + 1)
  }, [])

  const send = useCallback(
    async (raw) => {
      const question = raw.trim()
      if (!chat || !question || controller.current) return
      const abort = new AbortController()
      controller.current = abort
      setFailure(null)
      setDraft('')
      setPending({ question, text: '' })
      // What the stream has said so far: its text, then { done } or { error }.
      const heard = { text: '', outcome: null }
      try {
        await streamEvents(`/api/chats/${chat.id}/messages`, {
          body: { text: question },
          signal: abort.signal,
          onEvent: (name, data) => {
            if (!live.current || heard.outcome) return
            if (name === 'delta' && typeof data?.text === 'string') {
              heard.text += data.text
              setPending({ question, text: heard.text })
            } else if (name === 'done') {
              heard.outcome = { done: data }
            } else if (name === 'error') {
              heard.outcome = { error: { code: data?.code ?? 'llm_unavailable', params: {} } }
            }
          },
        })
        if (!heard.outcome) heard.outcome = { error: { code: 'llm_unavailable', params: {} } }
      } catch (err) {
        heard.outcome = { error: err }
      }
      const { outcome } = heard
      controller.current = null
      if (!live.current || abort.signal.aborted) return
      setPending(null)
      if (outcome.done) {
        const answer = {
          id: outcome.done.message_id,
          role: 'assistant',
          text: heard.text.trim(),
          sources: Array.isArray(outcome.done.sources) ? outcome.done.sources : [],
        }
        setChat((found) => ({
          ...found,
          messages: [...found.messages, { id: `${answer.id}-q`, role: 'user', text: question, sources: [] }, answer],
        }))
        setAnnouncement({ id: answer.id, text: answer.text })
        setLeft((n) => (n === null ? n : Math.max(0, n - 1)))
        return
      }
      const error = outcome.error
      if (SIGNED_OUT_CODES.has(error?.code)) return
      setDraft((current) => current || question)
      if (error?.code === 'quota_exceeded') {
        setLeft(0)
        return
      }
      setFailure({ question, error, retryable: !RULES.has(error?.code) })
    },
    [chat],
  )

  const retry = useCallback(() => {
    if (failure) send(failure.question)
  }, [failure, send])

  const setScope = useCallback(
    async (scope) => {
      if (!chat) return
      setScopeError(null)
      try {
        const saved = await apiFetch(`/api/chats/${chat.id}`, { method: 'PATCH', body: { scope } })
        if (live.current) setChat((found) => ({ ...found, current_scope: saved.current_scope }))
      } catch (err) {
        if (live.current && !SIGNED_OUT_CODES.has(err?.code)) setScopeError(err)
      }
    },
    [chat],
  )

  return {
    chat,
    loadError,
    reload,
    left,
    draft,
    setDraft,
    pending,
    failure,
    scopeError,
    announcement,
    send,
    retry,
    setScope,
  }
}
