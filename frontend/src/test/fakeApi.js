// An in-memory stand-in for the backend's profile, Projects (Story 2.1), Materials, and jobs (Story
// 2.2) routes, Quiz setup and generation (Story 3.1a), taking a Quiz (Story 3.2), Mistakes (Story
// 3.3), Mistake Review rounds (Stories 3.4 + 3.5), and phone upload links, batches, and photos
// (Stories 6.1 + 6.2), installed on the
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
  email: 'emma@example.com',
  sign_in_methods: ['email'],
}

// The current password the fake's POST /api/me/password/check accepts (Story 7.3a).
export const CURRENT_PASSWORD = 'correct-horse-1'

export function project(id, overrides = {}) {
  return {
    id,
    name: null,
    name_source: null,
    archived_at: null,
    deleted_at: null,
    purge_at: null,
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
 * `?withdraw_mistakes=true` withdraws the file's. A review-round request adds a running `review_round`
 * job at the `reading` step (one at a time, like the server); `finishReview` saves its round from the
 * oldest outstanding Mistakes. `rounds` lists stored rounds (see `reviewRound`); a practice answer is
 * scored and saved once, and a correct one clears its Mistake (Stories 3.4 + 3.5). Phone upload
 * (Stories 6.1 + 6.2): a link (`links`, token `tok-n`) lasts `linkTtlMs`; `/api/phone/{token}` routes
 * answer `410 link_expired` once it is revoked or expired. A photo uses one of `imagesLeft` and is
 * refused like the server (`file_too_large`, `quota_exceeded`); finalize adds one `phone_batch` file,
 * Reading…, named "Handwritten notes, {n} pages", or refuses (`insufficient_material`,
 * `material_limit_reached`). Archive (Story 7.1) sets `archived_at` (409 `project_read_only` for a
 * deleted Project) and revokes its links; delete (Story 7.2a) sets `deleted_at` and `purge_at` (30
 * days later), keeps `archived_at`, revokes its links, and cancels its active jobs; restore clears
 * `archived_at`, `deleted_at`, and `purge_at`. All three are idempotent. `appPublicUrl` is GET /api/config's `app_public_url`; with `serverOffsetMs`,
 * answers carry a `Date` header that far ahead of the test's clock. Returns the live
 * state.
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
  rounds = [],
  appPublicUrl = 'http://192.168.1.20:8000',
  serverOffsetMs = null,
  linkTtlMs = 10 * 60 * 1000,
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
    mistakes: mistakes.map((m) => ({ withdrawn: false, cleared: false, ...m })), // Story 3.3
    rounds: Object.fromEntries(rounds.map((r) => [r.id, structuredClone(r)])), // { [roundId]: reviewRound(...) }
    reviewRequests: 0, // POST .../review-rounds calls answered 202
    practiceAnswers: [], // bodies of POST .../items/{id}/answer, with their item id
    removeQueries: [], // query strings of DELETE .../materials/{id} (Story 3.3), '' for none
    links: [], // phone links: { link_id, token, project_id, expires_at, revoked } (Story 6.1)
    batches: [], // phone batches: { id, token, photos: [names], finalized } (Story 6.2)
    photoRequests: [], // names of photos sent, accepted or refused, in order
    passwordChecks: 0, // POST /api/me/password/check calls (Story 7.3a)
    stateChanges: [], // "archive {id}" / "delete {id}" / "restore {id}" / "purge {id}" answered, in order (7.1, 7.2)
  }

  const handle = async (path, { method = 'GET', body } = {}) => {
    const override = routes[`${method} ${path}`]
    if (override) return override(body, state)

    if (path === '/api/me' && method === 'GET') {
      // Like the server: last_project_id only while that Project is active.
      const last = state.projects.find((p) => p.id === state.me.last_project_id)
      const active = last && !last.archived_at && !last.deleted_at
      return { ...state.me, last_project_id: active ? last.id : null }
    }
    if (path === '/api/me' && method === 'PATCH') {
      // Settings (Story 7.3a): a Google-linked Account's name follows Google; the name is trimmed.
      if (body.first_name !== undefined && state.me.sign_in_methods?.includes('google')) throw rule('name_from_google')
      const changes = body.first_name !== undefined ? { ...body, first_name: Array.from(body.first_name.trim()).slice(0, 100).join('') } : body
      return Object.assign(state.me, changes)
    }
    if (path === '/api/me/password/check' && method === 'POST') {
      state.passwordChecks += 1
      if (!state.me.sign_in_methods?.includes('email')) throw rule('no_password')
      if (body.current_password !== CURRENT_PASSWORD) throw rule('wrong_password')
      return null
    }
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
    if (path === '/api/config' && method === 'GET') {
      return { supabase_url: 'http://127.0.0.1:54321', supabase_publishable_key: 'pk', google_enabled: false, app_public_url: appPublicUrl }
    }
    // Phone links (Story 6.1): created for an active Project after the Privacy notice; revoked on close.
    const linkCall = path.match(/^\/api\/projects\/([^/]+)\/phone-links(?:\/([^/]+))?$/)
    if (linkCall) {
      const [, id, linkId] = linkCall
      const owner = state.projects.find((p) => p.id === id)
      if (!owner) throw notFound()
      if (!linkId && method === 'POST') {
        if (owner.archived_at || owner.deleted_at) throw rule('project_read_only')
        if (!state.me.privacy_notice_accepted) throw rule('privacy_notice_required')
        const n = state.links.length + 1
        const link = { link_id: `link-${n}`, token: `tok-${n}`, project_id: id, expires_at: new Date(Date.now() + linkTtlMs).toISOString(), revoked: false }
        state.links.push(link)
        return { link_id: link.link_id, token: link.token, expires_at: link.expires_at }
      }
      if (linkId && method === 'DELETE') {
        const link = state.links.find((l) => l.link_id === linkId && l.project_id === id)
        if (!link) throw notFound()
        link.revoked = true
        return null
      }
    }
    // The phone page (Story 6.2): only the four fields; one photo per request; finalize adds one file.
    const phoneCall = path.match(/^\/api\/phone\/([^/]+)(\/.*)?$/)
    if (phoneCall) {
      const [, token, rest = ''] = phoneCall
      const link = state.links.find((l) => l.token === token)
      const finalizing = /\/finalize$/.test(rest)
      const grace = finalizing ? 10 * 60 * 1000 : 0
      if (!link || link.revoked || Date.now() >= Date.parse(link.expires_at) + grace) throw rule('link_expired')
      const owner = state.projects.find((p) => p.id === link.project_id)
      const files = state.materials[link.project_id] ?? []
      const slots = files.filter((m) => m.status !== 'rejected').length
      if (rest === '' && method === 'GET') {
        return { project_name: owner.name, images_left_today: state.imagesLeft, slot_available: slots < 10, expires_at: link.expires_at }
      }
      if (rest === '/revoke' && method === 'POST') {
        link.revoked = true
        return null
      }
      if (rest === '/batches' && method === 'POST') {
        const batch = { id: `batch-${state.batches.length + 1}`, token, photos: [], finalized: false }
        state.batches.push(batch)
        return { batch_id: batch.id }
      }
      const batchCall = rest.match(/^\/batches\/([^/]+)\/(photos|finalize)$/)
      const batch = batchCall && state.batches.find((b) => b.id === batchCall[1] && b.token === token)
      if (batchCall && !batch) throw notFound()
      if (batchCall && batch.finalized) throw rule('conflict')
      if (batchCall?.[2] === 'photos' && method === 'POST') {
        const photo = body.get('file')
        state.photoRequests.push(photo.name)
        if (photo.size > 50 * 1024 * 1024) throw rule('file_too_large', { max_mb: 50 })
        if (state.imagesLeft <= 0) throw rule('quota_exceeded', { limit: IMAGE_LIMIT, kind: 'image_extraction' })
        state.imagesLeft -= 1
        batch.photos.push(photo.name)
        return { page: batch.photos.length }
      }
      if (batchCall?.[2] === 'finalize' && method === 'POST') {
        if (batch.photos.length === 0) throw rule('insufficient_material')
        if (slots >= 10) throw rule('material_limit_reached', { max: 10 })
        batch.finalized = true
        state.uploaded += 1
        const pages = batch.photos.length
        const created = material(`m-${state.uploaded}`, {
          file_name: pages === 1 ? 'Handwritten notes, 1 page' : `Handwritten notes, ${pages} pages`,
          file_type: 'phone_batch',
          status: 'processing',
        })
        state.materials[link.project_id] = [...files, created]
        state.jobs.push({ id: `j-${state.uploaded}`, project_id: link.project_id, kind: 'material_processing', status: 'running', result_ref: created.id })
        return { pages }
      }
    }
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
    // Mistake Review (Stories 3.4 + 3.5): like the server, one active round job per Project, answers
    // scored and saved once, and a correct answer clears its Mistake.
    const practiceCall = path.match(/^\/api\/projects\/([^/]+)\/review-rounds\/([^/]+)\/items\/([^/]+)\/answer$/)
    if (practiceCall && method === 'POST') {
      const [, id, roundId, itemId] = practiceCall
      const owner = state.projects.find((p) => p.id === id)
      if (!owner) throw notFound()
      if (owner.archived_at || owner.deleted_at) throw rule('project_read_only')
      if (!['a', 'b', 'c', 'd'].includes(body?.option_id)) throw rule('invalid_request', { fields: ['option_id'] })
      const round = state.rounds[roundId]
      const item = round?.project_id === id && round.items.find((i) => i.id === itemId)
      if (!item) throw notFound()
      state.practiceAnswers.push({ item_id: itemId, ...body })
      if (!item.answered) {
        item.answered = { submitted_option_id: body.option_id, is_correct: body.option_id === item.correct_option_id }
        const target = state.mistakes.find((m) => m.id === item.mistake_id)
        if (item.answered.is_correct && target && !target.cleared && !target.withdrawn) {
          target.cleared = true
          item.cleared = true
        }
      }
      return {
        ...shownItem(state, item),
        cleared: Boolean(item.cleared),
        cleared_count: round.items.filter((i) => i.cleared).length,
        remaining_outstanding: outstandingOf(state, id).length,
      }
    }
    const roundCall = path.match(/^\/api\/projects\/([^/]+)\/review-rounds(?:\/([^/]+))?$/)
    if (roundCall) {
      const [, id, roundId] = roundCall
      const owner = state.projects.find((p) => p.id === id)
      if (!owner) throw notFound()
      if (roundId && method === 'GET') {
        const round = state.rounds[roundId]
        if (!round || round.project_id !== id) throw notFound()
        // Like the server: the round's job status, so one still being made isn't "missing".
        const job = state.jobs.find((j) => j.id === round.job_id)
        return {
          id: round.id,
          status: job ? job.status : 'completed',
          error_code: job?.error_code ?? null,
          items: round.items.map((item) => shownItem(state, item)),
          cleared_count: round.items.filter((i) => i.cleared).length,
          total: round.items.length,
          remaining_outstanding: outstandingOf(state, id).length,
        }
      }
      if (!roundId && method === 'POST') {
        if (owner.archived_at || owner.deleted_at) throw rule('project_read_only')
        if (outstandingOf(state, id).length === 0) throw rule('insufficient_material')
        const busy = state.jobs.some(
          (j) => j.project_id === id && j.kind === 'review_round' && ['queued', 'running'].includes(j.status),
        )
        if (busy) throw rule('review_in_progress')
        state.reviewRequests += 1
        const job = {
          id: `rv-${state.reviewRequests}`,
          project_id: id,
          kind: 'review_round',
          status: 'running',
          progress_step: 'reading',
          result_ref: null,
          error_code: null,
          topic_labels: [],
          round_id: `round-${state.reviewRequests}`,
        }
        state.jobs.push(job)
        state.rounds[job.round_id] = { id: job.round_id, project_id: id, job_id: job.id, items: [] }
        return { job_id: job.id, round_id: job.round_id }
      }
    }
    // Mistakes summary (Story 3.3): a read, so a read-only Project answers too.
    const summaryCall = path.match(/^\/api\/projects\/([^/]+)\/mistakes\/summary$/)
    if (summaryCall && method === 'GET') {
      const id = summaryCall[1]
      if (!state.projects.some((p) => p.id === id)) throw notFound()
      const outstanding = outstandingOf(state, id)
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

    // Delete forever (Story 7.2b): only a deleted Project (409 `project_not_deleted`); it and its
    // files, jobs, and Mistakes are gone (204). Recorded as "purge {id}" in `stateChanges`.
    const purgeCall = path.match(/^\/api\/projects\/([^/]+)\/purge$/)
    if (purgeCall && method === 'POST') {
      const found = state.projects.find((p) => p.id === purgeCall[1])
      if (!found) throw notFound()
      if (!found.deleted_at) throw rule('project_not_deleted')
      state.stateChanges.push(`purge ${found.id}`)
      state.projects = state.projects.filter((p) => p.id !== found.id)
      state.jobs = state.jobs.filter((job) => job.project_id !== found.id)
      state.mistakes = state.mistakes.filter((m) => m.project_id !== found.id)
      delete state.materials[found.id]
      if (state.me?.last_project_id === found.id) state.me = { ...state.me, last_project_id: null }
      return null
    }

    // Archive, delete, and restore (Stories 7.1, 7.2a): idempotent; a deleted Project refuses archive;
    // archive and delete revoke the Project's phone links, and delete cancels its active jobs.
    const stateCall = path.match(/^\/api\/projects\/([^/]+)\/(archive|delete|restore)$/)
    if (stateCall && method === 'POST') {
      const found = state.projects.find((p) => p.id === stateCall[1])
      if (!found) throw notFound()
      const action = stateCall[2]
      if (action === 'archive' && found.deleted_at) throw rule('project_read_only')
      state.stateChanges.push(`${action} ${found.id}`)
      if (action === 'archive') {
        found.archived_at = found.archived_at ?? new Date().toISOString()
        for (const link of state.links) if (link.project_id === found.id) link.revoked = true
      } else if (action === 'delete') {
        if (!found.deleted_at) {
          const now = Date.now()
          found.deleted_at = new Date(now).toISOString()
          found.purge_at = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString()
          for (const link of state.links) if (link.project_id === found.id) link.revoked = true
          for (const job of state.jobs) {
            if (job.project_id === found.id && (job.status === 'queued' || job.status === 'running')) {
              job.status = 'cancelled'
            }
          }
        }
      } else {
        found.archived_at = null
        found.deleted_at = null
        found.purge_at = null
      }
      return { ...found }
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
  }
  vi.mocked(apiFetch).mockImplementation(async (path, options = {}) => {
    const result = await handle(path, options)
    // Like a real response: `Date` is the server's clock, `serverOffsetMs` ahead of this one.
    const date = serverOffsetMs === null ? {} : { date: new Date(Date.now() + serverOffsetMs).toUTCString() }
    options.onResponse?.({ status: 200, headers: new Headers(date) })
    return result
  })
  return state
}

const rule = (code, params = {}) => ({ code, params })

/** The Project's outstanding Mistakes, oldest first: neither withdrawn nor cleared. */
function outstandingOf(state, projectId) {
  return state.mistakes.filter((m) => m.project_id === projectId && !m.withdrawn && !m.cleared)
}

/** A round item as the server shows it: the key, sources, and the original's correct answer only once
 * answered; the context comes from its Mistake. */
function shownItem(state, item) {
  const target = state.mistakes.find((m) => m.id === item.mistake_id) ?? {}
  return {
    id: item.id,
    position: item.position,
    question: item.question,
    options: item.options.map((o) => ({ ...o })),
    context: {
      question: target.question ?? '',
      earlier_answer_text: target.earlier ?? '',
      correct_text: item.answered ? (target.correct ?? '') : null,
    },
    file_removed: Boolean(target.file_removed),
    from_original: Boolean(item.from_original),
    answer: item.answered
      ? {
          ...item.answered,
          correct_option_id: item.correct_option_id,
          explanation: item.explanation,
          sources: item.sources.map((label) => ({ label })),
        }
      : null,
  }
}

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

let mistakeCount = 0

/** An outstanding Mistake of Project `projectId` citing `materialIds` (Story 3.3). For Mistake Review
 * (Stories 3.4 + 3.5) it carries its original question "Original {k}?", the earlier wrong answer "Wrong
 * {k}", and the correct one "Right {k}" (k counts every Mistake made); `overrides` may set `id`,
 * `file_removed`, `from_original` (its round item is the original question), and the rest. */
export function mistake(projectId, materialIds = ['notes'], overrides = {}) {
  mistakeCount += 1
  const k = mistakeCount
  return {
    id: `mk-${k}`,
    project_id: projectId,
    quiz_question_id: null,
    material_ids: [...materialIds],
    withdrawn: false,
    cleared: false,
    question: `Original ${k}?`,
    earlier: `Wrong ${k}`,
    correct: `Right ${k}`,
    file_removed: false,
    ...overrides,
  }
}

/** Round items for `mistakes` (in order): item i reads "Practice {i}?" with options "Choice {i}A".."Choice
 * {i}D", correct `correct`, explanation "Since {i}.", source "notes.pdf · Page {i}" (1-based). `answered`
 * maps a 0-based index to the submitted option id; a correct one counts as cleared. */
function roundItems(roundId, mistakes, { correct = 'b', answered = {} } = {}) {
  return mistakes.map((m, i) => ({
    id: `${roundId}-p${i + 1}`,
    position: i,
    mistake_id: m.id,
    question: `Practice ${i + 1}?`,
    options: ['a', 'b', 'c', 'd'].map((o) => ({ id: o, text: `Choice ${i + 1}${o.toUpperCase()}` })),
    correct_option_id: correct,
    explanation: `Since ${i + 1}.`,
    sources: [`notes.pdf · Page ${i + 1}`],
    from_original: Boolean(m.from_original),
    answered:
      answered[i] === undefined ? null : { submitted_option_id: answered[i], is_correct: answered[i] === correct },
    cleared: answered[i] !== undefined && answered[i] === correct,
  }))
}

/** A stored round `id` of Project `projectId` with one item per Mistake in `mistakes` (see roundItems).
 * Mistakes answered correctly here should be passed to fakeApi with `cleared: true`. */
export function reviewRound(id, projectId, mistakes, options = {}) {
  return { id, project_id: projectId, items: roundItems(id, mistakes, options) }
}

/** Complete a review job: its round holds the oldest outstanding Mistakes (at most 20), each with a new
 * practice question. Returns the round id. */
export function finishReview(state, jobId) {
  const job = state.jobs.find((j) => j.id === jobId)
  const picked = outstandingOf(state, job.project_id).slice(0, 20)
  state.rounds[job.round_id] = {
    id: job.round_id,
    project_id: job.project_id,
    job_id: job.id,
    items: roundItems(job.round_id, picked),
  }
  Object.assign(job, { status: 'completed', progress_step: null, result_ref: job.round_id })
  return job.round_id
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
