// Log in and Log out against the real supabase-js (only fetch is stubbed). The other auth tests stub
// createClient with the storage layout the code expects; this one checks that layout against the
// library itself, so a supabase-js update that changes it fails here (code review, Story 1.4).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const CONFIG = { supabase_url: 'http://sb.test', supabase_publishable_key: 'pk', google_enabled: false }

// A JWT-shaped token that expires in an hour; supabase-js reads `exp` but never verifies it.
function fakeJwt() {
  const part = (value) => btoa(JSON.stringify(value)).replace(/=+$/, '')
  const exp = Math.floor(Date.now() / 1000) + 3600
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: 'u1', exp, role: 'authenticated' })}.sig`
}

let auth
let token
let calls

beforeEach(async () => {
  vi.resetModules()
  token = fakeJwt()
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input, init = {}) => {
      const url = String(input instanceof Request ? input.url : input)
      const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined))
      calls.push({ url, authorization: headers.get('Authorization') })
      if (url.endsWith('/api/config')) return new Response(JSON.stringify(CONFIG), { status: 200 })
      if (url.includes('/auth/v1/token')) {
        const session = {
          access_token: token,
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: 'refresh',
          user: { id: 'u1', aud: 'authenticated', email: 'emma@example.com' },
        }
        return new Response(JSON.stringify(session), { status: 200 })
      }
      if (url.includes('/auth/v1/logout')) return new Response(null, { status: 204 })
      return new Response('{}', { status: 404 })
    }),
  )
  auth = await import('./index.js')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('with the real supabase-js', () => {
  it('a login is stored where signOut looks for it, and Log out ends it locally and on the server', async () => {
    await expect(auth.signIn({ email: 'emma@example.com', password: 'longenough' })).resolves.toHaveProperty(
      'session',
    )
    await expect(auth.hasSession()).resolves.toBe(true)
    expect(window.localStorage.getItem('studybuddy.auth')).toContain(token)

    const { ended } = await auth.signOut()
    await ended

    await expect(auth.hasSession()).resolves.toBe(false)
    const logout = calls.filter((call) => call.url.includes('/auth/v1/logout'))
    expect(logout.length).toBeGreaterThanOrEqual(1)
    expect(logout[0].url).toContain('scope=local')
    expect(logout[0].authorization).toBe(`Bearer ${token}`)
  })
})
