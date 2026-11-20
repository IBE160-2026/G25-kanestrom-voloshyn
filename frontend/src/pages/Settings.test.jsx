// Settings (Story 7.3a, FR-27, FR-29, EXPERIENCE.md › IA › Settings): the Account, Language, and Your
// data sections, Change password, and the Account menu entry. api/client.js and auth/ are mocked
// (spine › Tests); test/fakeApi.js plays the backend.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client.js'
import { hasSession, setNewPassword, signOut } from '../auth/index.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { CURRENT_PASSWORD, PROFILE, callsTo, fakeApi, project } from '../test/fakeApi.js'
import { i18n, renderRoute } from '../test/render.jsx'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

const WIDTH = window.innerWidth
const NEW_PASSWORD = 'brand-new-pass-9'
const PICTURE = 'https://lh3.googleusercontent.com/a/emma-photo'
const GOOGLE = { ...PROFILE, sign_in_methods: ['email', 'google'], picture_url: PICTURE }
const GOOGLE_ONLY = { ...PROFILE, sign_in_methods: ['google'], picture_url: PICTURE }

const BIOLOGY = project('bio', { name: 'Biology', name_source: 'student' })
const CHEMISTRY = project('chem', { name: 'Chemistry', name_source: 'student', archived_at: '2026-11-15T10:00:00Z' })
const ANATOMY = project('ana', {
  name: 'Anatomy',
  name_source: 'student',
  deleted_at: '2026-11-15T10:00:00Z',
  purge_at: '2099-12-15T10:00:00Z',
})

beforeEach(() => {
  vi.mocked(apiFetch).mockReset()
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
  vi.mocked(signOut).mockReset().mockResolvedValue({ ended: Promise.resolve() })
  vi.mocked(setNewPassword).mockReset().mockResolvedValue({ ok: true })
  window.innerWidth = 1280
})

afterEach(async () => {
  window.innerWidth = WIDTH
  await i18n.changeLanguage('en')
})

function setup(options = {}) {
  return fakeApi({ projects: [BIOLOGY, CHEMISTRY, ANATOMY], ...options })
}

const section = (name) => screen.getByRole('region', { name })

/** Opens Settings the way a student does: Account menu › Settings, over the page at `path`. */
async function openSettings(lang = en, path = '/projects') {
  const result = renderRoute(path)
  await openFromMenu(lang)
  await screen.findByRole('region', { name: lang.settings.account.heading })
  return result
}

async function openFromMenu(lang = en, menu = new RegExp(`^${lang.account.welcome.split('{{')[0]}`)) {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: menu }))
  await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: lang.account.settings }))
}

const nameInput = () => within(section(en.settings.account.heading)).getByRole('textbox', { name: en.settings.account.firstName })

async function openPasswordForm(user) {
  await user.click(screen.getByRole('button', { name: en.settings.password.open }))
  return screen.getByRole('form', { name: en.settings.password.open })
}

async function fillPassword(user, form, { current = CURRENT_PASSWORD, next = NEW_PASSWORD, repeat = next } = {}) {
  if (current) await user.type(within(form).getByLabelText(en.settings.password.current), current)
  if (next) await user.type(within(form).getByLabelText(en.settings.password.new), next)
  if (repeat) await user.type(within(form).getByLabelText(en.settings.password.repeat), repeat)
  await user.click(within(form).getByRole('button', { name: en.settings.password.save }))
}

