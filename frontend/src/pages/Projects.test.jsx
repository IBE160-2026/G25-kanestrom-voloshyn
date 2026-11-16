// Projects page, empty (Story 1.3), and its top bar with the Account menu (Story 1.4).
// api/client.js and auth/ are mocked (spine › Tests).
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, detachSignedOutListener } from '../api/client.js'
import { hasSession, signOut } from '../auth/index.js'
import { RETURN_TO_KEY } from '../auth/returnTo.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { i18n, renderRoute } from '../test/render.jsx'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

const PROFILE = { first_name: 'Emma', language: 'en', email_verified: false }

beforeEach(() => {
  vi.mocked(apiFetch).mockReset()
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
  vi.mocked(signOut).mockReset().mockResolvedValue({ ended: Promise.resolve() })
  vi.mocked(detachSignedOutListener).mockReset()
})

/** apiFetch answers GET /api/me with the profile and PATCH /api/me with `patch`. */
function answer({ me = PROFILE, patch = async (body) => ({ ...me, ...body }) } = {}) {
  vi.mocked(apiFetch).mockImplementation(async (path, options = {}) => {
    if (path === '/api/me' && options.method === 'PATCH') return patch(options.body)
    if (path === '/api/me') return me
    throw new Error(`unexpected ${path}`)
  })
}

function trigger(name = 'Welcome, Emma') {
  return screen.getByRole('button', { name })
}

