// Shared render helpers: wrap components with the real i18n instance and catalogues, and optionally
// a memory router. Never mock react-i18next (spine › Tests).
import { render } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import i18n from '../i18n/index.js'
import { routes } from '../routes.jsx'

export function renderWithI18n(ui, options) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>, options)
}

/** Render the app's routes in a memory router at `path`. Returns the router to inspect navigation. */
export function renderRoute(path = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const result = renderWithI18n(<RouterProvider router={router} />)
  return { ...result, router }
}

export { i18n }
