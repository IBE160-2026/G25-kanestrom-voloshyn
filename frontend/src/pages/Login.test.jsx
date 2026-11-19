// Login screen and the EN | NO toggle (Story 1.2 matrix rows 5-6), the Create account link
// (Story 1.3), and the login form, return route, and language after sign-in (Story 1.4).
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client.js'
import { hasSession, signIn, signOut } from '../auth/index.js'
import { RETURN_TO_KEY } from '../auth/returnTo.js'
import { i18n, renderRoute } from '../test/render.jsx'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

const PROFILE = { first_name: 'Emma', language: 'en', email_verified: false }

beforeEach(() => {
  vi.mocked(hasSession).mockReset().mockResolvedValue(false)
  vi.mocked(signIn).mockReset().mockResolvedValue({ session: { access_token: 'tok' } })
  vi.mocked(signOut).mockReset().mockResolvedValue(undefined)
  vi.mocked(apiFetch).mockReset().mockResolvedValue(PROFILE)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function expectStrings(catalogue) {
  expect(screen.getByRole('heading', { level: 1, name: catalogue.login.wordmark })).toBeInTheDocument()
  expect(screen.getByText(catalogue.login.tagline)).toBeInTheDocument()
  expect(screen.getByText(catalogue.login.privacy)).toBeInTheDocument()
  expect(screen.getByText(catalogue.footer.credit)).toBeInTheDocument()
  expect(screen.getByRole('group', { name: catalogue.language.label })).toBeInTheDocument()
}

function toggle() {
  const group = screen.getByRole('group', { name: /^(Language|Språk)$/ })
  return {
    en: within(group).getByRole('button', { name: 'English' }),
    nb: within(group).getByRole('button', { name: 'Norsk' }),
  }
}

describe('Login', () => {
  it('shows the static parts in English by default, with EN pressed', () => {
    renderRoute('/')

    expectStrings(en)
    const { en: enButton, nb: nbButton } = toggle()
    expect(enButton).toHaveTextContent('EN')
    expect(nbButton).toHaveTextContent('NO')
    expect(enButton).toHaveAttribute('aria-pressed', 'true')
    expect(nbButton).toHaveAttribute('aria-pressed', 'false')
  })

  it('pressing NO switches every string at once, saves nb, and sets <html lang>', async () => {
    const user = userEvent.setup()
    renderRoute('/')

    await user.click(toggle().nb)

    expectStrings(nb)
    expect(screen.queryByText(en.login.tagline)).not.toBeInTheDocument()
    expect(toggle().nb).toHaveAttribute('aria-pressed', 'true')
    expect(toggle().en).toHaveAttribute('aria-pressed', 'false')
    expect(window.localStorage.getItem('studybuddy.language')).toBe('nb')
    expect(document.documentElement.lang).toBe('nb')
  })

  it('works from the keyboard: Tab to a segment, then Enter', async () => {
    const user = userEvent.setup()
    renderRoute('/')

    await user.tab()
    expect(toggle().en).toHaveFocus()
    await user.tab()
    expect(toggle().nb).toHaveFocus()
    await user.keyboard('{Enter}')
    expectStrings(nb)

    await user.tab({ shift: true })
    expect(toggle().en).toHaveFocus()
    await user.keyboard('{Enter}')
    expectStrings(en)
    expect(window.localStorage.getItem('studybuddy.language')).toBe('en')
  })

  it('still switches for the session when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    const user = userEvent.setup()
    renderRoute('/')

    await user.click(toggle().nb)

    expectStrings(nb)
    expect(i18n.language).toBe('nb')
  })

  it('links to Create account', async () => {
    const user = userEvent.setup()
    const { router } = renderRoute('/')

    await user.click(screen.getByRole('link', { name: en.login.createAccount }))

    expect(router.state.location.pathname).toBe('/signup')
    expect(screen.getByRole('form', { name: en.signup.submit })).toBeInTheDocument()
  })

  it('"Forgot password?" goes to the reset request, in Norwegian too', async () => {
    await i18n.changeLanguage('nb')
    const user = userEvent.setup()
    const { router } = renderRoute('/')

    await user.click(screen.getByRole('link', { name: nb.login.forgotPassword }))

    expect(router.state.location.pathname).toBe('/forgot-password')
    expect(screen.getByRole('heading', { level: 2, name: nb.reset.request.title })).toBeInTheDocument()
  })
})

function loginForm(catalogue = en) {
  const panel = screen.getByRole('form', { name: catalogue.login.submit })
  return {
    email: within(panel).getByLabelText(catalogue.login.email),
    password: within(panel).getByLabelText(catalogue.login.password),
    submit: within(panel).getByRole('button', { name: catalogue.login.submit }),
  }
}

async function logIn(user, { email = 'emma@example.com', password = 'longenough' } = {}, catalogue = en) {
  const f = loginForm(catalogue)
  if (email) await user.type(f.email, email)
  if (password) await user.type(f.password, password)
  await user.click(f.submit)
  return f
}

/** After a successful signIn, the guarded Projects page sees a session. */
function signedInAfterLogin() {
  vi.mocked(hasSession).mockImplementation(async () => vi.mocked(signIn).mock.calls.length > 0)
}

describe('Login form', () => {
  it('shows email, password, and Log in, with no dead controls', () => {
    renderRoute('/')

    const f = loginForm()
    expect(f.email).toHaveAttribute('type', 'email')
    expect(f.email).toHaveAttribute('autocomplete', 'email')
    expect(f.password).toHaveAttribute('type', 'password')
    expect(f.password).toHaveAttribute('autocomplete', 'current-password')
    // "Forgot password?" is live since Story 1.5; Google (Story 1.6) shows only when configured.
    expect(screen.getByRole('link', { name: en.login.forgotPassword })).toHaveAttribute('href', '/forgot-password')
    expect(screen.queryByText('Sign in with Google')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // The notice's live region is always there, empty unless a session ended.
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('login: calls after-sign-in with the active language and lands on Projects with the greeting', async () => {
    signedInAfterLogin()
    const user = userEvent.setup()
    const { router } = renderRoute('/')

    await logIn(user, { email: '  emma@example.com ' })

    expect(signIn).toHaveBeenCalledWith({ email: 'emma@example.com', password: 'longenough' })
    expect(apiFetch).toHaveBeenCalledWith('/api/auth/after-sign-in', { method: 'POST', body: { language: 'en' } })
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'))
    expect(await screen.findByRole('button', { name: 'Welcome, Emma' })).toBeInTheDocument()
  })

  it.each([
    ['wrong password', 'emma@example.com'],
    ['unknown email', 'nobody@example.com'],
  ])('%s: the one generic line, email kept, focus in the form, button active', async (_, email) => {
    vi.mocked(signIn).mockResolvedValue({ error: 'credentials' })
    const user = userEvent.setup()
    const { router } = renderRoute('/')

    const f = await logIn(user, { email })

    expect(screen.getByRole('alert')).toHaveTextContent(en.login.errors.credentials)
    expect(f.email).toHaveValue(email)
    expect(f.password).toHaveFocus()
    expect(f.submit).toBeEnabled()
    expect(signIn).toHaveBeenCalledTimes(1) // no extra request that could tell the cases apart
    expect(apiFetch).not.toHaveBeenCalled()
    expect(router.state.location.pathname).toBe('/')
  })

  it('Supabase down: "Sign-in didn\'t work. Try again." and the button stays active', async () => {
    vi.mocked(signIn).mockResolvedValue({ error: 'failed' })
    const user = userEvent.setup()
    renderRoute('/')

    const f = await logIn(user)

    expect(screen.getByRole('alert')).toHaveTextContent(en.login.errors.failed)
    expect(f.submit).toBeEnabled()
    expect(f.email).toHaveValue('emma@example.com')
  })

  it('after-sign-in failing with auth_unavailable keeps the session; a retry repeats only that step', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce({ code: 'auth_unavailable', params: {} })
    signedInAfterLogin()
    const user = userEvent.setup()
    const { router } = renderRoute('/')

    const f = await logIn(user)

    expect(screen.getByRole('alert')).toHaveTextContent(en.login.errors.failed)
    expect(signOut).not.toHaveBeenCalled()
    expect(router.state.location.pathname).toBe('/')
    expect(f.email).toHaveAttribute('readonly')
    expect(f.submit).toBeEnabled()

    await user.click(f.submit)

    expect(signIn).toHaveBeenCalledTimes(1)
    expect(apiFetch).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'))
  })

  it('after-sign-in refusing the session: the next attempt logs in again', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce({ code: 'unauthorized', params: {} })
    const user = userEvent.setup()
    renderRoute('/')

    const f = await logIn(user)
    expect(screen.getByRole('alert')).toHaveTextContent(en.login.errors.failed)
    expect(f.email).not.toHaveAttribute('readonly')

    await user.click(f.submit)
    expect(signIn).toHaveBeenCalledTimes(2)
  })

  it('blank fields fail with the same line and no request', async () => {
    const user = userEvent.setup()
    renderRoute('/')

    const f = await logIn(user, { email: '', password: '' })

    expect(screen.getByRole('alert')).toHaveTextContent(en.login.errors.credentials)
    expect(f.email).toHaveFocus()
    expect(signIn).not.toHaveBeenCalled()
  })

  it('a repeated failure is a fresh alert, so it is announced again', async () => {
    vi.mocked(signIn).mockResolvedValue({ error: 'credentials' })
    const user = userEvent.setup()
    renderRoute('/')
    const f = await logIn(user)
    const first = screen.getByRole('alert')

    await user.click(f.submit)

    expect(screen.getByRole('alert')).not.toBe(first)
  })

  it('works from the keyboard: Tab to the fields and press Enter', async () => {
    signedInAfterLogin()
    const user = userEvent.setup()
    const { router } = renderRoute('/')
    const f = loginForm()

    await user.click(f.email)
    await user.keyboard('emma@example.com')
    await user.tab()
    expect(f.password).toHaveFocus()
    await user.keyboard('longenough{Enter}')

    expect(signIn).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'))
  })

  it('other browser: the Account language (nb) replaces the local English after sign-in', async () => {
    signedInAfterLogin()
    vi.mocked(apiFetch).mockResolvedValue({ ...PROFILE, language: 'nb' })
    const user = userEvent.setup()
    renderRoute('/')

    await logIn(user)

    expect(apiFetch).toHaveBeenCalledWith('/api/auth/after-sign-in', { method: 'POST', body: { language: 'en' } })
    await waitFor(() => expect(i18n.language).toBe('nb'))
    expect(window.localStorage.getItem('studybuddy.language')).toBe('nb')
    expect(await screen.findByRole('button', { name: 'Velkommen, Emma' })).toBeInTheDocument()
  })

  it('an Account without a saved language keeps the local choice', async () => {
    signedInAfterLogin()
    await i18n.changeLanguage('nb')
    vi.mocked(apiFetch).mockResolvedValue({ ...PROFILE, language: null })
    const user = userEvent.setup()
    renderRoute('/')

    await logIn(user, {}, nb)

    expect(apiFetch).toHaveBeenCalledWith('/api/auth/after-sign-in', { method: 'POST', body: { language: 'nb' } })
    expect(i18n.language).toBe('nb')
  })

  it('already signed in with a remembered route: goes there, once', async () => {
    window.sessionStorage.setItem(RETURN_TO_KEY, '/projects?x=1')
    vi.mocked(hasSession).mockResolvedValue(true)
    const { router } = renderRoute('/')

    await waitFor(() => expect(router.state.location.search).toBe('?x=1'))
    expect(window.sessionStorage.getItem(RETURN_TO_KEY)).toBeNull()
  })

  it('already signed in: goes straight to Projects', async () => {
    vi.mocked(hasSession).mockResolvedValue(true)
    const { router } = renderRoute('/')

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'))
    expect(signIn).not.toHaveBeenCalled()
  })
})

describe('Landing on the last Project (Story 2.1, FR-8)', () => {
  /** after-sign-in reports `last`; the Project itself opens through GET /api/projects/{id}. */
  function answerWithLastProject(last, others = []) {
    const project = { id: last, name: 'Biology', name_source: 'student', archived_at: null, deleted_at: null }
    const all = [project, ...others]
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (path === '/api/auth/after-sign-in' || path === '/api/me') return { ...PROFILE, ui_prefs: {}, last_project_id: last }
      if (path === '/api/projects') return all
      const found = all.find((p) => path === `/api/projects/${p.id}`)
      if (found) return found
      throw new Error(`unexpected ${path}`)
    })
  }

  it('login lands on the last opened active Project', async () => {
    answerWithLastProject('p1')
    signedInAfterLogin()
    const user = userEvent.setup()
    const { router } = renderRoute('/')

    await logIn(user)

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p1'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Biology' })).toBeInTheDocument()
  })

  it('a remembered route still wins over the last Project', async () => {
    const physics = { id: 'p2', name: 'Physics', name_source: 'student', archived_at: null, deleted_at: null }
    answerWithLastProject('p1', [physics])
    window.sessionStorage.setItem(RETURN_TO_KEY, '/projects/p2')
    signedInAfterLogin()
    const user = userEvent.setup()
    const { router } = renderRoute('/')

    await logIn(user)

    expect(await screen.findByRole('heading', { level: 1, name: 'Physics' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/projects/p2')
  })

  it('without a last Project, login lands on the Projects page', async () => {
    signedInAfterLogin()
    const user = userEvent.setup()
    const { router } = renderRoute('/')

    await logIn(user)

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'))
  })

  it('already signed in: the Projects page forwards to the last Project', async () => {
    answerWithLastProject('p1')
    vi.mocked(hasSession).mockResolvedValue(true)
    const { router } = renderRoute('/')

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p1'))
  })
})

describe('Signed out and return route', () => {
  it('signed-out visit to /projects goes to Login, and the next login returns there once', async () => {
    const user = userEvent.setup()
    const { router } = renderRoute('/projects')

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(window.sessionStorage.getItem(RETURN_TO_KEY)).toBe('/projects')
    expect(apiFetch).not.toHaveBeenCalledWith('/api/me')

    signedInAfterLogin()
    await logIn(user)

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'))
    expect(window.sessionStorage.getItem(RETURN_TO_KEY)).toBeNull()
  })

  async function expectNotice(text) {
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(text))
  }

  it('session ended mid-use: the notice is added to a mounted live region, and the state is cleared', async () => {
    window.sessionStorage.setItem(RETURN_TO_KEY, '/projects?tab=x')
    signedInAfterLogin()
    const user = userEvent.setup()
    const { router } = renderRoute('/')
    const region = screen.getByRole('status')
    expect(region).toBeEmptyDOMElement()

    await router.navigate('/', { replace: true, state: { sessionExpired: true } })

    await expectNotice(en.session.expired)
    expect(screen.getByRole('status')).toBe(region) // the same element, so it is announced
    // Cleared from history, so a reload doesn't show it again.
    await waitFor(() => expect(router.state.location.state).toBeNull())
    expect(screen.getByRole('status')).toHaveTextContent(en.session.expired)

    await logIn(user)

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'))
    expect(router.state.location.search).toBe('?tab=x')
  })

  it('the notice gives way to the Error line after a failed attempt', async () => {
    vi.mocked(signIn).mockResolvedValue({ error: 'credentials' })
    const user = userEvent.setup()
    const { router } = renderRoute('/')
    await router.navigate('/', { replace: true, state: { sessionExpired: true } })
    await expectNotice(en.session.expired)

    await logIn(user)

    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(screen.getByRole('alert')).toHaveTextContent(en.login.errors.credentials)
  })

  it('after a password reset: the password-changed notice, cleared from history', async () => {
    const { router } = renderRoute('/')
    const region = screen.getByRole('status')

    await router.navigate('/', { replace: true, state: { passwordChanged: true } })

    await expectNotice(en.reset.saved)
    expect(screen.getByRole('status')).toBe(region)
    await waitFor(() => expect(router.state.location.state).toBeNull())
    expect(screen.queryByText(en.session.expired)).not.toBeInTheDocument()
  })

  it('the notice is in Norwegian too', async () => {
    await i18n.changeLanguage('nb')
    const { router } = renderRoute('/')
    await router.navigate('/', { replace: true, state: { sessionExpired: true } })

    await expectNotice(nb.session.expired)
  })
})
