// API errors render from code + params in the active language (Story 1.2 matrix rows 7-8).
import { describe, expect, it } from 'vitest'
import { i18n } from '../test/render.jsx'
import en from './en.json'
import { errorText } from './errors.js'

const t = (...args) => i18n.t(...args)

describe('errorText', () => {
  it('renders a known code in English', () => {
    expect(errorText(t, { code: 'not_found', params: {} })).toBe("We couldn't find that.")
  })

  it('renders a known code in Norwegian after a switch', async () => {
    await i18n.changeLanguage('nb')
    expect(errorText(t, { code: 'not_found', params: {} })).toBe('Vi fant ikke det du lette etter.')
  })

  it('accepts the whole envelope and never shows the server message', () => {
    const envelope = { error: { code: 'not_found', params: {}, message: 'Not Found: /api/nope' } }
    expect(errorText(t, envelope)).toBe("We couldn't find that.")
  })

  it('falls back to the generic text for an unknown code', () => {
    expect(errorText(t, { code: 'brand_new_code', message: 'secret detail' })).toBe('Something went wrong.')
  })

  it('falls back to the Norwegian generic text for an unknown code', async () => {
    await i18n.changeLanguage('nb')
    expect(errorText(t, { code: 'brand_new_code' })).toBe('Noe gikk galt.')
  })

  it.each([undefined, null, {}, { code: 42 }, { code: 'errors' }, { code: '' }, { code: 'not_found.x' }])(
    'falls back to the generic text for %j',
    (error) => {
      expect(errorText(t, error)).toBe('Something went wrong.')
    },
  )

  it('has a catalogue entry for every code the backend emits today', () => {
    const codes = ['not_found', 'bad_request', 'unauthorized', 'forbidden', 'method_not_allowed', 'conflict',
      'file_too_large', 'invalid_request', 'http_error', 'internal_error']
    for (const code of codes) expect(en.errors[code], code).toBeTypeOf('string')
  })

  it('passes params to the catalogue text', () => {
    i18n.addResource('en', 'translation', 'errors.test_with_param', 'Only {{n}} left.')
    try {
      expect(errorText(t, { code: 'test_with_param', params: { n: 2 } })).toBe('Only 2 left.')
    } finally {
      delete i18n.store.data.en.translation.errors.test_with_param // keep the shared instance clean
    }
  })
})
