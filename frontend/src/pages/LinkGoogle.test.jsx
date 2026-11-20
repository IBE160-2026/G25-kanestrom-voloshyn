// Settings › Link Google account and Resend verification email (Story 7.3b, FR-1, FR-19, FR-27): the
// link row or the verify-first row, the resend, and the return through /auth/callback to the same page
// with Settings open. api/client.js and auth/ are mocked (spine › Tests); test/fakeApi.js plays the backend.
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client.js'
import { completeGoogleSignIn, hasSession, isGoogleEnabled, linkGoogle } from '../auth/index.js'
import { LINK_GOOGLE_KEY, rememberLinkRoute } from '../auth/returnTo.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { PROFILE, callsTo, fakeApi, project } from '../test/fakeApi.js'
import { i18n, renderRoute } from '../test/render.jsx'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

const WIDTH = window.innerWidth
const PICTURE = 'https://lh3.googleusercontent.com/a/emma-photo'
const VERIFIED = { ...PROFILE, email_verified: true }
const UNVERIFIED = { ...PROFILE, email_verified: false }
const LINKED = { ...PROFILE, email_verified: true, sign_in_methods: ['email', 'google'], picture_url: PICTURE }
const GOOGLE_ONLY = { ...PROFILE, email_verified: true, sign_in_methods: ['google'], picture_url: PICTURE }
const BIOLOGY = project('bio', { name: 'Biology', name_source: 'student' })

beforeEach(() => {
  vi.mocked(apiFetch).mockReset()
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
  vi.mocked(isGoogleEnabled).mockReset().mockResolvedValue(true)
  vi.mocked(linkGoogle).mockReset().mockResolvedValue({ ok: true })
  vi.mocked(completeGoogleSignIn).mockReset().mockResolvedValue({ ok: true })
  window.innerWidth = 1280
})

afterEach(async () => {
  window.innerWidth = WIDTH
  await i18n.changeLanguage('en')
})

function setup(me) {
  return fakeApi({ me, projects: [BIOLOGY] })
}

const account = (lang = en) => screen.getByRole('region', { name: lang.settings.account.heading })

async function openSettings(lang = en, path = '/projects/bio') {
  const user = userEvent.setup()
  const result = renderRoute(path)
  await user.click(await screen.findByRole('button', { name: new RegExp(`^${lang.account.welcome.split('{{')[0]}`) }))
  await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: lang.account.settings }))
  await screen.findByRole('region', { name: lang.settings.account.heading })
  return { ...result, user }
}

describe('Settings › Account rows', () => {
  it('a verified email Account gets "Link Google account" and no resend', async () => {
    setup(VERIFIED)
    await openSettings()
    expect(await within(account()).findByRole('button', { name: en.settings.account.linkGoogle })).toBeInTheDocument()
    expect(within(account()).queryByText(en.settings.account.verifyFirst)).not.toBeInTheDocument()
    expect(within(account()).queryByRole('button', { name: en.settings.account.resend })).not.toBeInTheDocument()
  })

  it('the link row is hidden when Google sign-in is not configured', async () => {
    vi.mocked(isGoogleEnabled).mockResolvedValue(false)
    setup(VERIFIED)
    await openSettings()
    await waitFor(() => expect(isGoogleEnabled).toHaveBeenCalled())
    expect(within(account()).queryByRole('button', { name: en.settings.account.linkGoogle })).not.toBeInTheDocument()
  })

  it('an unverified Account gets the muted "Verify your email first" and Resend, and no link row', async () => {
    setup(UNVERIFIED)
    await openSettings()
    const note = within(account()).getByText(en.settings.account.verifyFirst)
    expect(note).not.toHaveAttribute('role', 'alert')
    expect(within(account()).getByRole('button', { name: en.settings.account.resend })).toBeEnabled()
    expect(within(account()).queryByRole('button', { name: en.settings.account.linkGoogle })).not.toBeInTheDocument()
    // Change password stays available.
    expect(within(account()).getByRole('button', { name: en.settings.password.open })).toBeEnabled()
  })

  it.each([
    ['linked', LINKED, en.settings.account.viaBoth],
    ['Google-only', GOOGLE_ONLY, en.settings.account.viaGoogle],
  ])('a %s Account gets neither the link row nor the resend', async (_, me, methodLine) => {
    setup(me)
    await openSettings()
    await waitFor(() => expect(within(account()).getByText(methodLine)).toBeInTheDocument())
    expect(within(account()).queryByRole('button', { name: en.settings.account.linkGoogle })).not.toBeInTheDocument()
    expect(within(account()).queryByRole('button', { name: en.settings.account.resend })).not.toBeInTheDocument()
    expect(within(account()).queryByText(en.settings.account.verifyFirst)).not.toBeInTheDocument()
  })
})

