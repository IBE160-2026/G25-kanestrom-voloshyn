// The chat's Server-Sent Events reader (AD-25): POST with `fetch` (through apiFetch, so the request has
// the same auth header and its refusals the same ApiError) and read the body's ReadableStream.
// EventSource can't POST or send headers, so the stream is parsed here: events are separated by a
// blank line; `event:` names one and its `data:` lines are JSON. Comment lines (": ping") are skipped.
import { apiFetch } from './client.js'

/** Parse one event block; null for a keep-alive or an event without a name. */
function parseEvent(block) {
  let name = null
  const data = []
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') name = value
    else if (field === 'data') data.push(value)
  }
  if (!name) return null
  try {
    return { name, data: data.length ? JSON.parse(data.join('\n')) : {} }
  } catch {
    return { name, data: {} }
  }
}

/**
 * POST `body` to `path` and call `onEvent(name, data)` for each event as it arrives. Resolves when the
 * stream ends; rejects with an ApiError when the request is refused (a normal JSON error) or fails.
 * `signal` aborts it (the reader stops, and the server sees the disconnect).
 */
export async function streamEvents(path, { body, signal, onEvent }) {
  const response = await apiFetch(path, { method: 'POST', body, raw: true, signal })
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const drain = () => {
    buffer = buffer.replace(/\r\n?/g, '\n')
    let end
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const event = parseEvent(buffer.slice(0, end))
      buffer = buffer.slice(end + 2)
      if (event) onEvent(event.name, event.data)
    }
  }
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += typeof value === 'string' ? value : decoder.decode(value, { stream: true })
      drain()
    }
    buffer += decoder.decode()
    buffer += '\n\n'
    drain()
  } finally {
    reader.releaseLock?.()
  }
}