describe('Opening Settings', () => {
  it('the Account menu opens Settings as an overlay over the current page, with the title and the four sections', async () => {
    setup()
    const user = userEvent.setup()
    const { router } = renderRoute('/projects/bio')
    await screen.findByRole('button', { name: 'Welcome, Emma' })
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/bio'))

    await user.click(screen.getByRole('button', { name: 'Welcome, Emma' }))
    const menu = screen.getByRole('menu')
    expect(menu.querySelector('[role^="menuitem"]')).toHaveTextContent(en.account.settings)
    await user.click(within(menu).getByRole('menuitem', { name: en.account.settings }))

    const dialog = await screen.findByRole('dialog', { name: en.settings.title })
    expect(within(dialog).getByRole('heading', { level: 1, name: en.settings.title })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/projects/bio')
    expect(screen.getAllByRole('region').map((r) => within(r).getByRole('heading', { level: 2 }).textContent)).toEqual([
      en.settings.account.heading,
      en.settings.language.heading,
      en.settings.appearance.heading,
      en.settings.data.heading,
    ])
  })

  it.each([
    ['a click outside', async (user) => user.click(document.body)],
    ['Esc', async (user) => user.keyboard('{Escape}')],
    ['Close', async (user) => user.click(screen.getByRole('button', { name: en.settings.close }))],
  ])('%s closes Settings: the page behind is unchanged and focus is back on the Account menu', async (_, close) => {
    setup()
    // The scrim blocks pointer events, as in the browser; the click lands outside the panel.
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const { router } = renderRoute('/projects/bio')
    await screen.findByRole('button', { name: 'Welcome, Emma' })
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/bio'))
    await openFromMenu()
    await screen.findByRole('dialog', { name: en.settings.title })

    await close(user)

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(router.state.location.pathname).toBe('/projects/bio')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Welcome, Emma' })).toHaveFocus())
  })

  it('a failed profile load shows an error line', async () => {
    setup({
      routes: {
        'GET /api/me': () => {
          throw { code: 'internal_error', params: {} }
        },
      },
    })
    renderRoute('/projects')
    await openFromMenu(en, en.account.menu)

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.internal_error)
    expect(screen.queryByRole('region', { name: en.settings.account.heading })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: en.settings.language.heading })).toBeInTheDocument()
  })
})

