// Settings › Appearance (theme options, Cristoffer 2026-11-20): the theme (Default / Light / Dark) and
// accent colour, applied on <html> at once, saved to ui_prefs, applied after sign-in on any browser,
// and dropped for the Default theme and accent on sign-out. api/client.js and auth/ are mocked (spine ›
// Tests); test/fakeApi.js plays the backend.
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, onSignedOut } from '../api/client.js'
import { hasSession, signOut } from '../auth/index.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { PROFILE, callsTo, fakeApi, project } from '../test/fakeApi.js'
import { i18n, renderRoute } from '../test/render.jsx'
import { applyInitialTheme, applyTheme, cachedTheme } from '../theme/index.js'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

const BIOLOGY = project('bio', { name: 'Biology', name_source: 'student' })
const html = () => document.documentElement
beforeEach(() => {
  vi.mocked(apiFetch).mockReset()
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
  vi.mocked(signOut).mockReset().mockResolvedValue({ ended: Promise.resolve() })
  applyTheme({})
  delete html().dataset.theme
  delete html().dataset.accent
})

afterEach(async () => {
  await i18n.changeLanguage('en')
})

function setup(me = PROFILE, options = {}) {
  return fakeApi({ projects: [BIOLOGY], me, ...options })
}

const section = (name) => screen.getByRole('region', { name })
const appearance = (lang = en) => section(lang.settings.appearance.heading)
const themeRadio = (name, lang = en) =>
  within(within(appearance(lang)).getByRole('radiogroup', { name: lang.settings.appearance.theme })).getByRole('radio', { name })
const accentRadio = (name, lang = en) =>
  within(within(appearance(lang)).getByRole('radiogroup', { name: lang.settings.appearance.accent })).getByRole('radio', { name })

/** The signed-in app at `path` (as main.jsx starts it), then Account menu › Settings. */
async function openSettings(lang = en, path = '/projects/bio') {
  applyInitialTheme(path)
  const result = renderRoute(path)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: new RegExp(`^${lang.account.welcome.split('{{')[0]}`) }))
  await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: lang.account.settings }))
  await screen.findByRole('region', { name: lang.settings.appearance.heading })
  return { ...result, user }
}

