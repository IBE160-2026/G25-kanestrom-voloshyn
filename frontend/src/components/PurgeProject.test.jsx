// Delete a Project forever (Story 7.2b, FR-24, EXPERIENCE.md › Deleted projects). api/client.js and
// auth/ are mocked (spine › Tests); test/fakeApi.js plays the backend.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { fakeApi, material, project } from '../test/fakeApi.js'
import { i18n, renderRoute } from '../test/render.jsx'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

const WIDTH = window.innerWidth
const DAY = 24 * 60 * 60 * 1000

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
const READY = { bio: [material('notes', { file_name: 'notes.pdf' })], chem: [material('c1')], ana: [material('a1')] }

/** The Project, deleted with `days` left before its purge. */
function deleted(base, days = 10) {
  const purge = Date.now() + days * DAY
  return { ...base, deleted_at: new Date(purge - 30 * DAY).toISOString(), purge_at: new Date(purge).toISOString() }
}

const nav = () => screen.getByRole('navigation')
const activeNames = () => within(nav()).getAllByRole('link').map((link) => link.textContent)
const deletedToggle = (lang = en) =>
  screen.queryByRole('button', { name: new RegExp(`^${lang.projects.deletedGroup.replace('({{count}})', '\\(\\d+\\)')}$`) })
const deletedRows = () => within(screen.getByTestId('deleted-projects')).getAllByRole('listitem')
const moreName = (name, lang = en) => lang.projects.more.replace('{{name}}', name)
const titleOf = (name, lang = en) => lang.projects.purgeDialog.title.replace('{{name}}', name)

async function chatLoaded(lang = en) {
  await waitFor(() => expect(screen.getByRole('button', { name: lang.tools.quiz })).toBeEnabled())
}

async function openDeletedGroup(user, lang = en) {
  const toggle = await waitFor(() => {
    const found = deletedToggle(lang)
    expect(found).toBeInTheDocument()
    return found
  })
  if (toggle.getAttribute('aria-expanded') === 'false') await user.click(toggle)
}

async function openPurgeFromMenu(user, name, lang = en) {
  await openDeletedGroup(user, lang)
  await user.click(await screen.findByRole('button', { name: moreName(name, lang) }))
  const menu = await screen.findByRole('menu')
  await user.click(within(menu).getByRole('menuitem', { name: lang.projects.purge }))
  return screen.findByRole('dialog', { name: titleOf(name, lang) })
}

async function openPurgeFromBanner(user, lang = en) {
  const banner = await screen.findByTestId('deleted-banner')
  await user.click(within(banner).getByRole('button', { name: lang.projects.purge }))
  return screen.findByRole('dialog')
}

const confirm = (user, dialog, lang = en) =>
  user.click(within(dialog).getByRole('button', { name: lang.projects.purgeDialog.confirm }))

describe('Delete forever dialog', () => {
  it('names the Project and what is lost, starts on Cancel, and has Button (danger) with no typing', async () => {
    fakeApi({ projects: [BIOLOGY, deleted(CHEMISTRY)], materials: READY })
    const user = userEvent.setup()
    renderRoute('/projects/bio')
    await chatLoaded()
    await openDeletedGroup(user)

    await user.click(await screen.findByRole('button', { name: moreName('Chemistry') }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Restore',
      'Delete forever',
    ])
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete forever' }))

    const dialog = await screen.findByRole('dialog', { name: 'Delete Chemistry forever?' })
    const lost = within(dialog).getByText('Its files, mistakes, and generated material are deleted.')
    expect(lost.className).toMatch(/losses/)
    expect(within(dialog).getByText("This can't be undone.").className).toMatch(/final/)
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(within(dialog).getByRole('button', { name: 'Delete forever' }).className).toMatch(/danger/)
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument()
  })
})