describe('Account (email)', () => {
  it('a verified email Account shows "Email verified" under the address; an unverified one does not', async () => {
    setup({ me: { ...PROFILE, email_verified: true } })
    await openSettings()
    expect(section(en.settings.account.heading)).toHaveTextContent(en.settings.account.verified)
    expect(screen.queryByText(en.settings.account.verifyFirst)).not.toBeInTheDocument()
  })

  it('an unverified email Account shows no "Email verified" line', async () => {
    setup()
    await openSettings()
    expect(screen.queryByText(en.settings.account.verified)).not.toBeInTheDocument()
    expect(screen.getByText(en.settings.account.verifyFirst)).toBeInTheDocument()
  })

  it('reads "E-postadressen er bekreftet" in Norwegian', async () => {
    await i18n.changeLanguage('nb')
    setup({ me: { ...PROFILE, email_verified: true, language: 'nb' } })
    await openSettings(nb)
    expect(section(nb.settings.account.heading)).toHaveTextContent(nb.settings.account.verified)
  })

  it('shows the editable name, the email, "Signs in with email", Log out, and Change password', async () => {
    setup()
    await openSettings()
    const account = section(en.settings.account.heading)

    expect(account).toHaveTextContent(en.settings.account.leadEmail)
    expect(nameInput()).toHaveValue('Emma')
    expect(account).toHaveTextContent('emma@example.com')
    expect(account).toHaveTextContent(en.settings.account.viaEmail)
    expect(within(account).getByText('E')).toBeInTheDocument() // the initials avatar
    expect(within(account).getByRole('button', { name: en.settings.account.logOut })).toBeInTheDocument()
    expect(within(account).getByRole('button', { name: en.settings.password.open })).toBeEnabled()
  })

  it('"Ana" + Enter saves the name, and the greeting follows at once', async () => {
    const state = setup()
    const user = userEvent.setup()
    await openSettings()

    await user.clear(nameInput())
    await user.type(nameInput(), '  Ana {Enter}')

    expect(await screen.findByRole('button', { name: 'Welcome, Ana', hidden: true })).toBeInTheDocument()
    expect(callsTo('/api/me', 'PATCH').map(([, options]) => options.body)).toEqual([{ first_name: 'Ana' }])
    expect(state.me.first_name).toBe('Ana')
    expect(nameInput()).toHaveValue('Ana')

    // A blur after the save sends nothing more.
    await user.tab()
    expect(callsTo('/api/me', 'PATCH')).toHaveLength(1)
  })

  it('the name also saves on blur', async () => {
    setup()
    const user = userEvent.setup()
    await openSettings()

    await user.clear(nameInput())
    await user.type(nameInput(), 'Ana')
    await user.tab()

    expect(await screen.findByRole('button', { name: 'Welcome, Ana', hidden: true })).toBeInTheDocument()
  })

  it('a blank name reverts, with no request', async () => {
    setup()
    const user = userEvent.setup()
    await openSettings()

    await user.clear(nameInput())
    await user.type(nameInput(), '   {Enter}')

    expect(nameInput()).toHaveValue('Emma')
    expect(callsTo('/api/me', 'PATCH')).toHaveLength(0)
  })

  it('a long name is cut to 100 code points, never inside an emoji', async () => {
    const state = setup()
    const user = userEvent.setup()
    await openSettings()

    await user.clear(nameInput())
    await user.type(nameInput(), `${'A'.repeat(99)}😀😀{Enter}`)

    await waitFor(() => expect(callsTo('/api/me', 'PATCH')).toHaveLength(1))
    expect(callsTo('/api/me', 'PATCH')[0][1].body).toEqual({ first_name: `${'A'.repeat(99)}😀` })
    expect(state.me.first_name).toBe(`${'A'.repeat(99)}😀`)
  })

  it('an edit during a save is saved after it, and the reply does not overwrite it', async () => {
    const replies = []
    const state = setup({
      routes: {
        'PATCH /api/me': (body, s) => new Promise((resolve) => replies.push(() => resolve(Object.assign(s.me, body)))),
      },
    })
    const user = userEvent.setup()
    await openSettings()

    await user.clear(nameInput())
    await user.type(nameInput(), 'Ana{Enter}')
    await waitFor(() => expect(replies).toHaveLength(1))
    await user.clear(nameInput())
    await user.type(nameInput(), 'Bo{Enter}')
    expect(replies).toHaveLength(1) // one save at a time

    replies[0]()
    await waitFor(() => expect(replies).toHaveLength(2))
    expect(nameInput()).toHaveValue('Bo')
    replies[1]()

    expect(await screen.findByRole('button', { name: 'Welcome, Bo', hidden: true })).toBeInTheDocument()
    expect(callsTo('/api/me', 'PATCH').map(([, options]) => options.body)).toEqual([{ first_name: 'Ana' }, { first_name: 'Bo' }])
    expect(state.me.first_name).toBe('Bo')
    expect(nameInput()).toHaveValue('Bo')
  })

  it('Esc during a save keeps the reverted value and saves it after', async () => {
    const replies = []
    const state = setup({
      routes: {
        'PATCH /api/me': (body, s) => new Promise((resolve) => replies.push(() => resolve(Object.assign(s.me, body)))),
      },
    })
    const user = userEvent.setup()
    await openSettings()

    await user.clear(nameInput())
    await user.type(nameInput(), 'Ana{Enter}')
    await waitFor(() => expect(replies).toHaveLength(1))
    await user.type(nameInput(), '{Escape}')
    expect(nameInput()).toHaveValue('Emma')

    replies[0]()
    await waitFor(() => expect(replies).toHaveLength(2))
    expect(nameInput()).toHaveValue('Emma')
    replies[1]()

    await waitFor(() => expect(state.me.first_name).toBe('Emma'))
    expect(callsTo('/api/me', 'PATCH').map(([, options]) => options.body)).toEqual([{ first_name: 'Ana' }, { first_name: 'Emma' }])
    expect(await screen.findByRole('button', { name: 'Welcome, Emma', hidden: true })).toBeInTheDocument()
  })

  it('Esc reverts an unsaved edit', async () => {
    setup()
    const user = userEvent.setup()
    await openSettings()

    await user.clear(nameInput())
    await user.type(nameInput(), 'Ana{Escape}')

    expect(nameInput()).toHaveValue('Emma')
  })

  it('a failed save shows an error line and keeps the value', async () => {
    setup({
      routes: {
        'PATCH /api/me': () => {
          throw { code: 'internal_error', params: {} }
        },
      },
    })
    const user = userEvent.setup()
    await openSettings()

    await user.clear(nameInput())
    await user.type(nameInput(), 'Ana{Enter}')

    expect(await within(section(en.settings.account.heading)).findByRole('alert')).toHaveTextContent(en.errors.internal_error)
    expect(nameInput()).toHaveValue('Ana')
    expect(screen.getByRole('button', { name: 'Welcome, Emma', hidden: true })).toBeInTheDocument()
  })

  it('Log out ends the session and goes to Login', async () => {
    setup()
    const user = userEvent.setup()
    const { router } = await openSettings()

    vi.mocked(hasSession).mockResolvedValue(false)
    await user.click(within(section(en.settings.account.heading)).getByRole('button', { name: en.settings.account.logOut }))

    expect(signOut).toHaveBeenCalled()
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })
})

