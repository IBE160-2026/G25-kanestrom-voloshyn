// "Do it again" on the Quiz Score summary and the Flashcard end screen (Story 5.2, FR-25). api/client.js
// and auth/ are mocked (spine › Tests); test/fakeApi.js plays the backend: POST .../again queues a running
// job of the same kind from the stored setup, refusing a read-only Project or a removed source.
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { fakeApi, finishFlashcards, finishQuiz, flashcardSet, material, project, quiz } from '../test/fakeApi.js'
import { i18n, renderRoute } from '../test/render.jsx'
import { POLL_MS } from './useGenerationJob.js'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

beforeEach(async () => {
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
  await i18n.changeLanguage('en')
})

afterEach(async () => {
  vi.useRealTimers()
  await i18n.changeLanguage('en')
})

const READY = { a: [material('notes', { file_name: 'notes.pdf' })] }
const AGAIN = en.history.again

// A completed Quiz (every question answered) and an ended set.
const KINDS = {
  quiz: {
    path: '/projects/a/quizzes/z',
    result: (id) => `/projects/a/quizzes/${id}`,
    againPath: 'quizzes/z',
    setup: '/projects/a/quiz',
    steps: en.quiz.steps,
    fixture: (options) => ({ quizzes: [quiz('z', 'a', { n: 3, answered: { 0: 'b', 1: 'a', 2: 'b' }, ...options })] }),
    finish: (state, jobId) => finishQuiz(state, jobId, 3),
    opened: () => screen.findByRole('heading', { name: 'Question 1?' }),
  },
  flashcards: {
    path: '/projects/a/flashcard-sets/s1',
    result: (id) => `/projects/a/flashcard-sets/${id}`,
    againPath: 'flashcard-sets/s1',
    setup: '/projects/a/flashcards',
    steps: en.flashcards.steps,
    fixture: (options) => ({ flashcardSets: [flashcardSet('s1', 'a', { n: 3, ended: true, ...options })] }),
    finish: (state, jobId) => finishFlashcards(state, jobId, 3),
    opened: () => screen.findByText('1 of 3'),
  },
}

async function open(kind, { options = {}, projectOverrides = {}, routes = {}, jobs = [] } = {}) {
  const spec = KINDS[kind]
  const state = fakeApi({
    projects: [project('a', { name: 'Biology', ...projectOverrides })],
    materials: READY,
    routes,
    jobs,
    ...spec.fixture(options),
  })
  const view = renderRoute(spec.path)
  // The Score summary or the end screen, in either language.
  await screen.findByRole('button', { name: new RegExp(`^(${en.history.again}|${nb.history.again})$`) })
  return { state, ...view }
}

const againButton = (name = AGAIN) => screen.getByRole('button', { name })

