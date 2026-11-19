// Google sign-in in the SPA (Story 1.6, FR-19): the button behind google_enabled, /auth/callback,
// the Google picture in the avatar, and the one-time takeover notice. auth/ and api/client.js are
// mocked (spine › Tests).
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client.js'
import { completeOAuth, googleEnabled, googleSetting, hasSession, signInWithGoogle, signOut } from '../auth/index.js'
import { rememberRoute } from '../auth/returnTo.js'
import { UNDO_MESSAGE_MS } from '../components/UndoMessage.jsx'
import en from '../i18n/en.json'
import { i18n, renderRoute } from '../test/render.jsx'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

const PICTURE = 'https://lh3.googleusercontent.com/a/photo'
const PROFILE = {
  first_name: 'Kari',
  picture_url: PICTURE,
  language: 'en',
  email_verified: false,
  ui_prefs: {},
  last_project_id: null,
  privacy_notice_accepted: false,
  notice_google_takeover: false,
}

/** apiFetch answers after-sign-in, GET /api/me, GET /api/projects, and the notice clear. */
function answer({ me = PROFILE, afterSignIn = async () => me } = {}) {
  vi.mocked(apiFetch).mockImplementation(async (path, options = {}) => {
    if (path === '/api/auth/after-sign-in') return afterSignIn(options.body)
    if (path === '/api/me') return me
    if (path === '/api/projects') return []
    if (path === '/api/me/notices/google-takeover') return { ...me, notice_google_takeover: false }
    throw new Error(`unexpected ${path}`)
  })
}

function calls(path) {
  return vi.mocked(apiFetch).mock.calls.filter(([p]) => p === path)
}

beforeEach(() => {
  vi.mocked(googleEnabled).mockReset().mockResolvedValue(true)
  vi.mocked(googleSetting).mockReset().mockResolvedValue('on')
  vi.mocked(signInWithGoogle).mockReset().mockResolvedValue({ ok: true })
  vi.mocked(completeOAuth).mockReset().mockResolvedValue({ ok: true })
  vi.mocked(hasSession).mockReset().mockResolvedValue(false)
  vi.mocked(signOut).mockReset().mockResolvedValue({ ended: Promise.resolve() })
  vi.mocked(apiFetch).mockReset()
  answer()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Google button', () => {
  it.each(['/', '/signup'])('is not shown on %s when Google is not configured', async (path) => {
    vi.mocked(googleEnabled).mockResolvedValue(false)
    renderRoute(path)

    await waitFor(() => expect(googleEnabled).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByRole('button', { name: en.login.google })).not.toBeInTheDocument()
    expect(screen.queryByText(en.login.or)).not.toBeInTheDocument()
  })

  it.each(['/', '/signup'])('on %s, starts the Google sign-in when configured', async (path) => {
    const user = userEvent.setup()
    renderRoute(path)

    const button = await screen.findByRole('button', { name: en.login.google })
    expect(screen.getByText(en.login.or)).toBeInTheDocument()
    await user.click(button)

    expect(signInWithGoogle).toHaveBeenCalledTimes(1)
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it.each(['/', '/signup'])('on %s, a start that failed shows the sign-in failure', async (path) => {
    vi.mocked(signInWithGoogle).mockResolvedValue({ error: 'failed' })
    const user = userEvent.setup()
    renderRoute(path)

    await user.click(await screen.findByRole('button', { name: en.login.google }))

    expect(await screen.findByRole('alert')).toHaveTextContent(en.login.errors.failed)
    expect(screen.getByRole('button', { name: en.login.google })).toBeEnabled()
  })

  it('is usable again after Back from Google through the back/forward cache', async () => {
    const user = userEvent.setup()
    renderRoute('/')
    const button = await screen.findByRole('button', { name: en.login.google })
    await user.click(button)
    expect(button).toBeDisabled()

    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    })

    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('aria-busy', 'false')
  })

  it('shows the Norwegian label', async () => {
    await i18n.changeLanguage('nb')
    renderRoute('/')
    expect(await screen.findByRole('button', { name: 'Logg inn med Google' })).toBeInTheDocument()
    expect(screen.getByText('eller')).toBeInTheDocument()
  })
})

