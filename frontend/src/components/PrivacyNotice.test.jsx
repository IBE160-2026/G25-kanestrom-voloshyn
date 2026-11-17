// The Privacy notice before the first upload (Story 2.3, FR-6, §5.3, AD-19). api/client.js and auth/
// are mocked (spine › Tests); test/fakeApi.js plays the backend.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { PROFILE, callsTo, fakeApi, project } from '../test/fakeApi.js'
import { i18n, renderRoute } from '../test/render.jsx'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

const NOT_ACCEPTED = { ...PROFILE, privacy_notice_accepted: false }

beforeEach(() => {
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function drop(target, files) {
  const dataTransfer = { files, types: ['Files'], dropEffect: 'none' }
  fireEvent.dragOver(target, { dataTransfer })
  fireEvent.drop(target, { dataTransfer })
}

async function openProject(me = NOT_ACCEPTED) {
  const state = fakeApi({ me, projects: [project('a')] })
  renderRoute('/projects/a')
  await screen.findByRole('button', { name: en.files.upload })
  return state
}

const uploads = () => callsTo('/api/projects/a/materials', 'POST')
const accepts = () => callsTo('/api/me/privacy-notice', 'POST')

describe('Privacy notice', () => {
  it('a drop opens the notice first; Cancel uploads nothing and discards the files', async () => {
    await openProject()
    const user = userEvent.setup()

    drop(screen.getByTestId('drop-zone'), [new File(['x'], 'notes.md')])

    const dialog = await screen.findByRole('dialog', { name: en.privacyNotice.title })
    expect(within(dialog).getByText(en.privacyNotice.body)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: en.privacyNotice.cancel }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(uploads()).toEqual([])
    expect(accepts()).toEqual([])
  })

  it('Esc acts as Cancel', async () => {
    await openProject()
    const user = userEvent.setup()
    drop(screen.getByTestId('drop-zone'), [new File(['x'], 'notes.md')])
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(uploads()).toEqual([])
  })

  it('"Got it, upload" saves the acceptance, uploads the dropped files, and never asks again', async () => {
    const state = await openProject()
    const user = userEvent.setup()
    drop(screen.getByTestId('drop-zone'), [new File(['x'], 'notes.md')])

    await user.click(await screen.findByRole('button', { name: en.privacyNotice.accept }))

    await waitFor(() => expect(uploads()).toHaveLength(1))
    expect(accepts()).toHaveLength(1)
    expect(state.me.privacy_notice_accepted).toBe(true)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    drop(screen.getByRole('complementary', { name: /^Files · / }), [new File(['y'], 'more.md')])
    await waitFor(() => expect(uploads()).toHaveLength(2))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Upload opens the notice; "Got it, upload" opens the file picker in the same click', async () => {
    await openProject()
    const user = userEvent.setup()
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})

    await user.click(screen.getByRole('button', { name: en.files.upload }))
    expect(click).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: en.privacyNotice.accept }))

    expect(click).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(accepts()).toHaveLength(1))
  })

  it('files picked after "Got it, upload" upload once the acceptance is saved', async () => {
    await openProject()
    const user = userEvent.setup()
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    await user.click(screen.getByRole('button', { name: en.files.upload }))
    await user.click(await screen.findByRole('button', { name: en.privacyNotice.accept }))

    await user.upload(screen.getByTestId('file-picker'), new File(['x'], 'notes.md'))

    await waitFor(() => expect(uploads()).toHaveLength(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('an accepted Account uploads with no notice', async () => {
    await openProject(PROFILE)
    drop(screen.getByTestId('drop-zone'), [new File(['x'], 'notes.md')])

    await waitFor(() => expect(uploads()).toHaveLength(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('"How your files are used" shows the same text with only "Close"', async () => {
    await openProject(PROFILE)
    const user = userEvent.setup()
    const link = screen.getByRole('button', { name: en.privacyNotice.link })

    await user.click(link)

    const dialog = await screen.findByRole('dialog', { name: en.privacyNotice.title })
    expect(within(dialog).getByText(en.privacyNotice.body)).toBeInTheDocument()
    expect(within(dialog).getAllByRole('button').map((b) => b.textContent)).toEqual([en.privacyNotice.close])
    await user.click(within(dialog).getByRole('button', { name: en.privacyNotice.close }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // Focus returns to the opener.
    expect(link).toHaveFocus()
  })

  it('is in Norwegian too', async () => {
    await i18n.changeLanguage('nb')
    try {
      fakeApi({ me: NOT_ACCEPTED, projects: [project('a')] })
      renderRoute('/projects/a')
      const user = userEvent.setup()
      await user.click(await screen.findByRole('button', { name: nb.files.upload }))

      const dialog = await screen.findByRole('dialog', { name: nb.privacyNotice.title })
      expect(within(dialog).getByText(nb.privacyNotice.body)).toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: nb.privacyNotice.accept })).toBeInTheDocument()
    } finally {
      await i18n.changeLanguage('en')
    }
  })

  it('a failed save keeps the notice open with a calm message, and picked files are not sent', async () => {
    fakeApi({
      me: NOT_ACCEPTED,
      projects: [project('a')],
      routes: {
        'POST /api/me/privacy-notice': () => {
          throw { code: 'internal_error', params: {} }
        },
      },
    })
    renderRoute('/projects/a')
    // The picker is chosen while the modal is still open (its scrim blocks pointer events).
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    await user.click(await screen.findByRole('button', { name: en.files.upload }))
    await user.click(await screen.findByRole('button', { name: en.privacyNotice.accept }))

    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(en.errors.internal_error)
    expect(within(dialog).getByRole('button', { name: en.privacyNotice.accept })).toBeEnabled()

    await user.upload(screen.getByTestId('file-picker'), new File(['x'], 'notes.md'))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(uploads()).toEqual([])
  })

  it('"browse" in the drop zone and a drop on the Files strip open the notice too', async () => {
    fakeApi({ me: { ...NOT_ACCEPTED, ui_prefs: { files_collapsed: { a: true } } }, projects: [project('a')] })
    renderRoute('/projects/a')
    const user = userEvent.setup()
    const strip = await screen.findByRole('complementary', { name: en.files.show })

    drop(strip, [new File(['x'], 'notes.md')])
    expect(await screen.findByRole('dialog', { name: en.privacyNotice.title })).toBeInTheDocument()
    await user.keyboard('{Escape}')

    const browse = within(screen.getByTestId('drop-zone')).getByRole('button')
    await user.click(browse)
    expect(await screen.findByRole('dialog', { name: en.privacyNotice.title })).toBeInTheDocument()
    expect(uploads()).toEqual([])
  })

  it('Cancel gives focus back to Upload', async () => {
    await openProject()
    const user = userEvent.setup()
    const upload = screen.getByRole('button', { name: en.files.upload })

    await user.click(upload)
    await user.click(await screen.findByRole('button', { name: en.privacyNotice.cancel }))

    expect(upload).toHaveFocus()
  })
})
