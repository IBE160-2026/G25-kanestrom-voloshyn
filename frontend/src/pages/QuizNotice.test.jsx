// The "quiz is ready" notice in the chat (Story 3.1b, FR-26, AD-20). api/client.js and auth/ are
// mocked (spine › Tests); test/fakeApi.js plays the backend, and finishQuiz / failJob move a quiz job on.
import { act, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { PROFILE, callsTo, failJob, fakeApi, finishQuiz, material, project, quiz, topics } from '../test/fakeApi.js'
import { i18n, renderRoute } from '../test/render.jsx'
import { NOTICE_POLL_MS, useQuizNotices } from './useQuizNotices.js'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

beforeEach(() => {
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
})

afterEach(() => {
  vi.useRealTimers()
})

const READY = { a: [material('m1', { file_name: 'notes.md', topics: topics(3, { prefix: 'Cells' }) })] }

/** A quiz job of Project a. A completed one has a stored Quiz `quiz-{id}` as its result. */
function quizJob(id, status, overrides = {}) {
  return {
    id,
    project_id: 'a',
    kind: 'quiz',
    status,
    progress_step: status === 'running' ? 'writing' : null,
    result_ref: status === 'completed' ? `quiz-${id}` : null,
    error_code: status === 'failed' ? 'llm_unavailable' : null,
    topic_labels: [],
    ...overrides,
  }
}

function setup({ jobs = [], projects = [project('a', { name: 'Biology' })], ...options } = {}) {
  const quizzes = jobs.filter((j) => j.result_ref).map((j) => quiz(j.result_ref, 'a', { n: 3 }))
  return fakeApi({ projects, materials: READY, jobs, quizzes, ...options })
}

const notices = () => screen.getByTestId('ready-notices')
/** The notices' live region, once the chat has rendered. */
const region = async () => within(await screen.findByTestId('ready-notices'))
const jobReads = () => callsTo('/api/projects/a/jobs')
/** The chat has loaded (its tool buttons row is enabled once a file is Ready). */
async function opened() {
  await waitFor(() => expect(screen.getByRole('button', { name: en.tools.quiz })).toBeEnabled())
}

describe('Quiz ready notice', () => {
  it('shows on opening the Project for a completed, unseen quiz job, in a polite live region', async () => {
    setup({ jobs: [quizJob('q-1', 'completed', { topic_labels: ['Cells 1'] })] })
    renderRoute('/projects/a')

    expect(await (await region()).findByText(/Your quiz on Cells 1 is ready/)).toBeInTheDocument()
    expect(notices()).toHaveAttribute('aria-live', 'polite')
    expect(within(notices()).getByRole('button', { name: 'Open' })).toBeInTheDocument()
    expect(within(notices()).getByRole('button', { name: en.quiz.ready.dismiss })).toBeInTheDocument()
    expect(notices()).toHaveTextContent('Your quiz on Cells 1 is ready · Open')
  })

  it('appears after a poll when a quiz finishes while the student is on the chat, then polling stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const state = setup({ jobs: [quizJob('q-1', 'running')] })
    renderRoute('/projects/a')
    await opened()
    await waitFor(() => expect(jobReads()).toHaveLength(1))
    expect(notices()).toBeEmptyDOMElement()

    await act(() => vi.advanceTimersByTimeAsync(NOTICE_POLL_MS))
    expect(jobReads()).toHaveLength(2)
    expect(notices()).toBeEmptyDOMElement()

    finishQuiz(state, 'q-1', 3)
    await act(() => vi.advanceTimersByTimeAsync(NOTICE_POLL_MS))

    expect(await (await region()).findByText(/Your quiz on all topics is ready/)).toBeInTheDocument()
    const reads = jobReads().length
    await act(() => vi.advanceTimersByTimeAsync(NOTICE_POLL_MS * 3))
    expect(jobReads()).toHaveLength(reads)
  })

  it('reads the jobs once and does not poll while no quiz is being made', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup({ jobs: [quizJob('q-1', 'completed')] })
    renderRoute('/projects/a')
    await (await region()).findByText(/is ready/)

    await act(() => vi.advanceTimersByTimeAsync(NOTICE_POLL_MS * 3))

    expect(jobReads()).toHaveLength(1)
  })

  it('stops polling when the page goes away', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup({ jobs: [quizJob('q-1', 'running')] })
    const { unmount } = renderRoute('/projects/a')
    await opened()
    await waitFor(() => expect(jobReads()).toHaveLength(1))

    unmount()
    await act(() => vi.advanceTimersByTimeAsync(NOTICE_POLL_MS * 3))

    expect(jobReads()).toHaveLength(1)
  })

  it('"Open" marks the job seen and opens the Quiz; back on the chat the notice is gone', async () => {
    const state = setup({ jobs: [quizJob('q-1', 'completed')] })
    const { router } = renderRoute('/projects/a')

    fireEvent.click(await (await region()).findByRole('button', { name: 'Open' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a/quizzes/quiz-q-1'))
    await waitFor(() => expect(state.jobs[0].seen).toBe(true))
    expect(callsTo('/api/jobs/q-1/seen', 'POST')).toHaveLength(1)

    await act(() => router.navigate('/projects/a'))
    await opened()
    await waitFor(() => expect(jobReads().length).toBeGreaterThan(1))
    expect(notices()).toBeEmptyDOMElement()
  })

  it('"Open" still opens the Quiz when marking it seen fails', async () => {
    setup({
      jobs: [quizJob('q-1', 'completed')],
      routes: { 'POST /api/jobs/q-1/seen': () => Promise.reject({ code: 'server_error', params: {} }) },
    })
    const { router } = renderRoute('/projects/a')

    fireEvent.click(await (await region()).findByRole('button', { name: 'Open' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a/quizzes/quiz-q-1'))
  })

  it('× marks the job seen and removes the notice, which does not come back on reopening', async () => {
    const state = setup({ jobs: [quizJob('q-1', 'completed')] })
    const { unmount } = renderRoute('/projects/a')

    fireEvent.click(await (await region()).findByRole('button', { name: en.quiz.ready.dismiss }))

    await waitFor(() => expect(notices()).toBeEmptyDOMElement())
    expect(callsTo('/api/jobs/q-1/seen', 'POST')).toHaveLength(1)
    expect(state.jobs[0].seen).toBe(true)

    unmount()
    renderRoute('/projects/a')
    await opened()
    await waitFor(() => expect(jobReads()).toHaveLength(2))
    expect(notices()).toBeEmptyDOMElement()
  })

  it('a failed × keeps the notice, and the next × tries again', async () => {
    let fail = true
    setup({
      jobs: [quizJob('q-1', 'completed')],
      routes: {
        'POST /api/jobs/q-1/seen': (_, state) => {
          if (fail) return Promise.reject({ code: 'server_error', params: {} })
          state.jobs[0].seen = true
          return null
        },
      },
    })
    renderRoute('/projects/a')
    const dismiss = await (await region()).findByRole('button', { name: en.quiz.ready.dismiss })

    fireEvent.click(dismiss)
    await waitFor(() => expect(callsTo('/api/jobs/q-1/seen', 'POST')).toHaveLength(1))
    await act(() => Promise.resolve())
    expect(within(notices()).getByText(/is ready/)).toBeInTheDocument()

    fail = false
    fireEvent.click(within(notices()).getByRole('button', { name: en.quiz.ready.dismiss }))
    await waitFor(() => expect(notices()).toBeEmptyDOMElement())
    expect(callsTo('/api/jobs/q-1/seen', 'POST')).toHaveLength(2)
  })

  it('shows no notice for failed or cancelled quiz jobs, nor for finished file processing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const state = setup({
      jobs: [
        quizJob('q-1', 'running'),
        quizJob('q-2', 'cancelled'),
        { id: 'j-1', project_id: 'a', kind: 'material_processing', status: 'completed', result_ref: 'm1' },
      ],
    })
    renderRoute('/projects/a')
    await opened()
    await waitFor(() => expect(jobReads()).toHaveLength(1))

    failJob(state, 'q-1')
    await act(() => vi.advanceTimersByTimeAsync(NOTICE_POLL_MS))

    expect(jobReads()).toHaveLength(2)
    expect(notices()).toBeEmptyDOMElement()
    expect(callsTo('/api/jobs/q-1/seen', 'POST')).toHaveLength(0)
    expect(callsTo('/api/jobs/q-2/seen', 'POST')).toHaveLength(0)
  })

  it('shows no notice for a quiz that finished while the setup page was open (it marks it seen)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const state = setup()
    const { router } = renderRoute('/projects/a/quiz')
    const make = await screen.findByRole('button', { name: i18n.t('quiz.make', { count: 10 }) })
    await waitFor(() => expect(make).toBeEnabled())
    fireEvent.click(make)
    await waitFor(() => expect(state.jobs).toHaveLength(1))

    finishQuiz(state, 'q-1', 3)
    await act(() => vi.advanceTimersByTimeAsync(NOTICE_POLL_MS))
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a/quizzes/quiz-q-1'))
    expect(state.jobs[0].seen).toBe(true)

    const before = jobReads().length
    await act(() => router.navigate('/projects/a'))
    await opened()
    await waitFor(() => expect(jobReads()).toHaveLength(before + 1))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(notices()).toBeEmptyDOMElement()
  })

  it('keeps reading the jobs every 2 s after a failed first read, until one succeeds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let failures = 2
    setup({
      jobs: [quizJob('q-1', 'completed')],
      routes: {
        'GET /api/projects/a/jobs': (_, state) => {
          if (failures > 0) {
            failures -= 1
            return Promise.reject({ code: 'server_error', params: {} })
          }
          return state.jobs.filter((j) => !j.seen)
        },
      },
    })
    renderRoute('/projects/a')
    await opened()
    await waitFor(() => expect(jobReads()).toHaveLength(1))
    expect(notices()).toBeEmptyDOMElement()

    await act(() => vi.advanceTimersByTimeAsync(NOTICE_POLL_MS))
    expect(jobReads()).toHaveLength(2)
    await act(() => vi.advanceTimersByTimeAsync(NOTICE_POLL_MS))
    expect(jobReads()).toHaveLength(3)
    expect(await (await region()).findByText(/Your quiz on all topics is ready/)).toBeInTheDocument()

    // Nothing is being made: reading stops once a read has succeeded.
    await act(() => vi.advanceTimersByTimeAsync(NOTICE_POLL_MS * 3))
    expect(jobReads()).toHaveLength(3)
  })

  it('a double click on "Open" sends one seen and navigates once', async () => {
    setup({ jobs: [quizJob('q-1', 'completed')] })
    const { router } = renderRoute('/projects/a')
    const open = await (await region()).findByRole('button', { name: 'Open' })
    const navigate = vi.spyOn(router, 'navigate')

    fireEvent.click(open)
    fireEvent.click(open)

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a/quizzes/quiz-q-1'))
    await waitFor(() => expect(callsTo('/api/jobs/q-1/seen', 'POST')).toHaveLength(1))
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('"Open" with a failed seen does not bring the notice back on a later poll of the same visit', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup({
      jobs: [quizJob('q-1', 'completed'), quizJob('q-2', 'running')],
      routes: { 'POST /api/jobs/q-1/seen': () => Promise.reject({ code: 'server_error', params: {} }) },
    })
    const { result } = renderHook(() => useQuizNotices('a'))
    await waitFor(() => expect(result.current.notices.map((j) => j.id)).toEqual(['q-1']))

    let first
    act(() => {
      first = result.current.open(result.current.notices[0])
    })
    expect(first).toBe(true)
    expect(result.current.notices).toEqual([])
    await act(() => vi.advanceTimersByTimeAsync(NOTICE_POLL_MS * 2))

    expect(callsTo('/api/jobs/q-1/seen', 'POST')).toHaveLength(1)
    expect(jobReads().length).toBeGreaterThanOrEqual(3)
    expect(result.current.notices).toEqual([])
  })

  it("after ×, focus moves to the next notice's Open, then to the Quiz button once none remain", async () => {
    setup({
      jobs: [
        quizJob('q-1', 'completed', { topic_labels: ['Old'], finished_at: '2026-11-19T10:00:00Z' }),
        quizJob('q-2', 'completed', { topic_labels: ['New'], finished_at: '2026-11-19T11:00:00Z' }),
      ],
    })
    renderRoute('/projects/a')
    await (await region()).findByText(/Your quiz on New/)
    await opened()

    fireEvent.click(within(notices()).getAllByRole('button', { name: en.quiz.ready.dismiss })[0])
    await waitFor(() => expect(within(notices()).queryByText(/Your quiz on New/)).not.toBeInTheDocument())
    await waitFor(() => expect(within(notices()).getByRole('button', { name: 'Open' })).toHaveFocus())

    fireEvent.click(within(notices()).getByRole('button', { name: en.quiz.ready.dismiss }))
    await waitFor(() => expect(notices()).toBeEmptyDOMElement())
    await waitFor(() => expect(screen.getByRole('button', { name: en.tools.quiz })).toHaveFocus())
  })

  it('renders a markup-like Topic label as plain text', async () => {
    setup({ jobs: [quizJob('q-1', 'completed', { topic_labels: ['<b>A</b> & <0>x</0>'] })] })
    renderRoute('/projects/a')

    await (await region()).findByRole('button', { name: 'Open' })
    expect(notices()).toHaveTextContent('Your quiz on <b>A</b> & <0>x</0> is ready · Open')
    expect(notices().querySelector('b')).toBeNull()
    expect(within(notices()).getAllByRole('button')).toHaveLength(2)
  })

  it('leaves out empty or missing Topic labels before naming the topics', async () => {
    setup({
      jobs: [
        quizJob('q-1', 'completed', { topic_labels: ['', null, ' '], finished_at: '2026-11-19T10:00:00Z' }),
        quizJob('q-2', 'completed', { topic_labels: [null, 'Cells', ''], finished_at: '2026-11-19T11:00:00Z' }),
        quizJob('q-3', 'completed', { topic_labels: null, finished_at: '2026-11-19T12:00:00Z' }),
      ],
    })
    renderRoute('/projects/a')

    await (await region()).findByText(/Your quiz on Cells/)
    expect(within(notices()).getAllByText(/is ready/).map((item) => item.textContent)).toEqual([
      'Your quiz on all topics is ready · Open',
      'Your quiz on Cells is ready · Open',
      'Your quiz on all topics is ready · Open',
    ])
  })

  it('lists several notices newest first', async () => {
    setup({
      jobs: [
        quizJob('q-1', 'completed', { topic_labels: ['Old'], finished_at: '2026-11-19T10:00:00Z' }),
        quizJob('q-2', 'completed', { topic_labels: ['New'], finished_at: '2026-11-19T11:00:00Z' }),
      ],
    })
    renderRoute('/projects/a')

    await (await region()).findByText(/Your quiz on New/)
    const items = within(notices()).getAllByText(/is ready/)
    expect(items.map((item) => item.textContent)).toEqual([
      'Your quiz on New is ready · Open',
      'Your quiz on Old is ready · Open',
    ])
  })

  it.each([
    [[], 'all topics'],
    [['Cells'], 'Cells'],
    [['Cells', 'DNA'], 'Cells and DNA'],
    [['Cells', 'DNA', 'RNA', 'Proteins'], 'Cells and 3 more'],
  ])('names the topics %j as "%s"', async (labels, text) => {
    setup({ jobs: [quizJob('q-1', 'completed', { topic_labels: labels })] })
    renderRoute('/projects/a')

    expect(await (await region()).findByText(`Your quiz on ${text} is ready ·`, { exact: false })).toBeInTheDocument()
    expect(notices()).toHaveTextContent(`Your quiz on ${text} is ready · Open`)
  })

  it('shows in an archived Project, where Open and × still work', async () => {
    const archived = [project('a', { name: 'Biology', archived_at: '2026-11-18T10:00:00Z' })]
    const state = setup({
      projects: archived,
      jobs: [quizJob('q-1', 'completed'), quizJob('q-2', 'completed', { topic_labels: ['Cells 2'] })],
    })
    const { router } = renderRoute('/projects/a')

    await (await region()).findByText(/Your quiz on Cells 2/)
    const second = within(notices()).getAllByRole('button', { name: en.quiz.ready.dismiss })[0]
    fireEvent.click(second)
    await waitFor(() => expect(within(notices()).queryByText(/Cells 2/)).not.toBeInTheDocument())
    expect(state.jobs[1].seen).toBe(true)

    fireEvent.click(within(notices()).getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a/quizzes/quiz-q-1'))
    await waitFor(() => expect(state.jobs[0].seen).toBe(true))
  })

  it('appears on the chat after leaving the Quiz setup while the quiz is generating', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const state = setup()
    const { router } = renderRoute('/projects/a/quiz')
    fireEvent.click(await screen.findByRole('button', { name: 'Cells 2' }))
    const make = screen.getByRole('button', { name: i18n.t('quiz.make', { count: 10 }) })
    await waitFor(() => expect(make).toBeEnabled())
    fireEvent.click(make)
    await waitFor(() => expect(state.jobs).toHaveLength(1))

    fireEvent.click(await screen.findByRole('button', { name: en.activity.back }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a'))
    await opened()
    expect(notices()).toBeEmptyDOMElement()

    finishQuiz(state, 'q-1', 3)
    await act(() => vi.advanceTimersByTimeAsync(NOTICE_POLL_MS))

    expect(await (await region()).findByText(/Your quiz on Cells 2 is ready/)).toBeInTheDocument()
  })

  it('is in Norwegian too', async () => {
    await i18n.changeLanguage('nb')
    setup({
      me: { ...PROFILE, language: 'nb' },
      jobs: [
        quizJob('q-1', 'completed', { topic_labels: [], finished_at: '2026-11-19T10:00:00Z' }),
        quizJob('q-2', 'completed', { topic_labels: ['Celler', 'DNA'], finished_at: '2026-11-19T11:00:00Z' }),
        quizJob('q-3', 'completed', { topic_labels: ['Celler', 'DNA', 'RNA'], finished_at: '2026-11-19T12:00:00Z' }),
      ],
    })
    renderRoute('/projects/a')

    await (await region()).findByText(/Quizen din om Celler og 2 til er klar/)
    expect(within(notices()).getAllByText(/er klar/).map((item) => item.textContent)).toEqual([
      'Quizen din om Celler og 2 til er klar · Åpne',
      'Quizen din om Celler og DNA er klar · Åpne',
      'Quizen din om alle emner er klar · Åpne',
    ])
    expect(within(notices()).getAllByRole('button', { name: nb.quiz.ready.dismiss })).toHaveLength(3)
    expect(within(notices()).getAllByRole('button', { name: 'Åpne' })).toHaveLength(3)
  })
})
