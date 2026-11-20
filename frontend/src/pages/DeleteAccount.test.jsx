// Delete my account (Story 7.4, FR-28, EXPERIENCE.md › Confirm dialog (delete account)). api/client.js
// and auth/ are mocked (spine › Tests); test/fakeApi.js plays the backend.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, detachSignedOutListener } from '../api/client.js'
import { hasSession, signOut } from '../auth/index.js'
import { RETURN_TO_KEY } from '../auth/returnTo.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { PROFILE, callsTo, fakeApi, project } from '../test/fakeApi.js'
import { i18n, renderRoute } from '../test/render.jsx'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

const WIDTH = window.innerWidth
const BIOLOGY = project('bio', { name: 'Biology', name_source: 'student' })

beforeEach(() => {
  vi.mocked(apiFetch).mockReset()
  vi.mocked(detachSignedOutListener).mockReset()
  window.sessionStorage.removeItem(RETURN_TO_KEY)
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
  // Like the real signOut: the session is gone once it resolves.
  vi.mocked(signOut)
    .mockReset()
    .mockImplementation(async () => {
      vi.mocked(hasSession).mockResolvedValue(false)
      return { ended: Promise.resolve() }
    })
  window.innerWidth = 1280
})

afterEach(async () => {
  window.innerWidth = WIDTH
  await i18n.changeLanguage('en')
})

const dialogText = (lang) => lang.settings.deleteAccountDialog

/** Opens Settings the way a student does: Account menu › Settings, over the Projects page. */
async function openSettings(lang = en) {
  const result = renderRoute('/projects')
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: new RegExp(`^${lang.account.welcome.split('{{')[0]}`) }))
  await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: lang.account.settings }))
  await screen.findByRole('region', { name: lang.settings.data.heading })
  return result
}

const entry = (lang = en) =>
  within(screen.getByRole('region', { name: lang.settings.data.heading })).getByRole('button', {
    name: lang.settings.data.deleteAccountButton,
  })

async function openDialog(user, lang = en) {
  await user.click(entry(lang))
  return screen.findByRole('dialog', { name: dialogText(lang).title })
}

const labelOf = (lang = en) => dialogText(lang).label.replace('{{word}}', dialogText(lang).word)
const wordInput = (dialog, lang = en) => within(dialog).getByLabelText(labelOf(lang))
const confirmButton = (dialog, lang = en) => within(dialog).getByRole('button', { name: dialogText(lang).confirm })

describe('Settings › Your data', () => {
  it('shows "Delete my account and all my files" with its button, also without Projects', async () => {
    fakeApi({ projects: [] })
    await openSettings()
    const data = screen.getByRole('region', { name: en.settings.data.heading })

    expect(data).toHaveTextContent(en.settings.data.deleteAccount)
    expect(entry()).toHaveAccessibleDescription(en.settings.data.deleteAccount)
  })
})

