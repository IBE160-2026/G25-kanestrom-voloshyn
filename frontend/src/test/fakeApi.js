// An in-memory stand-in for the backend's profile and Projects routes (Story 2.1), installed on the
// mocked apiFetch. The test file must mock '../api/client.js' (test/mocks.js clientMock) first.
import { vi } from 'vitest'
import { apiFetch } from '../api/client.js'

export const PROFILE = { first_name: 'Emma', language: 'en', email_verified: false, ui_prefs: {}, last_project_id: null }

export function project(id, overrides = {}) {
  return {
    id,
    name: null,
    name_source: null,
    archived_at: null,
    deleted_at: null,
    created_at: '2026-11-16T10:00:00Z',
    ...overrides,
  }
}

const notFound = () => ({ code: 'not_found', params: {} })

/**
 * Install the fake. `projects` is newest first, as the server sends it. `routes` overrides a
 * handler by "METHOD /path" (for example 'POST /api/projects'). Returns the live state.
 */
export function fakeApi({ me = PROFILE, projects = [], routes = {} } = {}) {
  const state = { me: { ...me }, projects: projects.map((p) => ({ ...p })), created: 0 }

  vi.mocked(apiFetch).mockImplementation(async (path, { method = 'GET', body } = {}) => {
    const override = routes[`${method} ${path}`]
    if (override) return override(body, state)

    if (path === '/api/me' && method === 'GET') {
      // Like the server: last_project_id only while that Project is active.
      const last = state.projects.find((p) => p.id === state.me.last_project_id)
      const active = last && !last.archived_at && !last.deleted_at
      return { ...state.me, last_project_id: active ? last.id : null }
    }
    if (path === '/api/me' && method === 'PATCH') return Object.assign(state.me, body)
    if (path === '/api/me/prefs' && method === 'PATCH') {
      state.me = { ...state.me, ui_prefs: { ...state.me.ui_prefs, ...body } }
      return state.me
    }
    if (path === '/api/projects' && method === 'GET') return state.projects
    if (path === '/api/projects' && method === 'POST') {
      state.created += 1
      const created = project(`new-${state.created}`)
      state.projects.unshift(created)
      return created
    }

    const match = path.match(/^\/api\/projects\/([^/]+)$/)
    if (match) {
      const found = state.projects.find((p) => p.id === match[1])
      if (!found) throw notFound()
      if (method === 'GET') {
        state.me = { ...state.me, last_project_id: found.id }
        return found
      }
      if (method === 'PATCH') {
        const name = String(body?.name ?? '').trim()
        if (!name) throw { code: 'invalid_name', params: {} }
        Object.assign(found, { name: name.slice(0, 100), name_source: 'student' })
        return { ...found }
      }
    }
    throw new Error(`unexpected ${method} ${path}`)
  })
  return state
}

/** The calls the SPA made with `method` to `path`. */
export function callsTo(path, method = 'GET') {
  return vi
    .mocked(apiFetch)
    .mock.calls.filter(([p, options = {}]) => p === path && (options.method ?? 'GET') === method)
}
