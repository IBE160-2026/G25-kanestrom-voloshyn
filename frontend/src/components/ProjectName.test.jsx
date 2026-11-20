// Inline rename in the Top bar and the Sidebar row (Story 2.1, FR-5): Enter saves, Esc cancels with
// no request, a blank name shows invalid_name under the field. api/client.js and auth/ are mocked.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { callsTo, fakeApi, project } from '../test/fakeApi.js'
import { i18n, renderRoute } from '../test/render.jsx'
import ProjectName from './ProjectName.jsx'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

beforeEach(() => {
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
})

function sidebarLinks() {
  return within(screen.getByRole('navigation')).getAllByRole('link')
}

async function openTitle() {
  return screen.findByRole('button', { name: en.projects.placeholder, description: en.projects.rename })
}

describe('Top bar rename', () => {
  it('shows "New project" for an unnamed Project; Enter saves the trimmed name everywhere', async () => {
    fakeApi({ projects: [project('a')] })
    const user = userEvent.setup()
    renderRoute('/projects/a')

    const title = await openTitle()
    expect(screen.getByRole('heading', { level: 1, name: en.projects.placeholder })).toBeInTheDocument()
    await user.click(title)
    const field = screen.getByRole('textbox', { name: en.projects.rename })
    expect(field).toHaveFocus()
    expect(field).toHaveValue('')

    await user.type(field, '  Biology 101  {Enter}')

    expect(await screen.findByRole('heading', { level: 1, name: 'Biology 101' })).toBeInTheDocument()
    expect(sidebarLinks()[0]).toHaveTextContent('Biology 101')
    expect(callsTo('/api/projects/a', 'PATCH')).toEqual([
      ['/api/projects/a', { method: 'PATCH', body: { name: '  Biology 101  ' } }],
    ])
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('Esc restores the old name and sends no request', async () => {
    fakeApi({ projects: [project('a', { name: 'Biology', name_source: 'student' })] })
    const user = userEvent.setup()
    renderRoute('/projects/a')

    await user.click(await screen.findByRole('button', { name: 'Biology', description: en.projects.rename }))
    const field = screen.getByRole('textbox', { name: en.projects.rename })
    expect(field).toHaveValue('Biology')
    await user.clear(field)
    await user.type(field, 'Chemistry{Escape}')

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Biology' })).toBeInTheDocument()
    expect(sidebarLinks()[0]).toHaveTextContent('Biology')
    expect(callsTo('/api/projects/a', 'PATCH')).toEqual([])
  })

  it('a blank name shows the error under the field and keeps the old name', async () => {
    fakeApi({ projects: [project('a', { name: 'Biology', name_source: 'student' })] })
    const user = userEvent.setup()
    renderRoute('/projects/a')

    await user.click(await screen.findByRole('button', { name: 'Biology', description: en.projects.rename }))
    const field = screen.getByRole('textbox', { name: en.projects.rename })
    await user.clear(field)
    await user.type(field, '   {Enter}')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(en.errors.invalid_name)
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveFocus()
    expect(sidebarLinks()[0]).toHaveTextContent('Biology')

    // Esc after the error still restores the old name.
    await user.keyboard('{Escape}')
    expect(screen.getByRole('heading', { level: 1, name: 'Biology' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('the error is in the active language', async () => {
    await i18n.changeLanguage('nb')
    fakeApi({ projects: [project('a', { name: 'Biologi', name_source: 'student' })] })
    const user = userEvent.setup()
    renderRoute('/projects/a')

    await user.click(await screen.findByRole('button', { name: 'Biologi', description: nb.projects.rename }))
    const field = screen.getByRole('textbox', { name: nb.projects.rename })
    await user.clear(field)
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent(nb.errors.invalid_name)
  })

  it('a long name is saved as the server returns it (cut to 100)', async () => {
    fakeApi({ projects: [project('a')] })
    const user = userEvent.setup()
    renderRoute('/projects/a')

    await user.click(await openTitle())
    const long = 'x'.repeat(150)
    await user.type(screen.getByRole('textbox', { name: en.projects.rename }), `${long}{Enter}`)

    expect(await screen.findByRole('heading', { level: 1, name: 'x'.repeat(100) })).toBeInTheDocument()
  })

  it('a read-only Project shows its name with no rename', async () => {
    fakeApi({ projects: [project('a', { name: 'Old course', name_source: 'student', archived_at: '2026-11-10T00:00:00Z' })] })
    renderRoute('/projects/a')

    expect(await screen.findByRole('heading', { level: 1, name: 'Old course' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Old course' })).not.toBeInTheDocument()
  })

  it('a project_read_only refusal shows its message', async () => {
    fakeApi({
      projects: [project('a', { name: 'Biology', name_source: 'student' })],
      routes: {
        'PATCH /api/projects/a': async () => {
          throw { code: 'project_read_only', params: {} }
        },
      },
    })
    const user = userEvent.setup()
    renderRoute('/projects/a')

    await user.click(await screen.findByRole('button', { name: 'Biology', description: en.projects.rename }))
    await user.type(screen.getByRole('textbox', { name: en.projects.rename }), ' 2{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.project_read_only)
  })
})

describe('Top bar rename: keyboard and edge cases', () => {
  it('after Enter, focus returns to the title button', async () => {
    fakeApi({ projects: [project('a', { name: 'Biology', name_source: 'student' })] })
    const user = userEvent.setup()
    renderRoute('/projects/a')

    await user.click(await screen.findByRole('button', { name: 'Biology', description: en.projects.rename }))
    await user.type(screen.getByRole('textbox', { name: en.projects.rename }), ' 101{Enter}')

    const title = await screen.findByRole('button', { name: 'Biology 101', description: en.projects.rename })
    await waitFor(() => expect(title).toHaveFocus())
  })

  it('after Esc, focus returns to the title button', async () => {
    fakeApi({ projects: [project('a', { name: 'Biology', name_source: 'student' })] })
    const user = userEvent.setup()
    renderRoute('/projects/a')

    await user.click(await screen.findByRole('button', { name: 'Biology', description: en.projects.rename }))
    await user.keyboard('{Escape}')

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Biology', description: en.projects.rename })).toHaveFocus(),
    )
  })

  it('Enter on the untouched placeholder closes the field with no request and no error', async () => {
    fakeApi({ projects: [project('a')] })
    const user = userEvent.setup()
    renderRoute('/projects/a')

    await user.click(await openTitle())
    await user.keyboard('{Enter}')

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(callsTo('/api/projects/a', 'PATCH')).toEqual([])
  })

  it('Enter with the same name (spaces around it) sends nothing', async () => {
    fakeApi({ projects: [project('a', { name: 'Biology', name_source: 'student' })] })
    const user = userEvent.setup()
    renderRoute('/projects/a')

    await user.click(await screen.findByRole('button', { name: 'Biology', description: en.projects.rename }))
    const field = screen.getByRole('textbox', { name: en.projects.rename })
    await user.clear(field)
    await user.type(field, ' Biology {Enter}')

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(callsTo('/api/projects/a', 'PATCH')).toEqual([])
  })

  it('Esc while a save is pending does not cancel it; the rename applies', async () => {
    let release
    fakeApi({
      projects: [project('a', { name: 'Biology', name_source: 'student' })],
      routes: {
        'PATCH /api/projects/a': (body, state) =>
          new Promise((resolve) => {
            release = () => resolve({ ...state.projects[0], name: body.name.trim(), name_source: 'student' })
          }),
      },
    })
    const user = userEvent.setup()
    renderRoute('/projects/a')

    await user.click(await screen.findByRole('button', { name: 'Biology', description: en.projects.rename }))
    await user.type(screen.getByRole('textbox', { name: en.projects.rename }), ' 101{Enter}')
    await waitFor(() => expect(release).toBeTypeOf('function'))
    await user.keyboard('{Escape}')
    expect(screen.getByRole('textbox', { name: en.projects.rename })).toBeInTheDocument()

    release()

    expect(await screen.findByRole('heading', { level: 1, name: 'Biology 101' })).toBeInTheDocument()
    expect(sidebarLinks()[0]).toHaveTextContent('Biology 101')
  })
})

describe('Rename: a click elsewhere cancels (Cristoffer, 2026-11-20)', () => {
  it('in the Top bar, a click elsewhere restores the old name, sends nothing, and leaves focus where it went', async () => {
    fakeApi({ projects: [project('a', { name: 'Biology', name_source: 'student' })] })
    const user = userEvent.setup()
    renderRoute('/projects/a')

    await user.click(await screen.findByRole('button', { name: 'Biology', description: en.projects.rename }))
    const field = screen.getByRole('textbox', { name: en.projects.rename })
    await user.type(field, ' changed')
    await user.click(document.body)

    expect(screen.queryByRole('textbox', { name: en.projects.rename })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Biology' })).toBeInTheDocument()
    expect(callsTo('/api/projects/a', 'PATCH')).toEqual([])
    expect(screen.getByRole('button', { name: 'Biology', description: en.projects.rename })).not.toHaveFocus()
  })

  it('in the Sidebar row, a click elsewhere restores the link, sends nothing, and does not focus "···"', async () => {
    fakeApi({ projects: [project('a', { name: 'Biology', name_source: 'student' })] })
    const user = userEvent.setup()
    renderRoute('/projects/a')
    await screen.findByRole('heading', { level: 1, name: 'Biology' })

    await user.click(screen.getByRole('button', { name: 'More options for Biology' }))
    await user.click(await screen.findByRole('menuitem', { name: en.projects.rename }))
    const field = await screen.findByRole('textbox', { name: en.projects.rename })
    await waitFor(() => expect(field).toHaveFocus())
    await user.type(field, ' changed')
    await user.click(document.body)

    expect(screen.queryByRole('textbox', { name: en.projects.rename })).not.toBeInTheDocument()
    expect(sidebarLinks()[0]).toHaveTextContent('Biology')
    expect(callsTo('/api/projects/a', 'PATCH')).toEqual([])
    expect(screen.getByRole('button', { name: 'More options for Biology' })).not.toHaveFocus()
  })

  it('a click elsewhere while a save is pending does not cancel it; the rename applies', async () => {
    let release
    fakeApi({
      projects: [project('a', { name: 'Biology', name_source: 'student' })],
      routes: {
        'PATCH /api/projects/a': (body, state) =>
          new Promise((resolve) => {
            release = () => resolve({ ...state.projects[0], name: body.name.trim(), name_source: 'student' })
          }),
      },
    })
    const user = userEvent.setup()
    renderRoute('/projects/a')

    await user.click(await screen.findByRole('button', { name: 'Biology', description: en.projects.rename }))
    await user.type(screen.getByRole('textbox', { name: en.projects.rename }), ' 101{Enter}')
    await waitFor(() => expect(release).toBeTypeOf('function'))
    await user.click(document.body)
    expect(screen.getByRole('textbox', { name: en.projects.rename })).toBeInTheDocument()

    release()

    expect(await screen.findByRole('heading', { level: 1, name: 'Biology 101' })).toBeInTheDocument()
  })
})

describe('Sidebar rename', () => {
  it('"···" › Rename opens the field in the row; Enter saves it in the row and the Top bar', async () => {
    fakeApi({
      projects: [project('b', { name: 'Biology', name_source: 'student' }), project('a', { name: 'Anatomy', name_source: 'auto' })],
    })
    const user = userEvent.setup()
    renderRoute('/projects/b')
    await screen.findByRole('heading', { level: 1, name: 'Biology' })

    await user.click(screen.getByRole('button', { name: 'More options for Anatomy' }))
    await user.click(await screen.findByRole('menuitem', { name: en.projects.rename }))

    const field = await screen.findByRole('textbox', { name: en.projects.rename })
    await waitFor(() => expect(field).toHaveFocus())
    expect(field).toHaveValue('Anatomy')
    await user.clear(field)
    await user.type(field, 'Anatomy II{Enter}')

    await waitFor(() => expect(sidebarLinks()[1]).toHaveTextContent('Anatomy II'))
    expect(callsTo('/api/projects/a', 'PATCH')).toEqual([
      ['/api/projects/a', { method: 'PATCH', body: { name: 'Anatomy II' } }],
    ])
  })

  it('renaming the open Project in the Sidebar updates the Top bar at once', async () => {
    fakeApi({ projects: [project('a', { name: 'Biology', name_source: 'student' })] })
    const user = userEvent.setup()
    renderRoute('/projects/a')
    await screen.findByRole('heading', { level: 1, name: 'Biology' })

    await user.click(screen.getByRole('button', { name: 'More options for Biology' }))
    await user.click(await screen.findByRole('menuitem', { name: en.projects.rename }))
    const field = await screen.findByRole('textbox', { name: en.projects.rename })
    await user.clear(field)
    await user.type(field, 'Biology 101{Enter}')

    expect(await screen.findByRole('heading', { level: 1, name: 'Biology 101' })).toBeInTheDocument()
  })

  it('Esc in the row restores the link and sends nothing', async () => {
    fakeApi({ projects: [project('a', { name: 'Biology', name_source: 'student' })] })
    const user = userEvent.setup()
    renderRoute('/projects/a')
    await screen.findByRole('heading', { level: 1, name: 'Biology' })

    await user.click(screen.getByRole('button', { name: 'More options for Biology' }))
    await user.click(await screen.findByRole('menuitem', { name: en.projects.rename }))
    const field = await screen.findByRole('textbox', { name: en.projects.rename })
    await waitFor(() => expect(field).toHaveFocus())
    await user.type(field, ' changed{Escape}')

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(sidebarLinks()[0]).toHaveTextContent('Biology')
    expect(callsTo('/api/projects/a', 'PATCH')).toEqual([])
  })

  it('the "···" menu opens from the keyboard', async () => {
    fakeApi({ projects: [project('a', { name: 'Biology', name_source: 'student' })] })
    const user = userEvent.setup()
    renderRoute('/projects/a')
    await screen.findByRole('heading', { level: 1, name: 'Biology' })

    screen.getByRole('button', { name: 'More options for Biology' }).focus()
    await user.keyboard('{Enter}')
    const item = await screen.findByRole('menuitem', { name: en.projects.rename })
    await waitFor(() => expect(item).toHaveFocus())
    await user.keyboard('{Enter}')

    const field = await screen.findByRole('textbox', { name: en.projects.rename })
    await waitFor(() => expect(field).toHaveFocus())
  })

  it('after Esc or Enter in the row, focus returns to the row "···" trigger', async () => {
    fakeApi({ projects: [project('a', { name: 'Biology', name_source: 'student' })] })
    const user = userEvent.setup()
    renderRoute('/projects/a')
    await screen.findByRole('heading', { level: 1, name: 'Biology' })

    await user.click(screen.getByRole('button', { name: 'More options for Biology' }))
    await user.click(await screen.findByRole('menuitem', { name: en.projects.rename }))
    let field = await screen.findByRole('textbox', { name: en.projects.rename })
    await waitFor(() => expect(field).toHaveFocus())
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.getByRole('button', { name: 'More options for Biology' })).toHaveFocus())

    await user.keyboard('{Enter}')
    await user.click(await screen.findByRole('menuitem', { name: en.projects.rename }))
    field = await screen.findByRole('textbox', { name: en.projects.rename })
    await waitFor(() => expect(field).toHaveFocus())
    await user.type(field, ' 2{Enter}')

    await waitFor(() => expect(screen.getByRole('button', { name: 'More options for Biology 2' })).toHaveFocus())
  })
})

describe('Rename while the saved name changes (Story 2.4b)', () => {
  it('saves the name the field opened with when the student types it back after the name changed', async () => {
    fakeApi({ projects: [project('a', { name: 'B', name_source: 'auto' })] })
    const onRenamed = vi.fn()
    const user = userEvent.setup()
    const wrapper = ({ children }) => <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    const { rerender } = render(<ProjectName project={project('a', { name: 'A', name_source: 'auto' })} onRenamed={onRenamed} />, { wrapper })

    await user.click(screen.getByRole('button', { name: 'A' }))
    rerender(<ProjectName project={project('a', { name: 'B', name_source: 'auto' })} onRenamed={onRenamed} />)
    const field = screen.getByRole('textbox', { name: en.projects.rename })
    expect(field).toHaveValue('A')
    await user.type(field, '{Enter}')

    await waitFor(() => expect(onRenamed).toHaveBeenCalled())
    expect(callsTo('/api/projects/a', 'PATCH')).toEqual([['/api/projects/a', { method: 'PATCH', body: { name: 'A' } }]])
  })
})
