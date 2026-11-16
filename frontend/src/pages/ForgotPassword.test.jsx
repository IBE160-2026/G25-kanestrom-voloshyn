// Password reset, request step (Story 1.5, FR-3). api/client.js and auth/ are mocked (spine › Tests).
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { i18n, renderRoute } from '../test/render.jsx'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

beforeEach(() => {
  vi.mocked(apiFetch).mockReset().mockResolvedValue({ status: 'accepted' })
})

afterEach(async () => {
  await i18n.changeLanguage('en')
})

function form(catalogue = en) {
  return {
    email: screen.getByLabelText(catalogue.login.email),
    submit: screen.getByRole('button', { name: catalogue.reset.request.submit }),
  }
}

describe('ForgotPassword', () => {
  it('shows the request step with the language toggle and a way back to Login', () => {
    renderRoute('/forgot-password')

    expect(screen.getByRole('heading', { level: 2, name: en.reset.request.title })).toBeInTheDocument()
    expect(form().email).toHaveAttribute('type', 'email')
    expect(form().email).toHaveAttribute('autocomplete', 'email')
    expect(screen.getByRole('group', { name: en.language.label })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: en.login.submit })).toHaveAttribute('href', '/')
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('sends the email and the active language without a token, then shows the same "sent" text', async () => {
    await i18n.changeLanguage('nb')
    const user = userEvent.setup()
    renderRoute('/forgot-password')

    await user.type(form(nb).email, '  emma@example.com ')
    await user.click(form(nb).submit)

    expect(apiFetch).toHaveBeenCalledWith('/api/auth/password-reset', {
      method: 'POST',
      auth: false,
      body: { email: 'emma@example.com', language: 'nb' },
    })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(nb.reset.request.sent))
    // The form is replaced by the text.
    expect(screen.queryByRole('button', { name: nb.reset.request.submit })).not.toBeInTheDocument()
  })

  it.each([
    ['', en.signup.errors.emailRequired],
    ['not-an-email', en.signup.errors.emailInvalid],
    [`${'x'.repeat(250)}@example.com`, en.signup.errors.emailInvalid],
  ])('"%s" shows "%s" without a request, focus on the email', async (typed, message) => {
    const user = userEvent.setup()
    renderRoute('/forgot-password')

    if (typed) await user.type(form().email, typed)
    await user.click(form().submit)

    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(form().email).toHaveFocus()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('an API failure shows the translated error, keeps the email, and can be retried', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce({ code: 'network_error', params: {} })
    const user = userEvent.setup()
    renderRoute('/forgot-password')

    await user.type(form().email, 'emma@example.com')
    await user.click(form().submit)

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.generic)
    expect(form().email).toHaveValue('emma@example.com')
    expect(form().submit).toBeEnabled()

    await user.click(form().submit)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(en.reset.request.sent))
  })

  it('works from the keyboard and ignores a double submit', async () => {
    let resolve
    vi.mocked(apiFetch).mockImplementation(() => new Promise((r) => (resolve = r)))
    const user = userEvent.setup()
    renderRoute('/forgot-password')

    await user.click(form().email)
    await user.keyboard('emma@example.com{Enter}')
    expect(form().submit).toBeDisabled()
    await user.keyboard('{Enter}')
    expect(apiFetch).toHaveBeenCalledTimes(1)

    resolve({ status: 'accepted' })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(en.reset.request.sent))
  })
})
