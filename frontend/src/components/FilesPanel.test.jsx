// Upload and the Files panel (Story 2.2, FR-6, FR-8, AD-5, AD-20). api/client.js and auth/ are mocked
// (spine › Tests); test/fakeApi.js plays the backend.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client.js'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { POLL_MS } from '../pages/useProjectFiles.js'
import { callsTo, fakeApi, finish, material, project } from '../test/fakeApi.js'
import { i18n, renderRoute } from '../test/render.jsx'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

beforeEach(() => {
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
})

afterEach(() => {
  vi.useRealTimers()
})

function file(name, size) {
  const f = new File(['content'], name)
  if (size !== undefined) Object.defineProperty(f, 'size', { value: size })
  return f
}

function drop(target, files) {
  const dataTransfer = { files, types: ['Files'], dropEffect: 'none' }
  fireEvent.dragOver(target, { dataTransfer })
  fireEvent.drop(target, { dataTransfer })
}

function panel() {
  return screen.getByRole('complementary', { name: /^(Files|Filer) · / })
}

/** The Project and its files have loaded: the panel shows its Upload button (in either language). */
async function loaded() {
  await screen.findByRole('button', { name: /^(Upload|Last opp)$/ })
}

async function openProject(options) {
  const state = fakeApi({ projects: [project('a')], ...options })
  const result = renderRoute('/projects/a')
  await loaded()
  return { state, ...result }
}

const uploads = () => callsTo('/api/projects/a/materials', 'POST')
const polls = () => callsTo('/api/projects/a/jobs')

describe('Files panel', () => {
  it('lists every file with its last status, and counts Reading… and Ready toward 10 (FR-8)', async () => {
    await openProject({
      materials: {
        a: [
          material('r', { file_name: 'lecture.pdf', status: 'processing' }),
          material('ok', { file_name: 'notes.docx', file_type: 'docx' }),
          material('w', { file_name: 'scan.pdf', warning: true, warning_pages: [2, 4] }),
          material('x', { file_name: 'blank.pdf', status: 'rejected', reject_reason: 'unreadable' }),
        ],
      },
    })

    expect(await screen.findByRole('heading', { name: 'Files · 3 of 10' })).toBeInTheDocument()
    const rows = within(panel()).getAllByRole('listitem')
    expect(rows.map((row) => within(row).getByTitle(/./).textContent)).toEqual([
      'lecture.pdf',
      'notes.docx',
      'scan.pdf',
      'blank.pdf',
    ])
    expect(rows[0]).toHaveTextContent(en.files.status.processing)
    expect(rows[1]).toHaveTextContent(en.files.status.ready)
    expect(rows[2]).toHaveTextContent(en.files.status.warning)
    expect(rows[2]).toHaveTextContent(`${en.files.note.warning} Pages 2 and 4 couldn't be read.`)
    expect(rows[3]).toHaveTextContent(en.files.status.rejected)
    expect(rows[3]).toHaveTextContent(en.files.reason.unreadable)
  })

  it.each([
    ['unparseable', en.files.reason.unparseable],
    ['interrupted', en.files.reason.interrupted],
    ['processing_failed', en.files.reason.processing_failed],
  ])('a file rejected as %s shows its reason', async (reason, text) => {
    await openProject({ materials: { a: [material('x', { status: 'rejected', reject_reason: reason })] } })
    expect(await within(panel()).findByText(text)).toBeInTheDocument()
  })

  it('names a single unreadable page in the singular', async () => {
    await openProject({ materials: { a: [material('w', { warning: true, warning_pages: [3] })] } })
    expect(await within(panel()).findByText(/Page 3 couldn't be read\./)).toBeInTheDocument()
  })

  it('shows the empty box, the Upload button, and the types hint when there are no files', async () => {
    await openProject()
    expect(within(panel()).getByText(en.files.empty)).toBeInTheDocument()
    expect(within(panel()).getByRole('button', { name: en.files.upload })).toBeEnabled()
    expect(within(panel()).getByText(en.files.types)).toBeInTheDocument()
  })

  it('shows the drop zone until a file is Ready', async () => {
    await openProject({ materials: { a: [material('r', { status: 'processing' })] } })
    expect(screen.getByRole('heading', { name: en.projectHome.dropZone.heading })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'browse' })).toBeInTheDocument()
    expect(screen.getByTestId('drop-zone')).toHaveTextContent(en.files.types)
  })

  it('hides the drop zone once a file is Ready', async () => {
    await openProject({ materials: { a: [material('ok')] } })
    expect(screen.queryByRole('heading', { name: en.projectHome.dropZone.heading })).not.toBeInTheDocument()
  })

  it('a read-only Project lists its files but takes no uploads', async () => {
    fakeApi({
      projects: [project('a', { archived_at: '2026-11-17T00:00:00Z' })],
      materials: { a: [material('r', { file_name: 'lecture.pdf', status: 'processing' })] },
    })
    renderRoute('/projects/a')
    await loaded()

    expect(within(panel()).getByRole('listitem')).toHaveTextContent('lecture.pdf')
    expect(within(panel()).getByRole('button', { name: en.files.upload })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'browse' })).toBeDisabled()
    drop(panel(), [file('notes.pdf')])
    drop(screen.getByTestId('drop-zone'), [file('notes.pdf')])
    expect(uploads()).toHaveLength(0)
  })
})

