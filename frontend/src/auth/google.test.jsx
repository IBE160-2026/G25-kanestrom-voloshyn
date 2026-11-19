// auth/ Google sign-in (Story 1.6, FR-19): the config switch, starting the redirect, and finishing
// it on /auth/callback, with supabase-js and fetch stubbed (spine › Tests).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { signInWithOAuthMock, getSessionMock } = vi.hoisted(() => ({
  signInWithOAuthMock: vi.fn(),
  getSessionMock: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: { signInWithOAuth: signInWithOAuthMock, getSession: getSessionMock } })),
}))

const CONFIG = { supabase_url: 'http://sb.test', supabase_publishable_key: 'pk', google_enabled: true }
let auth

function serveConfig(config = CONFIG) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(config), { status: 200 })),
  )
}

beforeEach(async () => {
  vi.resetModules()
  signInWithOAuthMock.mockReset().mockResolvedValue({ data: { url: 'https://accounts.google.test' }, error: null })
  getSessionMock.mockReset().mockResolvedValue({ data: { session: { access_token: 'tok' } }, error: null })
  serveConfig()
  window.history.replaceState(null, '', '/auth/callback')
  auth = await import('./index.js')
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

describe('googleEnabled', () => {
  it('follows google_enabled from /api/config', async () => {
    await expect(auth.googleEnabled()).resolves.toBe(true)
  })

  it.each([false, undefined, 'true'])('is false for google_enabled = %s', async (value) => {
    serveConfig({ ...CONFIG, google_enabled: value })
    await expect(auth.googleEnabled()).resolves.toBe(false)
  })

  it('is false when /api/config fails, and tries again next time', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })))
    await expect(auth.googleEnabled()).resolves.toBe(false)
    serveConfig()
    await expect(auth.googleEnabled()).resolves.toBe(true)
  })
})

describe('googleSetting', () => {
  it('is on, off, or unknown when /api/config fails', async () => {
    await expect(auth.googleSetting()).resolves.toBe('on')
    serveConfig({ ...CONFIG, google_enabled: false })
    vi.resetModules()
    auth = await import('./index.js')
    await expect(auth.googleSetting()).resolves.toBe('off')
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })))
    auth = await import('./index.js')
    await expect(auth.googleSetting()).resolves.toBe('unknown')
  })
})

describe('signInWithGoogle', () => {
  it('starts signInWithOAuth for Google with the redirect to /auth/callback', async () => {
    await expect(auth.signInWithGoogle()).resolves.toEqual({ ok: true })
    expect(signInWithOAuthMock).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
  })

  it('reports a start that failed', async () => {
    signInWithOAuthMock.mockResolvedValue({ data: {}, error: { message: 'x' } })
    await expect(auth.signInWithGoogle()).resolves.toEqual({ error: 'failed' })
    signInWithOAuthMock.mockRejectedValue(new TypeError('network'))
    await expect(auth.signInWithGoogle()).resolves.toEqual({ error: 'failed' })
  })
})

describe('completeOAuth', () => {
  it('resolves ok once supabase-js holds the session', async () => {
    window.history.replaceState(null, '', '/auth/callback#access_token=tok&refresh_token=r')
    await expect(auth.completeOAuth()).resolves.toEqual({ ok: true })
  })

  it('is failed without a session', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null })
    await expect(auth.completeOAuth()).resolves.toEqual({ error: 'failed' })
  })

  it.each([
    ['?error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked', 'in_use'],
    ['#error=server_error&error_code=identity_already_exists', 'in_use'],
    ['?error=invalid_request&error_description=Identity+is+already+linked+to+another+user', 'in_use'],
    ['?error=access_denied&error_description=The+user+denied', 'failed'],
    ['#error=access_denied&error_code=access_denied', 'failed'],
    ['?error=server_error&error_description=Unable+to+exchange+external+code', 'failed'],
  ])('maps the callback URL %s to %s, without reading a session', async (query, expected) => {
    window.history.replaceState(null, '', `/auth/callback${query}`)
    await expect(auth.completeOAuth()).resolves.toEqual({ error: expected })
    expect(getSessionMock).not.toHaveBeenCalled()
  })

  it('maps an identity-in-use error from supabase-js too', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null }, error: { details: { code: 'identity_already_exists' } } })
    await expect(auth.completeOAuth()).resolves.toEqual({ error: 'in_use' })
  })

  it.each(['identity_already_exists', 'identity_already_linked'])(
    'maps a supabase-js error with top-level code %s to in_use',
    async (code) => {
      getSessionMock.mockResolvedValue({ data: { session: null }, error: { code, message: 'x' } })
      await expect(auth.completeOAuth()).resolves.toEqual({ error: 'in_use' })
    },
  )

  it('is failed when /api/config or supabase-js fails', async () => {
    getSessionMock.mockRejectedValue(new Error('boom'))
    await expect(auth.completeOAuth()).resolves.toEqual({ error: 'failed' })
  })

  it('shares a check in flight (React StrictMode)', async () => {
    const first = auth.completeOAuth()
    const second = auth.completeOAuth()
    expect(second).toBe(first)
    await first
    expect(getSessionMock).toHaveBeenCalledTimes(1)
  })
})
