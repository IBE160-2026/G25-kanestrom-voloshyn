// The Project's auto-name appears without a refresh (Story 2.4b, FR-4, AD-14). api/client.js and
// auth/ are mocked (spine › Tests); test/fakeApi.js plays the backend.
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import { callsTo, fakeApi, finish, material, project } from '../test/fakeApi.js'
import { renderRoute } from '../test/render.jsx'
import { NAME_POLL_MS, NAME_WAIT_MS } from './ProjectHome.jsx'
import { POLL_MS } from './useProjectFiles.js'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

const NAME = 'Photosynthesis: Study Notes'

beforeEach(() => {
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
})

afterEach(() => {
  vi.useRealTimers()
})

const reads = () => callsTo('/api/projects/a')
const title = (name) => screen.queryByRole('heading', { level: 1, name })
const sidebarLink = (name) => within(screen.getByRole('navigation')).queryByRole('link', { name })

/** Open Project "a" with one file Reading… (its job running), and wait until it has loaded. */
async function openReading(projects = [project('a')]) {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const state = fakeApi({
    projects,
    materials: { a: [material('r', { status: 'processing' })] },
    jobs: [{ id: 'j-r', project_id: 'a', kind: 'material_processing', status: 'running', result_ref: 'r' }],
  })
  renderRoute('/projects/a')
  await screen.findByRole('button', { name: /^(Upload|Show files)$/ })
  return state
}

/** The file turns Ready on the next jobs poll, and the list shows it. */
async function turnReady(state, options) {
  finish(state, 'r', { status: 'ready' }, options)
  await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
  await waitFor(() => expect(screen.getByRole('complementary', { name: /^Files · / })).toHaveTextContent(en.files.status.ready))
}

describe('Auto-naming (Story 2.4b)', () => {
  it('shows the new name in the Top bar and the Sidebar without a reload, then stops re-reading', async () => {
    const state = await openReading()
    expect(title(en.projects.placeholder)).toBeInTheDocument()
    expect(reads()).toHaveLength(1)

    await turnReady(state, { projectName: NAME })
    await act(() => vi.advanceTimersByTimeAsync(NAME_POLL_MS))

    expect(await screen.findByRole('heading', { level: 1, name: NAME })).toBeInTheDocument()
    expect(sidebarLink(NAME)).toBeInTheDocument()
    expect(title(en.projects.placeholder)).not.toBeInTheDocument()
    const count = reads().length
    expect(count).toBe(2)
    await act(() => vi.advanceTimersByTimeAsync(NAME_POLL_MS * 5))
    expect(reads()).toHaveLength(count)
  })

  it('re-reads every 2 s while the name is still missing, and gives up after 30 s', async () => {
    const state = await openReading()

    await turnReady(state) // naming failed on the server: no name arrives
    await act(() => vi.advanceTimersByTimeAsync(NAME_POLL_MS))
    expect(reads()).toHaveLength(2)
    await act(() => vi.advanceTimersByTimeAsync(NAME_POLL_MS))
    expect(reads()).toHaveLength(3)

    await act(() => vi.advanceTimersByTimeAsync(NAME_WAIT_MS))
    expect(reads()).toHaveLength(1 + NAME_WAIT_MS / NAME_POLL_MS)
    await act(() => vi.advanceTimersByTimeAsync(NAME_WAIT_MS))
    expect(reads()).toHaveLength(1 + NAME_WAIT_MS / NAME_POLL_MS)
    expect(title(en.projects.placeholder)).toBeInTheDocument()
  })

  it('does not re-read when the Project opens with a file already Ready and no name', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fakeApi({ projects: [project('a')], materials: { a: [material('r')] } })
    renderRoute('/projects/a')
    await screen.findByRole('button', { name: /^(Upload|Show files)$/ })

    await act(() => vi.advanceTimersByTimeAsync(NAME_WAIT_MS))

    expect(reads()).toHaveLength(1)
    expect(title(en.projects.placeholder)).toBeInTheDocument()
  })

  it('does not re-read when the file turns Ready in a named Project', async () => {
    const state = await openReading([project('a', { name: 'Biology', name_source: 'student' })])

    await turnReady(state)
    await act(() => vi.advanceTimersByTimeAsync(NAME_WAIT_MS))

    expect(reads()).toHaveLength(1)
    expect(title('Biology')).toBeInTheDocument()
  })

  it('does not re-read when the file is rejected', async () => {
    const state = await openReading()

    finish(state, 'r', { status: 'rejected', reject_reason: 'unreadable' })
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Files · 0 of 10' })).toBeInTheDocument())
    await act(() => vi.advanceTimersByTimeAsync(NAME_WAIT_MS))

    expect(reads()).toHaveLength(1)
  })

  it('keeps what the student is typing when the name arrives during a rename', async () => {
    const state = await openReading()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByRole('button', { name: en.projects.placeholder }))
    const field = screen.getByRole('textbox', { name: en.projects.rename })
    await user.type(field, 'My bio')

    await turnReady(state, { projectName: NAME })
    await act(() => vi.advanceTimersByTimeAsync(NAME_POLL_MS))
    await waitFor(() => expect(sidebarLink(NAME)).toBeInTheDocument())

    expect(screen.getByRole('textbox', { name: en.projects.rename })).toHaveValue('My bio')
  })

  it('closes an untouched rename field without a request when the name arrived meanwhile', async () => {
    const state = await openReading()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByRole('button', { name: en.projects.placeholder }))

    await turnReady(state, { projectName: NAME })
    await act(() => vi.advanceTimersByTimeAsync(NAME_POLL_MS))
    await waitFor(() => expect(sidebarLink(NAME)).toBeInTheDocument())
    await user.type(screen.getByRole('textbox', { name: en.projects.rename }), '{Enter}')

    expect(await screen.findByRole('heading', { level: 1, name: NAME })).toBeInTheDocument()
    expect(callsTo('/api/projects/a', 'PATCH')).toHaveLength(0)
  })
})

