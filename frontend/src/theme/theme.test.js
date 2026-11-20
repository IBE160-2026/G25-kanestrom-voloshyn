// Theme options: the contrast rules hold for every theme × accent in tokens.css (WCAG AA), and the
// theme module applies, caches, and falls back to the Default theme and accent.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  ACCENTS,
  THEMES,
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

/**
 * The colour tokens on <html> for a theme and accent, in the cascade order of tokens.css, with each
 * var(--…) resolved. The "default" accent is the theme's own (--color-theme-*); Blue / Violet / Cyan
 * have a Light block and one shared by the Default and Dark themes.
 */
function tokens(theme, accent) {
  const own = accent === 'default' || theme !== 'light'
  const merged = {
    ...block(':root'),
    ...(theme === 'default' ? {} : block(`:root[data-theme='${theme}']`)),
    ...block(own ? `[data-accent='${accent}']` : `:root[data-theme='light'][data-accent='${accent}']`),
  }
  const resolve = (value, depth = 0) =>
    depth > 5 ? value : value.replace(/var\((--[\w-]+)\)/g, (_, name) => resolve(merged[name] ?? '', depth + 1))
  return Object.fromEntries(Object.entries(merged).map(([name, value]) => [name, resolve(value)]))
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

const PAIRS = THEMES.flatMap((theme) => ACCENTS.map((accent) => [theme, accent]))

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

  it('in Light, the Sidebar and panels (surface) stand apart from the background: at least 1.15:1', () => {
    const t = tokens('light', 'default')
    expect(contrast(t['--color-surface'], t['--color-background'])).toBeGreaterThanOrEqual(1.15)
  })

  it('each theme has its own default accent', () => {
    const own = THEMES.map((theme) => tokens(theme, 'default')['--color-primary'])
    expect(new Set(own).size).toBe(THEMES.length)
    expect(own[0]).toBe('#6C7CFF') // the Default theme keeps today's accent
  })

  it('Dark is darker than Default: a darker background and surface', () => {
    const base = tokens('default', 'default')
    const dark = tokens('dark', 'default')
    expect(luminance(dark['--color-background'])).toBeLessThan(luminance(base['--color-background']))
    expect(luminance(dark['--color-surface'])).toBeLessThan(luminance(base['--color-surface']))
  })

  it('Light sets color-scheme: light; Default and Dark color-scheme: dark', () => {
    expect(tokensCss).toMatch(/:root\s*\{\s*color-scheme:\s*dark;/)
    expect(tokensCss).toMatch(/:root\[data-theme='dark'\]\s*\{\s*color-scheme:\s*dark;/)
    expect(tokensCss).toMatch(/:root\[data-theme='light'\]\s*\{\s*color-scheme:\s*light;/)
  })
})

const html = () => document.documentElement

describe('the theme module', () => {
  beforeEach(() => applyTheme({}))

  it('an Account with nothing saved, or an unknown value such as an old "system" or "indigo", gets both defaults', () => {
    expect(accountChoice({})).toEqual({ theme: 'default', accent: 'default' })
    expect(accountChoice(undefined)).toEqual({ theme: 'default', accent: 'default' })
    expect(accountChoice({ theme: 'system', accent: 'indigo' })).toEqual({ theme: 'default', accent: 'default' })
    expect(accountChoice({ theme: 'system', accent: 'green' })).toEqual({ theme: 'default', accent: 'default' })
    expect(accountChoice({ theme: 'light', accent: 'violet' })).toEqual({ theme: 'light', accent: 'violet' })
  })

  it('applies the theme and accent on <html>', () => {
    applyTheme({ theme: 'dark', accent: 'cyan' })
    expect(html().dataset).toMatchObject({ theme: 'dark', accent: 'cyan' })
    applyTheme({ theme: 'system' })
    expect(html().dataset).toMatchObject({ theme: 'default', accent: 'default' })
  })

  it('a signed-in page paints the cached choice; signed-out pages use both defaults', () => {
    applyAccountTheme({ theme: 'dark', accent: 'violet' })
    expect(cachedTheme()).toEqual({ theme: 'dark', accent: 'violet' })

    applyInitialTheme('/projects/bio')
    expect(html().dataset).toMatchObject({ theme: 'dark', accent: 'violet' })

    for (const path of ['/', '/signup', '/reset-password', '/u/tok-1']) {
      applyInitialTheme(path)
      expect(html().dataset).toMatchObject({ theme: 'default', accent: 'default' })
    }
  })

  it('with nothing cached, a signed-in page starts on both defaults', () => {
    applyInitialTheme('/projects')
    expect(html().dataset).toMatchObject({ theme: 'default', accent: 'default' })
  })

  it('signing out forgets the cached choice', () => {
    applyAccountTheme({ theme: 'light', accent: 'blue' })
    applySignedOutTheme({ forget: true })
    expect(cachedTheme()).toBeNull()
    expect(html().dataset).toMatchObject({ theme: 'default', accent: 'default' })
  })

  it('a corrupt cache is ignored', () => {
    window.localStorage.setItem('studybuddy.theme', '{not json')
    expect(cachedTheme()).toBeNull()
  })
})
