// The only supabase-js user (AD-1). The browser uses Supabase for auth only; the client is built
// at runtime from GET /api/config, never from build-time values (AD-17).
import { createClient } from '@supabase/supabase-js'
import { apiFetch } from '../api/client.js'

// Where supabase-js keeps the session (localStorage). Named here, so signOut can always clear it.
export const SESSION_STORAGE_KEY = 'studybuddy.auth'
// How long Log out waits for Supabase to end the session on the server.
const LOGOUT_TIMEOUT_MS = 3000

let configPromise = null
let clientPromise = null

/** GET /api/config, loaded once and shared. A failed load is retried next time. */
function getConfig() {
  if (!configPromise) {
    configPromise = apiFetch('/api/config', { auth: false })
    configPromise.catch(() => {
      configPromise = null
    })
  }
  return configPromise
}

/** The Supabase client, created once from /api/config. A failed config load is retried next time. */
export function getSupabase() {
  if (!clientPromise) {
    clientPromise = getConfig().then((config) =>
      createClient(config.supabase_url, config.supabase_publishable_key, {
        // PKCE for Google sign-in (FR-19); the callback page finishes the exchange itself
        // (completeGoogleSignIn), so supabase-js doesn't read the URL on its own.
        auth: { storageKey: SESSION_STORAGE_KEY, flowType: 'pkce', detectSessionInUrl: false },
      }),
    )
    clientPromise.catch(() => {
      clientPromise = null
    })
  }
  return clientPromise
}

/** Whether Google sign-in is configured (`google_enabled` in /api/config). False when it can't load. */
export async function isGoogleEnabled() {
  try {
    return (await getConfig())?.google_enabled === true
  } catch {
    return false
  }
}

// The page Google sign-in returns to; config.toml allows it on :8000 and :5173.
export const GOOGLE_CALLBACK_PATH = '/auth/callback'

/**
 * Start Google sign-in (FR-19): supabase-js sends the browser to Google's consent screen, which
 * returns to /auth/callback. Resolves with `{ ok: true }` while the browser leaves, or
 * `{ error: 'failed' }` when it can't start. Never throws.
 */