describe('From the Sidebar menu', () => {
  it('confirming removes the row, the group disappears at 0, and the page stays', async () => {
    const state = fakeApi({ projects: [BIOLOGY, deleted(CHEMISTRY)], materials: READY })
    const user = userEvent.setup()
    const { router } = renderRoute('/projects/bio')
    await chatLoaded()

    await confirm(user, await openPurgeFromMenu(user, 'Chemistry'))

    await waitFor(() => expect(deletedToggle()).not.toBeInTheDocument())
    expect(state.stateChanges).toEqual(['purge chem'])
    expect(state.projects.map((p) => p.id)).toEqual(['bio'])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/projects/bio')
    expect(activeNames()).toEqual(['Biology'])
  })

  it('with two deleted, the row leaves and the group counts one', async () => {
    fakeApi({ projects: [BIOLOGY, deleted(CHEMISTRY), deleted(ANATOMY, 5)], materials: READY })
    const user = userEvent.setup()
    renderRoute('/projects/bio')
    await chatLoaded()

    await confirm(user, await openPurgeFromMenu(user, 'Chemistry'))

    await waitFor(() => expect(deletedToggle()).toHaveTextContent('Deleted projects (1)'))
    expect(deletedRows()).toHaveLength(1)
    expect(deletedRows()[0]).toHaveTextContent('Anatomy')
  })

  it('Cancel changes nothing and gives focus back to "···"', async () => {
    const state = fakeApi({ projects: [BIOLOGY, deleted(CHEMISTRY)], materials: READY })
    const user = userEvent.setup()
    renderRoute('/projects/bio')
    await chatLoaded()

    const dialog = await openPurgeFromMenu(user, 'Chemistry')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(state.stateChanges).toEqual([])
    expect(deletedRows()).toHaveLength(1)
    await waitFor(() => expect(screen.getByRole('button', { name: moreName('Chemistry') })).toHaveFocus())
  })

  it('Esc changes nothing and gives focus back to "···"', async () => {
    const state = fakeApi({ projects: [BIOLOGY, deleted(CHEMISTRY)], materials: READY })
    const user = userEvent.setup()
    renderRoute('/projects/bio')
    await chatLoaded()

    await openPurgeFromMenu(user, 'Chemistry')
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(state.stateChanges).toEqual([])
    await waitFor(() => expect(screen.getByRole('button', { name: moreName('Chemistry') })).toHaveFocus())
  })

  it('a failed request keeps the dialog open with an error line, and the row stays', async () => {
    const state = fakeApi({
      projects: [BIOLOGY, deleted(CHEMISTRY)],
      materials: READY,
      routes: {
        'POST /api/projects/chem/purge': () => {
          throw { code: 'internal_error', params: {} }
        },
      },
    })
    const user = userEvent.setup()
    renderRoute('/projects/bio')
    await chatLoaded()

    const dialog = await openPurgeFromMenu(user, 'Chemistry')
    await confirm(user, dialog)

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(en.errors.internal_error)
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Delete forever' })).toHaveAttribute('aria-busy', 'false'),
    )
    expect(state.projects.some((p) => p.id === 'chem')).toBe(true)
  })

  it('a "not_found" answer (purged meanwhile) counts as done: the row leaves and the dialog closes', async () => {
    fakeApi({
      projects: [BIOLOGY, deleted(CHEMISTRY)],
      materials: READY,
      routes: {
        'POST /api/projects/chem/purge': () => {
          throw { code: 'not_found', params: {} }
        },
      },
    })
    const user = userEvent.setup()
    const { router } = renderRoute('/projects/bio')
    await chatLoaded()

    await confirm(user, await openPurgeFromMenu(user, 'Chemistry'))

    await waitFor(() => expect(deletedToggle()).not.toBeInTheDocument())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/projects/bio')
  })

  it('a "project_not_deleted" answer shows its own error text', async () => {
    fakeApi({
      projects: [BIOLOGY, deleted(CHEMISTRY)],
      materials: READY,
      routes: {
        'POST /api/projects/chem/purge': () => {
          throw { code: 'project_not_deleted', params: {} }
        },
      },
    })
    const user = userEvent.setup()
    renderRoute('/projects/bio')
    await chatLoaded()

    const dialog = await openPurgeFromMenu(user, 'Chemistry')
    await confirm(user, dialog)

    expect(await within(dialog).findByRole('alert')).toHaveTextContent("This project isn't in Deleted projects.")
  })

  it('after the purge, focus goes to the first Project link', async () => {
    fakeApi({ projects: [BIOLOGY, deleted(CHEMISTRY)], materials: READY })
    const user = userEvent.setup()
    renderRoute('/projects/bio')
    await chatLoaded()

    await confirm(user, await openPurgeFromMenu(user, 'Chemistry'))

    await waitFor(() => expect(within(nav()).getByRole('link', { name: 'Biology' })).toHaveFocus())
  })
})

