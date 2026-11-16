// The only HTTP caller for /api (AD-1). It attaches the Supabase access token and turns the
// error envelope {"error": {code, params, message}} into an ApiError that errorText() renders (AD-26).
// When the backend says the session is gone, it signs out locally and tells the router (FR-2).
import { getAccessToken, signOut } from '../auth/index.js'

// Codes that mean the session is over. auth_unavailable is not one: the session is kept (AD-2).
export const SIGNED_OUT_CODES = new Set(['unauthorized', 'session_expired'])

let signedOutListener = null
let pending = null // the sign-out in progress, shared by a burst of refusals of the same token
let pendingToken = null
let handledToken = null // the last session token already signed out, for answers that arrive late

/**
 * Register the one listener told when the session has ended (the router registers it, so this
 * module never imports the router). Returns a function that removes it.
 */
export function onSignedOut(listener) {
  signedOutListener = listener
  return () => {
    if (signedOutListener === listener) signedOutListener = null
  }
}

/** Drop the listener before a deliberate Log out, so refusals in flight show no expiry notice. */
export function detachSignedOutListener() {
  signedOutListener = null
}

async function currentToken() {
  try {
    return await getAccessToken()
  } catch {
    return undefined // unknown: never matches a refused token
  }
}

/**
 * A request sent with `token` was refused as signed out. Act only while that token is still the
 * current one: a refusal of an older token (after Log out, or after a new login) is ignored, and
 * a request sent without a token counts only while there is still no session. Never throws.
 */
async function handleSignedOut(token) {
  if (pending) {
    if (pendingToken === token) return pending
    await pending
  }
  if ((await currentToken()) !== token) return
  if (pending) return pendingToken === token ? pending : undefined
  if (token !== null && token === handledToken) return
  pendingToken = token
  if (token !== null) handledToken = token
  pending = (async () => {
    try {
      await signOut()
    } catch {
      // signOut never throws; the listener still runs
    }
    try {
      signedOutListener?.()
    } catch {
      // a failing listener must not hide the ApiError from the caller
    }
  })().finally(() => {
    pending = null
    pendingToken = null
  })
  return pending
}

export class ApiError extends Error {
  constructor(status, { code, params } = {}) {
    super(code || 'http_error')
    this.name = 'ApiError'
    this.status = status
    this.code = typeof code === 'string' ? code : 'http_error'
    this.params = params && typeof params === 'object' ? params : {}
  }
}

/**
 * Call the backend. `body` is sent as JSON; `auth: false` skips the bearer token (only /api/config).
 * Resolves with the parsed JSON (or null for 204); rejects with an ApiError.
 */
export async function apiFetch(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let token = null
  if (auth) {
    token = await getAccessToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  let response
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, { code: 'network_error' })
  }

  if (!response.ok) {
    let envelope = null
    try {
      envelope = await response.json()
    } catch {
      // not JSON: fall through to the generic code
    }
    const error = new ApiError(response.status, envelope?.error ?? {})
    if (auth && SIGNED_OUT_CODES.has(error.code)) await handleSignedOut(token)
    throw error
  }
  if (response.status === 204) return null
  try {
    return await response.json()
  } catch {
    // a 2xx with an empty or non-JSON body is a broken answer, not data
    throw new ApiError(response.status, { code: 'http_error' })
  }
}
