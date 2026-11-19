// Delete a Project and restore it (Story 7.2a, FR-24, EXPERIENCE.md › Deleted projects). api/client.js
// and auth/ are mocked (spine › Tests); test/fakeApi.js plays the backend.
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { PROFILE, callsTo, fakeApi, material, mistake, project } from '../test/fakeApi.js'
import { i18n, renderRoute } from '../test/render.jsx'
import { daysLeft } from './daysLeft.js'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

const WIDTH = window.innerWidth
const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

beforeEach(() => {
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
  // Wide enough for the Sidebar and the Files panel to start expanded.
  window.innerWidth = 1280
})

afterEach(async () => {
  window.innerWidth = WIDTH
  await i18n.changeLanguage('en')
})

const BIOLOGY = project('bio', { name: 'Biology', name_source: 'student', created_at: '2026-11-18T10:00:00Z' })
const CHEMISTRY = project('chem', { name: 'Chemistry', name_source: 'student', created_at: '2026-11-17T10:00:00Z' })
const ANATOMY = project('ana', { name: 'Anatomy', name_source: 'student', created_at: '2026-11-16T10:00:00Z' })
const ARCHIVED = '2026-11-15T10:00:00Z'
const READY = { bio: [material('notes', { file_name: 'notes.pdf' })], chem: [material('c1')], ana: [material('a1')] }

/** A deleted Project whose purge is `inMs` from now. */
function deletedIn(base, inMs, overrides = {}) {
  const purge = Date.now() + inMs
  return {
    ...base,
    deleted_at: new Date(purge - 30 * DAY).toISOString(),
    purge_at: new Date(purge).toISOString(),
    ...overrides,
  }
}

const nav = () => screen.getByRole('navigation')
const activeNames = () => within(nav()).getAllByRole('link').map((link) => link.textContent)
const groupToggle = (label) =>
  screen.queryByRole('button', { name: new RegExp(`^${label.replace('({{count}})', '\\(\\d+\\)')}$`) })
const deletedToggle = (lang = en) => groupToggle(lang.projects.deletedGroup)
const archivedToggle = (lang = en) => groupToggle(lang.projects.archivedGroup)
async function findDeletedToggle(lang = en) {
  return waitFor(() => {
    const found = deletedToggle(lang)
    expect(found).toBeInTheDocument()
    return found
  })
}
const deletedRows = () => within(screen.getByTestId('deleted-projects')).getAllByRole('listitem')
const panel = () => screen.getByRole('complementary', { name: /^(Files|Filer) · / })
const moreName = (name, lang = en) => lang.projects.more.replace('{{name}}', name)

function setup(options = {}) {
  return fakeApi({ projects: [BIOLOGY, CHEMISTRY, ANATOMY], materials: READY, ...options })
}

async function openMenu(user, name, lang = en) {
  await user.click(await screen.findByRole('button', { name: moreName(name, lang) }))
  return screen.findByRole('menu')
}

async function openDeleteDialog(user, name, lang = en) {
  const menu = await openMenu(user, name, lang)
  await user.click(within(menu).getByRole('menuitem', { name: lang.projects.delete }))
  return screen.findByRole('dialog')
}

async function deleteFromMenu(user, name, lang = en) {
  const dialog = await openDeleteDialog(user, name, lang)
  await user.click(within(dialog).getByRole('button', { name: lang.projects.deleteDialog.confirm }))
}

async function chatLoaded(lang = en) {
  await waitFor(() => expect(screen.getByRole('button', { name: lang.tools.quiz })).toBeEnabled())
}

