// Login screen and the EN | NO toggle (Story 1.2 matrix rows 5-6), plus the Create account link (Story 1.3).
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { i18n, renderRoute } from '../test/render.jsx'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'

vi.mock('../auth/index.js', () => ({ signUp: vi.fn(), getAccessToken: vi.fn() }))
vi.mock('../api/client.js', () => ({ apiFetch: vi.fn() }))

afterEach(() => {
  vi.restoreAllMocks()
})

function expectStrings(catalogue) {
  expect(screen.getByRole('heading', { level: 1, name: catalogue.login.wordmark })).toBeInTheDocument()
  expect(screen.getByText(catalogue.login.tagline)).toBeInTheDocument()
  expect(screen.getByText(catalogue.login.privacy)).toBeInTheDocument()
  expect(screen.getByText(catalogue.footer.credit)).toBeInTheDocument()
  expect(screen.getByRole('group', { name: catalogue.language.label })).toBeInTheDocument()
}

function toggle() {
  const group = screen.getByRole('group', { name: /^(Language|Språk)$/ })
  return {
    en: within(group).getByRole('button', { name: 'English' }),
    nb: within(group).getByRole('button', { name: 'Norsk' }),
  }
}

describe('Login', () => {
  it('shows the static parts in English by default, with EN pressed', () => {
    renderRoute('/')

    expectStrings(en)
    const { en: enButton, nb: nbButton } = toggle()
    expect(enButton).toHaveTextContent('EN')
    expect(nbButton).toHaveTextContent('NO')
    expect(enButton).toHaveAttribute('aria-pressed', 'true')
    expect(nbButton).toHaveAttribute('aria-pressed', 'false')
  })

  it('pressing NO switches every string at once, saves nb, and sets <html lang>', async () => {
    const user = userEvent.setup()
    renderRoute('/')

    await user.click(toggle().nb)

    expectStrings(nb)
    expect(screen.queryByText(en.login.tagline)).not.toBeInTheDocument()
    expect(toggle().nb).toHaveAttribute('aria-pressed', 'true')
    expect(toggle().en).toHaveAttribute('aria-pressed', 'false')
    expect(window.localStorage.getItem('studybuddy.language')).toBe('nb')
    expect(document.documentElement.lang).toBe('nb')
  })

  it('works from the keyboard: Tab to a segment, then Enter', async () => {
    const user = userEvent.setup()
    renderRoute('/')

    await user.tab()
    expect(toggle().en).toHaveFocus()
    await user.tab()
    expect(toggle().nb).toHaveFocus()
    await user.keyboard('{Enter}')
    expectStrings(nb)

    await user.tab({ shift: true })
    expect(toggle().en).toHaveFocus()
    await user.keyboard('{Enter}')
    expectStrings(en)
    expect(window.localStorage.getItem('studybuddy.language')).toBe('en')
  })

  it('still switches for the session when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    const user = userEvent.setup()
    renderRoute('/')

    await user.click(toggle().nb)

    expectStrings(nb)
    expect(i18n.language).toBe('nb')
  })

  it('links to Create account', async () => {
    const user = userEvent.setup()
    const { router } = renderRoute('/')

    await user.click(screen.getByRole('link', { name: en.login.createAccount }))

    expect(router.state.location.pathname).toBe('/signup')
    expect(screen.getByRole('form', { name: en.signup.submit })).toBeInTheDocument()
  })
})
