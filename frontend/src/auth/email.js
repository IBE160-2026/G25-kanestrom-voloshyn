// The light email check shared by the auth forms (Create account, Password reset) before a request:
// something@something, no spaces, at most 254 characters (the longest address SMTP allows, and the
// API's limit). Supabase and the backend have the final say.
export const MAX_EMAIL_LENGTH = 254
const EMAIL = /^[^\s@]+@[^\s@]+$/

export function isEmail(address) {
  return typeof address === 'string' && address.length <= MAX_EMAIL_LENGTH && EMAIL.test(address)
}
