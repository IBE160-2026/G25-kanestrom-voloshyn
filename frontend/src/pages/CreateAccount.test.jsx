// Create account screen (Story 1.3 SPA matrix rows). auth/ and api/client.js are mocked (spine › Tests).
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client.js'
import { signUp } from '../auth/index.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { i18n, renderRoute } from '../test/render.jsx'

vi.mock('../auth/index.js', () => ({ signUp: vi.fn(), getAccessToken: vi.fn() }))
vi.mock('../api/client.js', () => ({ apiFetch: vi.fn() }))

const PROFILE = { first_name: 'Emma', language: 'en', email_verified: false }

beforeEach(() => {
  vi.mocked(signUp).mockReset().mockResolvedValue({ session: { access_token: 't' } })
  vi.mocked(apiFetch).mockReset().mockResolvedValue(PROFILE)
})

function form(catalogue = en) {
  const panel = screen.getByRole('form', { name: catalogue.signup.submit })
  return {
    firstName: within(panel).getByLabelText(catalogue.signup.firstName),
    email: within(panel).getByLabelText(catalogue.signup.email),
    password: within(panel).getByLabelText(catalogue.signup.password),
    submit: within(panel).getByRole('button', { name: catalogue.signup.submit }),
  }
}

async function fillAndSubmit(user, { firstName = 'Emma', email = 'emma@example.com', password = 'longenough' } = {}, catalogue = en) {
  const f = form(catalogue)
  if (firstName) await user.type(f.firstName, firstName)
  if (email) await user.type(f.email, email)
  if (password) await user.type(f.password, password)
  await user.click(f.submit)
  return f
}

