// An in-memory stand-in for the backend's profile, Projects (Story 2.1), Materials, and jobs (Story
// 2.2) routes, Quiz setup and generation (Story 3.1a), taking a Quiz (Story 3.2), and Mistakes (Story
// 3.3), installed on the
// mocked apiFetch. The test file must mock '../api/client.js'
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
    topics: [],
    ...overrides,
  }
}

const notFound = () => ({ code: 'not_found', params: {} })
const TYPES = { pdf: 'pdf', docx: 'docx', pptx: 'pptx', txt: 'txt', md: 'md', jpg: 'jpg', jpeg: 'jpg', png: 'png', heic: 'heic' }
const IMAGE_TYPES = new Set(['jpg', 'png', 'heic'])
export const IMAGE_LIMIT = 25

/**
 * Install the fake. `projects` is newest first, as the server sends it. `materials` maps a Project
 * id to its files; `jobs` lists jobs ({id, project_id, kind, status}). An upload adds a processing
 * file and a running job. `imagesLeft` is today's image limit left (Story 2.5): an image upload uses
 * one, and at 0 it is refused with `quota_exceeded`. `routes` overrides a handler by "METHOD /path"
 * (for example 'POST /api/projects'). `capacity` is what GET .../capacity answers as `max_questions`: a
 * number, or a function of the scope (Story 3.1a). A quiz request adds a running `quiz` job at the
 * `reading` step, with its frozen `topic_labels`; `stepJob`, `finishQuiz`, and `failJob` move it on. The
 * jobs list leaves out finished jobs marked seen, like the server (Story 3.1b). `quizzes` lists stored Quizzes
 * (see `quiz`); an answer is scored and saved once, like the server (Story 3.2), and a newly saved wrong
 * answer adds an outstanding Mistake (Story 3.3). `mistakes` lists outstanding Mistakes ({project_id,
 * material_ids}, see `mistake`); GET .../mistakes/summary counts them, and a removal with
 * `?withdraw_mistakes=true` withdraws the file's. Returns the live state.
 */