describe('Account (Google)', () => {
  it('a Google-linked Account shows the name, email and picture read-only, and both sign-in methods', async () => {
    setup({ me: GOOGLE })
    await openSettings()
    const account = section(en.settings.account.heading)

    expect(account).toHaveTextContent(en.settings.account.leadGoogle)
    expect(within(account).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(account).getByText('Emma')).toBeInTheDocument()
    expect(account).toHaveTextContent('emma@example.com')
    // One line for both methods.
    expect(within(account).getByText(en.settings.account.viaBoth)).toBeInTheDocument()
    expect(within(account).queryByText(en.settings.account.viaEmail)).not.toBeInTheDocument()
    expect(within(account).queryByText(en.settings.account.viaGoogle)).not.toBeInTheDocument()
    expect(account.querySelector(`img[src="${PICTURE}"]`)).not.toBeNull()
    // It has an email identity too, so it still has a password to change.
    expect(within(account).getByRole('button', { name: en.settings.password.open })).toBeInTheDocument()
  })

  it('a Google-only Account has no Change password row', async () => {
    setup({ me: GOOGLE_ONLY })
    await openSettings()
    const account = section(en.settings.account.heading)

    expect(account).toHaveTextContent(en.settings.account.viaGoogle)
    expect(account).not.toHaveTextContent(en.settings.account.viaEmail)
    expect(within(account).queryByRole('button', { name: en.settings.password.open })).not.toBeInTheDocument()
  })
})

describe('Change password', () => {
  it('right current password and a matching new one: checked, then updateUser; fields cleared, form closed', async () => {
    const state = setup()
    const user = userEvent.setup()
    await openSettings()

    const form = await openPasswordForm(user)
    expect(within(form).getByLabelText(en.settings.password.current)).toHaveFocus()
    await fillPassword(user, form)

    // The unverified Account's resend row has a status line of its own (Story 7.3b).
    expect(await screen.findByText(en.settings.password.changed)).toHaveAttribute('role', 'status')
    expect(callsTo('/api/me/password/check', 'POST').map(([, options]) => options.body)).toEqual([
      { current_password: CURRENT_PASSWORD },
    ])
    expect(state.passwordChecks).toBe(1)
    expect(setNewPassword).toHaveBeenCalledWith(NEW_PASSWORD)
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.settings.password.open })).toHaveFocus()

    // Opened again, the fields are empty.
    const again = await openPasswordForm(user)
    expect(within(again).getByLabelText(en.settings.password.current)).toHaveValue('')
    expect(within(again).getByLabelText(en.settings.password.new)).toHaveValue('')
  })

  it('a wrong current password shows the error and never calls updateUser', async () => {
    setup()
    const user = userEvent.setup()
    await openSettings()

    const form = await openPasswordForm(user)
    await fillPassword(user, form, { current: 'not-the-one-1' })

    expect(await within(form).findByRole('alert')).toHaveTextContent(en.errors.wrong_password)
    expect(setNewPassword).not.toHaveBeenCalled()
    expect(within(form).getByLabelText(en.settings.password.current)).toHaveFocus()
  })

  it('an empty current password asks for it, with no request', async () => {
    setup()
    const user = userEvent.setup()
    await openSettings()

    const form = await openPasswordForm(user)
    await fillPassword(user, form, { current: '' })

    expect(within(form).getByRole('alert')).toHaveTextContent(en.settings.password.currentRequired)
    expect(within(form).getByLabelText(en.settings.password.current)).toHaveFocus()
    expect(callsTo('/api/me/password/check', 'POST')).toHaveLength(0)
  })

  it('a new password equal to the current one is refused, with no request', async () => {
    setup()
    const user = userEvent.setup()
    await openSettings()

    const form = await openPasswordForm(user)
    await fillPassword(user, form, { next: CURRENT_PASSWORD })

    expect(within(form).getByRole('alert')).toHaveTextContent(en.settings.password.samePassword)
    expect(callsTo('/api/me/password/check', 'POST')).toHaveLength(0)
    expect(setNewPassword).not.toHaveBeenCalled()
  })

  it("Supabase's same_password shows the same message", async () => {
    setup()
    vi.mocked(setNewPassword).mockResolvedValue({ error: 'same_password' })
    const user = userEvent.setup()
    await openSettings()

    const form = await openPasswordForm(user)
    await fillPassword(user, form)

    expect(await within(form).findByRole('alert')).toHaveTextContent(en.settings.password.samePassword)
  })

  it('too many tries: the rate-limit copy shows', async () => {
    setup({
      routes: {
        'POST /api/me/password/check': () => {
          throw { code: 'too_many_attempts', params: {} }
        },
      },
    })
    const user = userEvent.setup()
    await openSettings()

    const form = await openPasswordForm(user)
    await fillPassword(user, form)

    expect(await within(form).findByRole('alert')).toHaveTextContent(en.errors.too_many_attempts)
    expect(setNewPassword).not.toHaveBeenCalled()
  })

  it('copies that differ: a client message, no request', async () => {
    setup()
    const user = userEvent.setup()
    await openSettings()

    const form = await openPasswordForm(user)
    await fillPassword(user, form, { repeat: 'brand-new-pass-8' })

    expect(within(form).getByRole('alert')).toHaveTextContent(en.settings.password.mismatch)
    expect(callsTo('/api/me/password/check', 'POST')).toHaveLength(0)
    expect(setNewPassword).not.toHaveBeenCalled()
  })

  it('under 8 characters: the too-short message, no request', async () => {
    setup()
    const user = userEvent.setup()
    await openSettings()

    const form = await openPasswordForm(user)
    await fillPassword(user, form, { next: 'short7x' })

    expect(within(form).getByRole('alert')).toHaveTextContent(en.signup.errors.passwordTooShort)
    expect(callsTo('/api/me/password/check', 'POST')).toHaveLength(0)
  })

  it('auth down: the check answers 503 auth_unavailable and the existing copy shows', async () => {
    setup({
      routes: {
        'POST /api/me/password/check': () => {
          throw { code: 'auth_unavailable', params: {} }
        },
      },
    })
    const user = userEvent.setup()
    await openSettings()

    const form = await openPasswordForm(user)
    await fillPassword(user, form)

    expect(await within(form).findByRole('alert')).toHaveTextContent(en.errors.auth_unavailable)
    expect(setNewPassword).not.toHaveBeenCalled()
  })

  it('a failed updateUser keeps the form open with an error', async () => {
    setup()
    vi.mocked(setNewPassword).mockResolvedValue({ error: 'failed' })
    const user = userEvent.setup()
    await openSettings()

    const form = await openPasswordForm(user)
    await fillPassword(user, form)

    expect(await within(form).findByRole('alert')).toHaveTextContent(en.errors.generic)
    expect(screen.getByRole('form')).toBeInTheDocument()
  })

  it('Cancel closes the form with nothing sent', async () => {
    setup()
    const user = userEvent.setup()
    await openSettings()

    const form = await openPasswordForm(user)
    await user.click(within(form).getByRole('button', { name: en.settings.password.cancel }))

    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(callsTo('/api/me/password/check', 'POST')).toHaveLength(0)
  })
})

