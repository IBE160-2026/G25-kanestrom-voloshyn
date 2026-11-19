// Archive and restore a Project (Story 7.1, FR-23, EXPERIENCE.md › Archived project). api/client.js
// and auth/ are mocked (spine › Tests); test/fakeApi.js plays the backend.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { PROFILE, callsTo, fakeApi, material, mistake, project } from '../test/fakeApi.js'
import { i18n, renderRoute } from '../test/render.jsx'
import { UNDO_MESSAGE_MS } from './UndoMessage.jsx'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

const WIDTH = window.innerWidth

beforeEach(() => {
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
  // Wide enough for the Sidebar and the Files panel to start expanded.
  window.innerWidth = 1280
})

afterEach(async () => {
  vi.useRealTimers()
  window.innerWidth = WIDTH
  await i18n.changeLanguage('en')
})

const BIOLOGY = project('bio', { name: 'Biology', name_source: 'student', created_at: '2026-11-18T10:00:00Z' })
const CHEMISTRY = project('chem', { name: 'Chemistry', name_source: 'student', created_at: '2026-11-17T10:00:00Z' })
const ANATOMY = project('ana', { name: 'Anatomy', name_source: 'student', created_at: '2026-11-16T10:00:00Z' })
const ARCHIVED = '2026-11-15T10:00:00Z'
const READY = { bio: [material('notes', { file_name: 'notes.pdf' })], chem: [material('c1')], ana: [material('a1')] }

const nav = () => screen.getByRole('navigation')
const activeNames = () => within(nav()).getAllByRole('link').map((link) => link.textContent)
const archivedToggle = (lang = en) =>
  screen.queryByRole('button', { name: new RegExp(`^${lang.projects.archivedGroup.replace('({{count}})', '\\(\\d+\\)')}$`) })
async function findArchivedToggle(lang = en) {
  return waitFor(() => {
    const found = archivedToggle(lang)
    expect(found).toBeInTheDocument()
    return found
  })
}
// The Undo message's live region; it mounts with the first archive.
const status = () => screen.getAllByRole('status').find((el) => el.className.includes('undo'))
const panel = () => screen.getByRole('complementary', { name: /^(Files|Filer) · / })

function setup(options = {}) {
  return fakeApi({ projects: [BIOLOGY, CHEMISTRY, ANATOMY], materials: READY, ...options })
}

async function openMenu(user, name, lang = en) {
  await user.click(await screen.findByRole('button', { name: lang.projects.more.replace('{{name}}', name) }))
  return screen.findByRole('menu')
}

async function archiveFromMenu(user, name, lang = en) {
  const menu = await openMenu(user, name, lang)
  await user.click(within(menu).getByRole('menuitem', { name: lang.projects.archive }))
}

async function chatLoaded() {
  await waitFor(() => expect(screen.getByRole('button', { name: en.tools.quiz })).toBeEnabled())
}

