// auth/ sign-up, log in, log out, and password reset, with supabase-js and fetch stubbed (spine › Tests).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  signUpMock,
  signInMock,
  signOutMock,
  clientSignOutMock,
  getSessionMock,
  verifyOtpMock,
  updateUserMock,
  oauthMock,
  exchangeMock,
} = vi.hoisted(() => ({
    oauthMock: vi.fn(),
    exchangeMock: vi.fn(),
    verifyOtpMock: vi.fn(),
    updateUserMock: vi.fn(),
    signUpMock: vi.fn(),
    signInMock: vi.fn(),
    signOutMock: vi.fn(),
    clientSignOutMock: vi.fn(),
    getSessionMock: vi.fn(),
  }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      signUp: signUpMock,
      signInWithPassword: signInMock,
      getSession: getSessionMock,
      verifyOtp: verifyOtpMock,
      updateUser: updateUserMock,
      signInWithOAuth: oauthMock,
      exchangeCodeForSession: exchangeMock,
      signOut: clientSignOutMock, // supabase-js drops its own copy of the session
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
  verifyOtpMock.mockReset()
  updateUserMock.mockReset()
  oauthMock.mockReset().mockResolvedValue({ data: {}, error: null })
  exchangeMock.mockReset()
  signOutMock.mockReset().mockResolvedValue({ error: null })
  clientSignOutMock.mockReset().mockResolvedValue({ error: null })
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
    ['validation_failed', 'email_invalid'], // e.g. "åså@gmail.com"
    ['email_address_invalid', 'email_invalid'],
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
  it('builds the client with the named storage key and PKCE, without reading the URL itself', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    await auth.hasSession()
    expect(createClient).toHaveBeenLastCalledWith('http://sb.test', 'pk', {
      auth: { storageKey: 'studybuddy.auth', flowType: 'pkce', detectSessionInUrl: false },
    })
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

  it('also lets supabase-js drop its own copy, after the stored session is cleared', async () => {
    storeSession('tok')
    clientSignOutMock.mockImplementation(async () => {
      // By now the stored session is gone, so supabase-js finds no token to end a second time.
      expect(window.localStorage.getItem('studybuddy.auth')).toBeNull()
      return { error: null }
    })

    const { ended } = await auth.signOut()
    await ended

    expect(clientSignOutMock).toHaveBeenCalledWith({ scope: 'local' })
  })

  it("a failing supabase-js sign-out still ends the server session and doesn't throw", async () => {
    storeSession('tok')
    clientSignOutMock.mockRejectedValue(new Error('lock'))

    const { ended } = await auth.signOut()
    await expect(ended).resolves.toBeUndefined()
    expect(signOutMock).toHaveBeenCalledWith('tok', 'local')
  })

  it('stops waiting after 3 seconds when /api/config never loads', async () => {
    storeSession()
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))) // the config load hangs
    let settled = false

    const { ended } = await auth.signOut()
    ended.then(() => (settled = true))
    expect(window.localStorage.getItem('studybuddy.auth')).toBeNull()

    await vi.advanceTimersByTimeAsync(3000)
    expect(settled).toBe(true)
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

  it('with no stored session it sends no token of its own; supabase-js still clears its copy', async () => {
    const { ended } = await auth.signOut()
    await ended
    expect(signOutMock).not.toHaveBeenCalled()
    expect(clientSignOutMock).toHaveBeenCalledWith({ scope: 'local' })
  })
})

describe('completeRecovery', () => {
  const OK = { data: { session: { access_token: 'rec' } }, error: null }

  it('verifies the token hash as a recovery link', async () => {
    verifyOtpMock.mockResolvedValue(OK)
    await expect(auth.completeRecovery('abc123')).resolves.toEqual({ ok: true })
    expect(verifyOtpMock).toHaveBeenCalledWith({ token_hash: 'abc123', type: 'recovery' })
  })

  it.each([
    ['refused (expired, used, replaced)', async () => ({ data: { session: null }, error: { status: 403, code: 'otp_expired' } })],
    ['refused as malformed', async () => ({ data: { session: null }, error: { status: 400 } })],
    ['answered without a session', async () => ({ data: { session: null }, error: null })],
  ])('%s is expired', async (_, answer) => {
    verifyOtpMock.mockImplementation(answer)
    await expect(auth.completeRecovery('abc123')).resolves.toEqual({ error: 'expired' })
  })

  it.each([
    ['a network error', async () => ({ data: { session: null }, error: { name: 'AuthRetryableFetchError', status: 0 } })],
    ['no status', async () => ({ data: { session: null }, error: { message: 'x' } })],
    ['a 5xx', async () => ({ data: { session: null }, error: { status: 502 } })],
    ['a rate limit', async () => ({ data: { session: null }, error: { status: 429 } })],
    ['a throw', async () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('%s is failed, not expired', async (_, answer) => {
    verifyOtpMock.mockImplementation(answer)
    await expect(auth.completeRecovery('abc123')).resolves.toEqual({ error: 'failed' })
  })

  it('a failed /api/config load is failed', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 503 }))
    await expect(auth.completeRecovery('abc123')).resolves.toEqual({ error: 'failed' })
    expect(verifyOtpMock).not.toHaveBeenCalled()
  })

  it.each([null, ''])('a missing token hash (%j) is expired, with no Supabase call', async (tokenHash) => {
    await expect(auth.completeRecovery(tokenHash)).resolves.toEqual({ error: 'expired' })
    expect(verifyOtpMock).not.toHaveBeenCalled()
  })

  it('shares a check in flight (React StrictMode), but checks again once it settled', async () => {
    verifyOtpMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(OK)
    const [first, second] = await Promise.all([auth.completeRecovery('once'), auth.completeRecovery('once')])
    expect(first).toEqual({ error: 'failed' })
    expect(second).toEqual({ error: 'failed' })
    expect(verifyOtpMock).toHaveBeenCalledTimes(1)

    // The retry after a network failure reaches Supabase again, and works.
    await expect(auth.completeRecovery('once')).resolves.toEqual({ ok: true })
    expect(verifyOtpMock).toHaveBeenCalledTimes(2)
  })
})