describe.each(Object.keys(KINDS))('Do it again (%s)', (kind) => {
  const spec = KINDS[kind]

  it('queues a new job, replaces the page with the setup showing its progress, then opens the new result', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { state, router } = await open(kind, { options: { requested: 10, topicLabels: ['Photosynthesis'] } })

    expect(againButton()).toBeEnabled()
    await userEvent.click(againButton())

    await screen.findByText(`Step 1 of 3 · ${spec.steps.reading}`)
    expect(router.state.location.pathname).toBe(spec.setup)
    expect(router.state.historyAction).toBe('REPLACE')
    expect(state.againRequests).toEqual([spec.againPath])
    const job = state.jobs.find((j) => j.id === 'again-1')
    expect(job).toMatchObject({ kind: kind === 'quiz' ? 'quiz' : 'flashcards', count: 10, topic_labels: ['Photosynthesis'] })

    spec.finish(state, 'again-1')
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    await spec.opened()
  })

  it('an again job that already ended before the setup loads still moves on to its result', async () => {
    const jobKind = kind === 'quiz' ? 'quiz' : 'flashcards'
    const { state, router } = await open(kind, {
      routes: {
        [`POST /api/projects/a/${spec.againPath}/again`]: async () => {
          state.jobs.push({ id: 'again-done', project_id: 'a', kind: jobKind, status: 'running',
            progress_step: 'reading', result_ref: null, count: 3 })
          spec.finish(state, 'again-done')
          return { job_id: 'again-done' }
        },
      },
    })

    await userEvent.click(againButton())

    await waitFor(() => expect(router.state.location.pathname).toBe(spec.result(state.jobs.at(-1).result_ref)))
    await spec.opened()
  })

  it('follows the again job, not another job of the same kind that is also running', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const jobKind = kind === 'quiz' ? 'quiz' : 'flashcards'
    const other = { id: 'other', project_id: 'a', kind: jobKind, status: 'running', progress_step: 'writing',
      result_ref: null, count: 5 }
    const { state, router } = await open(kind, { jobs: [other] })

    await userEvent.click(againButton())

    await screen.findByText(`Step 1 of 3 · ${spec.steps.reading}`)
    spec.finish(state, 'other')
    spec.finish(state, 'again-1')
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))

    const target = state.jobs.find((j) => j.id === 'again-1').result_ref
    await waitFor(() => expect(router.state.location.pathname).toBe(spec.result(target)))
  })

  it('a removed source disables the button with the note beside it', async () => {
    const { state } = await open(kind, { options: { sourceRemoved: true } })

    expect(againButton()).toBeDisabled()
    expect(againButton().parentElement).toHaveTextContent(en.errors.material_removed)
    expect(againButton()).toHaveAccessibleDescription(en.errors.material_removed)
    await userEvent.click(againButton())
    expect(state.againRequests).toEqual([])
  })

  it('a read-only Project disables the button, and the read-only notice explains why', async () => {
    const { state } = await open(kind, { projectOverrides: { archived_at: '2026-11-20T10:00:00Z' } })

    expect(againButton()).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(en.errors.project_read_only)
    expect(screen.queryByText(en.errors.material_removed)).not.toBeInTheDocument()
    expect(state.againRequests).toEqual([])
  })

  it.each(['material_removed', 'project_read_only', 'not_found'])(
    'a refusal naming a rule (%s) shows its message with no Try again',
    async (code) => {
      const { router } = await open(kind, {
        routes: {
          [`POST /api/projects/a/${spec.againPath}/again`]: async () => {
            throw { code, params: {} }
          },
        },
      })

      await userEvent.click(againButton())

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(en.errors[code])
      expect(within(alert).queryByRole('button')).not.toBeInTheDocument()
      expect(router.state.location.pathname).toBe(spec.path)
    },
  )

  it('another failure adds Try again, which sends it again', async () => {
    let failing = true
    const { state, router } = await open(kind, {
      routes: {
        [`POST /api/projects/a/${spec.againPath}/again`]: async () => {
          if (failing) throw { code: 'network_error', params: {} }
          state.jobs.push({ id: 'again-x', project_id: 'a', kind: kind === 'quiz' ? 'quiz' : 'flashcards',
            status: 'running', progress_step: 'reading', result_ref: null })
          return { job_id: 'again-x' }
        },
      },
    })

    await userEvent.click(againButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(en.errors.generic)
    const retry = within(alert).getByRole('button', { name: en.inlineError.retry })
    await waitFor(() => expect(retry).toHaveFocus())
    failing = false
    await userEvent.click(retry)

    await waitFor(() => expect(router.state.location.pathname).toBe(spec.setup))
  })

  it('reads in Norwegian, with the signed-off copy', async () => {
    await i18n.changeLanguage('nb')
    await open(kind, { options: { sourceRemoved: true } })

    expect(againButton(nb.history.again)).toBeDisabled()
    expect(nb.history.again).toBe('Gjør det igjen')
    expect(screen.getByText('Filen dette kom fra, er fjernet.')).toBeInTheDocument()
  })
})

describe('Unfinished Quiz', () => {
  it('opens at its first unanswered question, and an unfinished summary offers no Do it again', async () => {
    fakeApi({
      projects: [project('a', { name: 'Biology' })],
      materials: READY,
      quizzes: [quiz('z', 'a', { n: 10, answered: { 0: 'b', 1: 'b', 2: 'a' } })],
    })
    renderRoute('/projects/a/quizzes/z')

    expect(await screen.findByRole('heading', { name: 'Question 4?' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: AGAIN })).not.toBeInTheDocument()
  })

  it('a read-only Project lets an unfinished Quiz reach its summary without Do it again', async () => {
    fakeApi({
      projects: [project('a', { name: 'Biology', archived_at: '2026-11-20T10:00:00Z' })],
      materials: READY,
      quizzes: [quiz('z', 'a', { n: 1 })],
    })
    renderRoute('/projects/a/quizzes/z')
    await screen.findByRole('heading', { name: 'Question 1?' })

    await userEvent.click(screen.getByRole('button', { name: new RegExp(en.quiz.seeResults) }))

    await screen.findByRole('heading', { name: /of 1 correct/ })
    expect(screen.queryByRole('button', { name: AGAIN })).not.toBeInTheDocument()
  })
})
