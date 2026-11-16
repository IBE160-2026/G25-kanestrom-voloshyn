// The shared email check (Create account, Password reset).
import { describe, expect, it } from 'vitest'
import { MAX_EMAIL_LENGTH, isEmail } from './email.js'

describe('isEmail', () => {
  it.each(['emma@example.com', 'a@b', `${'x'.repeat(MAX_EMAIL_LENGTH - 12)}@example.com`])('accepts %s', (address) => {
    expect(isEmail(address)).toBe(true)
  })

  it.each([
    '',
    'not-an-email',
    '@example.com',
    'emma@',
    'a b@example.com',
    'a@@example.com',
    `${'x'.repeat(MAX_EMAIL_LENGTH - 11)}@example.com`, // 255 characters
    null,
    undefined,
  ])('refuses %j', (address) => {
    expect(isEmail(address)).toBe(false)
  })
})