describe('Projects', () => {
  it('greets by first name and shows the empty state', async () => {
    answer()
    renderRoute('/projects')

    expect(await screen.findByText('Welcome, Emma')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: en.projects.empty.heading })).toBeInTheDocument()
    expect(apiFetch).toHaveBeenCalledWith('/api/me')
  })

  it('shows the API error from its code, never the server message', async () => {
    vi.mocked(apiFetch).mockRejectedValue({ code: 'auth_unavailable', params: {}, message: 'Supabase down' })
    const { router } = renderRoute('/projects')

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.auth_unavailable)
    expect(screen.queryByText('Supabase down')).not.toBeInTheDocument()
    expect(screen.queryByText(/Welcome/)).not.toBeInTheDocument()
    // Auth outage: still signed in, still here.
    expect(signOut).not.toHaveBeenCalled()
    expect(router.state.location.pathname).toBe('/projects')
  })

  it('shows no empty-state content until /api/me answers', async () => {
    let resolve
    vi.mocked(apiFetch).mockReturnValue(new Promise((r) => (resolve = r)))
    renderRoute('/projects')

    expect(await screen.findByRole('main')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()

    resolve(PROFILE)
    expect(await screen.findByRole('heading', { name: en.projects.empty.heading })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'false')
  })

  it.each(['unauthorized', 'session_expired'])('on %s it shows no error (client.js handles the sign-out)', async (code) => {
    vi.mocked(apiFetch).mockRejectedValue({ code, params: {} })
    renderRoute('/projects')

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('Account menu', () => {
  it('shows the avatar initials and opens with Language and Log out', async () => {
    answer()
    const user = userEvent.setup()
    renderRoute('/projects')

    const button = await screen.findByRole('button', { name: 'Welcome, Emma' })
    expect(within(button).getByText('E')).toBeInTheDocument()
    expect(button).toHaveAttribute('aria-haspopup', 'menu')

    await user.click(button)

    const menu = screen.getByRole('menu')
    expect(within(menu).getByText(en.account.language)).toBeInTheDocument()
    const english = within(menu).getByRole('menuitemradio', { name: 'English' })
    const norsk = within(menu).getByRole('menuitemradio', { name: 'Norsk' })
    expect(english).toHaveAttribute('aria-checked', 'true')
    expect(english).toHaveAttribute('lang', 'en')
    expect(norsk).toHaveAttribute('lang', 'nb')
    expect(within(menu).getByRole('menuitem', { name: en.account.logOut })).toBeInTheDocument()
    // No dead controls: Settings arrives with Story 7.3.
    expect(within(menu).queryByText('Settings')).not.toBeInTheDocument()
  })

  it('works from the keyboard: open, move, choose, Escape returns focus to the trigger', async () => {
    answer()
    const user = userEvent.setup()
    renderRoute('/projects')
    const button = await screen.findByRole('button', { name: 'Welcome, Emma' })

    await user.tab()
    expect(button).toHaveFocus()
    await user.keyboard('{Enter}')
    const menu = await screen.findByRole('menu')
    await waitFor(() => expect(within(menu).getByRole('menuitemradio', { name: 'English' })).toHaveFocus())

    await user.keyboard('{ArrowDown}')
    expect(within(menu).getByRole('menuitemradio', { name: 'Norsk' })).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(i18n.language).toBe('nb'))
    expect(screen.getByRole('menu')).toBeInTheDocument() // stays open to show the switch

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger('Velkommen, Emma')).toHaveFocus()
  })

  it('switching to Norsk changes the interface at once and saves it to the Account', async () => {
    answer()
    const user = userEvent.setup()
    renderRoute('/projects')

    await user.click(await screen.findByRole('button', { name: 'Welcome, Emma' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Norsk' }))

    expect(await screen.findByText(nb.projects.empty.heading)).toBeInTheDocument()
    expect(apiFetch).toHaveBeenCalledWith('/api/me', { method: 'PATCH', body: { language: 'nb' } })
    expect(window.localStorage.getItem('studybuddy.language')).toBe('nb')
    expect(screen.getByRole('menuitemradio', { name: 'Norsk' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a failed save keeps the switch and shows the generic error', async () => {
    answer({
      patch: async () => {
        throw { code: 'internal_error', params: {} }
      },
    })
    const user = userEvent.setup()
    renderRoute('/projects')

    await user.click(await screen.findByRole('button', { name: 'Welcome, Emma' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Norsk' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(nb.errors.internal_error)
    expect(screen.getByRole('menu')).not.toContainElement(alert)
    expect(i18n.language).toBe('nb')
    expect(screen.getByText(nb.projects.empty.heading)).toBeInTheDocument()

    // The alert survives the menu closing.
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(nb.errors.internal_error)
  })

  it('language saves are latest-wins: a late failure of a superseded save shows nothing', async () => {
    const replies = []
    answer({ patch: () => new Promise((resolve, reject) => replies.push({ resolve, reject })) })
    const user = userEvent.setup()
    renderRoute('/projects')

    await user.click(await screen.findByRole('button', { name: 'Welcome, Emma' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Norsk' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'English' }))
    await waitFor(() => expect(replies).toHaveLength(2))

    replies[1].resolve({ ...PROFILE, language: 'en' })
    replies[0].reject({ code: 'internal_error', params: {} })
    await new Promise((r) => setTimeout(r, 0))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(i18n.language).toBe('en')
  })

  it('choosing the active language sends nothing', async () => {
    answer()
    const user = userEvent.setup()
    renderRoute('/projects')

    await user.click(await screen.findByRole('button', { name: 'Welcome, Emma' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'English' }))

    expect(apiFetch).not.toHaveBeenCalledWith('/api/me', expect.objectContaining({ method: 'PATCH' }))
  })

  it('the menu is there even when the profile failed to load, so Log out still works', async () => {
    vi.mocked(apiFetch).mockRejectedValue({ code: 'internal_error', params: {} })
    const user = userEvent.setup()
    const { router } = renderRoute('/projects')

    const button = await screen.findByRole('button', { name: en.account.menu })
    await user.click(button)
    vi.mocked(hasSession).mockResolvedValue(false)
    await user.click(screen.getByRole('menuitem', { name: en.account.logOut }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('avatar initials are upper-cased in any script: "åse" shows "Å"', async () => {
    answer({ me: { ...PROFILE, first_name: 'åse' } })
    renderRoute('/projects')

    const button = await screen.findByRole('button', { name: 'Welcome, åse' })
    expect(within(button).getByText('Å')).toBeInTheDocument()
  })

  it('Log out detaches the expiry listener first and navigates without waiting for the server', async () => {
    answer()
    const order = []
    vi.mocked(detachSignedOutListener).mockImplementation(() => order.push('detach'))
    vi.mocked(signOut).mockImplementation(async () => {
      order.push('signOut')
      return { ended: new Promise(() => {}) } // the server never answers
    })
    const user = userEvent.setup()
    const { router } = renderRoute('/projects')

    await user.click(await screen.findByRole('button', { name: 'Welcome, Emma' }))
    vi.mocked(hasSession).mockResolvedValue(false)
    await user.click(screen.getByRole('menuitem', { name: en.account.logOut }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(order).toEqual(['detach', 'signOut'])
  })

  it('Log out is immediate: signs out and lands on Login', async () => {
    answer()
    window.sessionStorage.setItem(RETURN_TO_KEY, '/projects')
    const user = userEvent.setup()
    const { router } = renderRoute('/projects')

    await user.click(await screen.findByRole('button', { name: 'Welcome, Emma' }))
    vi.mocked(hasSession).mockResolvedValue(false)
    await user.click(screen.getByRole('menuitem', { name: en.account.logOut }))

    expect(signOut).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(screen.getByRole('form', { name: en.login.submit })).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeEmptyDOMElement() // no session-expired notice
    expect(window.sessionStorage.getItem(RETURN_TO_KEY)).toBeNull()
  })

  it('Log out from the keyboard', async () => {
    answer()
    const user = userEvent.setup()
    const { router } = renderRoute('/projects')
    await screen.findByRole('button', { name: 'Welcome, Emma' })

    await user.tab()
    await user.keyboard('{ArrowDown}')
    await screen.findByRole('menu')
    vi.mocked(hasSession).mockResolvedValue(false)
    await user.keyboard('{End}{Enter}')

    expect(signOut).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('without a first name the trigger is named "Account menu" and the avatar is empty', async () => {
    answer({ me: { first_name: null, language: null, email_verified: false } })
    renderRoute('/projects')

    const button = await screen.findByRole('button', { name: en.account.menu })
    expect(button).not.toHaveTextContent(/Welcome/)
  })
})
