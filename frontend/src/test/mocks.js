// Module mocks for page tests (spine › Tests): every test but those of api/client.js and auth/
// replaces those two modules. Use as
//   vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
import { vi } from 'vitest'

export function authMock() {
  return {
    getAccessToken: vi.fn(async () => null),
    hasSession: vi.fn(async () => false),
    signUp: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(async () => ({ ended: Promise.resolve() })),
    completeRecovery: vi.fn(async () => ({ ok: true })),
    setNewPassword: vi.fn(async () => ({ ok: true })),
    // Google is off unless a test turns it on (as for the grader, with no keys).
    googleEnabled: vi.fn(async () => false),
    googleSetting: vi.fn(async () => 'off'),
    signInWithGoogle: vi.fn(async () => ({ ok: true })),
    completeOAuth: vi.fn(async () => ({ ok: true })),
  }
}

export function clientMock() {
  return {
    apiFetch: vi.fn(),
    onSignedOut: vi.fn(() => () => {}),
    detachSignedOutListener: vi.fn(),
    SIGNED_OUT_CODES: new Set(['unauthorized', 'session_expired', 'google_sign_in_required']),
  }
}