describe('Confirm dialog (delete account)', () => {
  it('names what is lost, says it cannot be undone, and starts in the input with Delete disabled', async () => {
    fakeApi({ projects: [BIOLOGY] })
    const user = userEvent.setup()
    await openSettings()

    const dialog = await openDialog(user)

    expect(dialog).toHaveTextContent(dialogText(en).lost)
    expect(dialog).toHaveTextContent(dialogText(en).final)
    expect(wordInput(dialog)).toHaveFocus()
    expect(confirmButton(dialog)).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: dialogText(en).cancel })).toBeEnabled()
  })

  it.each([
    ['delete', false],
    ['DELET', false],
    [' DELETE ', true],
    ['SLETT', false],
  ])('typing "%s" enables Delete: %s', async (typed, enabled) => {
    fakeApi({ projects: [BIOLOGY] })
    const user = userEvent.setup()
    await openSettings()
    const dialog = await openDialog(user)

    await user.type(wordInput(dialog), typed)

    if (enabled) expect(confirmButton(dialog)).toBeEnabled()
    else expect(confirmButton(dialog)).toBeDisabled()
  })

  it('Enter with the wrong word sends nothing', async () => {
    const state = fakeApi({ projects: [BIOLOGY] })
    const user = userEvent.setup()
    await openSettings()
    const dialog = await openDialog(user)

    await user.type(wordInput(dialog), 'delete{Enter}')

    expect(state.accountDeleted).toBe(false)
    expect(callsTo('/api/me', 'DELETE')).toHaveLength(0)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it.each([
    ['Cancel', async (user, dialog) => user.click(within(dialog).getByRole('button', { name: dialogText(en).cancel }))],
    ['Esc', async (user) => user.keyboard('{Escape}')],
  ])('%s changes nothing and gives focus back to the button', async (_, close) => {
    const state = fakeApi({ projects: [BIOLOGY] })
    const user = userEvent.setup()
    await openSettings()
    const dialog = await openDialog(user)
    await user.type(wordInput(dialog), 'DELETE')

    await close(user, dialog)

    // Only the confirm dialog closes; Settings stays open under it.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: dialogText(en).title })).not.toBeInTheDocument())
    expect(screen.getByRole('dialog', { name: en.settings.title })).toBeInTheDocument()
    await waitFor(() => expect(entry()).toHaveFocus())
    expect(state.accountDeleted).toBe(false)
    expect(callsTo('/api/me', 'DELETE')).toHaveLength(0)
    expect(signOut).not.toHaveBeenCalled()

    // Opened again, the word is cleared.
    const again = await openDialog(user)
    expect(wordInput(again)).toHaveValue('')
    expect(confirmButton(again)).toBeDisabled()
  })

  it('confirming deletes the Account, ends the session, and lands on Login with the notice; Back stays out', async () => {
    const state = fakeApi({ projects: [BIOLOGY] })
    const order = []
    vi.mocked(detachSignedOutListener).mockImplementation(() => order.push('detach'))
    vi.mocked(signOut).mockImplementation(async () => {
      order.push('signOut')
      vi.mocked(hasSession).mockResolvedValue(false)
      return { ended: Promise.resolve() }
    })
    const user = userEvent.setup()
    // Settings opens over an app page, so there is an app page to go Back to.
    const { router } = await openSettings()
    // A route remembered earlier is forgotten with the Account.
    window.sessionStorage.setItem(RETURN_TO_KEY, '/projects/bio')
    const dialog = await openDialog(user)

    await user.type(wordInput(dialog), 'DELETE')
    await user.click(confirmButton(dialog))

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(state.accountDeleted).toBe(true)
    expect(callsTo('/api/me', 'DELETE')).toHaveLength(1)
    expect(order).toEqual(['detach', 'signOut'])
    expect(window.sessionStorage.getItem(RETURN_TO_KEY)).toBeNull()
    expect(await screen.findByRole('status')).toHaveTextContent(en.account.deleted)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await router.navigate(-1)
    await waitFor(() => expect(screen.getByRole('form', { name: en.login.submit })).toBeInTheDocument())
    expect(screen.queryByRole('region', { name: en.settings.data.heading })).not.toBeInTheDocument()
  })

  it('a failing sign-out after the deletion still lands on Login with the notice', async () => {
    const state = fakeApi({ projects: [BIOLOGY] })
    vi.mocked(signOut).mockImplementation(async () => {
      vi.mocked(hasSession).mockResolvedValue(false)
      throw new Error('storage unavailable')
    })
    const user = userEvent.setup()
    const { router } = await openSettings()
    const dialog = await openDialog(user)

    await user.type(wordInput(dialog), 'DELETE')
    await user.click(confirmButton(dialog))

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(state.accountDeleted).toBe(true)
    expect(await screen.findByRole('status')).toHaveTextContent(en.account.deleted)
  })

  it('while deleting, Esc and Cancel do nothing, the input is read-only, and both buttons are disabled', async () => {
    let answer
    fakeApi({
      projects: [BIOLOGY],
      routes: {
        'DELETE /api/me': () =>
          new Promise((resolve) => {
            answer = resolve
          }),
      },
    })
    const user = userEvent.setup()
    const { router } = await openSettings()
    const dialog = await openDialog(user)
    await user.type(wordInput(dialog), 'DELETE')

    await user.click(confirmButton(dialog))

    await waitFor(() => expect(confirmButton(dialog)).toBeDisabled())
    expect(confirmButton(dialog)).toHaveAttribute('aria-busy', 'true')
    const cancel = within(dialog).getByRole('button', { name: dialogText(en).cancel })
    expect(cancel).toBeDisabled()
    expect(wordInput(dialog)).toHaveAttribute('readonly')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(signOut).not.toHaveBeenCalled()

    answer(null)
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('a failed request keeps the dialog open with an error line and signs nothing out', async () => {
    const state = fakeApi({
      projects: [BIOLOGY],
      routes: {
        'DELETE /api/me': () => {
          throw { code: 'auth_unavailable', params: {} }
        },
      },
    })
    const user = userEvent.setup()
    const { router } = await openSettings()
    const dialog = await openDialog(user)

    await user.type(wordInput(dialog), 'DELETE')
    await user.click(confirmButton(dialog))

    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(confirmButton(dialog)).toBeEnabled()
    expect(state.accountDeleted).toBe(false)
    expect(signOut).not.toHaveBeenCalled()
    expect(router.state.location.pathname).not.toBe('/')
    expect(screen.getByRole('region', { name: en.settings.data.heading, hidden: true })).toBeInTheDocument()
  })
})

describe('Norwegian', () => {
  it('reads in Norwegian, and only SLETT enables Delete', async () => {
    await i18n.changeLanguage('nb')
    fakeApi({ me: { ...PROFILE, language: 'nb' }, projects: [BIOLOGY] })
    const user = userEvent.setup()
    await openSettings(nb)

    expect(screen.getByRole('region', { name: nb.settings.data.heading })).toHaveTextContent(nb.settings.data.deleteAccount)
    const dialog = await openDialog(user, nb)
    expect(wordInput(dialog, nb)).toBeInTheDocument()
    expect(labelOf(nb)).toBe('Skriv SLETT for å bekrefte')
    expect(dialog).toHaveTextContent(dialogText(nb).lost)
    expect(dialog).toHaveTextContent(dialogText(nb).final)

    await user.type(wordInput(dialog, nb), 'DELETE')
    expect(confirmButton(dialog, nb)).toBeDisabled()
    await user.clear(wordInput(dialog, nb))
    await user.type(wordInput(dialog, nb), 'slett')
    expect(confirmButton(dialog, nb)).toBeDisabled()
    await user.clear(wordInput(dialog, nb))
    await user.type(wordInput(dialog, nb), 'SLETT')
    expect(confirmButton(dialog, nb)).toBeEnabled()
  })

  it('Login shows the deleted notice in Norwegian', async () => {
    await i18n.changeLanguage('nb')
    fakeApi({ me: { ...PROFILE, language: 'nb' }, projects: [BIOLOGY] })
    const user = userEvent.setup()
    const { router } = await openSettings(nb)
    const dialog = await openDialog(user, nb)

    await user.type(wordInput(dialog, nb), 'SLETT')
    await user.click(confirmButton(dialog, nb))

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(await screen.findByRole('status')).toHaveTextContent(nb.account.deleted)
  })
})
