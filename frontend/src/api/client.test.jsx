// api/client.js and auth/ together, with fetch and supabase-js stubbed (spine › Tests).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getSession, signOut, createClient } = vi.hoisted(() => {
  const getSession = vi.fn()
  const signOut = vi.fn()
  // signOut is the server logout (POST /logout) that auth/ calls with the session's own token.
  return { getSession, signOut, createClient: vi.fn(() => ({ auth: { getSession, admin: { signOut } } })) }
})
vi.mock('@supabase/supabase-js', () => ({ createClient }))

const CONFIG = { supabase_url: 'http://sb.test', supabase_publishable_key: 'pk', google_enabled: false }

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

let fetchMock
let client

function storeSession(token) {
  window.localStorage.setItem('studybuddy.auth', JSON.stringify({ access_token: token }))
}

beforeEach(async () => {
  vi.resetModules() // a fresh cached Supabase client per test
  createClient.mockClear()
  // Like supabase-js: the stored session is the source of truth.
  storeSession('tok')
  getSession.mockReset().mockImplementation(async () => {
    const raw = window.localStorage.getItem('studybuddy.auth')
    return { data: { session: raw ? JSON.parse(raw) : null } }
  })
  signOut.mockReset().mockResolvedValue({ error: null })
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
    expect(createClient).toHaveBeenCalledWith('http://sb.test', 'pk', { auth: { storageKey: 'studybuddy.auth' } })
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

  it('sends a FormData body as is, with no Content-Type, so the browser sets the multipart boundary', async () => {
    const form = new FormData()
    form.append('file', new File(['hello'], 'notes.txt', { type: 'text/plain' }))
    await client.apiFetch('/api/projects/p/materials', { method: 'POST', body: form })
    const [, init] = callTo('/api/projects/p/materials')
    expect(init.body).toBe(form)
    expect(init.headers['Content-Type']).toBeUndefined()
    expect(init.headers.Authorization).toBe('Bearer tok')
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

describe('signed-out handling', () => {
  function failWith(status, code, paths = null) {
    fetchMock.mockImplementation(async (path) => {
      if (path === '/api/config') return json(200, CONFIG)
      if (paths && !paths.includes(path)) return json(200, { ok: true })
      return json(status, { error: { code, params: {}, message: 'x' } })
    })
  }

  it.each([
    [401, 'unauthorized'],
    [401, 'session_expired'],
    [401, 'google_sign_in_required'],
  ])('%i %s clears the session, ends it on the server, tells the listener, then rejects', async (status, code) => {
    failWith(status, code)
    const listener = vi.fn(() => {
      // The session is already gone locally when the listener runs.
      expect(window.localStorage.getItem('studybuddy.auth')).toBeNull()
    })
    client.onSignedOut(listener)

    await expect(client.apiFetch('/api/me')).rejects.toMatchObject({ status, code })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(code) // Login picks its notice from it
    await vi.waitFor(() => expect(signOut).toHaveBeenCalledWith('tok', 'local'))
  })

  it('a burst of failing requests signs out and notifies once', async () => {
    failWith(401, 'unauthorized')
    const listener = vi.fn()
    client.onSignedOut(listener)

    const results = await Promise.allSettled([client.apiFetch('/api/me'), client.apiFetch('/api/a'), client.apiFetch('/api/b')])

    expect(results.every((r) => r.status === 'rejected')).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('a late refusal of an old token does not sign out the new session', async () => {
    let refuse
    fetchMock.mockImplementation(async (path) => {
      if (path === '/api/config') return json(200, CONFIG)
      if (path === '/api/slow') return new Promise((resolve) => (refuse = resolve))
      return json(200, { ok: true })
    })
    const listener = vi.fn()
    client.onSignedOut(listener)

    const slow = client.apiFetch('/api/slow') // sent with 'tok'
    await vi.waitFor(() => expect(refuse).toBeTypeOf('function'))
    storeSession('tok-2') // logged out and in again meanwhile
    refuse(json(401, { error: { code: 'unauthorized', params: {} } }))

    await expect(slow).rejects.toMatchObject({ code: 'unauthorized' })
    expect(listener).not.toHaveBeenCalled()
    expect(signOut).not.toHaveBeenCalled()
    expect(JSON.parse(window.localStorage.getItem('studybuddy.auth')).access_token).toBe('tok-2')
  })

  it('a late refusal after Log out does nothing', async () => {
    let refuse
    fetchMock.mockImplementation(async (path) => {
      if (path === '/api/config') return json(200, CONFIG)
      return new Promise((resolve) => (refuse = resolve))
    })
    const listener = vi.fn()
    client.onSignedOut(listener)

    const slow = client.apiFetch('/api/slow')
    await vi.waitFor(() => expect(refuse).toBeTypeOf('function'))
    window.localStorage.removeItem('studybuddy.auth') // Log out cleared the session
    refuse(json(401, { error: { code: 'unauthorized', params: {} } }))

    await expect(slow).rejects.toMatchObject({ code: 'unauthorized' })
    expect(listener).not.toHaveBeenCalled()
  })

  it('a new session after login is handled again', async () => {
    failWith(401, 'session_expired')
    const listener = vi.fn()
    client.onSignedOut(listener)

    await client.apiFetch('/api/me').catch(() => {})
    storeSession('tok-2')
    await client.apiFetch('/api/me').catch(() => {})

    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('null token: a refusal while still signed out notifies once per burst, with no server call', async () => {
    window.localStorage.removeItem('studybuddy.auth')
    failWith(401, 'unauthorized')
    const listener = vi.fn()
    client.onSignedOut(listener)

    await Promise.allSettled([client.apiFetch('/api/me'), client.apiFetch('/api/a')])

    expect(callTo('/api/me')[1].headers.Authorization).toBeUndefined()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(signOut).not.toHaveBeenCalled()
  })

  it('null token: a refusal is ignored once a session exists again', async () => {
    let refuse
    window.localStorage.removeItem('studybuddy.auth')
    fetchMock.mockImplementation(async (path) => {
      if (path === '/api/config') return json(200, CONFIG)
      return new Promise((resolve) => (refuse = resolve))
    })
    const listener = vi.fn()
    client.onSignedOut(listener)

    const slow = client.apiFetch('/api/slow') // sent without a token
    await vi.waitFor(() => expect(refuse).toBeTypeOf('function'))
    storeSession('tok-2')
    refuse(json(401, { error: { code: 'unauthorized', params: {} } }))

    await expect(slow).rejects.toMatchObject({ code: 'unauthorized' })
    expect(listener).not.toHaveBeenCalled()
    expect(window.localStorage.getItem('studybuddy.auth')).not.toBeNull()
  })

  it('503 auth_unavailable never signs out', async () => {
    failWith(503, 'auth_unavailable')
    const listener = vi.fn()
    client.onSignedOut(listener)

    await expect(client.apiFetch('/api/me')).rejects.toMatchObject({ code: 'auth_unavailable' })

    expect(listener).not.toHaveBeenCalled()
    expect(window.localStorage.getItem('studybuddy.auth')).not.toBeNull()
  })

  it('other errors never sign out', async () => {
    failWith(422, 'invalid_request')
    await client.apiFetch('/api/me').catch(() => {})
    expect(window.localStorage.getItem('studybuddy.auth')).not.toBeNull()
  })

  it('a failing server logout or listener still rejects with the ApiError', async () => {
    failWith(401, 'unauthorized')
    signOut.mockRejectedValue(new TypeError('Failed to fetch'))
    client.onSignedOut(() => {
      throw new Error('listener broke')
    })

    await expect(client.apiFetch('/api/me')).rejects.toBeInstanceOf(client.ApiError)
    expect(window.localStorage.getItem('studybuddy.auth')).toBeNull()
  })

  it('remove and detach both unregister the listener', async () => {
    failWith(401, 'unauthorized')
    const listener = vi.fn()
    client.onSignedOut(listener)()
    await client.apiFetch('/api/me').catch(() => {})

    storeSession('tok-2')
    client.onSignedOut(listener)
    client.detachSignedOutListener()
    await client.apiFetch('/api/me').catch(() => {})

    expect(listener).not.toHaveBeenCalled()
    expect(window.localStorage.getItem('studybuddy.auth')).toBeNull()
  })
})
