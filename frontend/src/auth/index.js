// The only supabase-js user (AD-1). The browser uses Supabase for auth only; the client is built
// at runtime from GET /api/config, never from build-time values (AD-17).
import { createClient } from '@supabase/supabase-js'
import { apiFetch } from '../api/client.js'

let clientPromise = null

/** The Supabase client, created once from /api/config. A failed config load is retried next time. */
export function getSupabase() {
  if (!clientPromise) {
    clientPromise = apiFetch('/api/config', { auth: false }).then((config) =>
      createClient(config.supabase_url, config.supabase_publishable_key),
    )
    clientPromise.catch(() => {
      clientPromise = null
    })
  }
  return clientPromise
}

/** The current session's access token, or null when signed out. */
export async function getAccessToken() {
  const supabase = await getSupabase()
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token ?? null
}

const DUPLICATE_CODES = new Set(['user_already_exists', 'email_exists'])

/**
 * Create an email Account (FR-1). Email confirmations are off, so a new Account is signed in at once.
 * Resolves with `{ session }` or `{ error }`, where error is 'duplicate', 'password_too_short', or 'generic'.
 */
export async function signUp({ email, password }) {
  const supabase = await getSupabase()
  // No user metadata: the first name lives only in profiles (POST /api/auth/after-sign-in).
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) {
    if (DUPLICATE_CODES.has(error.code)) return { error: 'duplicate' }
    if (error.code === 'weak_password') return { error: 'password_too_short' }
    return { error: 'generic' }
  }
  if (!data?.session) return { error: 'generic' }
  return { session: data.session }
}
