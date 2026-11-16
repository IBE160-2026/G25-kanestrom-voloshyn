// auth/ sign-up, log in, and log out, with supabase-js and fetch stubbed (spine › Tests).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { signUpMock, signInMock, signOutMock, getSessionMock } = vi.hoisted(() => ({
  signUpMock: vi.fn(),
  signInMock: vi.fn(),
  signOutMock: vi.fn(),
  getSessionMock: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      signUp: signUpMock,
      signInWithPassword: signInMock,
      getSession: getSessionMock,
      admin: { signOut: signOutMock }, // POST /logout with the session's own token
    },
  })),
}))

const CONFIG = { supabase_url: 'http://sb.test', supabase_publishable_key: 'pk', google_enabled: false }
let auth

beforeEach(async () => {
  vi.resetModules()
  signUpMock.mockReset()
  signInMock.mockReset()
  signOutMock.mockReset().mockResolvedValue({ error: null })
  // Like supabase-js: the stored session is the source of truth.
  getSessionMock.mockReset().mockImplementation(async () => {
    const raw = window.localStorage.getItem('studybuddy.auth')
    return { data: { session: raw ? JSON.parse(raw) : null } }
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(CONFIG), { status: 200 })),
  )
  auth = await import('./index.js')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const INPUT = { email: 'emma@example.com', password: 'longenough' }

describe('signUp', () => {
  it('signs up with email and password only (no name metadata) and returns the session', async () => {
    const session = { access_token: 'tok' }
    signUpMock.mockResolvedValue({ data: { session, user: {} }, error: null })

    await expect(auth.signUp(INPUT)).resolves.toEqual({ session })
    expect(signUpMock).toHaveBeenCalledWith({ email: 'emma@example.com', password: 'longenough' })
  })

  it.each([
    ['user_already_exists', 'duplicate'],
    ['email_exists', 'duplicate'],
    ['weak_password', 'password_too_short'],
    ['over_request_rate_limit', 'generic'],
    [undefined, 'generic'],
  ])('maps Supabase error %s to %s', async (code, expected) => {
    signUpMock.mockResolvedValue({ data: { session: null, user: null }, error: { code, message: 'x' } })
    await expect(auth.signUp(INPUT)).resolves.toEqual({ error: expected })
  })

  it('a sign-up without a session is a generic failure', async () => {
    signUpMock.mockResolvedValue({ data: { session: null, user: {} }, error: null })
    await expect(auth.signUp(INPUT)).resolves.toEqual({ error: 'generic' })
  })
})

describe('signIn', () => {
  it('logs in with email and password and returns the session', async () => {
    const session = { access_token: 'tok' }
    signInMock.mockResolvedValue({ data: { session, user: {} }, error: null })

    await expect(auth.signIn(INPUT)).resolves.toEqual({ session })
    expect(signInMock).toHaveBeenCalledWith({ email: 'emma@example.com', password: 'longenough' })
  })

  it.each([
    ['invalid_credentials', 400, 'credentials'], // wrong password and unknown email alike
    ['email_not_confirmed', 400, 'credentials'],
    ['validation_failed', 400, 'credentials'],
    ['user_banned', 400, 'credentials'],
    ['over_request_rate_limit', 429, 'failed'],
    [undefined, 0, 'failed'], // network: no HTTP status
    [undefined, undefined, 'failed'],
    ['unexpected_failure', 500, 'failed'],
    [undefined, 502, 'failed'],
    [undefined, 503, 'failed'],
  ])('maps %s (HTTP %s) to %s', async (code, status, expected) => {
    signInMock.mockResolvedValue({ data: { session: null, user: null }, error: { code, status, message: 'x' } })
    await expect(auth.signIn(INPUT)).resolves.toEqual({ error: expected })
  })

  it('a thrown error is a failure', async () => {
    signInMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(auth.signIn(INPUT)).resolves.toEqual({ error: 'failed' })
  })

  it('a missing /api/config is a failure, not a credential error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 502 })))
    await expect(auth.signIn(INPUT)).resolves.toEqual({ error: 'failed' })
    expect(signInMock).not.toHaveBeenCalled()
  })

  it('a success without a session is a failure', async () => {
    signInMock.mockResolvedValue({ data: { session: null, user: null }, error: null })
    await expect(auth.signIn(INPUT)).resolves.toEqual({ error: 'failed' })
  })
})

function storeSession(token = 'tok') {
  window.localStorage.setItem('studybuddy.auth', JSON.stringify({ access_token: token, refresh_token: 'r' }))
  window.localStorage.setItem('studybuddy.auth-user', JSON.stringify({ id: 'u' }))
}

describe('signOut and hasSession', () => {
  it('builds the client with the named storage key', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    await auth.hasSession()
    expect(createClient).toHaveBeenLastCalledWith('http://sb.test', 'pk', { auth: { storageKey: 'studybuddy.auth' } })
  })

  it('clears the stored session at once and ends this session only on the server (scope local)', async () => {
    storeSession('tok')
    await expect(auth.hasSession()).resolves.toBe(true)

    const { ended } = await auth.signOut()

    expect(window.localStorage.getItem('studybuddy.auth')).toBeNull()
    expect(window.localStorage.getItem('studybuddy.auth-user')).toBeNull()
    await expect(auth.hasSession()).resolves.toBe(false)
    await ended
    expect(signOutMock).toHaveBeenCalledWith('tok', 'local')
  })

  it('a server error still leaves no session', async () => {
    storeSession()
    signOutMock.mockResolvedValue({ data: null, error: { status: 500, message: 'x' } })

    const { ended } = await auth.signOut()
    await ended

    await expect(auth.hasSession()).resolves.toBe(false)
  })

  it('a failing or unreachable server never throws', async () => {
    storeSession()
    signOutMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const { ended } = await auth.signOut()
    await expect(ended).resolves.toBeUndefined()
    await expect(auth.hasSession()).resolves.toBe(false)
  })

  it('resolves before the server answers, and stops waiting after 3 seconds', async () => {
    storeSession()
    await auth.hasSession() // the client exists before the clock is faked
    vi.useFakeTimers()
    signOutMock.mockReturnValue(new Promise(() => {})) // never answers
    let settled = false

    const { ended } = await auth.signOut()
    ended.then(() => (settled = true))
    expect(window.localStorage.getItem('studybuddy.auth')).toBeNull()

    await vi.advanceTimersByTimeAsync(2999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(true)
  })

  it('with no stored session it makes no server call', async () => {
    const { ended } = await auth.signOut()
    await ended
    expect(signOutMock).not.toHaveBeenCalled()
  })
})
