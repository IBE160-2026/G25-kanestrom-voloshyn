// PasswordInput (Cristoffer, 2026-11-20): the eye that shows or hides the password, and the Caps Lock
// hint. Tested on Login, where the student meets it first; the other screens use the same component.
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { i18n, renderRoute } from '../test/render.jsx'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

beforeEach(() => {
  vi.mocked(hasSession).mockReset().mockResolvedValue(false)
})

afterEach(async () => {
  await i18n.changeLanguage('en')
})

const password = () => screen.getByLabelText(en.login.password)

describe('Password input', () => {
  it('the eye shows the password and hides it again', async () => {
    const user = userEvent.setup()
    renderRoute('/')
    await user.type(password(), 'secret-pass')
    expect(password()).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: en.password.show }))
    expect(password()).toHaveAttribute('type', 'text')
    expect(password()).toHaveValue('secret-pass')
    const hide = screen.getByRole('button', { name: en.password.hide })
    expect(hide).toHaveAttribute('aria-pressed', 'true')

    await user.click(hide)
    expect(password()).toHaveAttribute('type', 'password')
    expect(screen.getByRole('button', { name: en.password.show })).toHaveAttribute('aria-pressed', 'false')
  })

  it('the eye is a button of its own, so Enter in the field still logs in', async () => {
    renderRoute('/')
    expect(screen.getByRole('button', { name: en.password.show })).toHaveAttribute('type', 'button')
  })

  it('says "Caps Lock is on." while typing with Caps Lock on, and not after it is off or the field is left', async () => {
    const user = userEvent.setup()
    renderRoute('/')
    await user.click(password())
    expect(screen.queryByText(en.password.capsLock)).not.toBeInTheDocument()

    await user.keyboard('{CapsLock}a')
    const hint = screen.getByText(en.password.capsLock)
    expect(password()).toHaveAttribute('aria-describedby', hint.id)

    await user.keyboard('{CapsLock}a')
    expect(screen.queryByText(en.password.capsLock)).not.toBeInTheDocument()

    await user.keyboard('{CapsLock}a')
    expect(screen.getByText(en.password.capsLock)).toBeInTheDocument()
    await user.tab()
    expect(screen.queryByText(en.password.capsLock)).not.toBeInTheDocument()
  })

  it('reads in Norwegian', async () => {
    await i18n.changeLanguage('nb')
    const user = userEvent.setup()
    renderRoute('/')
    const field = screen.getByLabelText(nb.login.password)
    await user.click(field)
    await user.keyboard('{CapsLock}a')

    expect(screen.getByText(nb.password.capsLock)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nb.password.show })).toBeInTheDocument()
  })
})