describe('setNewPassword', () => {
  it('updates the password of the recovery session', async () => {
    updateUserMock.mockResolvedValue({ data: { user: {} }, error: null })
    await expect(auth.setNewPassword('brand-new-pass')).resolves.toEqual({ ok: true })
    expect(updateUserMock).toHaveBeenCalledWith({ password: 'brand-new-pass' })
  })

  it.each([
    ['weak_password', 'password_too_short'],
    ['same_password', 'failed'],
    [undefined, 'failed'],
  ])('maps Supabase error %s to %s', async (code, expected) => {
    updateUserMock.mockResolvedValue({ data: { user: null }, error: { code, status: 422 } })
    await expect(auth.setNewPassword('whatever1')).resolves.toEqual({ error: expected })
  })

  it('a thrown error is a failure, never a throw', async () => {
    updateUserMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(auth.setNewPassword('whatever1')).resolves.toEqual({ error: 'failed' })
  })
})

describe('Google sign-in', () => {
  function stubConfig(config) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(config), { status: 200 })),
    )
  }

  it.each([
    [{ ...CONFIG, google_enabled: true }, true],
    [CONFIG, false],
  ])('isGoogleEnabled follows /api/config (%o)', async (config, expected) => {
    stubConfig(config)
    await expect(auth.isGoogleEnabled()).resolves.toBe(expected)
  })

  it('isGoogleEnabled is false when /api/config fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline')
      }),
    )
    await expect(auth.isGoogleEnabled()).resolves.toBe(false)
  })

  it('signInWithGoogle starts the Google OAuth flow back to /auth/callback', async () => {
    await expect(auth.signInWithGoogle()).resolves.toEqual({ ok: true })
    expect(oauthMock).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
  })

  it.each([
    [async () => ({ data: {}, error: { status: 500 } })],
    [
      async () => {
        throw new TypeError('offline')
      },
    ],
  ])('signInWithGoogle reports failed when it cannot start', async (impl) => {
    oauthMock.mockImplementation(impl)
    await expect(auth.signInWithGoogle()).resolves.toEqual({ error: 'failed' })
  })

  it('completeGoogleSignIn exchanges the code once, even when asked twice at once', async () => {
    exchangeMock.mockResolvedValue({ data: { session: { access_token: 'tok' } }, error: null })
    const [a, b] = await Promise.all([
      auth.completeGoogleSignIn('?code=abc'),
      auth.completeGoogleSignIn('?code=abc'),
    ])
    expect(a).toEqual({ ok: true })
    expect(b).toEqual({ ok: true })
    expect(exchangeMock).toHaveBeenCalledTimes(1)
    expect(exchangeMock).toHaveBeenCalledWith('abc')
  })

  it.each([
    ['?error=access_denied&error_description=cancelled', '', 'failed'],
    ['', '#error=access_denied', 'failed'],
    ['?error=server_error&error_code=identity_already_exists', '', 'identity_in_use'],
    ['', '#error=server_error&error_code=google_identity_in_use', 'identity_in_use'],
    ['', '', 'failed'],
  ])('completeGoogleSignIn(%s, %s) is %s without an exchange', async (search, hash, error) => {
    await expect(auth.completeGoogleSignIn(search, hash)).resolves.toEqual({ error })
    expect(exchangeMock).not.toHaveBeenCalled()
  })

  it.each([
    [{ data: { session: null }, error: { code: 'identity_already_exists', status: 422 } }, 'identity_in_use'],
    [{ data: { session: null }, error: { code: 'flow_state_not_found', status: 404 } }, 'failed'],
    [{ data: { session: null }, error: null }, 'failed'],
  ])('completeGoogleSignIn maps a refused exchange (%o) to %s', async (answer, error) => {
    exchangeMock.mockResolvedValue(answer)
    await expect(auth.completeGoogleSignIn('?code=abc')).resolves.toEqual({ error })
  })

  it('completeGoogleSignIn is failed when the exchange throws', async () => {
    exchangeMock.mockRejectedValue(new TypeError('offline'))
    await expect(auth.completeGoogleSignIn('?code=abc')).resolves.toEqual({ error: 'failed' })
  })
})