describe('Language', () => {
  it('Norsk switches the interface at once and saves it', async () => {
    const state = setup()
    const user = userEvent.setup()
    await openSettings()

    await user.click(within(section(en.settings.language.heading)).getByRole('radio', { name: 'Norsk' }))

    expect(await screen.findByRole('heading', { level: 1, name: nb.settings.title })).toBeInTheDocument()
    expect(i18n.language).toBe('nb')
    expect(state.me.language).toBe('nb')
    expect(within(section(nb.settings.language.heading)).getByRole('radio', { name: 'Norsk' })).toBeChecked()
  })

  it('a failed save shows an error line and keeps the switch', async () => {
    setup({
      routes: {
        'PATCH /api/me': () => {
          throw { code: 'internal_error', params: {} }
        },
      },
    })
    const user = userEvent.setup()
    await openSettings()

    await user.click(within(section(en.settings.language.heading)).getByRole('radio', { name: 'Norsk' }))

    const language = section(nb.settings.language.heading)
    expect(await within(language).findByRole('alert')).toHaveTextContent(nb.errors.internal_error)
    expect(i18n.language).toBe('nb')
  })
})

describe('Your data', () => {
  const dataRows = () => within(screen.getByRole('list', { name: en.settings.data.deleteProject })).getAllByRole('listitem')

  it('lists the active and archived Projects, each with Delete', async () => {
    setup()
    await openSettings()
    const data = section(en.settings.data.heading)

    expect(data).toHaveTextContent(en.settings.data.lead)
    expect(dataRows().map((row) => within(row).getByText(/./, { selector: 'span' }).textContent)).toEqual([
      'Biology',
      'Chemistry',
    ])
    for (const row of dataRows()) expect(within(row).getByRole('button', { name: en.settings.data.delete })).toBeInTheDocument()
  })

  it('Delete opens the delete-project dialog; confirm moves it to Deleted projects', async () => {
    const state = setup()
    const user = userEvent.setup()
    await openSettings()

    const row = dataRows().find((r) => r.textContent.includes('Biology'))
    await user.click(within(row).getByRole('button', { name: en.settings.data.delete }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete Biology?' })
    await user.click(within(dialog).getByRole('button', { name: en.projects.deleteDialog.confirm }))

    await waitFor(() => expect(dataRows().map((r) => r.textContent)).not.toContain(expect.stringContaining('Biology')))
    expect(dataRows()).toHaveLength(1)
    expect(state.stateChanges).toEqual(['delete bio'])
    expect(screen.getByRole('dialog', { name: en.settings.title })).toBeInTheDocument()
    // The Sidebar's Deleted projects group now has two.
    expect(screen.getByRole('button', { name: /^Deleted projects \(2\)$/, hidden: true })).toBeInTheDocument()
  })

  it.each([
    ['no Projects', []],
    ['only deleted Projects', [ANATOMY]],
  ])('with %s, "Delete a project" is hidden', async (_, projects) => {
    setup({ projects })
    await openSettings()
    const data = section(en.settings.data.heading)

    expect(data).toHaveTextContent(en.settings.data.lead)
    expect(data).not.toHaveTextContent(en.settings.data.deleteProject)
    expect(within(data).queryByRole('list')).not.toBeInTheDocument()
  })

  it('Cancel changes nothing and gives focus back to Delete', async () => {
    const state = setup()
    const user = userEvent.setup()
    await openSettings()

    const button = within(dataRows()[0]).getByRole('button', { name: en.settings.data.delete })
    await user.click(button)
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: en.projects.deleteDialog.cancel }))

    await waitFor(() => expect(button).toHaveFocus())
    expect(state.stateChanges).toEqual([])
    expect(dataRows()).toHaveLength(2)
  })
})

