// Language detection and persistence (Story 1.2 matrix rows 1-6).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function browserLanguages(list) {
  vi.spyOn(Navigator.prototype, 'languages', 'get').mockReturnValue(list)
}

function blockStorage() {
  const fail = () => {
    throw new DOMException('blocked', 'SecurityError')
  }
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(fail)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(fail)
}

// A fresh module graph is a fresh page load: i18n initialises from detectLanguage() again.
async function loadPage() {
  vi.resetModules()
  return import('./index.js')
}

// setup.js already resets the language and storage; only <html lang> needs a known start here.
beforeEach(() => {
  document.documentElement.lang = 'en'
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('first visit, no saved choice', () => {
  it.each(['nb-NO', 'nb', 'nn-NO', 'nn', 'no', 'no-NO'])('a %s browser gets Norwegian and <html lang="nb">', async (tag) => {
    browserLanguages([tag])
    const { default: i18n, detectLanguage } = await loadPage()

    expect(detectLanguage()).toBe('nb')
    expect(i18n.language).toBe('nb')
    expect(document.documentElement.lang).toBe('nb')
    expect(i18n.t('login.tagline')).toBe('Studer fra dine egne notater, med kilder')
  })

  it('an en-GB browser gets English', async () => {
    browserLanguages(['en-GB'])
    const { default: i18n, detectLanguage } = await loadPage()

    expect(detectLanguage()).toBe('en')
    expect(i18n.language).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('the first supported tag wins: ["de-DE", "nb"] gets Norwegian', async () => {
    browserLanguages(['de-DE', 'nb'])
    const { detectLanguage } = await loadPage()

    expect(detectLanguage()).toBe('nb')
  })

  it('an empty navigator.languages falls back to navigator.language', async () => {
    browserLanguages([])
    vi.spyOn(Navigator.prototype, 'language', 'get').mockReturnValue('nb-NO')
    const { detectLanguage } = await loadPage()

    expect(detectLanguage()).toBe('nb')
  })

  it('any other browser language falls back to English', async () => {
    browserLanguages(['de-DE', 'fr'])
    const { default: i18n, detectLanguage } = await loadPage()

    expect(detectLanguage()).toBe('en')
    expect(i18n.language).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })
})

describe('saved choice', () => {
  it('a saved nb wins over an English browser', async () => {
    browserLanguages(['en-US'])
    window.localStorage.setItem('studybuddy.language', 'nb')
    const { default: i18n, detectLanguage } = await loadPage()

    expect(detectLanguage()).toBe('nb')
    expect(i18n.language).toBe('nb')
    expect(document.documentElement.lang).toBe('nb')
  })

  it('an unknown saved value is ignored', async () => {
    browserLanguages(['nb-NO'])
    window.localStorage.setItem('studybuddy.language', 'de')
    const { detectLanguage } = await loadPage()

    expect(detectLanguage()).toBe('nb')
  })

  it('setLanguage saves the choice, and it survives a reload', async () => {
    browserLanguages(['en-GB'])
    const first = await loadPage()
    await first.setLanguage('nb')

    expect(window.localStorage.getItem('studybuddy.language')).toBe('nb')
    expect(document.documentElement.lang).toBe('nb')

    const reloaded = await loadPage()
    expect(reloaded.default.language).toBe('nb')
  })
})

describe('setLanguage', () => {
  it('an unsupported language falls back to English', async () => {
    browserLanguages(['nb-NO'])
    const { default: i18n, setLanguage } = await loadPage()
    expect(i18n.language).toBe('nb')

    await setLanguage('xx')

    expect(i18n.language).toBe('en')
    expect(window.localStorage.getItem('studybuddy.language')).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })
})

describe('storage blocked', () => {
  it('detection still follows the browser', async () => {
    blockStorage()
    browserLanguages(['nb-NO'])
    const { default: i18n, detectLanguage } = await loadPage()

    expect(() => detectLanguage()).not.toThrow()
    expect(i18n.language).toBe('nb')
  })

  it('setLanguage switches for the session without throwing', async () => {
    blockStorage()
    browserLanguages(['en-GB'])
    const { default: i18n, setLanguage } = await loadPage()

    await expect(setLanguage('nb')).resolves.toBeDefined()
    expect(i18n.language).toBe('nb')
    expect(document.documentElement.lang).toBe('nb')
  })
})