describe('Archive a Project', () => {
  it('moves the row into "Archived (1)" and shows the Undo message', async () => {
    const state = setup()
    const user = userEvent.setup()
    renderRoute('/projects/bio')
    await chatLoaded()

    await archiveFromMenu(user, 'Chemistry')

    await waitFor(() => expect(activeNames()).toEqual(['Biology', 'Anatomy']))
    expect(state.stateChanges).toEqual(['archive chem'])
    expect(state.projects.find((p) => p.id === 'chem').archived_at).not.toBeNull()
    expect(archivedToggle()).toHaveTextContent('Archived (1)')
    expect(status()).toHaveTextContent('Chemistry archived')
    expect(within(status()).getByRole('button', { name: en.projects.undo })).toBeInTheDocument()
    // No confirmation dialog.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Undo restores it to where it was in the active list', async () => {
    const state = setup()
    const user = userEvent.setup()
    renderRoute('/projects/bio')
    await chatLoaded()
    await archiveFromMenu(user, 'Chemistry')
    await waitFor(() => expect(activeNames()).toEqual(['Biology', 'Anatomy']))

    await user.click(within(status()).getByRole('button', { name: en.projects.undo }))

    await waitFor(() => expect(activeNames()).toEqual(['Biology', 'Chemistry', 'Anatomy']))
    expect(state.stateChanges).toEqual(['archive chem', 'restore chem'])
    expect(archivedToggle()).not.toBeInTheDocument()
    expect(status()).toBeEmptyDOMElement()
  })

  it('the Undo message closes after 6 s, and stays while hovered', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderRoute('/projects/bio')
    await chatLoaded()
    await archiveFromMenu(user, 'Chemistry')
    await waitFor(() => expect(status()).toHaveTextContent('Chemistry archived'))

    fireEvent.mouseEnter(status().firstChild)
    await act(() => vi.advanceTimersByTimeAsync(UNDO_MESSAGE_MS + 500))
    expect(status()).toHaveTextContent('Chemistry archived')

    fireEvent.mouseLeave(status().firstChild)
    await act(() => vi.advanceTimersByTimeAsync(UNDO_MESSAGE_MS + 10))
    expect(status()).toBeEmptyDOMElement()
    // Still archived: closing the message is not an Undo.
    expect(activeNames()).toEqual(['Biology', 'Anatomy'])
  })

  it('a failed archive leaves the row active and shows an error line', async () => {
    const state = setup({
      routes: {
        'POST /api/projects/chem/archive': () => {
          throw { code: 'internal_error', params: {} }
        },
      },
    })
    const user = userEvent.setup()
    renderRoute('/projects/bio')
    await chatLoaded()

    await archiveFromMenu(user, 'Chemistry')

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.internal_error)
    expect(activeNames()).toEqual(['Biology', 'Chemistry', 'Anatomy'])
    expect(archivedToggle()).not.toBeInTheDocument()
    expect(status()).toBeEmptyDOMElement()
    expect(state.projects.find((p) => p.id === 'chem').archived_at).toBeNull()
  })

  it('archiving the open Project keeps it open, read-only, with the Archived banner', async () => {
    setup()
    const user = userEvent.setup()
    const { router } = renderRoute('/projects/bio')
    await chatLoaded()
    expect(screen.queryByTestId('archived-banner')).not.toBeInTheDocument()

    await archiveFromMenu(user, 'Biology')

    const banner = await screen.findByTestId('archived-banner')
    expect(banner).toHaveTextContent(en.project.archivedBanner)
    expect(within(banner).getByRole('button', { name: en.projects.restore })).toBeEnabled()
    expect(router.state.location.pathname).toBe('/projects/bio')
    expect(within(panel()).getByRole('button', { name: en.files.upload })).toBeDisabled()
    expect(within(panel()).getByRole('button', { name: en.files.uploadPhone })).toBeDisabled()
    expect(screen.getByRole('button', { name: en.tools.quiz })).toBeDisabled()
  })

  it('the Sidebar strip shows no archived Projects', async () => {
    setup({
      me: { ...PROFILE, ui_prefs: { sidebar_collapsed: true } },
      projects: [BIOLOGY, { ...CHEMISTRY, archived_at: ARCHIVED }, ANATOMY],
    })
    renderRoute('/projects/bio')
    await chatLoaded()

    const strip = screen.getByRole('navigation')
    await waitFor(() => expect(within(strip).getAllByRole('link')).toHaveLength(2))
    expect(within(strip).queryByRole('link', { name: 'Chemistry' })).not.toBeInTheDocument()
    expect(archivedToggle()).not.toBeInTheDocument()
  })

  it('login no longer lands on an archived last Project', async () => {
    const state = setup({ me: { ...PROFILE, last_project_id: 'bio' } })
    const user = userEvent.setup()
    const { router } = renderRoute('/projects')
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/bio'))
    await chatLoaded()

    await archiveFromMenu(user, 'Biology')
    await screen.findByTestId('archived-banner')
    // The SPA drops it locally, as the server's /api/me does: /projects now opens the newest active one.
    await act(() => router.navigate('/projects'))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/chem'))
    expect(state.stateChanges).toEqual(['archive bio'])
  })
})

