// api/client.js and auth/ together, with fetch and supabase-js stubbed (spine › Tests).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getSession, createClient } = vi.hoisted(() => {
  const getSession = vi.fn()
  return { getSession, createClient: vi.fn(() => ({ auth: { getSession } })) }
})
vi.mock('@supabase/supabase-js', () => ({ createClient }))

const CONFIG = { supabase_url: 'http://sb.test', supabase_publishable_key: 'pk', google_enabled: false }

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

let fetchMock
let client

beforeEach(async () => {
  vi.resetModules() // a fresh cached Supabase client per test
  createClient.mockClear()
  getSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'tok' } } })
  fetchMock = vi.fn(async (path) => (path === '/api/config' ? json(200, CONFIG) : json(200, { ok: true })))
  vi.stubGlobal('fetch', fetchMock)
  client = await import('./client.js')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function callTo(path) {
  return fetchMock.mock.calls.find(([p]) => p === path)
}

describe('apiFetch', () => {
  it('attaches the bearer token and builds Supabase from /api/config without one', async () => {
    await expect(client.apiFetch('/api/me')).resolves.toEqual({ ok: true })

    expect(callTo('/api/me')[1].headers.Authorization).toBe('Bearer tok')
    expect(callTo('/api/config')[1].headers.Authorization).toBeUndefined()
    expect(createClient).toHaveBeenCalledWith('http://sb.test', 'pk')
  })

  it('loads /api/config once', async () => {
    await client.apiFetch('/api/me')
    await client.apiFetch('/api/me')
    expect(fetchMock.mock.calls.filter(([p]) => p === '/api/config')).toHaveLength(1)
  })

  it('sends a JSON body', async () => {
    await client.apiFetch('/api/auth/after-sign-in', { method: 'POST', body: { first_name: 'Emma' } })
    const [, init] = callTo('/api/auth/after-sign-in')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ first_name: 'Emma' })
  })

  it('sends no Authorization header when signed out', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    await client.apiFetch('/api/me')
    expect(callTo('/api/me')[1].headers.Authorization).toBeUndefined()
  })

  it('turns the error envelope into an ApiError with code and params', async () => {
    fetchMock.mockImplementation(async (path) =>
      path === '/api/config'
        ? json(200, CONFIG)
        : json(503, { error: { code: 'auth_unavailable', params: { a: 1 }, message: 'x' } }),
    )
    const error = await client.apiFetch('/api/me').catch((e) => e)
    expect(error).toBeInstanceOf(client.ApiError)
    expect(error).toMatchObject({ status: 503, code: 'auth_unavailable', params: { a: 1 } })
  })

  it('a non-JSON failure becomes http_error', async () => {
    fetchMock.mockImplementation(async (path) =>
      path === '/api/config' ? json(200, CONFIG) : new Response('<html>', { status: 502 }),
    )
    await expect(client.apiFetch('/api/me')).rejects.toMatchObject({ status: 502, code: 'http_error' })
  })

  it.each([
    ['empty', ''],
    ['non-JSON', '<html>'],
  ])('a 2xx with an %s body becomes http_error', async (_, text) => {
    fetchMock.mockImplementation(async (path) =>
      path === '/api/config' ? json(200, CONFIG) : new Response(text, { status: 200 }),
    )
    await expect(client.apiFetch('/api/me')).rejects.toMatchObject({ status: 200, code: 'http_error' })
    await expect(client.apiFetch('/api/me')).rejects.toBeInstanceOf(client.ApiError)
  })

  it('a network failure becomes network_error', async () => {
    fetchMock.mockImplementation(async (path) => {
      if (path === '/api/config') return json(200, CONFIG)
      throw new TypeError('Failed to fetch')
    })
    await expect(client.apiFetch('/api/me')).rejects.toMatchObject({ code: 'network_error' })
  })

  it('retries /api/config after a failed load', async () => {
    let first = true
    fetchMock.mockImplementation(async (path) => {
      if (path === '/api/config' && first) {
        first = false
        return json(500, { error: { code: 'internal_error', params: {} } })
      }
      return path === '/api/config' ? json(200, CONFIG) : json(200, { ok: true })
    })
    await expect(client.apiFetch('/api/me')).rejects.toMatchObject({ code: 'internal_error' })
    await expect(client.apiFetch('/api/me')).resolves.toEqual({ ok: true })
  })
})