describe('Delete project dialog', () => {
  it('names the Project, says it is kept 30 days, and starts on Cancel', async () => {
    setup()
    const user = userEvent.setup()
    renderRoute('/projects/bio')
    await chatLoaded()

    const menu = await openMenu(user, 'Chemistry')
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      en.projects.rename,
      en.projects.archive,
      en.projects.delete,
    ])
    await user.click(within(menu).getByRole('menuitem', { name: en.projects.delete }))

    const dialog = await screen.findByRole('dialog', { name: 'Delete Chemistry?' })
    expect(dialog).toHaveTextContent(
      'Chemistry moves to Deleted projects and is permanently deleted after 30 days. You can restore it until then.',
    )
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    // A soft delete: Button (primary), and nothing to type.
    expect(within(dialog).getByRole('button', { name: 'Delete project' }).className).toMatch(/primary/)
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('confirming moves the row into "Deleted projects (1)" with "Deleted · 30 days left"', async () => {
    const state = setup()
    const user = userEvent.setup()
    const { router } = renderRoute('/projects/bio')
    await chatLoaded()

    await deleteFromMenu(user, 'Chemistry')

    await waitFor(() => expect(activeNames()).toEqual(['Biology', 'Anatomy']))
    expect(state.stateChanges).toEqual(['delete chem'])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const toggle = await findDeletedToggle()
    expect(toggle).toHaveTextContent('Deleted projects (1)')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(deletedRows()).toHaveLength(1)
    expect(deletedRows()[0]).toHaveTextContent('Chemistry')
    expect(deletedRows()[0]).toHaveTextContent('Deleted · 30 days left')
    // Deleting another Project stays on the current page, with no Undo message.
    expect(router.state.location.pathname).toBe('/projects/bio')
    expect(screen.queryByRole('button', { name: en.projects.undo })).not.toBeInTheDocument()
  })

  it('Cancel changes nothing and gives focus back to "···"', async () => {
    const state = setup()
    const user = userEvent.setup()
    renderRoute('/projects/bio')
    await chatLoaded()

    const dialog = await openDeleteDialog(user, 'Chemistry')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(state.stateChanges).toEqual([])
    expect(activeNames()).toEqual(['Biology', 'Chemistry', 'Anatomy'])
    expect(deletedToggle()).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: moreName('Chemistry') })).toHaveFocus())
  })

  it('Esc changes nothing and gives focus back to "···"', async () => {
    const state = setup()
    const user = userEvent.setup()
    renderRoute('/projects/bio')
    await chatLoaded()

    await openDeleteDialog(user, 'Chemistry')
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(state.stateChanges).toEqual([])
    await waitFor(() => expect(screen.getByRole('button', { name: moreName('Chemistry') })).toHaveFocus())
  })

  it('a failed delete keeps the dialog open with an error line', async () => {
    const state = setup({
      routes: {
        'POST /api/projects/chem/delete': () => {
          throw { code: 'internal_error', params: {} }
        },
      },
    })
    const user = userEvent.setup()
    renderRoute('/projects/bio')
    await chatLoaded()

    await deleteFromMenu(user, 'Chemistry')

    const dialog = screen.getByRole('dialog')
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(en.errors.internal_error)
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Delete project' })).toHaveAttribute('aria-busy', 'false'),
    )
    // The open modal hides the rest of the page from the accessibility tree.
    const sidebar = screen.getByRole('navigation', { hidden: true })
    expect(within(sidebar).getAllByRole('link', { hidden: true }).map((link) => link.textContent)).toEqual([
      'Biology',
      'Chemistry',
      'Anatomy',
    ])
    expect(screen.queryByRole('button', { name: /^Deleted projects/, hidden: true })).not.toBeInTheDocument()
    expect(state.projects.find((p) => p.id === 'chem').deleted_at).toBeNull()
  })

  it('an archived row\'s "Delete project" moves it from Archived into Deleted', async () => {
    setup({ projects: [BIOLOGY, { ...CHEMISTRY, archived_at: ARCHIVED }, ANATOMY] })
    const user = userEvent.setup()
    renderRoute('/projects/bio')
    await chatLoaded()
    await user.click(archivedToggle())

    await deleteFromMenu(user, 'Chemistry')

    await waitFor(() => expect(archivedToggle()).not.toBeInTheDocument())
    expect(await findDeletedToggle()).toHaveTextContent('Deleted projects (1)')
    expect(activeNames()).toEqual(['Biology', 'Anatomy'])
  })
})

describe('Delete after archive', () => {
  it("deleting a just-archived Project clears its Undo message", async () => {
    setup()
    const user = userEvent.setup()
    renderRoute('/projects/bio')
    await chatLoaded()
    const menu = await openMenu(user, 'Chemistry')
    await user.click(within(menu).getByRole('menuitem', { name: en.projects.archive }))
    expect(await screen.findByRole('button', { name: en.projects.undo })).toBeInTheDocument()
    await user.click(archivedToggle())

    await deleteFromMenu(user, 'Chemistry')

    expect(await findDeletedToggle()).toHaveTextContent('Deleted projects (1)')
    expect(screen.queryByRole('button', { name: en.projects.undo })).not.toBeInTheDocument()
  })
})