describe('Settings › Appearance', () => {
  it('an existing Account with no theme saved gets the Default theme and the Default accent', async () => {
    setup()
    await openSettings()

    expect(html().dataset).toMatchObject({ theme: 'default', accent: 'default' })
    expect(themeRadio(en.settings.appearance.themeName.default)).toBeChecked()
    expect(accentRadio(en.settings.appearance.accentName.default)).toBeChecked()
    expect(appearance()).toHaveTextContent(en.settings.appearance.lead)
  })

  it('Light applies at once, is saved, and a reload stays light', async () => {
    const state = setup()
    const { user } = await openSettings()

    await user.click(themeRadio(en.settings.appearance.themeName.light))

    expect(html().dataset.theme).toBe('light')
    expect(themeRadio(en.settings.appearance.themeName.light)).toBeChecked()
    await waitFor(() => expect(state.me.ui_prefs.theme).toBe('light'))
    expect(callsTo('/api/me/prefs', 'PATCH').at(-1)[1].body).toEqual({ theme: 'light', accent: 'default' })

    // A reload (which runs no unmount): main.jsx paints the cached choice before the profile arrives.
    const cached = window.localStorage.getItem('studybuddy.theme')
    expect(JSON.parse(cached)).toEqual({ theme: 'light', accent: 'default' })
    cleanup()
    window.localStorage.setItem('studybuddy.theme', cached)
    delete html().dataset.theme
    applyInitialTheme('/projects/bio')
    expect(html().dataset.theme).toBe('light')
  })

  it('a failed save keeps the choice and shows an error line', async () => {
    setup(PROFILE, {
      routes: {
        'PATCH /api/me/prefs': () => {
          throw { code: 'internal_error', params: {} }
        },
      },
    })
    const { user } = await openSettings()

    await user.click(themeRadio(en.settings.appearance.themeName.light))

    expect(await within(appearance()).findByRole('alert')).toHaveTextContent(en.errors.internal_error)
    expect(html().dataset.theme).toBe('light')
    expect(themeRadio(en.settings.appearance.themeName.light)).toBeChecked()

    await user.click(accentRadio(en.settings.appearance.accentName.violet))
    expect(html().dataset.accent).toBe('violet')
    expect(await within(appearance()).findByRole('alert')).toHaveTextContent(en.errors.internal_error)
  })

  it('a choice made during a save is sent after it, in full: an earlier failure is overtaken by the latest success', async () => {
    const sent = []
    let rejectFirst
    const state = setup(PROFILE, {
      routes: {
        'PATCH /api/me/prefs': (body, server) => {
          sent.push(body)
          if (sent.length === 1) return new Promise((_, reject) => (rejectFirst = reject))
          server.me = { ...server.me, ui_prefs: { ...server.me.ui_prefs, ...body } }
          return server.me
        },
      },
    })
    const { user } = await openSettings()

    await user.click(themeRadio(en.settings.appearance.themeName.light))
    await user.click(accentRadio(en.settings.appearance.accentName.violet))
    expect(sent).toEqual([{ theme: 'light', accent: 'default' }]) // one save at a time

    rejectFirst({ code: 'internal_error', params: {} })

    await waitFor(() => expect(sent).toHaveLength(2))
    expect(sent[1]).toEqual({ theme: 'light', accent: 'violet' })
    await waitFor(() => expect(state.me.ui_prefs).toMatchObject({ theme: 'light', accent: 'violet' }))
    expect(within(appearance()).queryByRole('alert')).not.toBeInTheDocument()
    expect(html().dataset).toMatchObject({ theme: 'light', accent: 'violet' })
  })

  it('when the latest choice fails to save after an earlier one succeeded, the error line shows', async () => {
    const sent = []
    let resolveFirst
    setup(PROFILE, {
      routes: {
        'PATCH /api/me/prefs': (body) => {
          sent.push(body)
          if (sent.length === 1) return new Promise((resolve) => (resolveFirst = resolve))
          throw { code: 'internal_error', params: {} }
        },
      },
    })
    const { user } = await openSettings()

    await user.click(themeRadio(en.settings.appearance.themeName.light))
    await user.click(accentRadio(en.settings.appearance.accentName.blue))
    resolveFirst(PROFILE)

    expect(await within(appearance()).findByRole('alert')).toHaveTextContent(en.errors.internal_error)
    expect(sent[1]).toEqual({ theme: 'light', accent: 'blue' })
    expect(accentRadio(en.settings.appearance.accentName.blue)).toBeChecked()
  })

  it('Dark applies the darker palette at once and is saved; Default goes back', async () => {
    const state = setup()
    const { user } = await openSettings()

    await user.click(themeRadio(en.settings.appearance.themeName.dark))
    expect(html().dataset.theme).toBe('dark')
    await waitFor(() => expect(state.me.ui_prefs.theme).toBe('dark'))

    await user.click(themeRadio(en.settings.appearance.themeName.default))
    expect(html().dataset.theme).toBe('default')
    await waitFor(() => expect(state.me.ui_prefs.theme).toBe('default'))
  })

  it('there is no "Match system" option, and an old saved "system" reads as Default', async () => {
    setup({ ...PROFILE, ui_prefs: { theme: 'system' } })
    await openSettings()

    const group = within(appearance()).getByRole('radiogroup', { name: en.settings.appearance.theme })
    expect(within(group).getAllByRole('radio').map((radio) => radio.value)).toEqual(['default', 'light', 'dark'])
    expect(themeRadio(en.settings.appearance.themeName.default)).toBeChecked()
    expect(html().dataset.theme).toBe('default')
  })

  it('Violet turns the accent violet in either theme, and is saved', async () => {
    const state = setup()
    const { user } = await openSettings()

    await user.click(accentRadio(en.settings.appearance.accentName.violet))
    expect(html().dataset).toMatchObject({ theme: 'default', accent: 'violet' })
    await waitFor(() => expect(state.me.ui_prefs.accent).toBe('violet'))

    await user.click(themeRadio(en.settings.appearance.themeName.light))
    expect(html().dataset).toMatchObject({ theme: 'light', accent: 'violet' })
    await waitFor(() => expect(state.me.ui_prefs).toMatchObject({ theme: 'light', accent: 'violet' }))
  })

  it('each swatch is a radio named after its colour and shows that colour', async () => {
    setup()
    await openSettings()
    const group = within(appearance()).getByRole('radiogroup', { name: en.settings.appearance.accent })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((radio) => radio.closest('label').textContent)).toEqual(
      ['default', 'blue', 'violet', 'cyan'].map((accent) => en.settings.appearance.accentName[accent]),
    )
    expect(radios.map((radio) => radio.closest('label').querySelector('[data-accent]').dataset.accent)).toEqual([
      'default',
      'blue',
      'violet',
      'cyan',
    ])
  })

  it('the Default swatch shows the current theme’s own accent, and an old saved "indigo" reads as Default', async () => {
    setup({ ...PROFILE, ui_prefs: { accent: 'indigo' } })
    const { user } = await openSettings()

    expect(accentRadio(en.settings.appearance.accentName.default)).toBeChecked()
    expect(html().dataset.accent).toBe('default')
    // The swatch resets to the theme's own accent (tokens.css [data-accent='default']), whatever <html> has.
    const swatch = accentRadio(en.settings.appearance.accentName.default).closest('label').querySelector('[data-accent]')
    expect(swatch.dataset.accent).toBe('default')

    await user.click(accentRadio(en.settings.appearance.accentName.cyan))
    expect(swatch.dataset.accent).toBe('default')
    expect(html().dataset.accent).toBe('cyan')
  })

  it('Light and Violet chosen elsewhere apply after sign-in on a new browser; Login before it was Default', async () => {
    // Login on a browser with nothing cached: the Default theme and accent.
    applyInitialTheme('/')
    expect(html().dataset).toMatchObject({ theme: 'default', accent: 'default' })

    setup({ ...PROFILE, ui_prefs: { theme: 'light', accent: 'violet' } })
    renderRoute('/projects/bio')

    await waitFor(() => expect(html().dataset).toMatchObject({ theme: 'light', accent: 'violet' }))
    expect(cachedTheme()).toEqual({ theme: 'light', accent: 'violet' })
  })

  it('signed-out pages (Login, the phone page) use the Default theme and accent', () => {
    applyInitialTheme('/')
    expect(html().dataset).toMatchObject({ theme: 'default', accent: 'default' })
    applyInitialTheme('/u/tok-1')
    expect(html().dataset).toMatchObject({ theme: 'default', accent: 'default' })
  })

  it('Log out from a light, cyan choice: Login is Default with the Default accent and nothing stays cached', async () => {
    setup({ ...PROFILE, ui_prefs: { theme: 'light', accent: 'cyan' } })
    const { router, user } = await openSettings()
    await waitFor(() => expect(html().dataset).toMatchObject({ theme: 'light', accent: 'cyan' }))

    vi.mocked(hasSession).mockResolvedValue(false)
    await user.click(within(section(en.settings.account.heading)).getByRole('button', { name: en.settings.account.logOut }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(html().dataset).toMatchObject({ theme: 'default', accent: 'default' })
    expect(cachedTheme()).toBeNull()
  })

  it('a session that ends without Log out: Login is Default with the Default accent and nothing stays cached', async () => {
    let signedOut
    vi.mocked(onSignedOut).mockImplementation((listener) => {
      signedOut = listener
      return () => {}
    })
    setup({ ...PROFILE, ui_prefs: { theme: 'light', accent: 'violet' } })
    applyInitialTheme('/projects/bio')
    const { router } = renderRoute('/projects/bio')
    await waitFor(() => expect(html().dataset).toMatchObject({ theme: 'light', accent: 'violet' }))
    expect(cachedTheme()).toEqual({ theme: 'light', accent: 'violet' })

    // client.js answers a signed-out code (session_expired) by telling RequireSession.
    vi.mocked(hasSession).mockResolvedValue(false)
    signedOut('session_expired')

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    await waitFor(() => expect(html().dataset).toMatchObject({ theme: 'default', accent: 'default' }))
    expect(cachedTheme()).toBeNull()
  })

  it('reads in Norwegian', async () => {
    await i18n.changeLanguage('nb')
    setup({ ...PROFILE, language: 'nb' })
    await openSettings(nb)

    const section = appearance(nb)
    expect(section).toHaveTextContent(nb.settings.appearance.lead)
    for (const name of Object.values(nb.settings.appearance.themeName)) expect(themeRadio(name, nb)).toBeInTheDocument()
    for (const name of Object.values(nb.settings.appearance.accentName)) expect(accentRadio(name, nb)).toBeInTheDocument()
  })
})