describe('Auto-naming retries and renames (Story 2.4b)', () => {
  it('re-reads again when a second file turns Ready after the first gave up, and shows the name', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const state = fakeApi({
      projects: [project('a')],
      materials: { a: [material('r1', { status: 'processing' }), material('r2', { status: 'processing' })] },
      jobs: [
        { id: 'j-1', project_id: 'a', kind: 'material_processing', status: 'running', result_ref: 'r1' },
        { id: 'j-2', project_id: 'a', kind: 'material_processing', status: 'running', result_ref: 'r2' },
      ],
    })
    renderRoute('/projects/a')
    await screen.findByRole('button', { name: /^(Upload|Show files)$/ })
    const readyRows = () => within(screen.getByRole('complementary', { name: /^Files · / })).queryAllByText(en.files.status.ready)

    finish(state, 'r1') // naming failed on the server
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    await waitFor(() => expect(readyRows()).toHaveLength(1))
    await act(() => vi.advanceTimersByTimeAsync(NAME_WAIT_MS * 2))
    const gaveUp = reads().length
    expect(gaveUp).toBe(1 + NAME_WAIT_MS / NAME_POLL_MS)

    finish(state, 'r2', { status: 'ready' }, { projectName: NAME })
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    await waitFor(() => expect(readyRows()).toHaveLength(2))
    await act(() => vi.advanceTimersByTimeAsync(NAME_POLL_MS))

    expect(await screen.findByRole('heading', { level: 1, name: NAME })).toBeInTheDocument()
    expect(sidebarLink(NAME)).toBeInTheDocument()
    expect(reads()).toHaveLength(gaveUp + 1)
  })

  it('stops re-reading when the student renames the Project meanwhile', async () => {
    const state = await openReading()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await turnReady(state) // no name yet: re-reading starts
    await act(() => vi.advanceTimersByTimeAsync(NAME_POLL_MS))
    expect(reads()).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: en.projects.placeholder }))
    await user.type(screen.getByRole('textbox', { name: en.projects.rename }), 'Bio{Enter}')
    expect(await screen.findByRole('heading', { level: 1, name: 'Bio' })).toBeInTheDocument()
    const count = reads().length

    await act(() => vi.advanceTimersByTimeAsync(NAME_WAIT_MS))

    expect(reads()).toHaveLength(count)
    expect(callsTo('/api/projects/a', 'PATCH')).toHaveLength(1)
  })
})
