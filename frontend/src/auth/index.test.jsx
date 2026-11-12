// auth/ sign-up, with supabase-js and fetch stubbed (spine › Tests).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { signUpMock } = vi.hoisted(() => ({ signUpMock: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: { signUp: signUpMock, getSession: vi.fn() } })),
}))

const CONFIG = { supabase_url: 'http://sb.test', supabase_publishable_key: 'pk', google_enabled: false }
let auth

beforeEach(async () => {
  vi.resetModules()
  signUpMock.mockReset()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(CONFIG), { status: 200 })),
  )
  auth = await import('./index.js')
})

afterEach(() => {
  vi.unstubAllGlobals()
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
