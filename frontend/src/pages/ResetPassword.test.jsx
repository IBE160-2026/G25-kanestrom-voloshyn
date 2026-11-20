// Password reset, new-password step (Story 1.5, FR-3): the emailed link, saving, and the expired
// state. api/client.js and auth/ are mocked (spine › Tests).
import { readFileSync } from 'node:fs'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client.js'
import { completeRecovery, hasSession, setNewPassword, signOut } from '../auth/index.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { i18n, renderRoute } from '../test/render.jsx'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

const LINK = '/reset-password?token_hash=abc123'

beforeEach(() => {
  vi.mocked(completeRecovery).mockReset().mockResolvedValue({ ok: true })
  vi.mocked(setNewPassword).mockReset().mockResolvedValue({ ok: true })
  vi.mocked(signOut).mockReset().mockResolvedValue({ ended: Promise.resolve() })
  vi.mocked(hasSession).mockReset().mockResolvedValue(false)
  vi.mocked(apiFetch).mockReset().mockResolvedValue(null)
})

afterEach(async () => {
  await i18n.changeLanguage('en')
})

async function newPasswordForm(catalogue = en) {
  // Wait for the form itself: the heading also shows while the link is still being checked.
  const password = await screen.findByLabelText(catalogue.login.password)
  expect(screen.getByRole('heading', { level: 2, name: catalogue.reset.newPassword.title })).toBeInTheDocument()
  return {
    password,
    repeat: screen.getByLabelText(catalogue.signup.repeatPassword),
    submit: screen.getByRole('button', { name: catalogue.reset.newPassword.submit }),
  }
}

