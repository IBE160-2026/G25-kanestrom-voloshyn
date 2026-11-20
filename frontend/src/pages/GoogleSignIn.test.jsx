// Google sign-in in the SPA (Story 1.6, FR-19): the button on Login and Create account, the
// /auth/callback page, its error mapping, the one-time takeover notice, and the Google photo.
// api/client.js and auth/ are mocked (spine › Tests).
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client.js'
import { completeGoogleSignIn, hasSession, isGoogleEnabled, signInWithGoogle, signOut } from '../auth/index.js'
import { RETURN_TO_KEY } from '../auth/returnTo.js'
import { UNDO_MESSAGE_MS } from '../components/UndoMessage.jsx'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { i18n, renderRoute } from '../test/render.jsx'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

const PROFILE = {
  first_name: 'Emma',
  language: 'en',
  email_verified: false,
  ui_prefs: {},
  last_project_id: null,
  privacy_notice_accepted: false,
  notice_google_takeover: false,
  picture_url: null,
}
const PICTURE = 'https://lh3.googleusercontent.com/a/emma'

beforeEach(() => {
  vi.mocked(hasSession).mockReset().mockResolvedValue(false)
  vi.mocked(isGoogleEnabled).mockReset().mockResolvedValue(true)
  vi.mocked(signInWithGoogle).mockReset().mockResolvedValue({ ok: true })
  vi.mocked(completeGoogleSignIn).mockReset().mockResolvedValue({ ok: true })
  vi.mocked(signOut).mockReset().mockResolvedValue({ ended: Promise.resolve() })
  vi.mocked(apiFetch).mockReset().mockResolvedValue(PROFILE)
})

afterEach(() => {
  vi.useRealTimers()
})

const googleButton = (catalogue = en) => screen.findByRole('button', { name: catalogue.login.google })

describe('Google button', () => {
  it('shows on Login with the "or" divider above the email form', async () => {
    renderRoute('/')
    const button = await googleButton()
    expect(screen.getByText(en.login.or)).toBeInTheDocument()
    // It comes first in the panel, before the email field.
    const email = screen.getByLabelText(en.login.email)
    expect(button.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('is not on Create account, which is for an email Account (Cristoffer, 2026-11-20)', async () => {
    renderRoute('/signup')
    expect(await screen.findByLabelText(en.signup.firstName)).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('button', { name: en.login.google })).not.toBeInTheDocument()
    expect(screen.queryByText(en.login.or)).not.toBeInTheDocument()
  })

  it('is hidden on Login when Google is not configured', async () => {
    vi.mocked(isGoogleEnabled).mockResolvedValue(false)
    renderRoute('/')
    await waitFor(() => expect(isGoogleEnabled).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: en.login.google })).not.toBeInTheDocument()
    expect(screen.queryByText(en.login.or)).not.toBeInTheDocument()
    expect(screen.getByLabelText(en.login.email)).toBeInTheDocument()
  })

  it('starts Google sign-in and stays busy while the browser leaves', async () => {
    const user = userEvent.setup()
    renderRoute('/')
    await user.click(await googleButton())
    expect(signInWithGoogle).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: en.login.google })).toBeDisabled()
  })

  it('a sign-in that cannot start shows the Error line', async () => {
    const message = en.login.errors.failed
    vi.mocked(signInWithGoogle).mockResolvedValue({ error: 'failed' })
    const user = userEvent.setup()
    renderRoute('/')
    await user.click(await googleButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('button', { name: en.login.google })).toBeEnabled()
  })

  it('is usable again after Back from Google restores the page from the bfcache', async () => {
    const user = userEvent.setup()
    renderRoute('/')
    await user.click(await googleButton())
    expect(screen.getByRole('button', { name: en.login.google })).toBeDisabled()

    // A normal pageshow (not from the cache) changes nothing.
    await act(async () => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })))
    expect(screen.getByRole('button', { name: en.login.google })).toBeDisabled()

    await act(async () => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
    expect(screen.getByRole('button', { name: en.login.google })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: en.login.google }))
    expect(signInWithGoogle).toHaveBeenCalledTimes(2)
  })

  it('reads "Logg inn med Google" and "eller" in Norwegian', async () => {
    await i18n.changeLanguage('nb')
    renderRoute('/')
    expect(await googleButton(nb)).toBeInTheDocument()
    expect(screen.getByText(nb.login.or)).toBeInTheDocument()
  })
})