describe('Archived group', () => {
  it('is absent when nothing is archived', async () => {
    setup()
    renderRoute('/projects/bio')
    await chatLoaded()

    expect(archivedToggle()).not.toBeInTheDocument()
  })

  it('is collapsed by default and expands to rows that open the Project read-only', async () => {
    setup({ projects: [BIOLOGY, { ...CHEMISTRY, archived_at: ARCHIVED }, ANATOMY] })
    const user = userEvent.setup()
    const { router } = renderRoute('/projects/bio')
    await chatLoaded()

    const toggle = await findArchivedToggle()
    expect(toggle).toHaveTextContent('Archived (1)')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('archived-projects')).not.toBeInTheDocument()

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const row = within(screen.getByTestId('archived-projects')).getByRole('link', { name: 'Chemistry' })
    await user.click(row)
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/chem'))
    expect(await screen.findByTestId('archived-banner')).toBeInTheDocument()
    expect(within(panel()).getByRole('button', { name: en.files.upload })).toBeDisabled()
  })

  it('"Restore" in an archived row\'s menu returns it to the active list', async () => {
    const state = setup({ projects: [BIOLOGY, { ...CHEMISTRY, archived_at: ARCHIVED }, ANATOMY] })
    const user = userEvent.setup()
    renderRoute('/projects/bio')
    await chatLoaded()
    await user.click(await findArchivedToggle())

    const menu = await openMenu(user, 'Chemistry')
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([en.projects.restore])
    await user.click(within(menu).getByRole('menuitem', { name: en.projects.restore }))

    await waitFor(() => expect(activeNames()).toEqual(['Biology', 'Chemistry', 'Anatomy']))
    expect(state.stateChanges).toEqual(['restore chem'])
    expect(archivedToggle()).not.toBeInTheDocument()
    // Restore shows no Undo message.
    expect(screen.queryByRole('button', { name: en.projects.undo })).not.toBeInTheDocument()
  })
})

describe('Archived banner', () => {
  it('Restore re-enables uploads and tools, and the Mistakes card returns', async () => {
    const state = setup({
      projects: [{ ...BIOLOGY, archived_at: ARCHIVED }, CHEMISTRY],
      mistakes: [mistake('bio', ['notes']), mistake('bio', ['notes']), mistake('bio', ['notes'])],
    })
    const user = userEvent.setup()
    renderRoute('/projects/bio')

    const banner = await screen.findByTestId('archived-banner')
    await waitFor(() => expect(callsTo('/api/projects/bio/mistakes/summary').length).toBeGreaterThan(0))
    expect(screen.queryByTestId('mistakes-card')).not.toBeInTheDocument()
    expect(within(panel()).getByRole('button', { name: en.files.upload })).toBeDisabled()

    await user.click(within(banner).getByRole('button', { name: en.projects.restore }))

    await waitFor(() => expect(screen.queryByTestId('archived-banner')).not.toBeInTheDocument())
    expect(state.stateChanges).toEqual(['restore bio'])
    expect(await screen.findByTestId('mistakes-card')).toHaveTextContent('3 mistakes to review')
    expect(within(panel()).getByRole('button', { name: en.files.upload })).toBeEnabled()
    expect(within(panel()).getByRole('button', { name: en.files.uploadPhone })).toBeEnabled()
    expect(screen.getByRole('button', { name: en.tools.quiz })).toBeEnabled()
    expect(activeNames()).toEqual(['Biology', 'Chemistry'])
  })
})

const FAIL_RESTORE = {
  routes: {
    'POST /api/projects/chem/restore': () => {
      throw { code: 'internal_error', params: {} }
    },
  },
}

describe('A failed restore', () => {
  it('via Undo: the error line shows and it stays archived', async () => {
    const state = setup(FAIL_RESTORE)
    const user = userEvent.setup()
    renderRoute('/projects/bio')
    await chatLoaded()
    await archiveFromMenu(user, 'Chemistry')
    await waitFor(() => expect(status()).toHaveTextContent('Chemistry archived'))

    await user.click(within(status()).getByRole('button', { name: en.projects.undo }))

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.internal_error)
    expect(activeNames()).toEqual(['Biology', 'Anatomy'])
    expect(archivedToggle()).toHaveTextContent('Archived (1)')
    expect(state.projects.find((p) => p.id === 'chem').archived_at).not.toBeNull()
  })

  it("via the archived row's menu: the error line shows and the row stays in the group", async () => {
    setup({ ...FAIL_RESTORE, projects: [BIOLOGY, { ...CHEMISTRY, archived_at: ARCHIVED }, ANATOMY] })
    const user = userEvent.setup()
    renderRoute('/projects/bio')
    await chatLoaded()
    await user.click(await findArchivedToggle())

    const menu = await openMenu(user, 'Chemistry')
    await user.click(within(menu).getByRole('menuitem', { name: en.projects.restore }))

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.internal_error)
    expect(archivedToggle()).toHaveTextContent('Archived (1)')
    expect(within(screen.getByTestId('archived-projects')).getByRole('link', { name: 'Chemistry' })).toBeInTheDocument()
    expect(activeNames()).toEqual(['Biology', 'Anatomy'])
  })

  it('via the banner: the error line shows, the banner stays, and Restore is no longer busy', async () => {
    setup({ ...FAIL_RESTORE, projects: [BIOLOGY, { ...CHEMISTRY, archived_at: ARCHIVED }] })
    const user = userEvent.setup()
    renderRoute('/projects/chem')
    const banner = await screen.findByTestId('archived-banner')
    const restore = within(banner).getByRole('button', { name: en.projects.restore })

    await user.click(restore)

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.internal_error)
    await waitFor(() => expect(restore).toHaveAttribute('aria-busy', 'false'))
    expect(screen.getByTestId('archived-banner')).toBeInTheDocument()
    expect(within(panel()).getByRole('button', { name: en.files.upload })).toBeDisabled()
  })
})