describe('From the Deleted banner', () => {
  it('shows Restore and "Delete forever"; confirming lands on the newest active Project', async () => {
    const state = fakeApi({ projects: [BIOLOGY, deleted(CHEMISTRY), ANATOMY], materials: READY })
    const user = userEvent.setup()
    const { router } = renderRoute('/projects/chem')
    const banner = await screen.findByTestId('deleted-banner')
    expect(within(banner).getAllByRole('button').map((b) => b.textContent)).toEqual(['Restore', 'Delete forever'])

    const dialog = await openPurgeFromBanner(user)
    expect(dialog).toHaveAccessibleName('Delete Chemistry forever?')
    await confirm(user, dialog)

    const slow = { timeout: 5000 }
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/bio'), slow)
    await waitFor(
      () => expect(within(nav()).getByRole('link', { name: 'Biology' })).toHaveAttribute('aria-current', 'page'),
      slow,
    )
    expect(state.stateChanges).toEqual(['purge chem'])
    expect(deletedToggle()).not.toBeInTheDocument()
    expect(screen.queryByTestId('deleted-banner')).not.toBeInTheDocument()
  })

  it('a "not_found" answer from the banner lands as on success', async () => {
    fakeApi({
      projects: [BIOLOGY, deleted(CHEMISTRY)],
      materials: READY,
      routes: {
        'POST /api/projects/chem/purge': () => {
          throw { code: 'not_found', params: {} }
        },
      },
    })
    const user = userEvent.setup()
    const { router } = renderRoute('/projects/chem')

    await confirm(user, await openPurgeFromBanner(user))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/bio'), { timeout: 5000 })
    expect(deletedToggle()).not.toBeInTheDocument()
  })

  it('"Delete forever" is disabled while Restore is in flight', async () => {
    let finish
    fakeApi({
      projects: [BIOLOGY, deleted(CHEMISTRY)],
      materials: READY,
      routes: {
        'POST /api/projects/chem/restore': () =>
          new Promise((resolve) => {
            finish = () => resolve({ ...CHEMISTRY })
          }),
      },
    })
    const user = userEvent.setup()
    renderRoute('/projects/chem')
    const banner = await screen.findByTestId('deleted-banner')

    await user.click(within(banner).getByRole('button', { name: 'Restore' }))

    await waitFor(() => expect(within(banner).getByRole('button', { name: 'Delete forever' })).toBeDisabled())
    finish()
    await waitFor(() => expect(screen.queryByTestId('deleted-banner')).not.toBeInTheDocument())
  })

  it('with no active Project left, lands on the empty Projects page', async () => {
    fakeApi({ projects: [deleted(CHEMISTRY)], materials: READY })
    const user = userEvent.setup()
    const { router } = renderRoute('/projects/chem')

    await confirm(user, await openPurgeFromBanner(user))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'))
    expect(await screen.findByRole('button', { name: en.projects.empty.create })).toBeInTheDocument()
    expect(deletedToggle()).not.toBeInTheDocument()
  })

  it('Cancel changes nothing and gives focus back to "Delete forever"', async () => {
    const state = fakeApi({ projects: [BIOLOGY, deleted(CHEMISTRY)], materials: READY })
    const user = userEvent.setup()
    const { router } = renderRoute('/projects/chem')

    const dialog = await openPurgeFromBanner(user)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(state.stateChanges).toEqual([])
    expect(router.state.location.pathname).toBe('/projects/chem')
    const banner = screen.getByTestId('deleted-banner')
    await waitFor(() => expect(within(banner).getByRole('button', { name: 'Delete forever' })).toHaveFocus())
  })

  it('is absent from the Archived banner', async () => {
    fakeApi({ projects: [BIOLOGY, { ...CHEMISTRY, archived_at: '2026-11-15T10:00:00Z' }], materials: READY })
    renderRoute('/projects/chem')

    const banner = await screen.findByTestId('archived-banner')
    expect(within(banner).queryByRole('button', { name: 'Delete forever' })).not.toBeInTheDocument()
  })
})

describe('Norwegian', () => {
  it('reads the menu, the banner, the dialog, and the error in Norwegian', async () => {
    await i18n.changeLanguage('nb')
    fakeApi({
      projects: [BIOLOGY, deleted(CHEMISTRY)],
      materials: READY,
      routes: {
        'POST /api/projects/chem/purge': () => {
          throw { code: 'project_not_deleted', params: {} }
        },
      },
    })
    const user = userEvent.setup()
    renderRoute('/projects/chem')

    const banner = await screen.findByTestId('deleted-banner')
    expect(within(banner).getAllByRole('button').map((b) => b.textContent)).toEqual(['Gjenopprett', 'Slett for godt'])
    await openDeletedGroup(user, nb)
    await user.click(await screen.findByRole('button', { name: moreName('Chemistry', nb) }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Gjenopprett',
      'Slett for godt',
    ])
    await user.click(within(menu).getByRole('menuitem', { name: 'Slett for godt' }))

    const dialog = await screen.findByRole('dialog', { name: 'Vil du slette Chemistry for godt?' })
    expect(within(dialog).getByText('Filene, feilene og det genererte innholdet slettes.')).toBeInTheDocument()
    expect(within(dialog).getByText('Dette kan ikke angres.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Avbryt' })).toHaveFocus()
    await confirm(user, dialog, nb)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Prosjektet ligger ikke i Slettede prosjekter.')
  })
})
