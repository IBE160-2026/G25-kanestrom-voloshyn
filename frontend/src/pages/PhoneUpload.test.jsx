// The phone upload page `/u/:token` (Story 6.2, FR-21, AD-24): the header and countdown, numbered
// thumbnails that renumber, the Send label, the advisory warnings, sending with photos refused one by
// one, the sent and expired screens, and Norwegian. api/client.js and auth/ are mocked (spine › Tests);
// test/fakeApi.js plays the backend. No sign-in is involved.
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client.js'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { fakeApi, material, project } from '../test/fakeApi.js'
import { i18n, renderRoute } from '../test/render.jsx'
import { countdownText } from './phoneCountdown.js'
import { MAX_BYTES } from './useProjectFiles.js'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

afterEach(() => {
  vi.useRealTimers()
})

function photo(name = 'IMG_0001.jpg', size = null) {
  const file = new File(['pixels'], name, { type: 'image/jpeg' })
  if (size !== null) Object.defineProperty(file, 'size', { value: size })
  return file
}

/** A Project "Biology" with one live link, token `tok-1`, expiring in `msLeft`. */
async function openPage({ msLeft = 10 * 60 * 1000, name = 'Biology', ...options } = {}) {
  const state = fakeApi({ projects: [project('a', { name })], ...options })
  state.links.push({
    link_id: 'link-1',
    token: 'tok-1',
    project_id: 'a',
    expires_at: new Date(Date.now() + msLeft).toISOString(),
    revoked: false,
  })
  const view = renderRoute('/u/tok-1')
  return { state, ...view }
}

function sendButton() {
  return screen.getByRole('button', { name: /^(Send|Send) / })
}

async function add(user, ...files) {
  await user.upload(screen.getByTestId('phone-gallery'), files)
}

