// Email verified screen (Story 1.3 part 2): both outcomes and the "Log in" link.
// api/client.js and auth/ are mocked (spine › Tests); the screen itself calls neither.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { i18n, renderRoute } from '../test/render.jsx'

vi.mock('../auth/index.js', () => ({ signUp: vi.fn(), getAccessToken: vi.fn() }))
vi.mock('../api/client.js', () => ({ apiFetch: vi.fn() }))

afterEach(async () => {
  await i18n.changeLanguage('en')
})

describe('EmailVerified', () => {
  it('shows the success message after a working link', () => {
    renderRoute('/email-verified')
    expect(screen.getByRole('heading', { level: 2, name: en.verify.success })).toBeInTheDocument()
    expect(screen.queryByText(en.verify.expired)).not.toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('shows the expired message for an expired, used, or unknown link', () => {
    renderRoute('/email-verified?status=expired')
    expect(screen.getByRole('heading', { level: 2, name: en.verify.expired })).toBeInTheDocument()
    expect(screen.queryByText(en.verify.success)).not.toBeInTheDocument()
  })

  it('shows the Norwegian strings', async () => {
    await i18n.changeLanguage('nb')
    renderRoute('/email-verified')
    expect(screen.getByRole('heading', { level: 2, name: nb.verify.success })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: nb.verify.logIn })).toBeInTheDocument()
  })

  it.each(['/email-verified', '/email-verified?status=expired'])('"Log in" on %s goes to Login', async (path) => {
    const user = userEvent.setup()
    const { router } = renderRoute(path)

    await user.click(screen.getByRole('link', { name: en.verify.logIn }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(screen.getByRole('heading', { level: 1, name: en.login.wordmark })).toBeInTheDocument()
  })
})
