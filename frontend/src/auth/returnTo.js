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

// Settings › Link Google account (Story 7.3b): the route Settings was open on, kept while the browser
// visits Google, so /auth/callback knows the return is a link and lands there with Settings open.
// A separate sessionStorage key; JSON `{ route }`.
export const LINK_GOOGLE_KEY = 'studybuddy.linkGoogle'

export function rememberLinkRoute(path) {
  const route = typeof path === 'string' && SAFE_PATH.test(path) ? path : '/projects'
  try {
    window.sessionStorage.setItem(LINK_GOOGLE_KEY, JSON.stringify({ route }))
  } catch {
    // storage blocked: the return is then handled as a Google sign-in
  }
}

export function forgetLinkRoute() {
  try {
    window.sessionStorage.removeItem(LINK_GOOGLE_KEY)
  } catch {
    // storage blocked: nothing was saved
  }
}

/** The marked link route, or null when this return isn't a link. Read without clearing. */
export function peekLinkRoute() {
  try {
    const marker = JSON.parse(window.sessionStorage.getItem(LINK_GOOGLE_KEY) ?? 'null')
    const route = marker?.route
    return typeof route === 'string' && SAFE_PATH.test(route) ? route : null
  } catch {
    return null
  }
}

/** Whether the callback URL says the student cancelled Google consent (`error=access_denied`). */
export function consentCancelled(search = '', hash = '') {
  const query = new URLSearchParams(search)
  const fragment = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  return query.get('error') === 'access_denied' || fragment.get('error') === 'access_denied'
}