export function fakeApi({
  me = PROFILE,
  projects = [],
  materials = {},
  jobs = [],
  routes = {},
  imagesLeft = IMAGE_LIMIT,
  capacity = 20,
  quizzes = [],
  mistakes = [],
} = {}) {
  const state = {
    me: { ...me },
    projects: projects.map((p) => ({ ...p })),
    materials: Object.fromEntries(Object.entries(materials).map(([id, list]) => [id, list.map((m) => ({ ...m }))])),
    jobs: jobs.map((j) => ({ ...j })),
    created: 0,
    uploaded: 0,
    removed: [], // ids of removed files (Story 2.7)
    topicEdits: 0, // Topic edits answered or refused (Story 2.6b)
    autoNames: {}, // { [projectId]: name } the next GET /api/projects/{id} returns (Story 2.4b)
    imagesLeft, // today's image limit left (Story 2.5)
    capacity, // max_questions, or a function of the scope (Story 3.1a)
    quizRequests: [], // bodies of POST .../quizzes
    quizzes: Object.fromEntries(quizzes.map((q) => [q.id, structuredClone(q)])), // { [quizId]: quiz(...) }
    answers: [], // bodies of POST .../answer, with their question id
    cancelled: [], // job ids a cancel was sent for
    mistakes: mistakes.map((m) => ({ withdrawn: false, ...m })), // Story 3.3
    removeQueries: [], // query strings of DELETE .../materials/{id} (Story 3.3), '' for none
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
    if (path === '/api/usage' && method === 'GET') return { images_left_today: state.imagesLeft }
    if (path === '/api/projects' && method === 'GET') return state.projects
    if (path === '/api/projects' && method === 'POST') {
      state.created += 1
      const created = project(`new-${state.created}`)
      state.projects.unshift(created)
      return created
    }

    // Quiz setup and generation (Story 3.1a).
    const capacityCall = path.match(/^\/api\/projects\/([^/]+)\/capacity\?scope=(.*)$/)
    if (capacityCall && method === 'GET') {
      if (!state.projects.some((p) => p.id === capacityCall[1])) throw notFound()
      const scope = JSON.parse(decodeURIComponent(capacityCall[2]))
      const max = typeof state.capacity === 'function' ? state.capacity(scope) : state.capacity
      return { max_questions: max }
    }
    // Taking a Quiz (Story 3.2): like the server, scored here, saved once, the key hidden until answered.
    const answerCall = path.match(/^\/api\/projects\/([^/]+)\/quizzes\/([^/]+)\/questions\/([^/]+)\/answer$/)
    if (answerCall && method === 'POST') {
      const [, id, quizId, questionId] = answerCall
      const owner = state.projects.find((p) => p.id === id)
      if (!owner) throw notFound()
      if (owner.archived_at || owner.deleted_at) throw rule('project_read_only')
      if (!['a', 'b', 'c', 'd'].includes(body?.option_id)) throw rule('invalid_request', { fields: ['option_id'] })
      const question = state.quizzes[quizId]?.project_id === id && state.quizzes[quizId].questions.find((q) => q.id === questionId)
      if (!question) throw notFound()
      state.answers.push({ question_id: questionId, ...body })
      if (!question.answered) {
        question.answered = { submitted_option_id: body.option_id, is_correct: body.option_id === question.correct_option_id }
        // Like the server: a newly saved wrong answer becomes an outstanding Mistake (Story 3.3).
        if (!question.answered.is_correct) {
          state.mistakes.push({ project_id: id, quiz_question_id: questionId, material_ids: [...question.material_ids], withdrawn: false })
        }
      }
      return shownQuestion(question)
    }
    const quizCall = path.match(/^\/api\/projects\/([^/]+)\/quizzes(?:\/([^/]+))?$/)
    if (quizCall) {
      const [, id, quizId] = quizCall
      const owner = state.projects.find((p) => p.id === id)
      if (!owner) throw notFound()
      if (quizId && method === 'GET') {
        const found = state.quizzes[quizId]
        if (!found || found.project_id !== id) throw notFound()
        return {
          id: found.id,
          requested_count: found.requested_count,
          question_count: found.questions.length,
          questions: found.questions.map(shownQuestion),
        }
      }
      if (!quizId && method === 'POST') {
        if (owner.archived_at || owner.deleted_at) throw rule('project_read_only')
        if (!(state.materials[id] ?? []).some((m) => m.status === 'ready')) throw rule('insufficient_material')
        state.quizRequests.push(body)
        // Like the server: the frozen count is the asked one cut to the scope's capacity.
        const max = typeof state.capacity === 'function' ? state.capacity(body.scope) : state.capacity
        const job = {
          id: `q-${state.quizRequests.length}`,
          project_id: id,
          kind: 'quiz',
          status: 'running',
          progress_step: 'reading',
          result_ref: null,
          error_code: null,
          count: Math.min(body.count, max),
          // Like the server: the chosen Topics' labels, frozen in order; none for "All topics" (Story 3.1b).
          topic_labels: (body.scope?.topic_ids ?? []).map(
            (topicId) => (state.materials[id] ?? []).flatMap((m) => m.topics ?? []).find((t) => t.id === topicId)?.label,
          ).filter((label) => label !== undefined),
        }
        state.jobs.push(job)
        return { job_id: job.id }
      }
    }
    // Mistakes summary (Story 3.3): a read, so a read-only Project answers too.
    const summaryCall = path.match(/^\/api\/projects\/([^/]+)\/mistakes\/summary$/)
    if (summaryCall && method === 'GET') {
      const id = summaryCall[1]
      if (!state.projects.some((p) => p.id === id)) throw notFound()
      const outstanding = state.mistakes.filter((m) => m.project_id === id && !m.withdrawn)
      const byMaterial = {}
      for (const m of outstanding) for (const mid of m.material_ids) byMaterial[mid] = (byMaterial[mid] ?? 0) + 1
      return { outstanding: outstanding.length, by_material: byMaterial }
    }
    const cancelCall = path.match(/^\/api\/jobs\/([^/]+)\/cancel$/)
    if (cancelCall && method === 'POST') {
      const job = state.jobs.find((j) => j.id === cancelCall[1])
      if (!job) throw notFound()
      state.cancelled.push(job.id)
      if (['queued', 'running'].includes(job.status)) Object.assign(job, { status: 'cancelled', progress_step: null })
      return null
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
        const ext = String(file.name).split('.').pop().toLowerCase()
        // Like the server: an image over today's limit is refused, with nothing added.
        if (IMAGE_TYPES.has(TYPES[ext])) {
          if (state.imagesLeft <= 0) throw { code: 'quota_exceeded', params: { limit: IMAGE_LIMIT } }
          state.imagesLeft -= 1
        }
        state.uploaded += 1
        const created = material(`m-${state.uploaded}`, { file_name: file.name, file_type: TYPES[ext] ?? ext, status: 'processing' })
        state.materials[id] = [...(state.materials[id] ?? []), created]
        const job = { id: `j-${state.uploaded}`, project_id: id, kind: 'material_processing', status: 'running', result_ref: created.id }
        state.jobs.push(job)
        return { material: { ...created }, job_id: job.id }
      }
    }
    // Topic edits (Story 2.6b): like the server, each answers the file's whole Topic list, with the same
    // rule refusals.
    const topicEdit =
      path.match(/^\/api\/projects\/([^/]+)\/topics\/(merge)$/) ??
      path.match(/^\/api\/projects\/([^/]+)\/topics\/([^/]+)$/) ??
      path.match(/^\/api\/projects\/([^/]+)\/materials\/([^/]+)\/(topics)$/)
    if (topicEdit) return editTopics(state, method, path, body, topicEdit)
    // Remove a file (Story 2.7): like the server, 204 also when already removed; the job is cancelled.
    // With `?withdraw_mistakes=true`, the file's outstanding Mistakes are withdrawn (Story 3.3).
    const one = path.match(/^\/api\/projects\/([^/]+)\/materials\/([^/?]+)(?:\?(.*))?$/)
    if (one && method === 'DELETE') {
      const [, id, materialId, query = ''] = one
      state.removeQueries.push(query)
      const owner = state.projects.find((p) => p.id === id)
      if (!owner) throw notFound()
      if (owner.archived_at || owner.deleted_at) throw { code: 'project_read_only', params: {} }
      if (state.removed.includes(materialId)) return null
      const list = state.materials[id] ?? []
      if (!list.some((m) => m.id === materialId)) throw notFound()
      state.materials[id] = list.filter((m) => m.id !== materialId)
      state.removed.push(materialId)
      if (query === 'withdraw_mistakes=true') {
        for (const m of state.mistakes) if (m.project_id === id && m.material_ids.includes(materialId)) m.withdrawn = true
      }
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

const rule = (code, params = {}) => ({ code, params })

/** A stored Question as the server shows it: the key, explanation, and sources only once answered. */
function shownQuestion(q) {
  return {
    id: q.id,
    position: q.position,
    question: q.question,
    options: q.options.map((o) => ({ ...o })),
    answer: q.answered
      ? {
          ...q.answered,
          correct_option_id: q.correct_option_id,
          explanation: q.explanation,
          sources: q.sources.map((label) => ({ label })),
        }
      : null,
  }
}

/**
 * A stored Quiz of `n` Questions in Project `projectId`: Question i reads "Question {i}?" with options
 * "Option {i}A".."Option {i}D", explanation "Because {i}.", source "notes.pdf · Page {i}" (1-based).
 * `correct` is each Question's correct option id. `answered` maps a 0-based index to the submitted
 * option id. `requested` is the frozen count (default `n`). Each Question cites `materialId`.
 */
export function quiz(id, projectId, { n = 3, requested = n, correct = 'b', answered = {}, materialId = 'notes' } = {}) {
  return {
    id,
    project_id: projectId,
    requested_count: requested,
    questions: Array.from({ length: n }, (_, i) => ({
      id: `${id}-q${i + 1}`,
      position: i,
      question: `Question ${i + 1}?`,
      options: ['a', 'b', 'c', 'd'].map((o) => ({ id: o, text: `Option ${i + 1}${o.toUpperCase()}` })),
      correct_option_id: correct,
      explanation: `Because ${i + 1}.`,
      sources: [`notes.pdf · Page ${i + 1}`],
      material_ids: [materialId],
      answered:
        answered[i] === undefined ? null : { submitted_option_id: answered[i], is_correct: answered[i] === correct },
    })),
  }
}

function editTopics(state, method, path, body, [, projectId, second, third]) {
  const owner = state.projects.find((p) => p.id === projectId)
  if (!owner) throw notFound()
  if (owner.archived_at || owner.deleted_at) throw rule('project_read_only')
  const files = (state.materials[projectId] ?? []).filter((m) => m.status === 'ready')
  const fileOf = (topicId) => files.find((m) => (m.topics ?? []).some((t) => t.id === topicId))
  const answer = (file) => ({ material_id: file.id, topics: file.topics.map((t) => ({ ...t })) })
  const cleanLabel = () => {
    const label = String(body?.label ?? '').trim()
    if (!label || label.length > 100) throw rule('invalid_name')
    return label
  }
  state.topicEdits += 1

  if (third === 'topics' && method === 'POST') {
    const file = files.find((m) => m.id === second)
    if (!file) throw notFound()
    const label = cleanLabel()
    if (file.topics.length >= 100) throw rule('topic_limit_reached', { max: 100 })
    const position = Math.max(-1, ...file.topics.map((t) => t.position)) + 1
    file.topics = [...file.topics, { id: `t-new-${state.topicEdits}`, label, group_label: null, position }]
    return answer(file)
  }
  if (second === 'merge' && method === 'POST') {
    const ids = [...new Set(body?.topic_ids ?? [])]
    if (ids.length < 2) throw rule('invalid_request', { fields: ['topic_ids'] })
    const owners = ids.map(fileOf)
    if (owners.some((file) => !file)) throw notFound()
    if (new Set(owners).size > 1) throw rule('topic_merge_cross_material')
    const file = owners[0]
    const chosen = file.topics.filter((t) => ids.includes(t.id))
    const survivor = chosen.reduce((low, t) => (t.position < low.position ? t : low))
    file.topics = file.topics.filter((t) => t === survivor || !ids.includes(t.id))
    return answer(file)
  }
  const file = fileOf(second)
  if (!file) throw notFound()
  if (method === 'PATCH') {
    const label = cleanLabel()
    file.topics = file.topics.map((t) => (t.id === second ? { ...t, label } : t))
    return answer(file)
  }
  if (method === 'DELETE') {
    if (file.topics.length <= 1) throw rule('topic_last_cannot_delete')
    file.topics = file.topics.filter((t) => t.id !== second)
    return answer(file)
  }
  throw new Error(`unexpected ${method} ${path}`)
}

/** `n` Topics as the server lists them; with `groupSize`, grouped under "Part 1", "Part 2", ... */
export function topics(n, { groupSize = null, prefix = 'Topic' } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: `t-${i + 1}`,
    label: `${prefix} ${i + 1}`,
    group_label: groupSize ? `Part ${Math.floor(i / groupSize) + 1}` : null,
    position: i,
  }))
}

