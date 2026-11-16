// The return route after the next login (Story 1.4): one sessionStorage key, read once.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RETURN_TO_KEY, forgetRoute, rememberRoute, takeRememberedRoute } from './returnTo.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('return route', () => {
  it('is remembered and read once', () => {
    rememberRoute('/projects?x=1')
    expect(window.sessionStorage.getItem(RETURN_TO_KEY)).toBe('/projects?x=1')
    expect(takeRememberedRoute()).toBe('/projects?x=1')
    expect(takeRememberedRoute()).toBeNull()
  })

  it.each(['//evil.example', '/\\evil.example', 'https://evil.example', 'projects', ''])(
    'never remembers or returns %s',
    (path) => {
      rememberRoute(path)
      expect(window.sessionStorage.getItem(RETURN_TO_KEY)).toBeNull()
      window.sessionStorage.setItem(RETURN_TO_KEY, path)
      expect(takeRememberedRoute()).toBeNull()
      expect(window.sessionStorage.getItem(RETURN_TO_KEY)).toBeNull()
    },
  )

  it('does not remember Login itself', () => {
    rememberRoute('/')
    expect(window.sessionStorage.getItem(RETURN_TO_KEY)).toBeNull()
  })

  it('forgetRoute clears it', () => {
    rememberRoute('/projects')
    forgetRoute()
    expect(takeRememberedRoute()).toBeNull()
  })

  it('blocked storage only loses the route', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(() => rememberRoute('/projects')).not.toThrow()
    expect(takeRememberedRoute()).toBeNull()
  })
})