describe('Focus', () => {
  it('after Archive, focus goes to the first Project link', async () => {
    setup()
    const user = userEvent.setup()
    renderRoute('/projects/bio')
    await chatLoaded()

    await archiveFromMenu(user, 'Chemistry')

    await waitFor(() => expect(within(nav()).getByRole('link', { name: 'Biology' })).toHaveFocus())
  })

  it('after archiving the only active Project, focus goes to "+ New project"', async () => {
    setup({ projects: [BIOLOGY] })
    const user = userEvent.setup()
    renderRoute('/projects/bio')
    await chatLoaded()

    await archiveFromMenu(user, 'Biology')

    await waitFor(() => expect(screen.getByRole('button', { name: en.projects.new })).toHaveFocus())
  })

  it("after Restore, focus goes to the restored Project's link in the active list", async () => {
    setup({ projects: [BIOLOGY, { ...CHEMISTRY, archived_at: ARCHIVED }, ANATOMY] })
    const user = userEvent.setup()
    renderRoute('/projects/chem')
    const banner = await screen.findByTestId('archived-banner')

    await user.click(within(banner).getByRole('button', { name: en.projects.restore }))

    await waitFor(() => expect(within(nav()).getByRole('link', { name: 'Chemistry' })).toHaveFocus())
  })
})

describe('Undo on the open Project', () => {
  it('removes the banner and re-enables uploads', async () => {
    setup()
    const user = userEvent.setup()
    renderRoute('/projects/bio')
    await chatLoaded()
    await archiveFromMenu(user, 'Biology')
    await screen.findByTestId('archived-banner')
    expect(within(panel()).getByRole('button', { name: en.files.upload })).toBeDisabled()

    await user.click(within(status()).getByRole('button', { name: en.projects.undo }))

    await waitFor(() => expect(screen.queryByTestId('archived-banner')).not.toBeInTheDocument())
    expect(within(panel()).getByRole('button', { name: en.files.upload })).toBeEnabled()
    expect(within(panel()).getByRole('button', { name: en.files.uploadPhone })).toBeEnabled()
  })
})

describe('Norwegian', () => {
  it('reads the menu, the Undo message, the group, and the banner in Norwegian', async () => {
    await i18n.changeLanguage('nb')
    setup()
    const user = userEvent.setup()
    renderRoute('/projects/bio')
    await waitFor(() => expect(screen.getByRole('button', { name: nb.tools.quiz })).toBeEnabled())

    const menu = await openMenu(user, 'Biology', nb)
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      nb.projects.rename,
      nb.projects.archive,
    ])
    await user.click(within(menu).getByRole('menuitem', { name: 'Arkiver' }))

    await waitFor(() => expect(status()).toHaveTextContent('Biology er arkivert'))
    expect(within(status()).getByRole('button', { name: 'Angre' })).toBeInTheDocument()
    expect(archivedToggle(nb)).toHaveTextContent('Arkivert (1)')
    const banner = await screen.findByTestId('archived-banner')
    expect(banner).toHaveTextContent('Arkivert')
    expect(within(banner).getByRole('button', { name: 'Gjenopprett' })).toBeInTheDocument()
  })
})
