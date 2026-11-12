// The only HTTP caller for /api (AD-1). It attaches the Supabase access token and turns the
// error envelope {"error": {code, params, message}} into an ApiError that errorText() renders (AD-26).
import { getAccessToken } from '../auth/index.js'

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
  if (auth) {
    const token = await getAccessToken()
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
    throw new ApiError(response.status, envelope?.error ?? {})
  }
  if (response.status === 204) return null
  try {
    return await response.json()
  } catch {
    // a 2xx with an empty or non-JSON body is a broken answer, not data
    throw new ApiError(response.status, { code: 'http_error' })
  }
}
