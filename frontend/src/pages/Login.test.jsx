// Login screen and the EN | NO toggle (Story 1.2 matrix rows 5-6).
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { i18n, renderWithI18n } from '../test/render.jsx'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import Login from './Login.jsx'

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
    renderWithI18n(<Login />)

    expectStrings(en)
    const { en: enButton, nb: nbButton } = toggle()
    expect(enButton).toHaveTextContent('EN')
    expect(nbButton).toHaveTextContent('NO')
    expect(enButton).toHaveAttribute('aria-pressed', 'true')
    expect(nbButton).toHaveAttribute('aria-pressed', 'false')
  })

  it('pressing NO switches every string at once, saves nb, and sets <html lang>', async () => {
    const user = userEvent.setup()
    renderWithI18n(<Login />)

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
    renderWithI18n(<Login />)

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
    renderWithI18n(<Login />)

    await user.click(toggle().nb)

    expectStrings(nb)
    expect(i18n.language).toBe('nb')
  })
})
