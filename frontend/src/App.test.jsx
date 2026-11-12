// The app as production renders it: no I18nextProvider, only the instance bound by initReactI18next.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App.jsx'
import en from './i18n/en.json'
import nb from './i18n/nb.json'
import './i18n/index.js'

describe('App', () => {
  it('renders in English and switches to Norwegian without a provider', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByRole('heading', { level: 1, name: en.login.wordmark })).toBeInTheDocument()
    expect(screen.getByText(en.login.tagline)).toBeInTheDocument()
    const group = screen.getByRole('group', { name: en.language.label })

    await user.click(within(group).getByRole('button', { name: 'Norsk' }))

    expect(screen.getByText(nb.login.tagline)).toBeInTheDocument()
  })
})
