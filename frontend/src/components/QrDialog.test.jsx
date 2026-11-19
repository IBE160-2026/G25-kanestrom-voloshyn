// "Upload from phone" and the QR dialog (Story 6.2, FR-21, AD-24): the button in the Files panel and
// the drop zone, the Privacy notice first, the QR code's URL, live arrival of a batch while the dialog
// is open, and the revoke on close (DELETE) or on leaving the page (beacon). api/client.js and auth/ are
// mocked (spine › Tests); test/fakeApi.js plays the backend.
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { POLL_MS } from '../pages/useProjectFiles.js'
import { PROFILE, callsTo, fakeApi, finish, material, project } from '../test/fakeApi.js'
import { i18n, renderRoute } from '../test/render.jsx'
import { phoneUrl, qrPath } from './qrCode.js'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

beforeEach(() => {
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function panel() {
  return screen.getByRole('complementary', { name: /^(Files|Filer) · / })
}

async function openProject(options = {}, path = '/projects/a') {
  const state = fakeApi({ projects: [project('a', { name: 'Biology' })], ...options })
  const view = renderRoute(path)
  await screen.findByRole('button', { name: /^(Upload|Last opp)$/ })
  return { state, ...view }
}

async function openDialog(user) {
  await user.click(within(panel()).getByRole('button', { name: en.files.uploadPhone }))
  return screen.findByRole('dialog', { name: en.qr.title })
}

describe('Upload from phone', () => {
  it('sits beside Upload in the Files panel and in the empty Project drop zone', async () => {
    await openProject()

    expect(within(panel()).getByRole('button', { name: 'Upload from phone' })).toBeEnabled()
    expect(within(screen.getByTestId('drop-zone')).getByRole('button', { name: 'Upload from phone' })).toBeEnabled()
  })

  it('opens the QR dialog with the code for {app_public_url}/u/{token}', async () => {
    const user = userEvent.setup()
    const { state } = await openProject({ appPublicUrl: 'http://192.168.1.20:8000/' })

    const dialog = await openDialog(user)

    expect(within(dialog).getByText(en.qr.expiry)).toBeInTheDocument()
    expect(within(dialog).getByText(en.qr.waiting)).toBeInTheDocument()
    const code = await within(dialog).findByRole('img', { name: en.qr.title })
    const url = 'http://192.168.1.20:8000/u/tok-1'
    expect(code).toHaveAttribute('data-url', url)
    expect(code.querySelector('path').getAttribute('d')).toBe(qrPath(url).d)
    expect(state.links).toHaveLength(1)
    expect(en.qr.expiry).toBe('This code works for 10 minutes and stops when you close this window.')
  })

  it('builds the phone URL from the public URL only', () => {
    expect(phoneUrl('http://10.0.0.5:8000/', 'abc')).toBe('http://10.0.0.5:8000/u/abc')
    expect(phoneUrl('', 'abc')).toBeNull()
    expect(phoneUrl(undefined, 'abc')).toBeNull()
  })

  it('opens from the drop zone too', async () => {
    const user = userEvent.setup()
    await openProject()

    await user.click(within(screen.getByTestId('drop-zone')).getByRole('button', { name: en.files.uploadPhone }))

    expect(await screen.findByRole('dialog', { name: en.qr.title })).toBeInTheDocument()
  })

  it('shows the Privacy notice first, and makes the link only after "Got it, upload"', async () => {
    const user = userEvent.setup()
    await openProject({ me: { ...PROFILE, privacy_notice_accepted: false } })

    await user.click(within(panel()).getByRole('button', { name: en.files.uploadPhone }))

    expect(await screen.findByRole('dialog', { name: en.privacyNotice.title })).toBeInTheDocument()
    expect(callsTo('/api/projects/a/phone-links', 'POST')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: en.privacyNotice.accept }))
    expect(await screen.findByRole('dialog', { name: en.qr.title })).toBeInTheDocument()
    await waitFor(() => expect(callsTo('/api/projects/a/phone-links', 'POST')).toHaveLength(1))
  })

  it('Cancel on the Privacy notice makes no link', async () => {
    const user = userEvent.setup()
    await openProject({ me: { ...PROFILE, privacy_notice_accepted: false } })

    await user.click(within(panel()).getByRole('button', { name: en.files.uploadPhone }))
    await user.click(await screen.findByRole('button', { name: en.privacyNotice.cancel }))

    expect(screen.queryByRole('dialog', { name: en.qr.title })).not.toBeInTheDocument()
    expect(callsTo('/api/projects/a/phone-links', 'POST')).toHaveLength(0)
  })

  it('is disabled while the Project is read-only', async () => {
    await openProject({ projects: [project('a', { archived_at: '2026-11-18T10:00:00Z' })] })

    expect(within(panel()).getByRole('button', { name: en.files.uploadPhone })).toBeDisabled()
    expect(within(screen.getByTestId('drop-zone')).getByRole('button', { name: en.files.uploadPhone })).toBeDisabled()
  })

  it('closing the dialog revokes the link', async () => {
    const user = userEvent.setup()
    const { state } = await openProject()
    const dialog = await openDialog(user)
    await within(dialog).findByRole('img', { name: en.qr.title })

    await user.click(within(dialog).getByRole('button', { name: en.qr.close }))

    expect(screen.queryByRole('dialog', { name: en.qr.title })).not.toBeInTheDocument()
    await waitFor(() => expect(callsTo('/api/projects/a/phone-links/link-1', 'DELETE')).toHaveLength(1))
    expect(state.links[0].revoked).toBe(true)
  })

  it('Esc closes it and revokes the link too', async () => {
    const user = userEvent.setup()
    await openProject()
    const dialog = await openDialog(user)
    await within(dialog).findByRole('img', { name: en.qr.title })

    await user.keyboard('{Escape}')

    await waitFor(() => expect(callsTo('/api/projects/a/phone-links/link-1', 'DELETE')).toHaveLength(1))
  })

  it('leaving the page while it is open sends the revoke beacon', async () => {
    const beacon = vi.fn(() => true)
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon })
    const user = userEvent.setup()
    await openProject()
    const dialog = await openDialog(user)
    await within(dialog).findByRole('img', { name: en.qr.title })

    window.dispatchEvent(new Event('pagehide'))

    expect(beacon).toHaveBeenCalledWith('/api/phone/tok-1/revoke')
  })

  it('a batch that arrives shows in the dialog with its status, and the count updates, live', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { state } = await openProject({ materials: { a: [material('old', { status: 'ready' })] } })
    const dialog = await openDialog(user)
    await within(dialog).findByRole('img', { name: en.qr.title })
    expect(within(dialog).queryByRole('listitem')).not.toBeInTheDocument()

    // The phone finalizes a batch of two photos.
    state.materials.a.push(material('batch', { file_name: 'Handwritten notes, 2 pages', file_type: 'phone_batch', status: 'processing' }))
    state.jobs.push({ id: 'jb', project_id: 'a', kind: 'material_processing', status: 'running', result_ref: 'batch' })
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))

    const row = await within(dialog).findByRole('listitem')
    expect(row).toHaveTextContent('Handwritten notes, 2 pages')
    expect(row).toHaveTextContent(en.files.status.processing)
    // Behind the modal dialog (aria-hidden while it is open), the Files panel counts it too.
    expect(screen.getByRole('heading', { name: 'Files · 2 of 10', hidden: true })).toBeInTheDocument()

    finish(state, 'batch', { status: 'ready', warning: true, warning_pages: [2] })
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    await waitFor(() => expect(within(dialog).getByRole('listitem')).toHaveTextContent(en.files.status.warning))
    // The file row behind names the unreadable page.
    const files = screen.getByRole('complementary', { name: /^Files · /, hidden: true })
    expect(within(files).getByText(/Page 2 couldn't be read\./)).toBeInTheDocument()
  })

  it('polls nothing once the dialog is closed and nothing is Reading…', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await openProject()
    const dialog = await openDialog(user)
    await within(dialog).findByRole('img', { name: en.qr.title })
    await user.click(within(dialog).getByRole('button', { name: en.qr.close }))
    const before = callsTo('/api/projects/a/jobs').length

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3))

    expect(callsTo('/api/projects/a/jobs')).toHaveLength(before)
  })

  it('shows its copy in Norwegian', async () => {
    await i18n.changeLanguage('nb')
    const user = userEvent.setup()
    await openProject()

    await user.click(within(panel()).getByRole('button', { name: nb.files.uploadPhone }))

    const dialog = await screen.findByRole('dialog', { name: 'Last opp fra mobilen' })
    expect(within(dialog).getByText('Venter på bilder …')).toBeInTheDocument()
    expect(within(dialog).getByText(nb.qr.expiry)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Lukk' })).toBeInTheDocument()
  })

  it('without a public URL from /api/config, shows the generic error and no code, and drops the link', async () => {
    const user = userEvent.setup()
    const { state } = await openProject({ appPublicUrl: '' })

    const dialog = await openDialog(user)

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(en.errors.generic)
    expect(within(dialog).queryByRole('img', { name: en.qr.title })).not.toBeInTheDocument()
    await waitFor(() => expect(state.links[0].revoked).toBe(true))
  })

  it('a failed /api/config shows the generic error too', async () => {
    const user = userEvent.setup()
    await openProject({
      routes: {
        'GET /api/config': () => {
          throw { code: 'network_error', params: {} }
        },
      },
    })

    const dialog = await openDialog(user)

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(en.errors.generic)
  })

  it.each([
    ['project_read_only', en.errors.project_read_only],
    ['privacy_notice_required', en.errors.privacy_notice_required],
  ])('a refused link (%s) shows its message and no code', async (code, message) => {
    const user = userEvent.setup()
    await openProject({
      routes: {
        'POST /api/projects/a/phone-links': () => {
          throw { code, params: {} }
        },
      },
    })

    const dialog = await openDialog(user)

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message)
    expect(within(dialog).queryByRole('img', { name: en.qr.title })).not.toBeInTheDocument()
  })

  it('a link that expires while the dialog is open is replaced by a fresh one, and not revoked', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { state } = await openProject({ linkTtlMs: 60_000 })
    const dialog = await openDialog(user)
    await within(dialog).findByRole('img', { name: en.qr.title })

    await act(() => vi.advanceTimersByTimeAsync(60_000))

    await waitFor(() =>
      expect(within(dialog).getByRole('img', { name: en.qr.title })).toHaveAttribute('data-url', 'http://192.168.1.20:8000/u/tok-2'),
    )
    expect(within(dialog).getByText(en.qr.expiry)).toBeInTheDocument()
    // The expired link may still finalize a batch for 10 minutes.
    expect(state.links[0].revoked).toBe(false)
  })

  it('coming back from the back-forward cache makes a fresh link', async () => {
    const user = userEvent.setup()
    const { state } = await openProject()
    const dialog = await openDialog(user)
    await within(dialog).findByRole('img', { name: en.qr.title })

    const event = new Event('pageshow')
    Object.defineProperty(event, 'persisted', { value: true })
    act(() => {
      window.dispatchEvent(event)
    })

    await waitFor(() => expect(state.links).toHaveLength(2))
    await waitFor(() =>
      expect(within(dialog).getByRole('img', { name: en.qr.title })).toHaveAttribute('data-url', 'http://192.168.1.20:8000/u/tok-2'),
    )
  })

  it('a rejected phone batch of unreadable photos shows the image copy', async () => {
    await openProject({
      materials: {
        a: [
          material('b', {
            file_name: 'Handwritten notes, 2 pages',
            file_type: 'phone_batch',
            status: 'rejected',
            reject_reason: 'unreadable',
          }),
        ],
      },
    })

    const row = within(panel()).getByRole('listitem')
    expect(row).toHaveTextContent(en.files.reason.unreadable_image)
    expect(row).toHaveTextContent(/^IMG/)
  })

  it('a batch job that finishes after the dialog closed refreshes the images left today', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { state } = await openProject()
    const dialog = await openDialog(user)
    await within(dialog).findByRole('img', { name: en.qr.title })
    state.materials.a = [material('batch', { file_name: 'Handwritten notes, 1 page', file_type: 'phone_batch', status: 'processing' })]
    state.jobs.push({ id: 'jb', project_id: 'a', kind: 'material_processing', status: 'running', result_ref: 'batch' })
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    await within(dialog).findByRole('listitem')
    await user.click(within(dialog).getByRole('button', { name: en.qr.close }))
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    const before = callsTo('/api/usage').length

    finish(state, 'batch', { status: 'ready' })
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))

    await waitFor(() => expect(callsTo('/api/usage').length).toBeGreaterThan(before))
  })
})
