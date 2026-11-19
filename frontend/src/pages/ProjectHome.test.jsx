// Project home layout and opening a Project (Story 2.1, FR-4, FR-8). api/client.js and auth/ are
// mocked (spine › Tests); test/fakeApi.js plays the backend.
import { act, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client.js'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { PROFILE, callsTo, fakeApi, project } from '../test/fakeApi.js'
import { i18n, renderRoute } from '../test/render.jsx'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

beforeEach(() => {
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
})

describe('Project home', () => {
  it('shows the drop zone, a disabled Quiz in the tools row, and the Files panel "Files · 0 of 10"', async () => {
    fakeApi({ projects: [project('a')] })
    renderRoute('/projects/a')

    expect(await screen.findByRole('heading', { level: 2, name: en.projectHome.dropZone.heading })).toBeInTheDocument()
    expect(within(screen.getByTestId('tools-row')).getByRole('button', { name: en.tools.quiz })).toBeDisabled()
    const files = screen.getByRole('complementary', { name: 'Files · 0 of 10' })
    expect(within(files).getByRole('heading', { level: 2 })).toHaveTextContent('Files · 0 of 10')
  })

  it('is in Norwegian too', async () => {
    await i18n.changeLanguage('nb')
    fakeApi({ projects: [project('a')] })
    renderRoute('/projects/a')

    expect(await screen.findByRole('heading', { name: nb.projectHome.dropZone.heading })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Filer · 0 av 10' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: nb.projects.placeholder })).toBeInTheDocument()
  })

  it('opens the Project through GET /api/projects/{id}, which records it as the last one', async () => {
    const state = fakeApi({ projects: [project('a')] })
    renderRoute('/projects/a')

    await screen.findByRole('heading', { name: en.projectHome.dropZone.heading })
    expect(callsTo('/api/projects/a')).toHaveLength(1)
    expect(state.me.last_project_id).toBe('a')
  })

  it('shows a static skeleton until the Project has loaded', async () => {
    let release
    fakeApi({
      projects: [project('a')],
      routes: { 'GET /api/projects/a': (_, state) => new Promise((resolve) => (release = () => resolve(state.projects[0]))) },
    })
    const { container } = renderRoute('/projects/a')

    await waitFor(() => expect(release).toBeTypeOf('function'))
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.queryByRole('heading', { name: en.projectHome.dropZone.heading })).not.toBeInTheDocument()

    release()
    expect(await screen.findByRole('heading', { name: en.projectHome.dropZone.heading })).toBeInTheDocument()
  })

  it('another Account\'s Project id (not_found) goes to /projects', async () => {
    fakeApi({ projects: [] })
    const { router } = renderRoute('/projects/foreign')

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'))
    expect(await screen.findByRole('button', { name: en.projects.empty.create })).toBeInTheDocument()
  })

  it('a malformed Project id (invalid_request) goes to /projects with no error', async () => {
    fakeApi({
      routes: {
        'GET /api/projects/not-a-uuid': async () => {
          throw { code: 'invalid_request', params: {} }
        },
      },
    })
    const { router } = renderRoute('/projects/not-a-uuid')

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'))
    expect(await screen.findByRole('button', { name: en.projects.empty.create })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('opening an archived Project does not make it the one /projects forwards to', async () => {
    fakeApi({ projects: [project('old', { name: 'Old', name_source: 'student', archived_at: '2026-11-10T00:00:00Z' })] })
    const { router } = renderRoute('/projects/old')
    await screen.findByRole('heading', { level: 1, name: 'Old' })

    await act(() => router.navigate('/projects'))

    expect(await screen.findByRole('button', { name: en.projects.empty.create })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/projects')
  })

  it('a last Project that is gone does not loop between /projects and the Project', async () => {
    // The profile still names a Project deleted since (a race the server can't rule out).
    fakeApi({ projects: [], routes: { 'GET /api/me': async () => ({ ...PROFILE, last_project_id: 'gone' }) } })
    const { router } = renderRoute('/projects')

    expect(await screen.findByRole('button', { name: en.projects.empty.create })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/projects')
    expect(callsTo('/api/projects/gone')).toHaveLength(1)
  })

  it('any other failure shows the error and stays', async () => {
    fakeApi({
      projects: [project('a')],
      routes: {
        'GET /api/projects/a': async () => {
          throw { code: 'internal_error', params: {} }
        },
      },
    })
    const { router } = renderRoute('/projects/a')

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.internal_error)
    expect(router.state.location.pathname).toBe('/projects/a')
  })

  it('switching Projects in the Sidebar opens the other one', async () => {
    fakeApi({ projects: [project('b', { name: 'Biology', name_source: 'student' }), project('a', { name: 'Anatomy', name_source: 'student' })] })
    const { router } = renderRoute('/projects/b')
    await screen.findByRole('heading', { level: 1, name: 'Biology' })

    screen.getByRole('link', { name: 'Anatomy' }).click()

    expect(await screen.findByRole('heading', { level: 1, name: 'Anatomy' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/projects/a')
    expect(vi.mocked(apiFetch)).toHaveBeenCalledWith('/api/projects/a')
  })
})