describe('/auth/callback', () => {
  it('finishes sign-in, calls after-sign-in with the language, and lands on Projects', async () => {
    const { router } = renderRoute('/auth/callback?code=abc')
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'))
    expect(completeGoogleSignIn).toHaveBeenCalledWith('?code=abc', '')
    expect(apiFetch).toHaveBeenCalledWith('/api/auth/after-sign-in', { method: 'POST', body: { language: 'en' } })
    // The code doesn't stay in history: the callback entry was replaced.
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('lands on the last Project, a remembered route winning, in the Account language', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ ...PROFILE, language: 'nb', last_project_id: 'p1' })
    const { router } = renderRoute('/auth/callback?code=abc')
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p1'))
    expect(i18n.resolvedLanguage).toBe('nb')

    window.sessionStorage.setItem(RETURN_TO_KEY, '/projects/p2/quiz')
    const second = renderRoute('/auth/callback?code=def')
    await waitFor(() => expect(second.router.state.location.pathname).toBe('/projects/p2/quiz'))
  })

  it.each([
    ['failed', en.login.errors.failed],
    ['identity_in_use', en.login.errors.identityInUse],
  ])('a %s sign-in returns to Login with its Error line, and no after-sign-in', async (error, message) => {
    vi.mocked(completeGoogleSignIn).mockResolvedValue({ error })
    const { router } = renderRoute('/auth/callback?error=access_denied')
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(apiFetch).not.toHaveBeenCalledWith('/api/auth/after-sign-in', expect.anything())
    // The history state is cleared, so a reload doesn't show it again.
    await waitFor(() => expect(router.state.location.state).toBeNull())
  })

  it('shows "already linked" in Norwegian', async () => {
    await i18n.changeLanguage('nb')
    vi.mocked(completeGoogleSignIn).mockResolvedValue({ error: 'identity_in_use' })
    renderRoute('/auth/callback?error=server_error&error_code=identity_already_exists')
    expect(await screen.findByRole('alert')).toHaveTextContent(nb.login.errors.identityInUse)
  })

  it('a sign-in that took the Account over (401 google_takeover) shows Login with the takeover line', async () => {
    vi.mocked(apiFetch).mockRejectedValue({ code: 'google_takeover', params: {} })
    const { router } = renderRoute('/auth/callback?code=abc')
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(signOut).toHaveBeenCalledTimes(1)
    // An info line in the notice region, not the Error line; Google is offered again.
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(en.account.googleTakeover))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(await googleButton()).toBeEnabled()
  })

  it('signs out and returns to Login when after-sign-in fails', async () => {
    vi.mocked(apiFetch).mockRejectedValue({ code: 'auth_unavailable', params: {} })
    const { router } = renderRoute('/auth/callback?code=abc')
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('alert')).toHaveTextContent(en.login.errors.failed)
  })
})