describe('ResetPassword', () => {
  it('a valid link verifies the token hash and shows the new-password screen', async () => {
    renderRoute(LINK)

    const f = await newPasswordForm()
    expect(completeRecovery).toHaveBeenCalledWith('abc123')
    expect(f.password).toHaveAttribute('type', 'password')
    expect(f.password).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByRole('group', { name: en.language.label })).toBeInTheDocument()
  })

  it('saving: sets the password, ends other sessions, signs out, and Login shows the notice', async () => {
    const user = userEvent.setup()
    const { router } = renderRoute(LINK)
    const f = await newPasswordForm()

    await user.type(f.password, 'brand-new-pass')
    await user.type(f.repeat, 'brand-new-pass')
    await user.click(f.submit)

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(setNewPassword).toHaveBeenCalledWith('brand-new-pass')
    expect(apiFetch).toHaveBeenCalledWith('/api/auth/after-password-reset', { method: 'POST' })
    expect(signOut).toHaveBeenCalledTimes(1)
    // The order: password, then other sessions, then this one.
    expect(vi.mocked(setNewPassword).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(apiFetch).mock.invocationCallOrder[0],
    )
    expect(vi.mocked(apiFetch).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(signOut).mock.invocationCallOrder[0])
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(en.reset.saved))
  })

  it('a 7-character password shows "Use at least 8 characters." and changes nothing', async () => {
    const user = userEvent.setup()
    const { router } = renderRoute(LINK)
    const f = await newPasswordForm()

    await user.type(f.password, 'seven77')
    await user.type(f.repeat, 'seven77')
    await user.click(f.submit)

    expect(screen.getByRole('alert')).toHaveTextContent(en.signup.errors.passwordTooShort)
    expect(f.password).toHaveFocus()
    expect(setNewPassword).not.toHaveBeenCalled()
    expect(apiFetch).not.toHaveBeenCalled()
    expect(router.state.location.pathname).toBe('/reset-password')
  })

  it('a repeat that differs shows the mismatch line on the repeat field and changes nothing', async () => {
    const user = userEvent.setup()
    renderRoute(LINK)
    const f = await newPasswordForm()

    await user.type(f.password, 'brand-new-pass')
    await user.type(f.repeat, 'brand-new-pas')
    await user.click(f.submit)

    expect(screen.getByRole('alert')).toHaveTextContent(en.signup.errors.passwordMismatch)
    expect(f.repeat).toHaveFocus()
    expect(setNewPassword).not.toHaveBeenCalled()
  })

  it('Supabase refusing the password as too short shows the same line', async () => {
    vi.mocked(setNewPassword).mockResolvedValue({ error: 'password_too_short' })
    const user = userEvent.setup()
    renderRoute(LINK)
    const f = await newPasswordForm()

    await user.type(f.password, 'longenough')
    await user.type(f.repeat, 'longenough')
    await user.click(f.submit)

    expect(await screen.findByRole('alert')).toHaveTextContent(en.signup.errors.passwordTooShort)
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('a failed save shows the generic error and can be retried', async () => {
    vi.mocked(setNewPassword).mockResolvedValueOnce({ error: 'failed' })
    const user = userEvent.setup()
    const { router } = renderRoute(LINK)
    const f = await newPasswordForm()

    await user.type(f.password, 'longenough')
    await user.type(f.repeat, 'longenough')
    await user.click(f.submit)
    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.generic)

    await user.click(f.submit)
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(setNewPassword).toHaveBeenCalledTimes(2)
  })

  it('after-password-reset failing: the password stays saved and a retry repeats only that step', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce({ code: 'auth_unavailable', params: {} })
    const user = userEvent.setup()
    const { router } = renderRoute(LINK)
    const f = await newPasswordForm()

    await user.type(f.password, 'longenough')
    await user.type(f.repeat, 'longenough')
    await user.click(f.submit)
    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.generic)
    expect(f.password).toHaveAttribute('readonly')
    expect(signOut).not.toHaveBeenCalled()

    await user.click(f.submit)
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(setNewPassword).toHaveBeenCalledTimes(1)
    expect(apiFetch).toHaveBeenCalledTimes(2)
  })

  it('after-password-reset refusing the session: carries on to Login with the notice', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce({ code: 'unauthorized', params: {} })
    const user = userEvent.setup()
    const { router } = renderRoute(LINK)
    const f = await newPasswordForm()

    await user.type(f.password, 'longenough')
    await user.type(f.repeat, 'longenough')
    await user.click(f.submit)

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(en.reset.saved))
  })

  it('an expired, used, or replaced link shows "This link has expired" and "Send a new link"', async () => {
    vi.mocked(completeRecovery).mockResolvedValue({ error: 'expired' })
    const user = userEvent.setup()
    const { router } = renderRoute(LINK)

    expect(await screen.findByRole('heading', { level: 2, name: en.reset.expired })).toBeInTheDocument()
    expect(screen.queryByLabelText(en.login.password)).not.toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: en.reset.sendNewLink }))
    expect(router.state.location.pathname).toBe('/forgot-password')
    expect(screen.getByRole('heading', { level: 2, name: en.reset.request.title })).toBeInTheDocument()
  })

  it('a link without a token hash is the same expired state', async () => {
    vi.mocked(completeRecovery).mockResolvedValue({ error: 'expired' })
    renderRoute('/reset-password')

    expect(await screen.findByRole('heading', { level: 2, name: en.reset.expired })).toBeInTheDocument()
    expect(completeRecovery).toHaveBeenCalledWith(null)
  })

  it('shows the Norwegian strings', async () => {
    await i18n.changeLanguage('nb')
    vi.mocked(completeRecovery).mockResolvedValue({ error: 'expired' })
    renderRoute(LINK)

    expect(await screen.findByRole('heading', { level: 2, name: nb.reset.expired })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: nb.reset.sendNewLink })).toBeInTheDocument()
  })

  it('works from the keyboard: type and press Enter', async () => {
    const user = userEvent.setup()
    const { router } = renderRoute(LINK)
    const f = await newPasswordForm()

    await user.click(f.password)
    await user.keyboard('brand-new-pass')
    await user.click(f.repeat)
    await user.keyboard('brand-new-pass{Enter}')

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('while the link is checked: the heading shows and the panel is busy', async () => {
    vi.mocked(completeRecovery).mockReturnValue(new Promise(() => {}))
    renderRoute(LINK)

    const heading = screen.getByRole('heading', { level: 2, name: en.reset.newPassword.title })
    const panel = heading.closest('section')
    expect(panel).toHaveAttribute('aria-busy', 'true')
    expect(panel).toHaveAttribute('aria-labelledby', heading.id)
    expect(screen.queryByLabelText(en.login.password)).not.toBeInTheDocument()
  })

  it("a network failure shows the retryable sign-in error, and saving checks the same link again", async () => {
    vi.mocked(completeRecovery).mockResolvedValueOnce({ error: 'failed' }).mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    const { router } = renderRoute(LINK)

    expect(await screen.findByRole('alert')).toHaveTextContent(en.login.errors.failed)
    expect(screen.queryByRole('heading', { name: en.reset.expired })).not.toBeInTheDocument()
    const f = await newPasswordForm()

    await user.type(f.password, 'brand-new-pass')
    await user.type(f.repeat, 'brand-new-pass')
    await user.click(f.submit)

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(completeRecovery).toHaveBeenLastCalledWith('abc123')
    expect(setNewPassword).toHaveBeenCalledWith('brand-new-pass')
  })

  it('a retry that finds the link expired shows the expired state', async () => {
    vi.mocked(completeRecovery).mockResolvedValueOnce({ error: 'failed' }).mockResolvedValue({ error: 'expired' })
    const user = userEvent.setup()
    renderRoute(LINK)
    const f = await newPasswordForm()

    await user.type(f.password, 'brand-new-pass')
    await user.type(f.repeat, 'brand-new-pass')
    await user.click(f.submit)

    expect(await screen.findByRole('heading', { level: 2, name: en.reset.expired })).toBeInTheDocument()
    expect(setNewPassword).not.toHaveBeenCalled()
  })

  it('abandoned: leaving through "Log in" after the link was verified signs out, and Login shows the form', async () => {
    // A session exists until signOut is called.
    vi.mocked(hasSession).mockImplementation(async () => vi.mocked(signOut).mock.calls.length === 0)
    const user = userEvent.setup()
    const { router } = renderRoute(LINK)
    await newPasswordForm()

    await user.click(screen.getByRole('link', { name: en.login.submit }))

    expect(signOut).toHaveBeenCalledTimes(1)
    await expect(hasSession()).resolves.toBe(false)
    expect(router.state.location.pathname).toBe('/')
    expect(screen.getByRole('form', { name: en.login.submit })).toBeInTheDocument()
    // Login stays: it didn't move on to /projects.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(router.state.location.pathname).toBe('/')
  })

  it('leaving before the link was verified, or after a failed check, signs nothing out', async () => {
    vi.mocked(completeRecovery).mockResolvedValue({ error: 'failed' })
    const user = userEvent.setup()
    renderRoute(LINK)
    await screen.findByRole('alert')

    await user.click(screen.getByRole('link', { name: en.login.submit }))
    expect(signOut).not.toHaveBeenCalled()
  })

  it('a link verified after the student left is signed out at once', async () => {
    let resolve
    vi.mocked(completeRecovery).mockReturnValue(new Promise((r) => (resolve = r)))
    const user = userEvent.setup()
    renderRoute(LINK)

    await user.click(screen.getByRole('link', { name: en.login.submit }))
    expect(signOut).not.toHaveBeenCalled()
    resolve({ ok: true })
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1))
  })

  it("another link starts from a clean screen and ends the first link's session", async () => {
    const user = userEvent.setup()
    const { router } = renderRoute(LINK)
    const f = await newPasswordForm()
    await user.type(f.password, 'typed-for-the-first')
    await user.type(f.repeat, 'typed-for-the-first')

    vi.mocked(completeRecovery).mockResolvedValue({ error: 'expired' })
    await router.navigate('/reset-password?token_hash=other456')

    expect(await screen.findByRole('heading', { level: 2, name: en.reset.expired })).toBeInTheDocument()
    expect(completeRecovery).toHaveBeenLastCalledWith('other456')
    expect(signOut).toHaveBeenCalledTimes(1)

    vi.mocked(completeRecovery).mockResolvedValue({ ok: true })
    await router.navigate(LINK)
    expect((await newPasswordForm()).password).toHaveValue('')
  })

  it('removes the token hash from the URL once read, and the page keeps working', async () => {
    const user = userEvent.setup()
    const { router } = renderRoute(LINK)
    const f = await newPasswordForm()

    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(router.state.location.pathname).toBe('/reset-password')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(completeRecovery).toHaveBeenCalledTimes(1)
    expect(completeRecovery).toHaveBeenCalledWith('abc123')

    await user.type(f.password, 'brand-new-pass')
    await user.type(f.repeat, 'brand-new-pass')
    await user.click(f.submit)
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(setNewPassword).toHaveBeenCalledWith('brand-new-pass')
  })

  it('after saving, waits until the session has ended before showing Login', async () => {
    let end
    const ended = new Promise((resolve) => (end = resolve))
    let sessionEnded = false
    vi.mocked(signOut).mockResolvedValue({ ended: ended.then(() => (sessionEnded = true)) })
    // The recovery session is still seen until signing out has really finished.
    vi.mocked(hasSession).mockImplementation(async () => !sessionEnded)
    const user = userEvent.setup()
    const { router } = renderRoute(LINK)
    const f = await newPasswordForm()

    await user.type(f.password, 'brand-new-pass')
    await user.type(f.repeat, 'brand-new-pass')
    await user.click(f.submit)
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(router.state.location.pathname).toBe('/reset-password')

    end()
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(en.reset.saved))
    // Login stays: its session check no longer sees the recovery session.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(router.state.location.pathname).toBe('/')
  })

  it('leaving while the new password is being saved stops there: no follow-up, no navigation', async () => {
    let save
    vi.mocked(setNewPassword).mockReturnValue(new Promise((resolve) => (save = resolve)))
    const user = userEvent.setup()
    const { router } = renderRoute(LINK)
    const f = await newPasswordForm()

    await user.type(f.password, 'brand-new-pass')
    await user.type(f.repeat, 'brand-new-pass')
    await user.click(f.submit)
    await router.navigate('/forgot-password')
    // the unmount ends the held recovery session
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1))

    save({ ok: true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(apiFetch).not.toHaveBeenCalled()
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(router.state.location.pathname).toBe('/forgot-password')
  })

  it('leaving while other sessions are being ended stops there: no sign-out twice, no navigation', async () => {
    let done
    vi.mocked(apiFetch).mockReturnValue(new Promise((resolve) => (done = resolve)))
    const user = userEvent.setup()
    const { router } = renderRoute(LINK)
    const f = await newPasswordForm()

    await user.type(f.password, 'brand-new-pass')
    await user.type(f.repeat, 'brand-new-pass')
    await user.click(f.submit)
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    await router.navigate('/forgot-password')
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1))

    done(null)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(router.state.location.pathname).toBe('/forgot-password')
  })

  it('"Send a new link" has hover and visible focus states, from tokens only', () => {
    const css = readFileSync('src/components/AuthForm.module.css', 'utf8')
    expect(css).toMatch(/\.primaryLink:hover[^{]*\{[^}]*text-decoration: underline/)
    expect(css).toMatch(/\.primaryLink:focus-visible\s*\{[^}]*outline: var\(--space-focus-ring-width\) solid var\(--color-primary\)/)
  })
})
