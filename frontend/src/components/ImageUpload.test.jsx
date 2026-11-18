// Photos of notes (Story 2.5, FR-7): image types in the picker, the 26th image refused, the Limit
// notice, image tiles, and the unreadable-image copy. api/client.js and auth/ are mocked (spine ›
// Tests); test/fakeApi.js plays the backend.
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { ACCEPT, POLL_MS, precheck } from '../pages/useProjectFiles.js'
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

function file(name) {
  return new File(['content'], name)
}

function panel() {
  return screen.getByRole('complementary', { name: /^(Files|Filer) · / })
}

async function openProject(options = {}) {
  const state = fakeApi({ projects: [project('a')], ...options })
  renderRoute('/projects/a')
  await screen.findByRole('button', { name: /^(Upload|Last opp)$/ })
  return state
}

const notice = (n, strings = en) =>
  (n === 1 ? strings.files.limit.images_one : strings.files.limit.images_other).replace('{{count}}', String(n))

describe('Image uploads', () => {
  it('the picker and the precheck accept JPG, JPEG, PNG, and HEIC', () => {
    for (const ext of ['.jpg', '.jpeg', '.png', '.heic']) expect(ACCEPT.split(',')).toContain(ext)
    for (const name of ['a.jpg', 'B.JPEG', 'c.png', 'd.HEIC']) expect(precheck(file(name))).toBeNull()
    expect(precheck(file('e.gif'))).toEqual({ code: 'unsupported_file_type', params: {} })
  })

  it('uploads a photo and shows it as Reading… with its type tile', async () => {
    const user = userEvent.setup()
    await openProject()

    await user.upload(screen.getByTestId('file-picker'), file('notes-photo.png'))

    const row = await within(panel()).findByRole('listitem')
    expect(row).toHaveTextContent('notes-photo.png')
    expect(row).toHaveTextContent(en.files.status.processing)
    await waitFor(() => expect(row).toHaveTextContent(/^PNG/))
    expect(callsTo('/api/projects/a/materials', 'POST')).toHaveLength(1)
  })

  it('refuses the 26th image today with the limit message and adds no file', async () => {
    const user = userEvent.setup()
    await openProject({ imagesLeft: 0 })

    await user.upload(screen.getByTestId('file-picker'), file('page-26.jpg'))

    const message = en.errors.quota_exceeded.replace('{{limit}}', '25')
    expect(message).toBe("You've used today's 25 images. Try again tomorrow.")
    expect(await within(panel()).findByText(message)).toBeInTheDocument()
    expect(within(panel()).getByText('page-26.jpg')).toBeInTheDocument()
    expect(within(panel()).queryByRole('listitem')).not.toBeInTheDocument()
    // A rule refusal: trying again today can't help.
    expect(within(panel()).queryByRole('button', { name: en.inlineError.retry })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Files · 0 of 10' })).toBeInTheDocument()
  })

  it('shows the Limit notice at 10 images left, but not at 11', async () => {
    await openProject({ imagesLeft: 11 })
    await waitFor(() => expect(callsTo('/api/usage')).toHaveLength(1))
    expect(within(panel()).queryByText(/images? left today/)).not.toBeInTheDocument()
  })

  it('shows "10 images left today" at 10', async () => {
    await openProject({ imagesLeft: 10 })
    expect(await within(panel()).findByText(notice(10))).toBeInTheDocument()
    expect(notice(10)).toBe('10 images left today')
  })

  it('refreshes the notice after each image upload, down to the singular', async () => {
    const user = userEvent.setup()
    await openProject({ imagesLeft: 11 })
    await waitFor(() => expect(callsTo('/api/usage')).toHaveLength(1))

    await user.upload(screen.getByTestId('file-picker'), file('one.png'))
    expect(await within(panel()).findByText(notice(10))).toBeInTheDocument()
    expect(callsTo('/api/usage')).toHaveLength(2)

    // A document doesn't touch the image limit, so no refresh.
    await user.upload(screen.getByTestId('file-picker'), file('notes.pdf'))
    await waitFor(() => expect(within(panel()).getAllByRole('listitem')).toHaveLength(2))
    expect(callsTo('/api/usage')).toHaveLength(2)
  })

  it('names one image left in the singular', async () => {
    await openProject({ imagesLeft: 1 })
    expect(await within(panel()).findByText('1 image left today')).toBeInTheDocument()
  })

  it('shows JPG, PNG, and HEIC tiles', async () => {
    await openProject({
      materials: {
        a: [
          material('j', { file_name: 'a.jpeg', file_type: 'jpg' }),
          material('p', { file_name: 'b.png', file_type: 'png' }),
          material('h', { file_name: 'c.heic', file_type: 'heic' }),
        ],
      },
    })
    const rows = await within(panel()).findAllByRole('listitem')
    expect(rows.map((row) => row.querySelector('[aria-hidden="true"]').textContent)).toEqual(['JPG', 'PNG', 'HEIC'])
  })

  it('a rejected unreadable photo shows the image copy; a document keeps its own', async () => {
    await openProject({
      materials: {
        a: [
          material('i', { file_name: 'blurry.jpg', file_type: 'jpg', status: 'rejected', reject_reason: 'unreadable' }),
          material('d', { file_name: 'blank.pdf', status: 'rejected', reject_reason: 'unreadable' }),
        ],
      },
    })
    const [image, doc] = await within(panel()).findAllByRole('listitem')
    expect(image).toHaveTextContent(en.files.reason.unreadable_image)
    expect(doc).toHaveTextContent(en.files.reason.unreadable)
    expect(doc).not.toHaveTextContent(en.files.reason.unreadable_image)
  })

  it('shows the limit message, the notice, and the image copy in Norwegian', async () => {
    const user = userEvent.setup()
    await i18n.changeLanguage('nb')
    await openProject({
      imagesLeft: 0,
      materials: {
        a: [material('i', { file_name: 'uskarp.png', file_type: 'png', status: 'rejected', reject_reason: 'unreadable' })],
      },
    })
    expect(await within(panel()).findByText(notice(0, nb))).toBeInTheDocument()
    expect(notice(0, nb)).toBe('0 bilder igjen i dag')
    expect(within(panel()).getByRole('listitem')).toHaveTextContent(nb.files.reason.unreadable_image)

    await user.upload(screen.getByTestId('file-picker'), file('side.heic'))
    expect(
      await within(panel()).findByText('Du har brukt dagens 25 bilder. Prøv igjen i morgen.'),
    ).toBeInTheDocument()
    expect(nb.files.limit.images_one.replace('{{count}}', '1')).toBe('1 bilde igjen i dag')
  })

  it('removing a Reading… image fetches the usage again', async () => {
    const user = userEvent.setup()
    await openProject({
      imagesLeft: 9,
      materials: { a: [material('i', { file_name: 'notes.png', file_type: 'png', status: 'processing' })] },
      jobs: [{ id: 'j-i', project_id: 'a', kind: 'material_processing', status: 'queued', result_ref: 'i' }],
    })
    await waitFor(() => expect(callsTo('/api/usage')).toHaveLength(1))

    await user.click(within(panel()).getByRole('button', { name: 'More options for notes.png' }))
    await user.click(await screen.findByRole('menuitem', { name: en.files.remove.item }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove notes.png?' })
    await user.click(within(dialog).getByRole('button', { name: en.files.remove.confirm }))

    await waitFor(() => expect(callsTo('/api/usage')).toHaveLength(2))
  })

  it('a read-only Project shows no Limit notice', async () => {
    fakeApi({ projects: [project('a', { archived_at: '2026-11-17T00:00:00Z' })], imagesLeft: 5 })
    renderRoute('/projects/a')
    await screen.findByRole('button', { name: en.files.upload })
    await waitFor(() => expect(callsTo('/api/usage')).toHaveLength(1))
    expect(within(panel()).queryByRole('status')).not.toBeInTheDocument()
    expect(within(panel()).queryByText(notice(5))).not.toBeInTheDocument()
  })

  it('fetches the usage again when a poll sees an image job end', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const state = await openProject({
      imagesLeft: 9,
      materials: { a: [material('i', { file_name: 'blurry.png', file_type: 'png', status: 'processing' })] },
      jobs: [{ id: 'j-i', project_id: 'a', kind: 'material_processing', status: 'running', result_ref: 'i' }],
    })
    await waitFor(() => expect(callsTo('/api/usage')).toHaveLength(1))

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    expect(callsTo('/api/usage')).toHaveLength(1)

    finish(state, 'i', { status: 'rejected', reject_reason: 'unparseable' })
    state.imagesLeft = 10
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))

    await waitFor(() => expect(callsTo('/api/usage')).toHaveLength(2))
    expect(await within(panel()).findByRole('status')).toHaveTextContent(notice(10))
  })
})