describe('Create account', () => {
  it('shows the Login layout with the form, the Log in link, and the toggle', () => {
    renderRoute('/signup')

    expect(screen.getByRole('heading', { level: 1, name: en.login.wordmark })).toBeInTheDocument()
    expect(screen.getByText(en.login.tagline)).toBeInTheDocument()
    expect(screen.getByText(en.login.privacy)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: en.language.label })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: en.signup.logIn })).toHaveAttribute('href', '/')
    const f = form()
    expect(f.email).toHaveAttribute('type', 'email')
    expect(f.password).toHaveAttribute('type', 'password')
    expect(f.password).toHaveAttribute('autocomplete', 'new-password')
    expect(f.firstName).toHaveAttribute('maxlength', '100')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('happy sign-up: signs up, sends the first name and language, and lands on Projects', async () => {
    const user = userEvent.setup()
    const { router } = renderRoute('/signup')

    await fillAndSubmit(user, { firstName: '  Emma  ' })

    expect(signUp).toHaveBeenCalledWith({ email: 'emma@example.com', password: 'longenough' })
    expect(apiFetch).toHaveBeenCalledWith('/api/auth/after-sign-in', {
      method: 'POST',
      body: { first_name: 'Emma', language: 'en' },
    })
    expect(router.state.location.pathname).toBe('/projects')
    expect(await screen.findByText('Welcome, Emma')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: en.projects.empty.heading })).toBeInTheDocument()
  })

  it('in Norwegian: sends nb and greets with "Velkommen, Emma"', async () => {
    const user = userEvent.setup()
    await i18n.changeLanguage('nb')
    renderRoute('/signup')

    await fillAndSubmit(user, {}, nb)

    expect(apiFetch).toHaveBeenCalledWith('/api/auth/after-sign-in', {
      method: 'POST',
      body: { first_name: 'Emma', language: 'nb' },
    })
    expect(await screen.findByText('Velkommen, Emma')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: nb.projects.empty.heading })).toBeInTheDocument()
  })

  it('duplicate email: shows the error line with a Log in link and keeps the email', async () => {
    vi.mocked(signUp).mockResolvedValue({ error: 'duplicate' })
    const user = userEvent.setup()
    const { router } = renderRoute('/signup')

    const f = await fillAndSubmit(user)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('An account with this email already exists. Log in instead?')
    expect(router.state.location.pathname).toBe('/signup')
    expect(f.email).toHaveValue('emma@example.com')
    expect(f.email).toHaveFocus()
    expect(f.submit).toBeEnabled()
    expect(apiFetch).not.toHaveBeenCalled()

    await user.click(within(alert).getByRole('link', { name: 'Log in' }))
    expect(router.state.location.pathname).toBe('/')
  })

  it('short password: refused in the SPA before any sign-up', async () => {
    const user = userEvent.setup()
    renderRoute('/signup')

    const f = await fillAndSubmit(user, { password: 'seven77' })

    expect(screen.getByRole('alert')).toHaveTextContent(en.signup.errors.passwordTooShort)
    expect(signUp).not.toHaveBeenCalled()
    expect(f.password).toHaveFocus()
    expect(f.email).toHaveValue('emma@example.com')
  })

  it('short password refused by Supabase shows the same line', async () => {
    vi.mocked(signUp).mockResolvedValue({ error: 'password_too_short' })
    const user = userEvent.setup()
    renderRoute('/signup')

    await fillAndSubmit(user)

    expect(screen.getByRole('alert')).toHaveTextContent(en.signup.errors.passwordTooShort)
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('blank first name: whitespace only is refused before sign-up', async () => {
    const user = userEvent.setup()
    const { router } = renderRoute('/signup')

    const f = await fillAndSubmit(user, { firstName: '   ' })

    expect(screen.getByRole('alert')).toHaveTextContent(en.signup.errors.firstNameRequired)
    expect(signUp).not.toHaveBeenCalled()
    expect(f.firstName).toHaveFocus()
    expect(router.state.location.pathname).toBe('/signup')
  })

  it('Supabase Auth down at after-sign-in: generic error, stays, and a retry does not sign up again', async () => {
    const outage = Object.assign(new Error('auth_unavailable'), { code: 'auth_unavailable', params: {} })
    vi.mocked(apiFetch).mockRejectedValueOnce(outage)
    const user = userEvent.setup()
    const { router } = renderRoute('/signup')

    const f = await fillAndSubmit(user)

    expect(screen.getByRole('alert')).toHaveTextContent(en.errors.auth_unavailable)
    expect(router.state.location.pathname).toBe('/signup')
    // The Account exists now: email and password can't be edited and silently ignored on retry.
    expect(f.email).toHaveAttribute('readonly')
    expect(f.password).toHaveAttribute('readonly')
    expect(f.firstName).not.toHaveAttribute('readonly')

    await user.click(f.submit)
    expect(signUp).toHaveBeenCalledTimes(1)
    expect(apiFetch).toHaveBeenCalledWith('/api/auth/after-sign-in', expect.anything())
    expect(router.state.location.pathname).toBe('/projects')
  })

  it('an unexpected sign-up failure shows the generic error', async () => {
    vi.mocked(signUp).mockResolvedValue({ error: 'generic' })
    const user = userEvent.setup()
    renderRoute('/signup')

    await fillAndSubmit(user)

    expect(screen.getByRole('alert')).toHaveTextContent(en.errors.generic)
  })

  it('works from the keyboard: Tab through the fields and press Enter', async () => {
    const user = userEvent.setup()
    const { router } = renderRoute('/signup')
    const f = form()

    await user.click(f.firstName)
    await user.keyboard('Emma')
    await user.tab()
    expect(f.email).toHaveFocus()
    await user.keyboard('emma@example.com')
    await user.tab()
    expect(f.password).toHaveFocus()
    await user.keyboard('longenough{Enter}')

    expect(signUp).toHaveBeenCalledTimes(1)
    expect(router.state.location.pathname).toBe('/projects')
  })

  it.each([
    ['empty', '', en.signup.errors.emailRequired],
    ['invalid', 'emma.example.com', en.signup.errors.emailInvalid],
  ])('%s email: the Error line explains it, no sign-up', async (_, email, message) => {
    const user = userEvent.setup()
    renderRoute('/signup')

    const f = await fillAndSubmit(user, { email })

    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(signUp).not.toHaveBeenCalled()
    expect(f.email).toHaveFocus()
  })

  it('disables the button while busy and ignores a second submit', async () => {
    let finish
    vi.mocked(signUp).mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const user = userEvent.setup()
    renderRoute('/signup')
    const f = await fillAndSubmit(user)

    expect(f.submit).toBeDisabled()
    f.submit.form.requestSubmit()
    expect(signUp).toHaveBeenCalledTimes(1)

    finish({ error: 'duplicate' })
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(f.submit).toBeEnabled()
  })

  it('a repeated identical error is a fresh alert, so it is announced again', async () => {
    const user = userEvent.setup()
    renderRoute('/signup')
    const f = await fillAndSubmit(user, { password: 'short' })
    const first = screen.getByRole('alert')

    await user.click(f.submit)

    const second = screen.getByRole('alert')
    expect(second).toHaveTextContent(en.signup.errors.passwordTooShort)
    expect(second).not.toBe(first)
  })
})
