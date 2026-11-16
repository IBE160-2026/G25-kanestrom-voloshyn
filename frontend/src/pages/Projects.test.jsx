// Projects page, empty (Story 1.3, Story 2.1), and its top bar with the Account menu (Story 1.4).
// api/client.js and auth/ are mocked (spine › Tests).
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, detachSignedOutListener } from '../api/client.js'
import { hasSession, signOut } from '../auth/index.js'
import { RETURN_TO_KEY } from '../auth/returnTo.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { callsTo, fakeApi, project } from '../test/fakeApi.js'
import { i18n, renderRoute } from '../test/render.jsx'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

const PROFILE = { first_name: 'Emma', language: 'en', email_verified: false, ui_prefs: {}, last_project_id: null }

beforeEach(() => {
  vi.mocked(apiFetch).mockReset()
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
  vi.mocked(signOut).mockReset().mockResolvedValue({ ended: Promise.resolve() })
  vi.mocked(detachSignedOutListener).mockReset()
})

/** apiFetch answers GET /api/me with the profile, PATCH /api/me with `patch`, and GET /api/projects. */
function answer({ me = PROFILE, projects = [], patch = async (body) => ({ ...me, ...body }) } = {}) {
  vi.mocked(apiFetch).mockImplementation(async (path, options = {}) => {
    if (path === '/api/me' && options.method === 'PATCH') return patch(options.body)
    if (path === '/api/me') return me
    if (path === '/api/projects' && !options.method) return projects
    throw new Error(`unexpected ${path}`)
  })
}

/** Tab until `element` has focus (the Sidebar's buttons come first). */
async function tabTo(user, element) {
  for (let i = 0; i < 10 && document.activeElement !== element; i += 1) await user.tab()
  expect(element).toHaveFocus()
}

function trigger(name = 'Welcome, Emma') {
  return screen.getByRole('button', { name })
}

describe('Projects', () => {
  it('greets by first name and shows the empty state', async () => {
    answer()
    renderRoute('/projects')

    expect(await screen.findByText('Welcome, Emma')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: en.projects.empty.create })).toBeInTheDocument()
    expect(screen.getByText(en.projects.empty.body)).toBeInTheDocument()
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
    expect(screen.queryByRole('button', { name: en.projects.empty.create })).not.toBeInTheDocument()

    resolve(PROFILE)
    expect(await screen.findByRole('button', { name: en.projects.empty.create })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'false')
  })

  it.each(['unauthorized', 'session_expired'])('on %s it shows no error (client.js handles the sign-out)', async (code) => {
    vi.mocked(apiFetch).mockRejectedValue({ code, params: {} })
    renderRoute('/projects')

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('Projects page (Story 2.1)', () => {
  it('first sign-in: the empty state and "+ New project" in the Sidebar', async () => {
    fakeApi()
    renderRoute('/projects')

    expect(await screen.findByRole('button', { name: en.projects.empty.create })).toBeInTheDocument()
    expect(screen.getByText(en.projects.empty.body)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.projects.new })).toBeInTheDocument()
  })

  it('is in Norwegian too', async () => {
    await i18n.changeLanguage('nb')
    fakeApi()
    renderRoute('/projects')

    expect(await screen.findByRole('button', { name: nb.projects.empty.create })).toBeInTheDocument()
    expect(screen.getByText(nb.projects.empty.body)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nb.projects.new })).toBeInTheDocument()
  })

  it('"Create your first project" creates a Project and opens it showing "New project"', async () => {
    fakeApi()
    const user = userEvent.setup()
    const { router } = renderRoute('/projects')

    await user.click(await screen.findByRole('button', { name: en.projects.empty.create }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/new-1'))
    expect(callsTo('/api/projects', 'POST')).toHaveLength(1)
    expect(await screen.findByRole('heading', { level: 1, name: en.projects.placeholder })).toBeInTheDocument()
  })

  it('a failed create shows the error and opens nothing', async () => {
    fakeApi({
      routes: {
        'POST /api/projects': async () => {
          throw { code: 'internal_error', params: {} }
        },
      },
    })
    const user = userEvent.setup()
    const { router } = renderRoute('/projects')

    await user.click(await screen.findByRole('button', { name: en.projects.empty.create }))

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.internal_error)
    expect(router.state.location.pathname).toBe('/projects')
  })

  it('a double click creates one Project', async () => {
    let release
    fakeApi({
      routes: {
        'POST /api/projects': () => new Promise((resolve) => (release = () => resolve(project('only')))),
      },
    })
    const user = userEvent.setup()
    const { router } = renderRoute('/projects')

    const button = await screen.findByRole('button', { name: en.projects.empty.create })
    await user.click(button)
    await user.click(button)
    release()

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/only'))
    expect(callsTo('/api/projects', 'POST')).toHaveLength(1)
  })

  it('with a last opened Project it goes there', async () => {
    fakeApi({ me: { ...PROFILE, last_project_id: 'a' }, projects: [project('a', { name: 'Biology', name_source: 'student' })] })
    const { router } = renderRoute('/projects')

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Biology' })).toBeInTheDocument()
  })

  it('with no usable last Project but active ones, it opens the most recent', async () => {
    fakeApi({
      me: PROFILE,
      projects: [project('newest', { name: 'Chemistry', name_source: 'student' }), project('older')],
    })
    const { router } = renderRoute('/projects')

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/newest'))
    expect(screen.queryByRole('button', { name: en.projects.empty.create })).not.toBeInTheDocument()
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

    await tabTo(user, button)
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

    expect(await screen.findByText(nb.projects.empty.create)).toBeInTheDocument()
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
    expect(screen.getByText(nb.projects.empty.create)).toBeInTheDocument()

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
    await tabTo(user, await screen.findByRole('button', { name: 'Welcome, Emma' }))
    await user.keyboard('{ArrowDown}')
    await screen.findByRole('menu')
    vi.mocked(hasSession).mockResolvedValue(false)
    await user.keyboard('{End}{Enter}')

    expect(signOut).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('without a first name the trigger is named "Account menu" and the avatar is empty', async () => {
    answer({ me: { ...PROFILE, first_name: null, language: null } })
    renderRoute('/projects')

    const button = await screen.findByRole('button', { name: en.account.menu })
    expect(button).not.toHaveTextContent(/Welcome/)
  })
})