describe('Uploading', () => {
  it('uploads a picked file as multipart field "file" and shows it as Reading… (202)', async () => {
    const user = userEvent.setup()
    await openProject()

    await user.upload(screen.getByTestId('file-picker'), file('photosynthesis-lecture.pdf'))

    const row = await within(panel()).findByRole('listitem')
    expect(row).toHaveTextContent('photosynthesis-lecture.pdf')
    expect(row).toHaveTextContent(en.files.status.processing)
    const [, { body }] = uploads()[0]
    expect(body).toBeInstanceOf(FormData)
    expect(body.get('file').name).toBe('photosynthesis-lecture.pdf')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Files · 1 of 10' })).toBeInTheDocument())
  })

  it('three files dropped at once show as Reading… at once and upload one after another', async () => {
    const releases = []
    const { state } = await openProject()
    const real = vi.mocked(apiFetch).getMockImplementation()
    let inFlight = 0
    let maxInFlight = 0
    vi.mocked(apiFetch).mockImplementation((path, options = {}) => {
      if (path === '/api/projects/a/materials' && options.method === 'POST') {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        return new Promise((resolve) => {
          releases.push(() => {
            inFlight -= 1
            resolve(real(path, options))
          })
        })
      }
      return real(path, options)
    })

    drop(screen.getByTestId('drop-zone'), [file('a.pdf'), file('b.docx'), file('c.md')])

    const rows = within(panel()).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    rows.forEach((row) => expect(row).toHaveTextContent(en.files.status.processing))
    await waitFor(() => expect(releases).toHaveLength(1))
    releases[0]()
    await waitFor(() => expect(releases).toHaveLength(2))
    releases[1]()
    await waitFor(() => expect(releases).toHaveLength(3))
    releases[2]()

    await waitFor(() => expect(state.materials.a).toHaveLength(3))
    expect(maxInFlight).toBe(1)
    expect(state.materials.a.map((m) => m.file_name)).toEqual(['a.pdf', 'b.docx', 'c.md'])
  })

  it('files still uploading count toward 10: three dropped files show "3 of 10"', async () => {
    await openProject()
    vi.mocked(apiFetch).mockImplementation(async (path, options = {}) => {
      if (path === '/api/projects/a/materials' && options.method === 'POST') return new Promise(() => {})
      throw new Error(`unexpected ${path}`)
    })

    drop(screen.getByTestId('drop-zone'), [file('a.pdf'), file('b.pdf'), file('c.pdf')])

    expect(await screen.findByRole('heading', { name: 'Files · 3 of 10' })).toBeInTheDocument()
  })

  it('a file dropped outside the drop targets is not opened by the browser', async () => {
    const { unmount } = await openProject()
    const dataTransfer = { files: [file('a.pdf')], types: ['Files'] }

    expect(fireEvent.dragOver(document.body, { dataTransfer })).toBe(false) // default prevented
    expect(fireEvent.drop(document.body, { dataTransfer })).toBe(false)
    expect(uploads()).toHaveLength(0)

    unmount()
    expect(fireEvent.drop(document.body, { dataTransfer })).toBe(true)
  })

  it('a file dropped on the Files panel uploads too', async () => {
    const { state } = await openProject({ materials: { a: [material('ok')] } })
    drop(panel(), [file('notes.txt')])
    await waitFor(() => expect(state.materials.a).toHaveLength(2))
  })

  it.each([
    ['unsupported-type.rtf', undefined, en.errors.unsupported_file_type],
    ['notes-photo.png', undefined, en.errors.unsupported_file_type],
    ['big.pdf', 50 * 1024 * 1024 + 1, en.errors.file_too_large],
  ])('%s is refused with an Inline error and nothing is sent', async (name, size, message) => {
    await openProject()
    drop(screen.getByTestId('drop-zone'), [file(name, size)])

    const alert = await within(panel()).findByRole('alert')
    expect(alert).toHaveTextContent(name)
    expect(alert).toHaveTextContent(message)
    expect(within(alert).queryByRole('button', { name: en.inlineError.retry })).not.toBeInTheDocument()
    expect(uploads()).toHaveLength(0)
  })

  it.each([
    ['material_limit_reached', en.errors.material_limit_reached],
    ['project_read_only', en.errors.project_read_only],
    ['not_found', en.errors.not_found],
  ])('a server refusal (%s) shows an Inline error and drops the row', async (code, message) => {
    await openProject({
      routes: {
        'POST /api/projects/a/materials': async () => {
          throw { code, params: {} }
        },
      },
    })
    drop(screen.getByTestId('drop-zone'), [file('eleventh.pdf')])

    const alert = await within(panel()).findByRole('alert')
    expect(alert).toHaveTextContent(message)
    await waitFor(() => expect(within(panel()).queryByRole('listitem')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Files · 0 of 10' })).toBeInTheDocument()
  })

  it('a network failure offers "Try again", which uploads the file again', async () => {
    const user = userEvent.setup()
    let fail = true
    const { state } = await openProject({
      routes: {
        'POST /api/projects/a/materials': async (body, s) => {
          if (fail) throw { code: 'network_error', params: {} }
          s.materials.a = [material('m', { file_name: body.get('file').name, status: 'processing' })]
          return { material: s.materials.a[0], job_id: 'j' }
        },
      },
    })
    drop(screen.getByTestId('drop-zone'), [file('notes.pdf')])
    const alert = await within(panel()).findByRole('alert')
    expect(alert).toHaveTextContent(en.inlineError.reassurance)

    fail = false
    await user.click(within(alert).getByRole('button', { name: en.inlineError.retry }))

    await waitFor(() => expect(state.materials.a).toHaveLength(1))
    expect(within(panel()).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('Upload opens the file picker from the keyboard', async () => {
    const user = userEvent.setup()
    await openProject()
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})

    const upload = within(panel()).getByRole('button', { name: en.files.upload })
    while (document.activeElement !== upload) await user.tab()
    await user.keyboard('{Enter}')

    expect(click).toHaveBeenCalledTimes(1)
    click.mockRestore()
  })

  it('is in Norwegian too', async () => {
    await i18n.changeLanguage('nb')
    await openProject({
      materials: {
        a: [
          material('w', { file_name: 'scan.pdf', warning: true, warning_pages: [2, 4] }),
          material('x', { status: 'rejected', reject_reason: 'unparseable' }),
        ],
      },
    })

    expect(screen.getByRole('heading', { name: 'Filer · 1 av 10' })).toBeInTheDocument()
    expect(within(panel()).getByRole('button', { name: nb.files.upload })).toBeInTheDocument()
    expect(panel()).toHaveTextContent(`${nb.files.note.warning} Sidene 2 og 4 kunne ikke leses.`)
    expect(panel()).toHaveTextContent(nb.files.reason.unparseable)
    expect(panel()).toHaveTextContent(nb.files.status.rejected)
    drop(panel(), [file('notat.rtf')])
    expect(await within(panel()).findByRole('alert')).toHaveTextContent(nb.errors.unsupported_file_type)
  })

  it('shows the drop zone body in Norwegian', async () => {
    await i18n.changeLanguage('nb')
    await openProject()
    expect(screen.getByRole('button', { name: 'velg fra maskinen' })).toBeInTheDocument()
    expect(screen.getByTestId('drop-zone')).toHaveTextContent(nb.files.types)
  })
})

describe('Live status (polling)', () => {
  it('makes no polling requests while nothing is Reading…', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await openProject({ materials: { a: [material('ok')] } })

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3))

    expect(polls()).toHaveLength(0)
  })

  it('polls every 2 s while a file is Reading…, then shows Ready with no refresh and stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { state } = await openProject()
    drop(screen.getByTestId('drop-zone'), [file('lecture.pdf')])
    await waitFor(() => expect(state.materials.a).toHaveLength(1))

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    expect(polls()).toHaveLength(1)
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    expect(polls()).toHaveLength(2)

    finish(state, 'm-1', { status: 'ready' })
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))

    const row = within(panel()).getByRole('listitem')
    await waitFor(() => expect(row).toHaveTextContent(en.files.status.ready))
    expect(callsTo('/api/jobs/j-1/seen', 'POST')).toHaveLength(1)
    const count = polls().length
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3))
    expect(polls()).toHaveLength(count)
  })

  it('with no active job returned, it refetches the list; the file shows Ready and polling stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { state } = await openProject({ materials: { a: [material('r', { status: 'processing' })] } })
    // No job for the file: GET …/jobs returns [].

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    expect(polls()).toHaveLength(1)
    expect(within(panel()).getByRole('listitem')).toHaveTextContent(en.files.status.processing)

    state.materials.a[0].status = 'ready'
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))

    await waitFor(() => expect(within(panel()).getByRole('listitem')).toHaveTextContent(en.files.status.ready))
    const count = polls().length
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3))
    expect(polls()).toHaveLength(count)
  })

  it('a poll that lists a new file before its upload answers does not show it twice', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { state } = await openProject({ materials: { a: [material('r', { status: 'processing' })] } })
    const real = vi.mocked(apiFetch).getMockImplementation()
    let answer
    vi.mocked(apiFetch).mockImplementation((path, options = {}) => {
      if (path === '/api/projects/a/materials' && options.method === 'POST') {
        const result = real(path, options) // the server has the file already
        state.jobs = [] // and no active job, so the next poll refetches the list
        return new Promise((resolve) => (answer = () => resolve(result)))
      }
      return real(path, options)
    })

    drop(panel(), [file('new.pdf')])
    await waitFor(() => expect(state.materials.a).toHaveLength(2))
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS)) // no active job: the list is refetched
    await waitFor(() => expect(callsTo('/api/projects/a/materials').length).toBeGreaterThan(1))
    answer()

    await waitFor(() => expect(within(panel()).getAllByRole('listitem')).toHaveLength(2))
    expect(within(panel()).getAllByTitle('new.pdf')).toHaveLength(1)
  })

  it('a file that ends rejected frees its slot', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { state } = await openProject({ materials: { a: [material('r', { status: 'processing' })] } })
    state.jobs.push({ id: 'j-r', project_id: 'a', kind: 'material_processing', status: 'running', result_ref: 'r' })
    expect(screen.getByRole('heading', { name: 'Files · 1 of 10' })).toBeInTheDocument()

    finish(state, 'r', { status: 'rejected', reject_reason: 'unreadable' })
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))

    expect(await screen.findByRole('heading', { name: 'Files · 0 of 10' })).toBeInTheDocument()
    expect(panel()).toHaveTextContent(en.files.reason.unreadable)
  })
})