describe('/auth/callback', () => {
  it('without Google configured, behaves as before: Login, no sign-in work', async () => {
    vi.mocked(googleEnabled).mockResolvedValue(false)
    vi.mocked(googleSetting).mockResolvedValue('off')
    renderRoute('/auth/callback')

    expect(await screen.findByRole('button', { name: en.login.submit })).toBeInTheDocument()
    expect(completeOAuth).not.toHaveBeenCalled()
    expect(calls('/api/auth/after-sign-in')).toEqual([])
  })

  it('a new Google sign-in runs after-sign-in, lands on Projects, and shows the Google picture', async () => {
    vi.mocked(hasSession).mockResolvedValue(true) // the session supabase-js now holds
    const { router } = renderRoute('/auth/callback')

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'))
    expect(calls('/api/auth/after-sign-in')).toEqual([
      ['/api/auth/after-sign-in', { method: 'POST', body: { language: 'en' } }],
    ])
    const trigger = await screen.findByRole('button', { name: 'Welcome, Kari' })
    const img = trigger.querySelector('img')
    expect(img).toHaveAttribute('src', PICTURE)
    expect(img).toHaveAttribute('alt', '')
    // A matched verified Account: no takeover notice.
    expect(screen.queryByText(en.account.googleTakeover)).not.toBeInTheDocument()
    expect(calls('/api/me/notices/google-takeover')).toEqual([])
  })

  it('a failed /api/config is not "Google off": Login shows the sign-in failure', async () => {
    vi.mocked(googleSetting).mockResolvedValue('unknown')
    const { router } = renderRoute('/auth/callback')

    expect(await screen.findByRole('alert')).toHaveTextContent(en.login.errors.failed)
    expect(router.state.location.pathname).toBe('/')
    expect(completeOAuth).not.toHaveBeenCalled()
  })

  it('a remembered route wins over the last Project', async () => {
    rememberRoute('/projects/p2?x=1')
    vi.mocked(hasSession).mockResolvedValue(true)
    const seen = []
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (path === '/api/auth/after-sign-in') return { ...PROFILE, last_project_id: 'p1' }
      return new Promise(() => {})
    })
    const { router } = renderRoute('/auth/callback')
    router.subscribe((state) => seen.push(`${state.location.pathname}${state.location.search}`))

    await waitFor(() => expect(seen[0]).toBe('/projects/p2?x=1'))
  })

  it('applies the Account language and lands on the last Project', async () => {
    answer({ me: { ...PROFILE, language: 'nb', last_project_id: 'p1' } })
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (path === '/api/auth/after-sign-in') return { ...PROFILE, language: 'nb', last_project_id: 'p1' }
      return new Promise(() => {})
    })
    const { router } = renderRoute('/auth/callback')

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p1'))
    expect(i18n.resolvedLanguage).toBe('nb')
  })

  it('an identity already linked elsewhere goes back to Login with its message', async () => {
    vi.mocked(completeOAuth).mockResolvedValue({ error: 'in_use' })
    const { router } = renderRoute('/auth/callback')

    expect(await screen.findByRole('alert')).toHaveTextContent(en.login.errors.googleInUse)
    expect(router.state.location.pathname).toBe('/')
    expect(calls('/api/auth/after-sign-in')).toEqual([])
    // The form is usable for either way in.
    expect(screen.getByRole('button', { name: en.login.google })).toBeEnabled()
    expect(screen.getByRole('button', { name: en.login.submit })).toBeEnabled()
  })

  it('a cancelled consent or any other error shows "Sign-in didn\'t work. Try again." on Login', async () => {
    vi.mocked(completeOAuth).mockResolvedValue({ error: 'failed' })
    const { router } = renderRoute('/auth/callback')

    expect(await screen.findByRole('alert')).toHaveTextContent(en.login.errors.failed)
    expect(router.state.location.pathname).toBe('/')
    expect(router.state.location.state).toBeNull() // a reload doesn't repeat it
  })

  it('a failed after-sign-in signs out and shows the failure on Login', async () => {
    answer({ afterSignIn: async () => Promise.reject({ code: 'auth_unavailable', params: {} }) })
    const { router } = renderRoute('/auth/callback')

    expect(await screen.findByRole('alert')).toHaveTextContent(en.login.errors.failed)
    expect(router.state.location.pathname).toBe('/')
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('a refused session (already signed out by api/client.js) is not signed out again', async () => {
    answer({ afterSignIn: async () => Promise.reject({ code: 'unauthorized', params: {} }) })
    renderRoute('/auth/callback')

    expect(await screen.findByRole('alert')).toHaveTextContent(en.login.errors.failed)
    expect(signOut).not.toHaveBeenCalled()
  })
})

describe('Avatar', () => {
  it('falls back to the initial when the Google picture fails to load', async () => {
    vi.mocked(hasSession).mockResolvedValue(true)
    renderRoute('/projects')

    const trigger = await screen.findByRole('button', { name: 'Welcome, Kari' })
    fireEvent.error(trigger.querySelector('img'))

    expect(trigger.querySelector('img')).toBeNull()
    expect(within(trigger).getByText('K')).toBeInTheDocument()
  })

  it('an email Account shows the initial', async () => {
    vi.mocked(hasSession).mockResolvedValue(true)
    answer({ me: { ...PROFILE, first_name: 'Emma', picture_url: null } })
    renderRoute('/projects')

    const trigger = await screen.findByRole('button', { name: 'Welcome, Emma' })
    expect(trigger.querySelector('img')).toBeNull()
    expect(within(trigger).getByText('E')).toBeInTheDocument()
  })
})