describe('Landing', () => {
  it('deleting the open Project lands on the most recent other active Project', async () => {
    setup()
    const user = userEvent.setup()
    const { router } = renderRoute('/projects/chem')
    await chatLoaded()

    await deleteFromMenu(user, 'Chemistry')

    // Under parallel load the landing and Biology's home can take longer than the default 1 s.
    const slow = { timeout: 5000 }
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/bio'), slow)
    // Biology's own home has loaded: its Sidebar link is current and its tools are enabled.
    await waitFor(
      () => expect(within(nav()).getByRole('link', { name: 'Biology' })).toHaveAttribute('aria-current', 'page'),
      slow,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: en.tools.quiz })).toBeEnabled(), slow)
    expect(screen.queryByTestId('deleted-banner')).not.toBeInTheDocument()
  })

  it('deleting the last active Project lands on the empty Projects page', async () => {
    setup({ projects: [BIOLOGY, { ...CHEMISTRY, archived_at: ARCHIVED }] })
    const user = userEvent.setup()
    const { router } = renderRoute('/projects/bio')
    await chatLoaded()

    await deleteFromMenu(user, 'Biology')

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'))
    expect(await screen.findByRole('button', { name: en.projects.empty.create })).toBeInTheDocument()
    expect(await findDeletedToggle()).toHaveTextContent('Deleted projects (1)')
  })

  it('login no longer lands on a deleted last Project', async () => {
    const state = setup({ me: { ...PROFILE, last_project_id: 'chem' } })
    const user = userEvent.setup()
    const { router } = renderRoute('/projects')
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/chem'))
    await chatLoaded()

    await deleteFromMenu(user, 'Biology')
    await waitFor(() => expect(state.stateChanges).toEqual(['delete bio']))
    await deleteFromMenu(user, 'Chemistry')
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/ana'))
    await act(() => router.navigate('/projects'))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/ana'))
  })
})

describe('Deleted projects group', () => {
  it('is absent at 0, collapsed by default, and absent from the strip', async () => {
    setup({
      me: { ...PROFILE, ui_prefs: { sidebar_collapsed: true } },
      projects: [BIOLOGY, deletedIn(CHEMISTRY, 10 * DAY), ANATOMY],
    })
    renderRoute('/projects/bio')
    await chatLoaded()

    const strip = screen.getByRole('navigation')
    await waitFor(() => expect(within(strip).getAllByRole('link')).toHaveLength(2))
    expect(within(strip).queryByRole('link', { name: 'Chemistry' })).not.toBeInTheDocument()
    expect(deletedToggle()).not.toBeInTheDocument()
  })

  it('is absent when nothing is deleted', async () => {
    setup()
    renderRoute('/projects/bio')
    await chatLoaded()

    expect(deletedToggle()).not.toBeInTheDocument()
  })

  it('sits below the Archived group', async () => {
    setup({
      projects: [BIOLOGY, { ...CHEMISTRY, archived_at: ARCHIVED }, deletedIn(ANATOMY, 10 * DAY)],
    })
    renderRoute('/projects/bio')
    await chatLoaded()

    const deleted = await findDeletedToggle()
    const archived = archivedToggle()
    expect(archived.compareDocumentPosition(deleted) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows the days left: 29 d 2 h is "30 days left", 0 d 3 h is "1 day left"', async () => {
    setup({
      projects: [BIOLOGY, deletedIn(CHEMISTRY, 29 * DAY + 2 * HOUR), deletedIn(ANATOMY, 3 * HOUR)],
    })
    const user = userEvent.setup()
    renderRoute('/projects/bio')
    await chatLoaded()

    await user.click(await findDeletedToggle())

    const [chem, ana] = deletedRows()
    expect(chem).toHaveTextContent('Chemistry')
    expect(chem).toHaveTextContent('Deleted · 30 days left')
    expect(ana).toHaveTextContent('Deleted · 1 day left')
  })

  it('a deleted row opens read-only with the Deleted banner and no Mistakes card', async () => {
    setup({
      projects: [BIOLOGY, deletedIn(CHEMISTRY, 12 * DAY + HOUR)],
      mistakes: [mistake('chem', ['c1'])],
    })
    const user = userEvent.setup()
    const { router } = renderRoute('/projects/bio')
    await chatLoaded()
    await user.click(await findDeletedToggle())

    await user.click(within(screen.getByTestId('deleted-projects')).getByRole('link', { name: /Chemistry/ }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/chem'))
    const banner = await screen.findByTestId('deleted-banner')
    expect(banner).toHaveTextContent('Deleted · 13 days left')
    expect(within(banner).getByRole('button', { name: en.projects.restore })).toBeEnabled()
    expect(screen.queryByTestId('archived-banner')).not.toBeInTheDocument()
    await waitFor(() => expect(callsTo('/api/projects/chem/mistakes/summary').length).toBeGreaterThan(0))
    expect(screen.queryByTestId('mistakes-card')).not.toBeInTheDocument()
    expect(within(panel()).getByRole('button', { name: en.files.upload })).toBeDisabled()
    expect(within(panel()).getByRole('button', { name: en.files.uploadPhone })).toBeDisabled()
    expect(screen.getByRole('button', { name: en.tools.quiz })).toBeDisabled()
  })

  it('"Restore" is the only item in a deleted row\'s menu, and returns it to the active list', async () => {
    const state = setup({ projects: [BIOLOGY, deletedIn(CHEMISTRY, 10 * DAY, { archived_at: ARCHIVED }), ANATOMY] })
    const user = userEvent.setup()
    renderRoute('/projects/bio')
    await chatLoaded()
    await user.click(await findDeletedToggle())

    const menu = await openMenu(user, 'Chemistry')
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([en.projects.restore])
    await user.click(within(menu).getByRole('menuitem', { name: en.projects.restore }))

    await waitFor(() => expect(activeNames()).toEqual(['Biology', 'Chemistry', 'Anatomy']))
    expect(state.stateChanges).toEqual(['restore chem'])
    expect(deletedToggle()).not.toBeInTheDocument()
    // Not back in Archived, though it was archived before.
    expect(archivedToggle()).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.projects.undo })).not.toBeInTheDocument()
  })
})