describe('Norwegian', () => {
  it('every Settings string is in Norwegian', async () => {
    await i18n.changeLanguage('nb')
    setup({ me: { ...PROFILE, language: 'nb' } })
    const user = userEvent.setup()
    await openSettings(nb)

    expect(screen.getByRole('heading', { level: 1, name: nb.settings.title })).toBeInTheDocument()
    const account = section(nb.settings.account.heading)
    expect(account).toHaveTextContent(nb.settings.account.leadEmail)
    expect(account).toHaveTextContent(nb.settings.account.viaEmail)
    expect(within(account).getByRole('textbox', { name: nb.settings.account.firstName })).toBeInTheDocument()
    expect(within(account).getByRole('button', { name: nb.settings.account.logOut })).toBeInTheDocument()
    expect(section(nb.settings.language.heading)).toHaveTextContent(nb.settings.language.lead)
    const data = section(nb.settings.data.heading)
    expect(data).toHaveTextContent(nb.settings.data.lead)
    expect(data).toHaveTextContent(nb.settings.data.deleteProject)
    expect(within(data).getAllByRole('button', { name: nb.settings.data.delete })).toHaveLength(2)

    await user.click(within(account).getByRole('button', { name: nb.settings.password.open }))
    const form = screen.getByRole('form', { name: nb.settings.password.open })
    expect(within(form).getByLabelText(nb.settings.password.current)).toBeInTheDocument()
    expect(within(form).getByLabelText(nb.settings.password.new)).toBeInTheDocument()
    expect(within(form).getByLabelText(nb.settings.password.repeat)).toBeInTheDocument()
    await user.type(within(form).getByLabelText(nb.settings.password.current), CURRENT_PASSWORD)
    await user.type(within(form).getByLabelText(nb.settings.password.new), NEW_PASSWORD)
    await user.type(within(form).getByLabelText(nb.settings.password.repeat), 'brand-new-pass-8')
    await user.click(within(form).getByRole('button', { name: nb.settings.password.save }))
    expect(within(form).getByRole('alert')).toHaveTextContent(nb.settings.password.mismatch)

    // The overlay's own Close reads in Norwegian (the menu item was found by its Norwegian name above).
    expect(screen.getByRole('button', { name: nb.settings.close })).toBeInTheDocument()
  })

  it('the Google variant reads in Norwegian too', async () => {
    await i18n.changeLanguage('nb')
    setup({ me: { ...GOOGLE, language: 'nb' } })
    await openSettings(nb)
    const account = section(nb.settings.account.heading)

    expect(account).toHaveTextContent(nb.settings.account.leadGoogle)
    expect(account).toHaveTextContent(nb.settings.account.viaBoth)
  })
})
