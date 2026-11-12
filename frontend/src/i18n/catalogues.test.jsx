// Catalogue shape: identical keys in both languages, and plural forms (Story 1.2 matrix row 9).
import { describe, expect, it } from 'vitest'
import { i18n } from '../test/render.jsx'
import en from './en.json'
import nb from './nb.json'

function keys(tree, prefix = '') {
  return Object.entries(tree).flatMap(([key, value]) => {
    if (!prefix && key === '_meta') return [] // documentation only, differs on purpose
    const path = prefix ? `${prefix}.${key}` : key
    return value && typeof value === 'object' ? keys(value, path) : [path]
  })
}

describe('catalogues', () => {
  it('en.json and nb.json have identical key sets', () => {
    expect(keys(nb).sort()).toEqual(keys(en).sort())
  })

  it('nb.json is marked as draft', () => {
    expect(nb._meta.status).toBe('draft')
  })

  it('the footer credit is verbatim in both languages', () => {
    const credit = '© 2026 Sherlock and Watson Inc. · All mysteries solved, all rights reserved.'
    expect(en.footer.credit).toBe(credit)
    expect(nb.footer.credit).toBe(credit)
  })

  it.each([
    ['en', 1, '1 message left today'],
    ['en', 3, '3 messages left today'],
    ['nb', 1, '1 melding igjen i dag'],
    ['nb', 3, '3 meldinger igjen i dag'],
  ])('%s with count %i reads "%s"', (lng, count, expected) => {
    expect(i18n.getFixedT(lng)('limits.messagesLeft', { count })).toBe(expected)
  })
})
