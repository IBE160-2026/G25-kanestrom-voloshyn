// The chat's SSE reader (Story 4.4, AD-25): events split across chunks, bytes or strings, keep-alive
// comments, and CRLF line ends. api/client.js is mocked; its apiFetch returns the Response stand-in.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from './client.js'
import { streamEvents } from './stream.js'

vi.mock('./client.js', async () => (await import('../test/mocks.js')).clientMock())

function responseOf(chunks) {
  const queue = [...chunks]
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => (queue.length ? { value: queue.shift(), done: false } : { value: undefined, done: true }),
        releaseLock() {},
      }),
    },
  }
}

beforeEach(() => {
  vi.mocked(apiFetch).mockReset()
})

describe('streamEvents', () => {
  it('posts with the raw option and parses events split across chunks', async () => {
    const encoder = new TextEncoder()
    vi.mocked(apiFetch).mockResolvedValue(
      responseOf([
        encoder.encode('event: delta\ndata: {"text":"Hel'),
        'lo"}\n\n: ping\n\nevent: delta\r\ndata: {"text":" there"}\r\n\r\n',
        'event: done\ndata: {"message_id":"m1","sources":[]}',
      ]),
    )
    const seen = []

    await streamEvents('/api/chats/c1/messages', { body: { text: 'Hi' }, onEvent: (name, data) => seen.push([name, data]) })

    expect(apiFetch).toHaveBeenCalledWith('/api/chats/c1/messages', {
      method: 'POST',
      body: { text: 'Hi' },
      raw: true,
      signal: undefined,
    })
    expect(seen).toEqual([
      ['delta', { text: 'Hello' }],
      ['delta', { text: ' there' }],
      ['done', { message_id: 'm1', sources: [] }],
    ])
  })

  it('passes a refused request on as its ApiError', async () => {
    vi.mocked(apiFetch).mockImplementation(async () => {
      throw Object.assign(new Error('refused'), { code: 'quota_exceeded', params: { limit: 50 } })
    })
    let caught = null
    try {
      await streamEvents('/api/chats/c1/messages', { body: { text: 'Hi' }, onEvent: () => {} })
    } catch (err) {
      caught = err
    }

    expect(caught?.code).toBe('quota_exceeded')
  })
})