describe('Resend verification email', () => {
  it('sends a new link and says so', async () => {
    const state = setup(UNVERIFIED)
    const { user } = await openSettings()
    await user.click(within(account()).getByRole('button', { name: en.settings.account.resend }))
    expect(await within(account()).findByText(en.settings.account.resent)).toHaveAttribute('role', 'status')
    expect(state.verificationsSent).toBe(1)
    expect(callsTo('/api/me/verification', 'POST')).toHaveLength(1)
    // Not rate-limited: it can be sent again.
    await user.click(within(account()).getByRole('button', { name: en.settings.account.resend }))
    await waitFor(() => expect(state.verificationsSent).toBe(2))
  })

  it('a failed resend shows an error line and no confirmation', async () => {
    fakeApi({
      me: UNVERIFIED,
      projects: [BIOLOGY],
      routes: {
        'POST /api/me/verification': () => {
          throw { code: 'internal_error', params: {} }
        },
      },
    })
    const { user } = await openSettings()
    await user.click(within(account()).getByRole('button', { name: en.settings.account.resend }))
    expect(await within(account()).findByRole('alert')).toHaveTextContent(en.errors.internal_error)
    expect(within(account()).queryByText(en.settings.account.resent)).not.toBeInTheDocument()
  })
})

describe('Resend after the email was verified elsewhere', () => {
  it('409 already_verified switches the row to Link Google account, with no error line', async () => {
    fakeApi({
      me: UNVERIFIED,
      projects: [BIOLOGY],
      routes: {
        'POST /api/me/verification': () => {
          throw { code: 'already_verified', params: {} }
        },
      },
    })
    const { user } = await openSettings()
    await user.click(within(account()).getByRole('button', { name: en.settings.account.resend }))
    expect(await within(account()).findByRole('button', { name: en.settings.account.linkGoogle })).toBeInTheDocument()
    expect(within(account()).queryByRole('button', { name: en.settings.account.resend })).not.toBeInTheDocument()
    expect(within(account()).queryByText(en.settings.account.verifyFirst)).not.toBeInTheDocument()
    expect(within(account()).queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('Link Google account', () => {
  it('remembers the route with its search and hash', async () => {
    setup(VERIFIED)
    const { user } = await openSettings(en, '/projects/bio?tab=files#top')
    await user.click(await within(account()).findByRole('button', { name: en.settings.account.linkGoogle }))
    expect(linkGoogle).toHaveBeenCalledWith('/projects/bio?tab=files#top')
  })

  it('is usable again after Back from Google restores the page from the bfcache', async () => {
    setup(VERIFIED)
    const { user } = await openSettings()
    const button = await within(account()).findByRole('button', { name: en.settings.account.linkGoogle })
    await user.click(button)
    expect(button).toBeDisabled()

    await act(async () => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })))
    expect(button).toBeDisabled()
    await act(async () => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
    expect(button).toBeEnabled()
  })

  it('starts the link with the current route', async () => {
    setup(VERIFIED)
    const { user } = await openSettings(en, '/projects/bio')
    const button = await within(account()).findByRole('button', { name: en.settings.account.linkGoogle })
    await user.click(button)
    expect(linkGoogle).toHaveBeenCalledWith('/projects/bio')
    // The browser is leaving for Google: stay busy.
    expect(button).toBeDisabled()
  })

  it('a link that cannot start shows an error line and can be tried again', async () => {
    vi.mocked(linkGoogle).mockResolvedValue({ error: 'failed' })
    setup(VERIFIED)
    const { user } = await openSettings()
    await user.click(await within(account()).findByRole('button', { name: en.settings.account.linkGoogle }))
    expect(await within(account()).findByRole('alert')).toHaveTextContent(en.errors.generic)
    expect(within(account()).getByRole('button', { name: en.settings.account.linkGoogle })).toBeEnabled()
  })
})

describe('/auth/callback after a link', () => {
  it('a completed link calls google-link and reopens Settings on the same page, Google shown', async () => {
    const state = setup(VERIFIED)
    state.googleFirstName = 'Emmeline'
    rememberLinkRoute('/projects/bio')
    const { router } = renderRoute('/auth/callback?code=abc')

    const dialog = await screen.findByRole('dialog', { name: en.settings.title })
    expect(router.state.location.pathname).toBe('/projects/bio')
    expect(callsTo('/api/me/google-link', 'POST')).toHaveLength(1)
    expect(callsTo('/api/auth/after-sign-in', 'POST')).toHaveLength(0)
    expect(await within(dialog).findByText(en.settings.account.viaBoth)).toBeInTheDocument()
    // The name is read-only and now Google's.
    expect(within(dialog).getByText('Emmeline')).toBeInTheDocument()
    expect(within(dialog).queryByRole('textbox', { name: en.settings.account.firstName })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: en.settings.account.linkGoogle })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    // The marker and the history state are gone, so a reload doesn't reopen Settings.
    expect(window.sessionStorage.getItem(LINK_GOOGLE_KEY)).toBeNull()
    await waitFor(() => expect(router.state.location.state).toBeNull())
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('a Google account linked elsewhere reopens Settings with the error in the error colour', async () => {
    vi.mocked(completeGoogleSignIn).mockResolvedValue({ error: 'identity_in_use' })
    setup(VERIFIED)
    rememberLinkRoute('/projects/bio')
    const { router } = renderRoute('/auth/callback?error=server_error&error_code=identity_already_exists')

    const dialog = await screen.findByRole('dialog', { name: en.settings.title })
    expect(router.state.location.pathname).toBe('/projects/bio')
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This Google account is already linked to another Study Buddy account.',
    )
    expect(callsTo('/api/me/google-link', 'POST')).toHaveLength(0)
  })

  it('cancelled consent reopens Settings and shows nothing', async () => {
    setup(VERIFIED)
    rememberLinkRoute('/projects/bio')
    const { router } = renderRoute('/auth/callback?error=access_denied&error_description=cancelled')

    const dialog = await screen.findByRole('dialog', { name: en.settings.title })
    expect(router.state.location.pathname).toBe('/projects/bio')
    expect(await within(dialog).findByRole('button', { name: en.settings.account.linkGoogle })).toBeInTheDocument()
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(completeGoogleSignIn).not.toHaveBeenCalled()
    expect(callsTo('/api/me/google-link', 'POST')).toHaveLength(0)
  })

  it('cancelled consent in the hash reopens Settings and shows nothing', async () => {
    setup(VERIFIED)
    rememberLinkRoute('/projects/bio')
    const { router } = renderRoute('/auth/callback#error=access_denied')

    const dialog = await screen.findByRole('dialog', { name: en.settings.title })
    expect(router.state.location.pathname).toBe('/projects/bio')
    await within(dialog).findByRole('button', { name: en.settings.account.linkGoogle })
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(completeGoogleSignIn).not.toHaveBeenCalled()
  })

  it('a link that failed at Supabase reopens Settings with the generic error, not Login', async () => {
    vi.mocked(completeGoogleSignIn).mockResolvedValue({ error: 'failed' })
    setup(VERIFIED)
    rememberLinkRoute('/projects/bio')
    const { router } = renderRoute('/auth/callback?error=server_error')

    const dialog = await screen.findByRole('dialog', { name: en.settings.title })
    expect(router.state.location.pathname).toBe('/projects/bio')
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent(en.errors.generic)
    expect(alert).not.toHaveTextContent(en.errors.google_identity_in_use)
    expect(callsTo('/api/me/google-link', 'POST')).toHaveLength(0)
  })

  it('a signed-out google-link clears the marker and leaves the rest to the sign-out', async () => {
    fakeApi({
      me: VERIFIED,
      projects: [BIOLOGY],
      routes: {
        'POST /api/me/google-link': () => {
          throw { code: 'unauthorized', params: {} }
        },
      },
    })
    rememberLinkRoute('/projects/bio')
    const { router } = renderRoute('/auth/callback?code=abc')

    await waitFor(() => expect(callsTo('/api/me/google-link', 'POST')).toHaveLength(1))
    await waitFor(() => expect(window.sessionStorage.getItem(LINK_GOOGLE_KEY)).toBeNull())
    expect(router.state.location.pathname).toBe('/auth/callback')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a failed google-link reopens Settings with its error line', async () => {
    fakeApi({
      me: UNVERIFIED,
      projects: [BIOLOGY],
      routes: {
        'POST /api/me/google-link': () => {
          throw { code: 'email_not_verified', params: {} }
        },
      },
    })
    rememberLinkRoute('/projects/bio')
    const { router } = renderRoute('/auth/callback?code=abc')

    const dialog = await screen.findByRole('dialog', { name: en.settings.title })
    expect(router.state.location.pathname).toBe('/projects/bio')
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(en.errors.email_not_verified)
  })

  it('closing Settings clears the link error', async () => {
    vi.mocked(completeGoogleSignIn).mockResolvedValue({ error: 'identity_in_use' })
    setup(VERIFIED)
    rememberLinkRoute('/projects/bio')
    renderRoute('/auth/callback?error=server_error&error_code=identity_already_exists')
    const dialog = await screen.findByRole('dialog', { name: en.settings.title })
    await within(dialog).findByRole('alert')
    const user = userEvent.setup()
    await user.click(within(dialog).getByRole('button', { name: en.settings.close }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /^Welcome/ }))
    await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: en.account.settings }))
    const reopened = await screen.findByRole('dialog', { name: en.settings.title })
    expect(within(reopened).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('without the marker the callback is a Google sign-in, as before', async () => {
    fakeApi({ me: VERIFIED, projects: [BIOLOGY], routes: { 'POST /api/auth/after-sign-in': (_, state) => state.me } })
    const { router } = renderRoute('/auth/callback?code=abc')
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/projects/))
    expect(callsTo('/api/auth/after-sign-in', 'POST')).toHaveLength(1)
    expect(callsTo('/api/me/google-link', 'POST')).toHaveLength(0)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('Norwegian', () => {
  it('reads the new rows and messages in Norwegian', async () => {
    await i18n.changeLanguage('nb')
    setup({ ...UNVERIFIED, language: 'nb' })
    const { user } = await openSettings(nb)
    expect(within(account(nb)).getByText('Bekreft e-postadressen din først')).toBeInTheDocument()
    await user.click(within(account(nb)).getByRole('button', { name: 'Send bekreftelseslenken på nytt' }))
    expect(await within(account(nb)).findByText('Vi har sendt en ny lenke. Den gjelder i 24 timer.')).toBeInTheDocument()
  })

  it('reads "Koble til Google-konto" and the Norwegian errors', async () => {
    await i18n.changeLanguage('nb')
    setup({ ...VERIFIED, language: 'nb' })
    await openSettings(nb)
    expect(await within(account(nb)).findByRole('button', { name: 'Koble til Google-konto' })).toBeInTheDocument()
    expect(nb.errors.google_identity_in_use).toBe('Denne Google-kontoen er allerede koblet til en annen Study Buddy-konto.')
    expect(nb.errors.email_not_verified).toBe('Bekreft e-postadressen din før du kobler til Google.')
  })
})