describe('Signed in with Google', () => {
  function answer(me) {
    vi.mocked(hasSession).mockResolvedValue(true)
    vi.mocked(apiFetch).mockImplementation(async (path, options = {}) => {
      if (path === '/api/me' && !options.method) return me
      if (path === '/api/projects') return []
      if (path === '/api/me/notices/google-takeover/seen') return { ...me, notice_google_takeover: false }
      throw new Error(`unexpected ${path}`)
    })
  }
  const seenCalls = () =>
    vi.mocked(apiFetch).mock.calls.filter(([path]) => path === '/api/me/notices/google-takeover/seen')

  it('shows the takeover notice once, marks it seen, and hides it after 6 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    answer({ ...PROFILE, notice_google_takeover: true })
    renderRoute('/projects')

    const status = await screen.findByText(en.account.googleTakeover)
    expect(status.closest('[role="status"]')).toBeInTheDocument()
    expect(seenCalls()).toEqual([['/api/me/notices/google-takeover/seen', { method: 'POST' }]])
    // No action in the box.
    expect(within(status.closest('[role="status"]')).queryByRole('button')).not.toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(UNDO_MESSAGE_MS + 10)
    })
    expect(screen.queryByText(en.account.googleTakeover)).not.toBeInTheDocument()
    expect(seenCalls()).toHaveLength(1)
  })

  it('stays while hovered', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    answer({ ...PROFILE, notice_google_takeover: true })
    renderRoute('/projects')
    const text = await screen.findByText(en.account.googleTakeover)

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.hover(text)
    await act(async () => {
      vi.advanceTimersByTime(UNDO_MESSAGE_MS * 2)
    })
    expect(screen.getByText(en.account.googleTakeover)).toBeInTheDocument()
  })

  it('keeps the notice when the seen POST answers first or fails, and the page keeps working', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(hasSession).mockResolvedValue(true)
    vi.mocked(apiFetch).mockImplementation(async (path, options = {}) => {
      if (path === '/api/me' && !options.method) return { ...PROFILE, notice_google_takeover: true }
      if (path === '/api/projects') return []
      if (path === '/api/me/notices/google-takeover/seen') throw { code: 'auth_unavailable', params: {} }
      throw new Error(`unexpected ${path}`)
    })
    renderRoute('/projects')

    expect(await screen.findByText(en.account.googleTakeover)).toBeInTheDocument()
    expect(seenCalls()).toHaveLength(1)
    // No error is shown for the failed save, and the page is usable.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Welcome, Emma' })).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(UNDO_MESSAGE_MS - 100)
    })
    expect(screen.getByText(en.account.googleTakeover)).toBeInTheDocument()
  })

  it('keeps the notice through a profile update after the seen answer (latched)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    vi.mocked(hasSession).mockResolvedValue(true)
    let me = { ...PROFILE, notice_google_takeover: true }
    vi.mocked(apiFetch).mockImplementation(async (path, options = {}) => {
      if (path === '/api/me' && !options.method) return me
      if (path === '/api/projects') return []
      if (path === '/api/me/notices/google-takeover/seen') {
        me = { ...me, notice_google_takeover: false }
        return me
      }
      // A language change refreshes the profile with the flag already cleared.
      if (path === '/api/me' && options.method === 'PATCH') return { ...me, ...options.body }
      throw new Error(`unexpected ${path}`)
    })
    renderRoute('/projects')
    expect(await screen.findByText(en.account.googleTakeover)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Welcome, Emma' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Norsk' }))
    expect(screen.getByText(nb.account.googleTakeover)).toBeInTheDocument()
    expect(seenCalls()).toHaveLength(1)
  })

  it('shows no notice without the flag', async () => {
    answer(PROFILE)
    renderRoute('/projects')
    await screen.findByRole('button', { name: 'Welcome, Emma' })
    expect(screen.queryByText(en.account.googleTakeover)).not.toBeInTheDocument()
    expect(seenCalls()).toHaveLength(0)
  })

  it('reads the notice in Norwegian', async () => {
    await i18n.changeLanguage('nb')
    answer({ ...PROFILE, language: 'nb', notice_google_takeover: true })
    renderRoute('/projects')
    expect(await screen.findByText(nb.account.googleTakeover)).toBeInTheDocument()
  })

  it('shows the Google photo in the Avatar, with initials when it fails to load', async () => {
    answer({ ...PROFILE, picture_url: PICTURE })
    const { container } = renderRoute('/projects')
    await screen.findByRole('button', { name: 'Welcome, Emma' })
    const img = container.querySelector(`img[src="${PICTURE}"]`)
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('alt', '')

    await act(async () => {
      img.dispatchEvent(new Event('error'))
    })
    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: 'Welcome, Emma' })).getByText('E')).toBeInTheDocument()
  })
})