/** An outstanding Mistake of Project `projectId` citing `materialIds` (Story 3.3). */
export function mistake(projectId, materialIds = ['notes']) {
  return { project_id: projectId, quiz_question_id: null, material_ids: [...materialIds], withdrawn: false }
}

/** The calls the SPA made with `method` to `path`. */
export function callsTo(path, method = 'GET') {
  return vi
    .mocked(apiFetch)
    .mock.calls.filter(([p, options = {}]) => p === path && (options.method ?? 'GET') === method)
}

/**
 * Finish a file's processing in the fake: the Material gets `changes` (for example `{ status: 'ready',
 * topics: topics(3) }`), its job completes. With
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

/** Move a running quiz job to `step` ('reading', 'writing', or 'checking'). */
export function stepJob(state, jobId, step) {
  const job = state.jobs.find((j) => j.id === jobId)
  Object.assign(job, { progress_step: step })
}

/** Complete a quiz job with a saved Quiz of `questionCount` questions (its `requested_count` is the job's
 * frozen count). Returns the Quiz id. */
export function finishQuiz(state, jobId, questionCount) {
  const job = state.jobs.find((j) => j.id === jobId)
  const quizId = `quiz-${jobId}`
  state.quizzes[quizId] = quiz(quizId, job.project_id, { n: questionCount, requested: job.count })
  Object.assign(job, { status: 'completed', progress_step: null, result_ref: quizId })
  return quizId
}

/** Fail a quiz job with `code` (for example 'llm_unavailable'). */
export function failJob(state, jobId, code = 'llm_unavailable') {
  const job = state.jobs.find((j) => j.id === jobId)
  Object.assign(job, { status: 'failed', progress_step: null, error_code: code })
}
