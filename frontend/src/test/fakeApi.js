// An in-memory stand-in for the backend's profile, Projects (Story 2.1), Materials, and jobs (Story
// 2.2) routes, installed on the mocked apiFetch. The test file must mock '../api/client.js'
// (test/mocks.js clientMock) first.
import { vi } from 'vitest'
import { apiFetch } from '../api/client.js'

// The Privacy notice is accepted by default, so upload tests start from an Account that may upload;
// Story 2.3's tests set `privacy_notice_accepted: false`.
export const PROFILE = {
  first_name: 'Emma',
  language: 'en',
  email_verified: false,
  ui_prefs: {},
  last_project_id: null,
  privacy_notice_accepted: true,
}

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

export function material(id, overrides = {}) {
  return {
    id,
    file_name: `${id}.pdf`,
    file_type: 'pdf',
    size_bytes: 1000,
    status: 'ready',
    reject_reason: null,
    warning: false,
    warning_pages: [],
    created_at: '2026-11-17T10:00:00Z',
    ...overrides,
  }
}

const notFound = () => ({ code: 'not_found', params: {} })
const TYPES = { pdf: 'pdf', docx: 'docx', pptx: 'pptx', txt: 'txt', md: 'md' }

/**
 * Install the fake. `projects` is newest first, as the server sends it. `materials` maps a Project
 * id to its files; `jobs` lists jobs ({id, project_id, kind, status}). An upload adds a processing
 * file and a running job. `routes` overrides a handler by "METHOD /path" (for example
 * 'POST /api/projects'). Returns the live state.
 */
export function fakeApi({ me = PROFILE, projects = [], materials = {}, jobs = [], routes = {} } = {}) {
  const state = {
    me: { ...me },
    projects: projects.map((p) => ({ ...p })),
    materials: Object.fromEntries(Object.entries(materials).map(([id, list]) => [id, list.map((m) => ({ ...m }))])),
    jobs: jobs.map((j) => ({ ...j })),
    created: 0,
    uploaded: 0,
    removed: [], // ids of removed files (Story 2.7)
    autoNames: {}, // { [projectId]: name } the next GET /api/projects/{id} returns (Story 2.4b)
  }

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
      // As the server: files_collapsed merges per Project (Story 2.2b).
      const prefs = { ...state.me.ui_prefs, ...body }
      if (body.files_collapsed) prefs.files_collapsed = { ...state.me.ui_prefs?.files_collapsed, ...body.files_collapsed }
      state.me = { ...state.me, ui_prefs: prefs }
      return state.me
    }
    if (path === '/api/me/privacy-notice' && method === 'POST') {
      state.me = { ...state.me, privacy_notice_accepted: true }
      return state.me
    }
    if (path === '/api/projects' && method === 'GET') return state.projects
    if (path === '/api/projects' && method === 'POST') {
      state.created += 1
      const created = project(`new-${state.created}`)
      state.projects.unshift(created)
      return created
    }

    const files = path.match(/^\/api\/projects\/([^/]+)\/(materials|jobs)$/)
    if (files) {
      const [, id, what] = files
      if (!state.projects.some((p) => p.id === id)) throw notFound()
      if (what === 'jobs' && method === 'GET') {
        return state.jobs.filter((j) => j.project_id === id && (['queued', 'running'].includes(j.status) || !j.seen))
      }
      if (what === 'materials' && method === 'GET') return (state.materials[id] ?? []).map((m) => ({ ...m }))
      if (what === 'materials' && method === 'POST') {
        const file = body.get('file')
        state.uploaded += 1
        const ext = String(file.name).split('.').pop().toLowerCase()
        const created = material(`m-${state.uploaded}`, { file_name: file.name, file_type: TYPES[ext] ?? ext, status: 'processing' })
        state.materials[id] = [...(state.materials[id] ?? []), created]
        const job = { id: `j-${state.uploaded}`, project_id: id, kind: 'material_processing', status: 'running', result_ref: created.id }
        state.jobs.push(job)
        return { material: { ...created }, job_id: job.id }
      }
    }
    // Remove a file (Story 2.7): like the server, 204 also when already removed; the job is cancelled.
    const one = path.match(/^\/api\/projects\/([^/]+)\/materials\/([^/]+)$/)
    if (one && method === 'DELETE') {
      const [, id, materialId] = one
      const owner = state.projects.find((p) => p.id === id)
      if (!owner) throw notFound()
      if (owner.archived_at || owner.deleted_at) throw { code: 'project_read_only', params: {} }
      if (state.removed.includes(materialId)) return null
      const list = state.materials[id] ?? []
      if (!list.some((m) => m.id === materialId)) throw notFound()
      state.materials[id] = list.filter((m) => m.id !== materialId)
      state.removed.push(materialId)
      for (const job of state.jobs) {
        if (job.result_ref === materialId && ['queued', 'running'].includes(job.status)) job.status = 'cancelled'
      }
      return null
    }
    const seen = path.match(/^\/api\/jobs\/([^/]+)\/seen$/)
    if (seen && method === 'POST') {
      const job = state.jobs.find((j) => j.id === seen[1])
      if (!job) throw notFound()
      job.seen = true
      return null
    }

    const match = path.match(/^\/api\/projects\/([^/]+)$/)
    if (match) {
      const found = state.projects.find((p) => p.id === match[1])
      if (!found) throw notFound()
      if (method === 'GET') {
        state.me = { ...state.me, last_project_id: found.id }
        // An auto-name set by finish() lands now, as the server's naming trails the Ready commit.
        const autoName = state.autoNames[found.id]
        if (autoName !== undefined && !found.name_source) {
          delete state.autoNames[found.id]
          Object.assign(found, { name: autoName, name_source: 'auto' })
        }
        return { ...found }
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

/**
 * Finish a file's processing in the fake: the Material gets `changes`, its job completes. With
 * `projectName`, the server auto-names the Project: the next GET /api/projects/{id} returns that name
 * (unless the Project is named by then).
 */
export function finish(state, materialId, changes = { status: 'ready' }, { projectName } = {}) {
  for (const [projectId, list] of Object.entries(state.materials)) {
    const found = list.find((m) => m.id === materialId)
    if (found) Object.assign(found, changes)
    if (found && projectName !== undefined) state.autoNames[projectId] = projectName
  }
  const job = state.jobs.find((j) => j.result_ref === materialId)
  if (job) job.status = 'completed'
}
