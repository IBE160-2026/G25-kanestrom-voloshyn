// RequireSession: the guard and the session-ended listener (Story 1.4). api/client.js and auth/
// are mocked (spine › Tests); the listener is the one RequireSession hands to onSignedOut.
import { act, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, onSignedOut } from '../api/client.js'
import { hasSession } from '../auth/index.js'
import { RETURN_TO_KEY } from '../auth/returnTo.js'
import en from '../i18n/en.json'
import { renderRoute } from '../test/render.jsx'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

beforeEach(() => {
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
  vi.mocked(onSignedOut).mockReset().mockImplementation(() => () => {})
  vi.mocked(apiFetch).mockReset().mockResolvedValue({ first_name: 'Emma', language: 'en', email_verified: false })
})

function registeredListener() {
  const calls = vi.mocked(onSignedOut).mock.calls
  return calls[calls.length - 1][0]
}

describe('RequireSession', () => {
  it('shows nothing until the session is known', async () => {
    let resolve
    vi.mocked(hasSession).mockReturnValue(new Promise((r) => (resolve = r)))
    renderRoute('/projects')

    expect(screen.queryByRole('main')).not.toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
    resolve(true)
    expect(await screen.findByRole('main')).toBeInTheDocument()
  })

  it('a failed session read counts as signed out', async () => {
    vi.mocked(hasSession).mockRejectedValue(new Error('config down'))
    const { router } = renderRoute('/projects')

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(window.sessionStorage.getItem(RETURN_TO_KEY)).toBe('/projects')
  })

  it('session ended mid-use: remembers the route and shows Login with the notice', async () => {
    const { router } = renderRoute('/projects')
    await screen.findByRole('button', { name: 'Welcome, Emma' })

    vi.mocked(hasSession).mockResolvedValue(false)
    await act(async () => registeredListener()())

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(window.sessionStorage.getItem(RETURN_TO_KEY)).toBe('/projects')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(en.session.expired))
  })

  it('removes its listener when the signed-in page closes', async () => {
    const remove = vi.fn()
    vi.mocked(onSignedOut).mockImplementation(() => remove)
    const { router } = renderRoute('/projects')
    await screen.findByRole('main')

    await act(() => router.navigate('/signup'))

    expect(remove).toHaveBeenCalled()
  })
})
