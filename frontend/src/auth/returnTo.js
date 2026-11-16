// The route to return to after the next login (FR-2): set when the session ends mid-use or a
// signed-in page is opened without a session; read once by Login. One sessionStorage key.
export const RETURN_TO_KEY = 'studybuddy.returnTo'

// Only same-origin app paths: "/x", never "//host" or "/\host" (no open redirect).
const SAFE_PATH = /^\/(?![/\\])/

export function rememberRoute(path) {
  if (typeof path !== 'string' || !SAFE_PATH.test(path) || path === '/') return
  try {
    window.sessionStorage.setItem(RETURN_TO_KEY, path)
  } catch {
    // storage blocked: the next login lands on the default page
  }
}

export function forgetRoute() {
  try {
    window.sessionStorage.removeItem(RETURN_TO_KEY)
  } catch {
    // storage blocked: nothing was saved
  }
}

/** The remembered route, cleared as it is read; null when there is none. */
export function takeRememberedRoute() {
  let path = null
  try {
    path = window.sessionStorage.getItem(RETURN_TO_KEY)
  } catch {
    return null
  }
  forgetRoute()
  return typeof path === 'string' && SAFE_PATH.test(path) ? path : null
}
