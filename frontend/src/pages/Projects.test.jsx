// Projects page, empty (Story 1.3). api/client.js and auth/ are mocked (spine › Tests).
import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client.js'
import en from '../i18n/en.json'
import { renderRoute } from '../test/render.jsx'

vi.mock('../auth/index.js', () => ({ signUp: vi.fn(), getAccessToken: vi.fn() }))
vi.mock('../api/client.js', () => ({ apiFetch: vi.fn() }))

beforeEach(() => {
  vi.mocked(apiFetch).mockReset()
})

describe('Projects', () => {
  it('greets by first name and shows the empty state', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ first_name: 'Emma', language: 'en', email_verified: false })
    renderRoute('/projects')

    expect(await screen.findByText('Welcome, Emma')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: en.projects.empty.heading })).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(apiFetch).toHaveBeenCalledWith('/api/me')
  })

  it('shows the API error from its code, never the server message', async () => {
    vi.mocked(apiFetch).mockRejectedValue({ code: 'auth_unavailable', params: {}, message: 'Supabase down' })
    renderRoute('/projects')

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.auth_unavailable)
    expect(screen.queryByText('Supabase down')).not.toBeInTheDocument()
    expect(screen.queryByText(/Welcome/)).not.toBeInTheDocument()
  })

  it('shows no empty-state content until /api/me answers', async () => {
    let answer
    vi.mocked(apiFetch).mockReturnValue(new Promise((resolve) => (answer = resolve)))
    renderRoute('/projects')

    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true')

    answer({ first_name: 'Emma', language: 'en', email_verified: false })
    expect(await screen.findByRole('heading', { name: en.projects.empty.heading })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'false')
  })

  it.each(['unauthorized', 'session_expired'])('on %s it goes back to Login', async (code) => {
    vi.mocked(apiFetch).mockRejectedValue({ code, params: {} })
    const { router } = renderRoute('/projects')

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
