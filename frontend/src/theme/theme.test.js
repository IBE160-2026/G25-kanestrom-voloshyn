// Theme options: the contrast rules hold for every theme × accent in tokens.css (WCAG AA), and the
// theme module resolves "system", follows it live, and falls back to dark + indigo.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACCENTS,
  accountChoice,
  applyAccountTheme,
  applyInitialTheme,
  applySignedOutTheme,
  applyTheme,
  cachedTheme,
} from './index.js'

/** The CSS blocks of tokens.css as [{ selectors: [..], decls: { '--name': value } }]. */
function parseBlocks(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, head, body]) => ({
    selectors: head.split(',').map((s) => s.trim().replace(/"/g, "'")),
    decls: Object.fromEntries(
      body
        .split(';')
        .map((d) => d.trim())
        .filter((d) => d.startsWith('--'))
        .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]),
    ),
  }))
}

// Read from disk: Vitest doesn't process CSS, so a `?raw` import would be empty.
const tokensCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../styles/tokens.css'), 'utf8')
const BLOCKS = parseBlocks(tokensCss)

function block(selector) {
  const found = BLOCKS.find((b) => b.selectors.includes(selector))
  if (!found) throw new Error(`tokens.css has no block for ${selector}`)
  return found.decls
}

/** The colour tokens on <html> for a theme and accent, in the cascade order of tokens.css. */
function tokens(theme, accent) {
  const light = theme === 'light'
  return {
    ...block(':root'),
    ...(light ? block(":root[data-theme='light']") : {}),
    ...block(light ? `:root[data-theme='light'][data-accent='${accent}']` : `[data-accent='${accent}']`),
  }
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const linear = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

function contrast(a, b) {
  expect(a, `${a} is an opaque #RRGGBB colour`).toMatch(/^#[0-9A-Fa-f]{6}$/)
  expect(b, `${b} is an opaque #RRGGBB colour`).toMatch(/^#[0-9A-Fa-f]{6}$/)
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const PAIRS = ['dark', 'light'].flatMap((theme) => ACCENTS.map((accent) => [theme, accent]))

describe('contrast (WCAG AA) for every theme × accent', () => {
  it.each(PAIRS)('%s × %s', (theme, accent) => {
    const t = tokens(theme, accent)
    const grounds = { background: t['--color-background'], surface: t['--color-surface'] }
    for (const [ground, colour] of Object.entries(grounds)) {
      // Text, muted text, and the semantic colours used as text (feedback, error lines): 4.5:1.
      for (const name of ['--color-text', '--color-text-muted', '--color-correct', '--color-mistake', '--color-error']) {
        expect(contrast(t[name], colour), `${name} on ${ground}`).toBeGreaterThanOrEqual(4.5)
      }
      // Controls, and the primary colour as the focus ring and Ready dot: 3:1.
      expect(contrast(t['--color-border-control'], colour), `border-control on ${ground}`).toBeGreaterThanOrEqual(3)
      expect(contrast(t['--color-primary'], colour), `primary on ${ground}`).toBeGreaterThanOrEqual(3)
    }
    expect(contrast(t['--color-on-primary'], t['--color-primary']), 'on-primary on primary').toBeGreaterThanOrEqual(4.5)
    // Danger buttons put on-primary on the error colour.
    expect(contrast(t['--color-on-primary'], t['--color-error']), 'on-primary on error').toBeGreaterThanOrEqual(4.5)
  })

  it('the light theme sets color-scheme: light, and the dark default color-scheme: dark', () => {
    expect(tokensCss).toMatch(/:root\s*\{\s*color-scheme:\s*dark;/)
    expect(tokensCss).toMatch(/:root\[data-theme='light'\]\s*\{\s*color-scheme:\s*light;/)
  })
})

/** A stand-in for matchMedia('(prefers-color-scheme: light)') whose answer the test changes. */
function stubSystem(light) {
  const listeners = new Set()
  const state = { light }
  const query = {
    get matches() {
      return state.light
    },
    addEventListener: (_, listener) => listeners.add(listener),
    removeEventListener: (_, listener) => listeners.delete(listener),
  }
  window.matchMedia = vi.fn(() => query)
  return {
    set(next) {
      state.light = next
      listeners.forEach((listener) => listener({ matches: next }))
    },
  }
}

const html = () => document.documentElement

describe('the theme module', () => {
  const original = window.matchMedia

  beforeEach(() => applyTheme({ theme: 'dark' })) // detach any system listener of an earlier test
  afterEach(() => {
    window.matchMedia = original
  })

  it('an Account with nothing saved is dark and indigo', () => {
    expect(accountChoice({})).toEqual({ theme: 'dark', accent: 'indigo' })
    expect(accountChoice(undefined)).toEqual({ theme: 'dark', accent: 'indigo' })
    expect(accountChoice({ theme: 'pink', accent: 'green' })).toEqual({ theme: 'dark', accent: 'indigo' })
    expect(accountChoice({ theme: 'light', accent: 'violet' })).toEqual({ theme: 'light', accent: 'violet' })
  })

  it('"system" resolves through prefers-color-scheme and follows it live', () => {
    const system = stubSystem(true)
    applyTheme({ theme: 'system', accent: 'cyan' })
    expect(html().dataset.theme).toBe('light')
    expect(html().dataset.accent).toBe('cyan')

    system.set(false)
    expect(html().dataset.theme).toBe('dark')

    // A fixed choice stops following.
    applyTheme({ theme: 'light', accent: 'cyan' })
    system.set(false)
    expect(html().dataset.theme).toBe('light')
  })

  it('without matchMedia, "system" is dark', () => {
    window.matchMedia = undefined
    applyTheme({ theme: 'system' })
    expect(html().dataset.theme).toBe('dark')
    expect(html().dataset.accent).toBe('indigo')
  })

  it('a signed-in page paints the cached choice; signed-out pages follow the system with indigo', () => {
    stubSystem(true)
    applyAccountTheme({ theme: 'dark', accent: 'violet' })
    expect(cachedTheme()).toEqual({ theme: 'dark', accent: 'violet' })

    applyInitialTheme('/projects/bio')
    expect(html().dataset).toMatchObject({ theme: 'dark', accent: 'violet' })

    for (const path of ['/', '/signup', '/reset-password', '/u/tok-1']) {
      applyInitialTheme(path)
      expect(html().dataset).toMatchObject({ theme: 'light', accent: 'indigo' })
    }
  })

  it('with nothing cached, a signed-in page starts dark and indigo', () => {
    stubSystem(true)
    applyInitialTheme('/projects')
    expect(html().dataset).toMatchObject({ theme: 'dark', accent: 'indigo' })
  })

  it('signing out forgets the cached choice', () => {
    stubSystem(false)
    applyAccountTheme({ theme: 'light', accent: 'blue' })
    applySignedOutTheme({ forget: true })
    expect(cachedTheme()).toBeNull()
    expect(html().dataset).toMatchObject({ theme: 'dark', accent: 'indigo' })
  })

  it('a corrupt cache is ignored', () => {
    window.localStorage.setItem('studybuddy.theme', '{not json')
    expect(cachedTheme()).toBeNull()
  })
})