describe('Deleted banner', () => {
  it('Restore of a Project archived before deletion returns it to the active list with uploads enabled', async () => {
    const state = setup({
      projects: [deletedIn(BIOLOGY, 20 * DAY, { archived_at: ARCHIVED }), CHEMISTRY],
      mistakes: [mistake('bio', ['notes']), mistake('bio', ['notes'])],
    })
    const user = userEvent.setup()
    const { router } = renderRoute('/projects/bio')
    const banner = await screen.findByTestId('deleted-banner')
    expect(screen.queryByTestId('archived-banner')).not.toBeInTheDocument()

    await user.click(within(banner).getByRole('button', { name: en.projects.restore }))

    await waitFor(() => expect(screen.queryByTestId('deleted-banner')).not.toBeInTheDocument())
    expect(screen.queryByTestId('archived-banner')).not.toBeInTheDocument()
    expect(state.stateChanges).toEqual(['restore bio'])
    expect(router.state.location.pathname).toBe('/projects/bio')
    expect(activeNames()).toEqual(['Biology', 'Chemistry'])
    expect(archivedToggle()).not.toBeInTheDocument()
    expect(deletedToggle()).not.toBeInTheDocument()
    expect(await screen.findByTestId('mistakes-card')).toHaveTextContent('2 mistakes to review')
    expect(within(panel()).getByRole('button', { name: en.files.upload })).toBeEnabled()
    expect(within(panel()).getByRole('button', { name: en.files.uploadPhone })).toBeEnabled()
    expect(screen.queryByRole('button', { name: en.projects.undo })).not.toBeInTheDocument()
  })

  it('a failed restore shows the error line and the Project stays deleted', async () => {
    setup({
      projects: [BIOLOGY, deletedIn(CHEMISTRY, 20 * DAY)],
      routes: {
        'POST /api/projects/chem/restore': () => {
          throw { code: 'internal_error', params: {} }
        },
      },
    })
    const user = userEvent.setup()
    renderRoute('/projects/chem')
    const banner = await screen.findByTestId('deleted-banner')
    const restore = within(banner).getByRole('button', { name: en.projects.restore })

    await user.click(restore)

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.internal_error)
    await waitFor(() => expect(restore).toHaveAttribute('aria-busy', 'false'))
    expect(screen.getByTestId('deleted-banner')).toBeInTheDocument()
    expect(within(panel()).getByRole('button', { name: en.files.upload })).toBeDisabled()
    expect(deletedToggle()).toHaveTextContent('Deleted projects (1)')
  })
})

