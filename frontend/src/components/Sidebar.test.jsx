// Sidebar and Sidebar strip in the app shell (Story 2.1, FR-4, EXPERIENCE.md › Sidebar). api/client.js
// and auth/ are mocked (spine › Tests); test/fakeApi.js plays the backend.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import { PROFILE, callsTo, fakeApi, project } from '../test/fakeApi.js'
import { initials } from './initials.js'
import { renderRoute } from '../test/render.jsx'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

const WIDTH = window.innerWidth

beforeEach(() => {
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
})

afterEach(() => {
  window.innerWidth = WIDTH
})

function sidebarNav() {
  return screen.getByRole('navigation')
}

describe('Sidebar', () => {
  it('first sign-in: the Sidebar shows "+ New project" and no Projects', async () => {
    fakeApi()
    renderRoute('/projects')

    expect(await screen.findByRole('button', { name: en.projects.new })).toBeInTheDocument()
    expect(within(sidebarNav()).queryAllByRole('link')).toHaveLength(0)
    expect(screen.getByText(en.login.wordmark)).toBeInTheDocument()
    expect(screen.getByText(en.footer.credit)).toBeInTheDocument()
  })

  it('lists the active Projects newest first, with the placeholder for an unnamed one', async () => {
    fakeApi({
      projects: [
        project('c', { name: 'Chemistry', name_source: 'student' }),
        project('b'),
        project('old', { name: 'Archived one', name_source: 'student', archived_at: '2026-11-10T00:00:00Z' }),
        project('a', { name: 'Anatomy', name_source: 'auto' }),
      ],
    })
    renderRoute('/projects')

    await waitFor(() => expect(within(sidebarNav()).getAllByRole('link')).toHaveLength(3))
    const links = within(sidebarNav()).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['Chemistry', en.projects.placeholder, 'Anatomy'])
    expect(links[0]).toHaveAttribute('href', '/projects/c')
  })

  it('"+ New project" creates a Project and opens it', async () => {
    const state = fakeApi({ projects: [project('a', { name: 'Anatomy', name_source: 'student' })] })
    const user = userEvent.setup()
    const { router } = renderRoute('/projects')

    await user.click(await screen.findByRole('button', { name: en.projects.new }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/new-1'))
    expect(state.created).toBe(1)
    const links = within(sidebarNav()).getAllByRole('link')
    expect(links[0]).toHaveTextContent(en.projects.placeholder)
    expect(links[0]).toHaveAttribute('aria-current', 'page')
  })

  it('"Hide projects" collapses to the strip and saves the choice', async () => {
    const state = fakeApi()
    const user = userEvent.setup()
    renderRoute('/projects')

    const hide = await screen.findByRole('button', { name: en.projects.hide })
    expect(hide).toHaveAttribute('aria-expanded', 'true')
    await user.click(hide)

    const show = screen.getByRole('button', { name: en.projects.show })
    expect(show).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: en.projects.newShort })).toBeInTheDocument()
    // The expanded list's "+ New project" is gone (the strip's own squares are tested below).
    expect(screen.queryByRole('button', { name: en.projects.new })).not.toBeInTheDocument()
    expect(callsTo('/api/me/prefs', 'PATCH')).toEqual([
      ['/api/me/prefs', { method: 'PATCH', body: { sidebar_collapsed: true } }],
    ])
    expect(state.me.ui_prefs).toEqual({ sidebar_collapsed: true })

    await user.click(show)
    expect(screen.getByRole('button', { name: en.projects.hide })).toBeInTheDocument()
    expect(callsTo('/api/me/prefs', 'PATCH').at(-1)).toEqual([
      '/api/me/prefs',
      { method: 'PATCH', body: { sidebar_collapsed: false } },
    ])
  })

  it('a reload keeps the collapsed state saved to the Account', async () => {
    fakeApi({ me: { ...PROFILE, ui_prefs: { sidebar_collapsed: true } } })
    renderRoute('/projects')

    expect(await screen.findByRole('button', { name: en.projects.show })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.projects.hide })).not.toBeInTheDocument()
  })

  it('below 1024 px the Sidebar starts collapsed whatever the preference says', async () => {
    window.innerWidth = 800
    fakeApi({ me: { ...PROFILE, ui_prefs: { sidebar_collapsed: false } } })
    const user = userEvent.setup()
    renderRoute('/projects')

    const show = await screen.findByRole('button', { name: en.projects.show })
    // The student can still expand it.
    await user.click(show)
    expect(screen.getByRole('button', { name: en.projects.hide })).toBeInTheDocument()
  })

  it('at 1024 px the saved preference applies', async () => {
    window.innerWidth = 1024
    fakeApi()
    renderRoute('/projects')

    expect(await screen.findByRole('button', { name: en.projects.hide })).toBeInTheDocument()
  })

  it('the strip\'s "New project" button creates and opens a Project, and shows it in the expanded Sidebar', async () => {
    fakeApi({ me: { ...PROFILE, ui_prefs: { sidebar_collapsed: true } } })
    const user = userEvent.setup()
    const { router } = renderRoute('/projects')

    await user.click(await screen.findByRole('button', { name: en.projects.newShort }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/new-1'))
    // The Sidebar opens so the new Project is visible (Cristoffer, 2026-11-17)...
    const link = await screen.findByRole('link', { name: en.projects.placeholder })
    expect(link).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: en.projects.hide })).toBeInTheDocument()
    // ...but that isn't saved as the student's collapse choice.
    expect(callsTo('/api/me/prefs', 'PATCH')).toEqual([])
  })

  it('the strip shows the active Projects as initials, newest first, and opens one on click', async () => {
    fakeApi({
      me: { ...PROFILE, ui_prefs: { sidebar_collapsed: true } },
      projects: [project('b', { name: 'Biology 101', name_source: 'student' }), project('a')],
    })
    const user = userEvent.setup()
    const { router } = renderRoute('/projects/a')

    // Wait for the saved collapse to apply; before /api/me answers, the expanded Sidebar shows.
    await screen.findByRole('button', { name: en.projects.show })
    const links = await within(screen.getByRole('navigation')).findAllByRole('link')
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual(['Biology 101', en.projects.placeholder])
    expect(links.map((link) => link.textContent)).toEqual(['B1', 'NP'])
    await waitFor(() => expect(links[1]).toHaveAttribute('aria-current', 'page'))

    await user.click(links[0])

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/b'))
    // Opening a Project from the strip keeps the Sidebar collapsed.
    expect(screen.getByRole('button', { name: en.projects.show })).toBeInTheDocument()
  })

  it('a strip square shows the full name in a tooltip on keyboard focus', async () => {
    fakeApi({
      me: { ...PROFILE, ui_prefs: { sidebar_collapsed: true } },
      projects: [project('b', { name: 'Biology 101', name_source: 'student' })],
    })
    const user = userEvent.setup()
    renderRoute('/projects/b')
    const square = await screen.findByRole('link', { name: 'Biology 101' })

    while (document.activeElement !== square) await user.tab()

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Biology 101')
  })

  it.each([
    ['Biology 101', 'B1'],
    ['  økonomi og   ledelse ', 'ØO'],
    ['Nytt prosjekt', 'NP'],
    ['Matte', 'M'],
    ['😀 Fun stuff', '😀F'],
  ])('initials("%s") is "%s"', (name, expected) => {
    expect(initials(name)).toBe(expected)
  })

  it('"+ New project" in the expanded Sidebar keeps it expanded and saves nothing', async () => {
    fakeApi()
    const user = userEvent.setup()
    const { router } = renderRoute('/projects')

    await user.click(await screen.findByRole('button', { name: en.projects.new }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/new-1'))
    expect(screen.getByRole('button', { name: en.projects.hide })).toBeInTheDocument()
    expect(callsTo('/api/me/prefs', 'PATCH')).toEqual([])
  })

  it('the strip buttons work from the keyboard', async () => {
    fakeApi({ me: { ...PROFILE, ui_prefs: { sidebar_collapsed: true } } })
    const user = userEvent.setup()
    renderRoute('/projects')
    const show = await screen.findByRole('button', { name: en.projects.show })

    await user.tab()
    expect(show).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('button', { name: en.projects.hide })).toBeInTheDocument()
  })

  it('a failed save of the collapse keeps the switch and shows nothing', async () => {
    fakeApi({
      routes: {
        'PATCH /api/me/prefs': async () => {
          throw { code: 'internal_error', params: {} }
        },
      },
    })
    const user = userEvent.setup()
    renderRoute('/projects')

    await user.click(await screen.findByRole('button', { name: en.projects.hide }))

    expect(screen.getByRole('button', { name: en.projects.show })).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a failed create error clears when another Project opens', async () => {
    fakeApi({
      projects: [project('b', { name: 'Biology', name_source: 'student' }), project('a', { name: 'Anatomy', name_source: 'student' })],
      routes: {
        'POST /api/projects': async () => {
          throw { code: 'internal_error', params: {} }
        },
      },
    })
    const user = userEvent.setup()
    const { router } = renderRoute('/projects/a')
    await screen.findByRole('heading', { level: 1, name: 'Anatomy' })

    await user.click(screen.getByRole('button', { name: en.projects.new }))
    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.internal_error)
    expect(router.state.location.pathname).toBe('/projects/a')

    await user.click(screen.getByRole('link', { name: 'Biology' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Biology' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