describe('Phone upload page', () => {
  it('opens with no sign-in and shows "Uploading to {project}" and the countdown', async () => {
    await openPage()

    expect(await screen.findByRole('heading', { name: 'Uploading to Biology' })).toBeInTheDocument()
    expect(screen.getByText('Link expires in 10 min')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.phone.take })).toBeEnabled()
    expect(screen.getByRole('button', { name: en.phone.gallery })).toBeEnabled()
    expect(screen.getByText(en.footer.credit)).toBeInTheDocument()
    expect(hasSession).not.toHaveBeenCalled()
    // Only the phone link's routes, with no bearer token.
    for (const [path, options] of vi.mocked(apiFetch).mock.calls) {
      expect(path.startsWith('/api/phone/tok-1')).toBe(true)
      expect(options.auth).toBe(false)
    }
  })

  it('the camera input asks for the back camera, the gallery input for several images', async () => {
    await openPage()
    await screen.findByRole('heading', { name: 'Uploading to Biology' })

    expect(screen.getByTestId('phone-camera')).toHaveAttribute('accept', 'image/*')
    expect(screen.getByTestId('phone-camera')).toHaveAttribute('capture', 'environment')
    expect(screen.getByTestId('phone-gallery')).toHaveAttribute('multiple')
  })

  it('counts down in minutes, then in seconds in the last minute, then expires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await openPage({ msLeft: 62_000 })
    await screen.findByText('Link expires in 2 min')

    await act(() => vi.advanceTimersByTimeAsync(20_000))
    expect(screen.getByText('Link expires in 0:42')).toBeInTheDocument()

    await act(() => vi.advanceTimersByTimeAsync(43_000))
    expect(screen.getByText(en.phone.expiredTitle)).toBeInTheDocument()
    expect(screen.getByText(en.phone.expiredBody)).toBeInTheDocument()
    expect(sendButton()).toBeDisabled()
    expect(screen.queryByText(/Link expires in/)).not.toBeInTheDocument()
  })

  it('formats the countdown', () => {
    const t = i18n.getFixedT('en')
    expect(countdownText(t, 8 * 60_000)).toBe('Link expires in 8 min')
    expect(countdownText(t, 7 * 60_000 + 1)).toBe('Link expires in 8 min')
    expect(countdownText(t, 60_000)).toBe('Link expires in 1:00')
    expect(countdownText(t, 9_000)).toBe('Link expires in 0:09')
    expect(countdownText(t, 0)).toBeNull()
  })

  it('numbers the thumbnails, × removes one at once and the rest renumber; Send counts them', async () => {
    const user = userEvent.setup()
    await openPage()
    await screen.findByRole('heading', { name: 'Uploading to Biology' })
    expect(sendButton()).toHaveTextContent('Send photos')
    expect(sendButton()).toBeDisabled()

    await add(user, photo('a.jpg'), photo('b.jpg'), photo('c.jpg'))

    const strip = screen.getByRole('list')
    expect(within(strip).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['1', '2', '3'])
    expect(sendButton()).toHaveTextContent('Send 3 photos')
    expect(sendButton()).toBeEnabled()

    await user.click(within(strip).getByRole('button', { name: 'Remove 2' }))
    expect(within(strip).getAllByRole('listitem')).toHaveLength(2)
    expect(within(strip).getByRole('button', { name: 'Remove 2' })).toBeInTheDocument()
    expect(within(strip).queryByRole('button', { name: 'Remove 3' })).not.toBeInTheDocument()
    expect(sendButton()).toHaveTextContent('Send 2 photos')

    await user.click(within(strip).getByRole('button', { name: 'Remove 1' }))
    expect(sendButton()).toHaveTextContent('Send 1 photo')
    await user.click(within(strip).getByRole('button', { name: 'Remove 1' }))
    expect(sendButton()).toHaveTextContent('Send photos')
    expect(sendButton()).toBeDisabled()
  })

  it('photos from the camera join the strip too', async () => {
    const user = userEvent.setup()
    await openPage()
    await screen.findByRole('heading', { name: 'Uploading to Biology' })

    await user.upload(screen.getByTestId('phone-camera'), photo('image.jpg'))
    await user.upload(screen.getByTestId('phone-camera'), photo('image.jpg'))

    expect(sendButton()).toHaveTextContent('Send 2 photos')
  })

  it('warns before sending when there are more photos than images left today', async () => {
    const user = userEvent.setup()
    await openPage({ imagesLeft: 2 })
    await screen.findByRole('heading', { name: 'Uploading to Biology' })
    // The Limit notice at 10 or fewer.
    expect(screen.getByText('2 images left today')).toBeInTheDocument()

    await add(user, photo('a.jpg'), photo('b.jpg'))
    expect(screen.queryByText(/won't be sent/)).not.toBeInTheDocument()
    await add(user, photo('c.jpg'))

    expect(screen.getByText("You can send 2 more photos today. 1 photo won't be sent.")).toBeInTheDocument()
    // Advisory: Send stays enabled.
    expect(sendButton()).toBeEnabled()
  })

  it('shows no Limit notice above 10 images left', async () => {
    await openPage({ imagesLeft: 11 })
    await screen.findByRole('heading', { name: 'Uploading to Biology' })

    expect(screen.queryByText(/images left today/)).not.toBeInTheDocument()
  })

  it('warns before sending when the Project already has 10 files', async () => {
    const files = Array.from({ length: 10 }, (_, i) => material(`f${i}`))
    await openPage({ materials: { a: files } })
    await screen.findByRole('heading', { name: 'Uploading to Biology' })

    expect(screen.getByText(en.phone.projectFull)).toBeInTheDocument()
  })

  it('warns about a photo over 50 MB and does not send it; the rest go through', async () => {
    const user = userEvent.setup()
    const { state } = await openPage()
    await screen.findByRole('heading', { name: 'Uploading to Biology' })

    await add(user, photo('big.jpg', MAX_BYTES + 1), photo('ok.jpg'))
    expect(screen.getByText(en.phone.tooLarge)).toBeInTheDocument()
    await user.click(sendButton())

    expect(await screen.findByText(/Your photos are in Biology\./)).toBeInTheDocument()
    expect(state.photoRequests).toEqual(['ok.jpg'])
    expect(state.materials.a.map((m) => m.file_name)).toEqual(['Handwritten notes, 1 page'])
  })

  it('sends: a batch, each photo in its own request, then finalize; then "Send more"', async () => {
    const user = userEvent.setup()
    const { state } = await openPage()
    await screen.findByRole('heading', { name: 'Uploading to Biology' })
    await add(user, photo('a.jpg'), photo('b.jpg'), photo('c.jpg'))

    await user.click(sendButton())

    const sent = await screen.findByText("Your photos are in Biology. Your computer shows when they're ready.")
    expect(sent).toBeInTheDocument()
    expect(state.batches).toHaveLength(1)
    expect(state.batches[0]).toMatchObject({ photos: ['a.jpg', 'b.jpg', 'c.jpg'], finalized: true })
    expect(state.materials.a.map((m) => m.file_name)).toEqual(['Handwritten notes, 3 pages'])
    // No file list on the phone.
    expect(screen.queryByText('Handwritten notes, 3 pages')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: en.phone.sendMore }))
    expect(await screen.findByRole('heading', { name: 'Uploading to Biology' })).toBeInTheDocument()
    expect(sendButton()).toHaveTextContent('Send photos')
  })

  it('photos refused one by one are skipped and the rest go through as one file', async () => {
    const user = userEvent.setup()
    const { state } = await openPage({ imagesLeft: 2 })
    await screen.findByRole('heading', { name: 'Uploading to Biology' })
    await add(user, photo('a.jpg'), photo('b.jpg'), photo('c.jpg'))

    await user.click(sendButton())

    expect(await screen.findByText(/Your photos are in Biology\./)).toBeInTheDocument()
    expect(state.photoRequests).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(state.batches[0].photos).toEqual(['a.jpg', 'b.jpg'])
    expect(state.materials.a.map((m) => m.file_name)).toEqual(['Handwritten notes, 2 pages'])
    expect(screen.getByText("You've used today's 25 images. Try again tomorrow.")).toBeInTheDocument()
  })

  it('a full Project at finalize says so and keeps the photos', async () => {
    const user = userEvent.setup()
    const { state } = await openPage()
    await screen.findByRole('heading', { name: 'Uploading to Biology' })
    await add(user, photo('a.jpg'))
    // Ten files land on the computer meanwhile.
    state.materials.a = Array.from({ length: 10 }, (_, i) => material(`f${i}`))

    await user.click(sendButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(en.phone.projectFull)
    expect(sendButton()).toHaveTextContent('Send 1 photo')
  })

  it('an expired or revoked link shows the expired notice with Send disabled', async () => {
    fakeApi({ projects: [project('a')] })
    renderRoute('/u/unknown-token')

    expect(await screen.findByText(en.phone.expiredTitle)).toBeInTheDocument()
    expect(screen.getByText(en.phone.expiredBody)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Send/ })).not.toBeInTheDocument()
    expect(en.errors.link_expired).toBe('This link has expired. Scan a new code on your computer.')
  })

  it('a link revoked while sending stops with the expired notice; the photos stay, dimmed, and Send is disabled', async () => {
    const user = userEvent.setup()
    const { state } = await openPage()
    await screen.findByRole('heading', { name: 'Uploading to Biology' })
    await add(user, photo('a.jpg'), photo('b.jpg'))
    // The computer closes the QR dialog.
    state.links[0].revoked = true

    await user.click(sendButton())

    expect(await screen.findByText(en.phone.expiredTitle)).toBeInTheDocument()
    expect(sendButton()).toBeDisabled()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument()
    expect(state.batches).toHaveLength(0)
    expect(state.materials.a ?? []).toEqual([])
  })

  it('an unnamed Project shows the placeholder name', async () => {
    await openPage({ name: null })

    expect(await screen.findByRole('heading', { name: 'Uploading to New project' })).toBeInTheDocument()
  })

  it('speaks Norwegian when the browser does', async () => {
    await i18n.changeLanguage('nb')
    const user = userEvent.setup()
    await openPage({ imagesLeft: 1 })

    expect(await screen.findByRole('heading', { name: 'Laster opp til Biology' })).toBeInTheDocument()
    expect(screen.getByText('Lenken utløper om 10 min')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ta bilder' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Velg fra galleriet' })).toBeInTheDocument()
    expect(screen.getByText('1 bilde igjen i dag')).toBeInTheDocument()
    expect(sendButton()).toHaveTextContent(nb.phone.sendNone)

    await add(user, photo('a.jpg'), photo('b.jpg'))
    expect(sendButton()).toHaveTextContent('Send 2 bilder')
    expect(screen.getByText('Du kan sende 1 bilde til i dag. 1 bilde blir ikke sendt.')).toBeInTheDocument()

    await user.click(sendButton())
    expect(await screen.findByText('Bildene er i Biology. Datamaskinen viser når de er klare.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send flere' })).toBeInTheDocument()
  })

  it('shows the expired notice in Norwegian', async () => {
    await i18n.changeLanguage('nb')
    fakeApi({ projects: [project('a')] })
    renderRoute('/u/gone')

    expect(await screen.findByText('Lenken er utløpt.')).toBeInTheDocument()
    expect(screen.getByText('Skann en ny kode på datamaskinen.')).toBeInTheDocument()
  })

  it('a failed first load offers Try again', async () => {
    const user = userEvent.setup()
    const routes = {
      'GET /api/phone/tok-1': () => {
        throw { code: 'network_error', params: {} }
      },
    }
    await openPage({ routes })

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.generic)
    delete routes['GET /api/phone/tok-1']
    await user.click(screen.getByRole('button', { name: en.inlineError.retry }))

    expect(await screen.findByRole('heading', { name: 'Uploading to Biology' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a retry after a failed finalize reuses the open batch and sends no photo twice', async () => {
    const user = userEvent.setup()
    const routes = {
      'POST /api/phone/tok-1/batches/batch-1/finalize': () => {
        delete routes['POST /api/phone/tok-1/batches/batch-1/finalize']
        throw { code: 'network_error', params: {} }
      },
    }
    const { state } = await openPage({ routes })
    await screen.findByRole('heading', { name: 'Uploading to Biology' })
    await add(user, photo('a.jpg'), photo('b.jpg'))

    await user.click(sendButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.generic)
    // Both photos are on the server: no × for them, and Send tries again.
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument()
    await user.click(sendButton())

    expect(await screen.findByText(/Your photos are in Biology\./)).toBeInTheDocument()
    expect(state.batches).toHaveLength(1)
    expect(state.photoRequests).toEqual(['a.jpg', 'b.jpg'])
    expect(state.imagesLeft).toBe(23)
    expect(state.materials.a.map((m) => m.file_name)).toEqual(['Handwritten notes, 2 pages'])
  })

  it('a finalize whose answer was lost (conflict on retry) counts as sent', async () => {
    const user = userEvent.setup()
    const routes = {
      'POST /api/phone/tok-1/batches/batch-1/finalize': (body, state) => {
        state.batches[0].finalized = true
        routes['POST /api/phone/tok-1/batches/batch-1/finalize'] = () => {
          throw { code: 'conflict', params: {} }
        }
        throw { code: 'network_error', params: {} }
      },
    }
    await openPage({ routes })
    await screen.findByRole('heading', { name: 'Uploading to Biology' })
    await add(user, photo('a.jpg'))

    await user.click(sendButton())
    await screen.findByRole('alert')
    await user.click(sendButton())

    expect(await screen.findByText(/Your photos are in Biology\./)).toBeInTheDocument()
  })

  it('when the link expires mid-send, the photos already in are still finalized', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { state } = await openPage({
      msLeft: 60_000,
      routes: {
        'POST /api/phone/tok-1/batches/batch-1/photos': (body, live) => {
          if (live.batches[0].photos.length > 0) throw { code: 'link_expired', params: {} }
          live.batches[0].photos.push(body.get('file').name)
          live.imagesLeft -= 1
          // The link expires while the first photo is sent.
          vi.setSystemTime(Date.now() + 61_000)
          return { page: 1 }
        },
      },
    })
    await screen.findByRole('heading', { name: 'Uploading to Biology' })
    await add(user, photo('a.jpg'), photo('b.jpg'))

    await user.click(sendButton())

    expect(await screen.findByText(/Your photos are in Biology\./)).toBeInTheDocument()
    expect(state.materials.a.map((m) => m.file_name)).toEqual(['Handwritten notes, 1 page'])
    // Expired now: no "Send more".
    await waitFor(() => expect(screen.queryByRole('button', { name: en.phone.sendMore })).not.toBeInTheDocument())
  })

  it("counts down on the server's clock, whatever the phone's clock says", async () => {
    // The server is 5.5 minutes ahead of this phone (the Date header has whole seconds); the link has
    // 10 minutes left by the phone's clock, 4.5 by the server's.
    await openPage({ serverOffsetMs: 5.5 * 60_000 })

    expect(await screen.findByText('Link expires in 5 min')).toBeInTheDocument()
  })

  it('a link revoked while the page sits idle shows as expired within 30 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { state } = await openPage()
    await screen.findByRole('heading', { name: 'Uploading to Biology' })

    state.links[0].revoked = true
    await act(() => vi.advanceTimersByTimeAsync(30_000))

    expect(screen.getByText(en.phone.expiredTitle)).toBeInTheDocument()
    expect(sendButton()).toBeDisabled()
  })

  it('a link revoked while the page was hidden shows as expired when it becomes visible', async () => {
    const { state } = await openPage()
    await screen.findByRole('heading', { name: 'Uploading to Biology' })
    state.links[0].revoked = true
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(await screen.findByText(en.phone.expiredTitle)).toBeInTheDocument()
    expect(sendButton()).toBeDisabled()
    visibility.mockRestore()
  })

  it("with no images left today, it shows today's limit message", async () => {
    const user = userEvent.setup()
    await openPage({ imagesLeft: 0 })
    await screen.findByRole('heading', { name: 'Uploading to Biology' })

    await add(user, photo('a.jpg'))

    expect(screen.getByText("You've used today's 25 images. Try again tomorrow.")).toBeInTheDocument()
    expect(screen.queryByText(/You can send 0/)).not.toBeInTheDocument()
  })
})