describe('Focus', () => {
  it('after Delete, focus goes to the first Project link', async () => {
    setup()
    const user = userEvent.setup()
    renderRoute('/projects/bio')
    await chatLoaded()

    await deleteFromMenu(user, 'Chemistry')

    await waitFor(() => expect(within(nav()).getByRole('link', { name: 'Biology' })).toHaveFocus())
  })

  it('after deleting the only active Project, focus goes to "+ New project"', async () => {
    setup({ projects: [BIOLOGY] })
    const user = userEvent.setup()
    renderRoute('/projects/bio')
    await chatLoaded()

    await deleteFromMenu(user, 'Biology')

    await waitFor(() => expect(screen.getByRole('button', { name: en.projects.new })).toHaveFocus())
  })

  it("after Restore, focus goes to the restored Project's link in the active list", async () => {
    setup({ projects: [BIOLOGY, deletedIn(CHEMISTRY, 5 * DAY), ANATOMY] })
    const user = userEvent.setup()
    renderRoute('/projects/chem')
    const banner = await screen.findByTestId('deleted-banner')

    await user.click(within(banner).getByRole('button', { name: en.projects.restore }))

    await waitFor(() => expect(within(nav()).getByRole('link', { name: 'Chemistry' })).toHaveFocus())
  })
})

describe('Norwegian', () => {
  it('reads the menu, the dialog, the group, the days left, and the banner in Norwegian', async () => {
    await i18n.changeLanguage('nb')
    setup({ projects: [BIOLOGY, CHEMISTRY, deletedIn(ANATOMY, 3 * HOUR)] })
    const user = userEvent.setup()
    const { router } = renderRoute('/projects/bio')
    await chatLoaded(nb)

    const menu = await openMenu(user, 'Chemistry', nb)
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Gi nytt navn',
      'Arkiver',
      'Slett prosjekt',
    ])
    await user.click(within(menu).getByRole('menuitem', { name: 'Slett prosjekt' }))
    const dialog = await screen.findByRole('dialog', { name: 'Vil du slette Chemistry?' })
    expect(dialog).toHaveTextContent(
      'Chemistry flyttes til Slettede prosjekter og slettes for godt etter 30 dager. Du kan gjenopprette det frem til da.',
    )
    expect(within(dialog).getByRole('button', { name: 'Avbryt' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Slett prosjekt' }))

    const toggle = await findDeletedToggle(nb)
    await waitFor(() => expect(toggle).toHaveTextContent('Slettede prosjekter (2)'))
    await user.click(toggle)
    const [chem, ana] = deletedRows()
    expect(chem).toHaveTextContent('Slettet · 30 dager igjen')
    expect(ana).toHaveTextContent('Slettet · 1 dag igjen')

    await act(() => router.navigate('/projects/ana'))
    const banner = await screen.findByTestId('deleted-banner')
    expect(banner).toHaveTextContent('Slettet · 1 dag igjen')
    expect(within(banner).getByRole('button', { name: 'Gjenopprett' })).toBeInTheDocument()
  })
})

describe('daysLeft', () => {
  const now = Date.parse('2026-11-19T12:00:00Z')

  it('rounds up to whole days and is at least 1', () => {
    expect(daysLeft({ purge_at: new Date(now + 29 * DAY + 2 * HOUR).toISOString() }, now)).toBe(30)
    expect(daysLeft({ purge_at: new Date(now + 3 * HOUR).toISOString() }, now)).toBe(1)
    expect(daysLeft({ purge_at: new Date(now + 30 * DAY).toISOString() }, now)).toBe(30)
    expect(daysLeft({ purge_at: new Date(now - HOUR).toISOString() }, now)).toBe(1)
  })

  it('works it out from deleted_at when purge_at is missing', () => {
    expect(daysLeft({ deleted_at: new Date(now - 2 * DAY).toISOString(), purge_at: null }, now)).toBe(28)
  })
})
