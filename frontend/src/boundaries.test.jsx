// @vitest-environment node
// Source boundaries (AD-1, spine › Tests): only src/auth/ imports supabase-js, and only
// src/api/client.js calls fetch. Test files and src/test/ are excluded; they stub both.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('.', import.meta.url))

function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'test' ? [] : sources(path)
    if (!/\.(js|jsx)$/.test(entry.name) || /\.test\.(js|jsx)$/.test(entry.name)) return []
    return [relative(SRC, path).split(sep).join('/')]
  })
}

function filesMatching(pattern) {
  return sources(SRC).filter((file) => pattern.test(readFileSync(join(SRC, file), 'utf8')))
}

describe('source boundaries', () => {
  it('scans the source tree', () => {
    expect(sources(SRC)).toEqual(expect.arrayContaining(['api/client.js', 'auth/index.js', 'App.jsx']))
  })

  it('only src/auth/ imports @supabase/supabase-js', () => {
    const offenders = filesMatching(/['"]@supabase\/supabase-js['"]/).filter((file) => !file.startsWith('auth/'))
    expect(offenders).toEqual([])
  })

  it('only src/api/client.js calls fetch(', () => {
    expect(filesMatching(/\bfetch\(/)).toEqual(['api/client.js'])
  })
})
