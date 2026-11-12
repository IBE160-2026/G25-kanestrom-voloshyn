// Vitest setup (spine › Tests): jest-dom matchers, a fresh language and storage before every test,
// and a clean DOM after every test.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { resetI18n } from './reset.js'

beforeEach(resetI18n)

afterEach(() => {
  cleanup()
})