export async function signInWithGoogle() {
  try {
    const supabase = await getSupabase()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}${GOOGLE_CALLBACK_PATH}` },
    })
    return error ? { error: 'failed' } : { ok: true }
  } catch {
    return { error: 'failed' }
  }
}

// Supabase's codes for a Google identity that already belongs to another Account.
const IDENTITY_IN_USE_CODES = new Set(['identity_already_exists', 'google_identity_in_use'])

/** The OAuth error the callback URL carries (query or fragment), or null. */
function callbackError(params) {
  const code = params.get('error_code')
  if (code && IDENTITY_IN_USE_CODES.has(code)) return 'identity_in_use'
  return params.get('error') || code ? 'failed' : null
}

// Exchanges in flight, by code: React StrictMode's second effect shares the first instead of
// spending the single-use code again.
const exchanges = new Map()

async function exchangeCode(code) {
  let supabase
  try {
    supabase = await getSupabase()
  } catch {
    return { error: 'failed' }
  }
  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) return { error: IDENTITY_IN_USE_CODES.has(error.code) ? 'identity_in_use' : 'failed' }
    return data?.session ? { ok: true } : { error: 'failed' }
  } catch {
    return { error: 'failed' }
  }
}

/**
 * Finish Google sign-in on /auth/callback from the URL's `search` and `hash`. Resolves with
 * `{ ok: true }` (signed in) or `{ error }`: 'identity_in_use' when the Google account is already
 * linked to another Account, otherwise 'failed' (cancelled consent, `access_denied`, a missing or
 * refused code, Supabase unreachable). Never throws; nothing is logged.
 */
export function completeGoogleSignIn(search = '', hash = '') {
  const query = new URLSearchParams(search)
  const fragment = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const failure = callbackError(query) ?? callbackError(fragment)
  if (failure) return Promise.resolve({ error: failure })
  const code = query.get('code')
  if (!code) return Promise.resolve({ error: 'failed' })
  if (!exchanges.has(code)) {
    const exchange = exchangeCode(code).finally(() => exchanges.delete(code))
    exchanges.set(code, exchange)
  }
  return exchanges.get(code)
}

/** The current session's access token, or null when signed out. */
export async function getAccessToken() {
  const supabase = await getSupabase()
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token ?? null
}

const DUPLICATE_CODES = new Set(['user_already_exists', 'email_exists'])
// Supabase refusing the address itself, e.g. letters like "å" before the @, which it doesn't accept.
const INVALID_EMAIL_CODES = new Set(['validation_failed', 'email_address_invalid'])

/**
 * Create an email Account (FR-1). Email confirmations are off, so a new Account is signed in at once.
 * Resolves with `{ session }` or `{ error }`, where error is 'duplicate', 'email_invalid',
 * 'password_too_short', or 'generic'.
 */
export async function signUp({ email, password }) {
  const supabase = await getSupabase()
  // No user metadata: the first name lives only in profiles (POST /api/auth/after-sign-in).
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) {
    if (DUPLICATE_CODES.has(error.code)) return { error: 'duplicate' }
    if (INVALID_EMAIL_CODES.has(error.code)) return { error: 'email_invalid' }
    if (error.code === 'weak_password') return { error: 'password_too_short' }
    return { error: 'generic' }
  }
  if (!data?.session) return { error: 'generic' }
  return { session: data.session }
}

/** Whether this browser holds a session (it may still be refused by the backend). */
export async function hasSession() {
  return (await getAccessToken()) !== null
}

/**
 * Log in with email and password (FR-2). Resolves with `{ session }` or `{ error }`:
 * 'credentials' for every refusal (wrong password, unknown email, ...), so the message never
 * reveals whether the email exists; 'failed' when Supabase can't be reached or answers 5xx.
 */
export async function signIn({ email, password }) {
  let supabase
  try {
    supabase = await getSupabase()
  } catch {
    return { error: 'failed' } // /api/config didn't load
  }
  let result
  try {
    result = await supabase.auth.signInWithPassword({ email, password })
  } catch {
    return { error: 'failed' }
  }
  const { data, error } = result
  if (error) {
    const status = typeof error.status === 'number' ? error.status : 0
    // Only a refusal of the credentials is 'credentials'; a rate limit (429) is a failure to retry.
    return { error: status === 0 || status === 429 || status >= 500 ? 'failed' : 'credentials' }
  }
  if (!data?.session) return { error: 'failed' }
  return { session: data.session }
}

// Checks in flight, by token hash: a second call while one runs (React StrictMode's double effect)
// shares it instead of spending the single-use link again. Removed once settled, so a retry after a
// network failure checks the link again.
const recoveries = new Map()

async function verifyRecovery(tokenHash) {
  if (typeof tokenHash !== 'string' || !tokenHash) return { error: 'expired' }
  let supabase
  try {
    supabase = await getSupabase()
  } catch {
    return { error: 'failed' } // /api/config didn't load
  }
  let result
  try {
    result = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
  } catch {
    return { error: 'failed' }
  }
  const { data, error } = result
  if (error) {
    const status = typeof error.status === 'number' ? error.status : 0
    // Only Supabase refusing the token is 'expired'; no answer, a rate limit, or a 5xx is a
    // failure to retry, and the link stays usable.
    return { error: status === 0 || status === 429 || status >= 500 ? 'failed' : 'expired' }
  }
  return data?.session ? { ok: true } : { error: 'expired' }
}

/**
 * Open a password-reset link (FR-3): verify its token hash with Supabase (type recovery), which
 * signs this browser in with a recovery session. Resolves with `{ ok: true }` or `{ error }`:
 * 'expired' when Supabase refuses the token (expired, used, replaced, malformed, or missing), the
 * one state that asks for a new link; 'failed' when Supabase or /api/config couldn't be reached
 * (retry the same link). Never throws.
 */
export function completeRecovery(tokenHash) {
  if (!recoveries.has(tokenHash)) {
    const check = verifyRecovery(tokenHash).finally(() => recoveries.delete(tokenHash))
    recoveries.set(tokenHash, check)
  }
  return recoveries.get(tokenHash)
}

/**
 * Save a new password for the signed-in (recovery) session (FR-3). Resolves with `{ ok: true }`
 * or `{ error }`: 'password_too_short' when Supabase finds it too weak, otherwise 'failed'.
 * Never throws; the password is never stored or logged.
 */
export async function setNewPassword(password) {
  try {
    const supabase = await getSupabase()
    const { error } = await supabase.auth.updateUser({ password })
    if (!error) return { ok: true }
    return { error: error.code === 'weak_password' ? 'password_too_short' : 'failed' }
  } catch {
    return { error: 'failed' }
  }
}

/** The stored session's access token, read straight from storage (no refresh, no network). */
function storedAccessToken() {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY)
    const token = raw ? JSON.parse(raw)?.access_token : null
    return typeof token === 'string' && token ? token : null
  } catch {
    return null
  }
}

function clearStoredSession() {
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY)
    window.localStorage.removeItem(`${SESSION_STORAGE_KEY}-user`)
  } catch {
    // storage blocked: there is no stored session to clear
  }
}

/**
 * End the session in Supabase:
 * - with the stored token, ask the server to end this session (POST /logout?scope=local);
 * - let supabase-js drop its own copy (auth.signOut, scope 'local').
 * The second step matters in two cases the storage clear alone misses. A token refresh in flight
 * would otherwise write the session back, and supabase-js's sign-out discards that write. With
 * localStorage blocked, supabase-js keeps the session in memory, and its sign-out removes it (and
 * ends it on the server, since then there is no stored token).
 */
async function endSession(token) {
  const supabase = await getSupabase()
  await Promise.allSettled([
    token ? supabase.auth.admin.signOut(token, 'local') : null,
    supabase.auth.signOut({ scope: 'local' }),
  ])
}

/** Wait for `work`, at most LOGOUT_TIMEOUT_MS; never throws. */
async function settleWithin(work) {
  let timer
  try {
    await Promise.race([
      work,
      new Promise((resolve) => {
        timer = setTimeout(resolve, LOGOUT_TIMEOUT_MS)
      }),
    ])
  } catch {
    // Supabase or /api/config unreachable: the local session is gone anyway.
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Log out (FR-2). The stored session is removed at once, whatever happens next, so the caller can
 * move on without waiting for the network. In the background, Supabase ends this session's
 * auth.sessions row (scope 'local': other devices stay signed in), so the old token is refused,
 * and supabase-js drops its own copy. Resolves after the local clear; `ended` resolves when both
 * settle or after 3 s (including the /api/config load). Never throws.
 */
export async function signOut() {
  const token = storedAccessToken()
  clearStoredSession()
  return { ended: settleWithin(endSession(token)) }
}