describe('Google takeover notice', () => {
  const TAKEN_OVER = { ...PROFILE, notice_google_takeover: true }

  it('shows once as a polite status, clears the flag, and goes after 6 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(hasSession).mockResolvedValue(true)
    answer({ me: TAKEN_OVER })
    renderRoute('/projects')

    const notice = await screen.findByText(en.account.googleTakeover)
    expect(notice.closest('[role="status"]')).not.toBeNull()
    expect(calls('/api/me/notices/google-takeover')).toEqual([['/api/me/notices/google-takeover', { method: 'POST' }]])

    await act(async () => vi.advanceTimersByTime(UNDO_MESSAGE_MS + 10))
    expect(screen.queryByText(en.account.googleTakeover)).not.toBeInTheDocument()
    expect(calls('/api/me/notices/google-takeover')).toHaveLength(1)
  })

  it('stays while hovered, and Escape then dismisses it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(hasSession).mockResolvedValue(true)
    answer({ me: TAKEN_OVER })
    renderRoute('/projects')
    const box = (await screen.findByText(en.account.googleTakeover)).parentElement

    fireEvent.mouseEnter(box)
    await act(async () => vi.advanceTimersByTime(UNDO_MESSAGE_MS * 2))
    expect(screen.getByText(en.account.googleTakeover)).toBeInTheDocument()
    // A plain status line, not a Tab stop.
    expect(box).not.toHaveAttribute('tabindex')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText(en.account.googleTakeover)).not.toBeInTheDocument()
  })

  it('Escape does nothing while it is neither hovered nor focused', async () => {
    vi.mocked(hasSession).mockResolvedValue(true)
    answer({ me: TAKEN_OVER })
    renderRoute('/projects')
    await screen.findByText(en.account.googleTakeover)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByText(en.account.googleTakeover)).toBeInTheDocument()
  })

  it('retries a failed clear once', async () => {
    vi.mocked(hasSession).mockResolvedValue(true)
    answer({ me: TAKEN_OVER })
    const base = vi.mocked(apiFetch).getMockImplementation()
    let failures = 1
    vi.mocked(apiFetch).mockImplementation(async (path, options) => {
      if (path === '/api/me/notices/google-takeover' && failures-- > 0) throw { code: 'auth_unavailable' }
      return base(path, options)
    })
    renderRoute('/projects')

    await screen.findByText(en.account.googleTakeover)
    await waitFor(() => expect(calls('/api/me/notices/google-takeover')).toHaveLength(2))
  })

  it('a remount of the shell does not show it again', async () => {
    vi.mocked(hasSession).mockResolvedValue(true)
    answer({ me: TAKEN_OVER }) // the clear's reply is never re-read; the flag stays true here
    const first = renderRoute('/projects')
    await screen.findByText(en.account.googleTakeover)
    first.unmount()

    renderRoute('/projects')
    await screen.findByRole('button', { name: 'Welcome, Kari' })
    expect(screen.queryByText(en.account.googleTakeover)).not.toBeInTheDocument()
    expect(calls('/api/me/notices/google-takeover')).toHaveLength(1)
  })

  it('is not shown without the flag', async () => {
    vi.mocked(hasSession).mockResolvedValue(true)
    renderRoute('/projects')

    await screen.findByRole('button', { name: 'Welcome, Kari' })
    expect(screen.queryByText(en.account.googleTakeover)).not.toBeInTheDocument()
    expect(calls('/api/me/notices/google-takeover')).toEqual([])
  })
})

describe('Login after a refused password session', () => {
  it('google_sign_in_required shows the takeover line, not the session-expired one', async () => {
    const { router } = renderRoute('/')
    await act(async () =>
      router.navigate('/', { replace: true, state: { sessionExpired: true, code: 'google_sign_in_required' } }),
    )

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(en.account.googleTakeover))
    expect(screen.queryByText(en.session.expired)).not.toBeInTheDocument()
  })

  it('a password login refused with google_sign_in_required shows the takeover line', async () => {
    const { signIn } = await import('../auth/index.js')
    vi.mocked(signIn).mockResolvedValue({ session: { access_token: 'tok' } })
    vi.mocked(apiFetch).mockRejectedValue({ code: 'google_sign_in_required', params: {} })
    const user = userEvent.setup()
    renderRoute('/')

    await user.type(screen.getByLabelText(en.login.email), 'kari@example.com')
    await user.type(screen.getByLabelText(en.login.password), 'longenough')
    await user.click(screen.getByRole('button', { name: en.login.submit }))

    expect(await screen.findByRole('status')).toHaveTextContent(en.account.googleTakeover)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
