// Quiz setup and generation (Story 3.1a, FR-10, FR-26). api/client.js and auth/ are mocked (spine ›
// Tests); test/fakeApi.js plays the backend, and stepJob / finishQuiz / failJob move the quiz job on.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { callsTo, failJob, fakeApi, finishQuiz, material, project, stepJob, topics } from '../test/fakeApi.js'
import { i18n, renderRoute } from '../test/render.jsx'
import { POLL_MS } from './QuizSetup.jsx'
import { requestCount } from './quizCounts.js'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

beforeEach(() => {
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
})

afterEach(() => {
  vi.useRealTimers()
})

const READY = { a: [material('m1', { file_name: 'notes.md', topics: topics(3, { prefix: 'Photosynthesis' }) })] }
// The primary button in the active language: "Make {n} questions".
const make = (n) => screen.getByRole('button', { name: i18n.t('quiz.make', { count: n }) })

async function openSetup(options = {}) {
  const state = fakeApi({ projects: [project('a', { name: 'Biology' })], materials: READY, ...options })
  const view = renderRoute('/projects/a/quiz')
  await screen.findByRole('heading', { level: 2, name: (options.lang === 'nb' ? nb : en).quiz.title })
  return { state, ...view }
}

async function startQuiz(options = {}) {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const opened = await openSetup(options)
  await waitFor(() => expect(make(10)).toBeEnabled())
  fireEvent.click(make(10))
  await waitFor(() => expect(opened.state.quizRequests).toHaveLength(1))
  return opened
}

function stepStates() {
  return screen.getAllByRole('listitem').filter((li) => li.dataset.state).map((li) => [li.textContent.replace('✓', ''), li.dataset.state])
}

describe('Quiz setup', () => {
  it('opens from the Quiz button in the chat, which is enabled once a file is Ready', async () => {
    fakeApi({ projects: [project('a')], materials: READY })
    const { router } = renderRoute('/projects/a')

    const quiz = await screen.findByRole('button', { name: en.tools.quiz })
    await waitFor(() => expect(quiz).toBeEnabled())
    await userEvent.click(quiz)

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a/quiz'))
    expect(await screen.findByRole('heading', { name: en.quiz.title })).toBeInTheDocument()
  })

  it('keeps the Quiz button disabled while files are only Reading…', async () => {
    fakeApi({ projects: [project('a')], materials: { a: [material('m1', { status: 'processing' })] } })
    renderRoute('/projects/a')

    await screen.findByText(en.files.status.processing)
    expect(screen.getByRole('button', { name: en.tools.quiz })).toBeDisabled()
  })

  it('keeps the Quiz button disabled in an archived Project', async () => {
    fakeApi({ projects: [project('a', { archived_at: '2026-11-18T10:00:00Z' })], materials: READY })
    renderRoute('/projects/a')

    await screen.findAllByText('Photosynthesis 1')
    expect(screen.getByRole('button', { name: en.tools.quiz })).toBeDisabled()
  })

  it('shows the header, "All topics" first and selected, the Topic chips, and 10 preselected', async () => {
    await openSetup()

    expect(screen.getByRole('button', { name: en.activity.back })).toBeInTheDocument()
    const topicsField = screen.getByRole('group', { name: en.quiz.topics })
    const chips = within(topicsField).getAllByRole('button')
    expect(chips.map((chip) => chip.textContent)).toEqual([en.quiz.allTopics, 'Photosynthesis 1', 'Photosynthesis 2', 'Photosynthesis 3'])
    expect(chips[0]).toHaveAttribute('aria-pressed', 'true')
    const countField = screen.getByRole('group', { name: en.quiz.count })
    expect(within(countField).getAllByRole('radio').map((radio) => radio.value)).toEqual(['5', '10', '20'])
    expect(within(countField).getByRole('radio', { name: '10' })).toBeChecked()
    await waitFor(() => expect(make(10)).toBeEnabled())
  })

  it('names the chosen count on the button: "Make {n} questions"', async () => {
    await openSetup()

    await userEvent.click(screen.getByRole('radio', { name: '20' }))
    expect(make(20)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: '5' }))
    expect(make(5)).toBeInTheDocument()
  })

  it('sends the chosen Topics, in list order, and "All topics" again once none is chosen', async () => {
    const { state } = await openSetup({ capacity: (scope) => (scope.all_topics ? 20 : 12) })
    const field = screen.getByRole('group', { name: en.quiz.topics })

    await userEvent.click(within(field).getByRole('button', { name: 'Photosynthesis 3' }))
    await userEvent.click(within(field).getByRole('button', { name: 'Photosynthesis 1' }))
    expect(within(field).getByRole('button', { name: en.quiz.allTopics })).toHaveAttribute('aria-pressed', 'false')
    await waitFor(() => expect(make(10)).toBeEnabled())
    await userEvent.click(make(10))

    await waitFor(() => expect(state.quizRequests).toEqual([{ scope: { topic_ids: ['t-1', 't-3'] }, count: 10 }]))
  })

  it('asks the capacity endpoint for the chosen scope', async () => {
    await openSetup()
    await waitFor(() => expect(callsTo(`/api/projects/a/capacity?scope=${encodeURIComponent('{"all_topics":true}')}`)).toHaveLength(1))

    await userEvent.click(screen.getByRole('button', { name: 'Photosynthesis 2' }))

    await waitFor(() =>
      expect(callsTo(`/api/projects/a/capacity?scope=${encodeURIComponent('{"topic_ids":["t-2"]}')}`)).toHaveLength(1),
    )
  })

  it('with too little material, the note offers the largest count and disables the button until it fits', async () => {
    const { state } = await openSetup({ capacity: 6 })

    const note = await screen.findByText(en.quiz.tooLittle_other.replace('{{count}}', 6))
    expect(note).toHaveAttribute('role', 'status')
    expect(make(10)).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: en.quiz.makeInstead.replace('{{count}}', 6) }))

    expect(screen.queryByText(en.quiz.tooLittle_other.replace('{{count}}', 6))).not.toBeInTheDocument()
    expect(make(6)).toBeEnabled()
    await userEvent.click(make(6))
    // The API takes 5, 10, or 20: the next one up; the server saves what the material supports.
    await waitFor(() => expect(state.quizRequests).toEqual([{ scope: { all_topics: true }, count: 10 }]))
  })

  it('a smaller count that fits clears the note', async () => {
    await openSetup({ capacity: 6 })
    await screen.findByText(en.quiz.tooLittle_other.replace('{{count}}', 6))

    await userEvent.click(screen.getByRole('radio', { name: '5' }))

    expect(screen.queryByText(en.quiz.tooLittle_other.replace('{{count}}', 6))).not.toBeInTheDocument()
    expect(make(5)).toBeEnabled()
  })

  it('maps an offered count to the next allowed count', () => {
    expect([1, 5, 6, 10, 14, 20].map(requestCount)).toEqual([5, 5, 10, 10, 20, 20])
  })

  it('shows the Progress steps in turn, polling every 2 s, then the Quiz ready panel', async () => {
    const { state } = await startQuiz()
    const steps = en.quiz.steps

    await waitFor(() => expect(stepStates()).toEqual([[steps.reading, 'now'], [steps.writing, 'pending'], [steps.checking, 'pending']]))
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')

    stepJob(state, 'q-1', 'writing')
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    expect(stepStates()).toEqual([[steps.reading, 'done'], [steps.writing, 'now'], [steps.checking, 'pending']])

    stepJob(state, 'q-1', 'checking')
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    expect(stepStates()).toEqual([[steps.reading, 'done'], [steps.writing, 'done'], [steps.checking, 'now']])

    finishQuiz(state, 'q-1', 10)
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    expect(await screen.findByRole('heading', { name: en.quiz.ready_other.replace('{{count}}', 10) })).toBeInTheDocument()
    expect(screen.queryByText(en.quiz.fewer_other.replace('{{count}}', 10))).not.toBeInTheDocument()
    expect(callsTo('/api/jobs/q-1/seen', 'POST')).toHaveLength(1)
  })

  it('keeps polling after a failed poll', async () => {
    let fail = true
    const { state } = await startQuiz({
      routes: {
        'GET /api/projects/a/jobs': async (_, current) => {
          if (fail) {
            fail = false
            throw { code: 'network_error', params: {} }
          }
          return current.jobs.filter((j) => j.project_id === 'a')
        },
      },
    })

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    stepJob(state, 'q-1', 'writing')
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))

    expect(stepStates()[1]).toEqual([en.quiz.steps.writing, 'now'])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says when fewer questions were possible than chosen', async () => {
    const { state } = await startQuiz()

    finishQuiz(state, 'q-1', 6)
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))

    expect(await screen.findByRole('heading', { name: en.quiz.ready_other.replace('{{count}}', 6) })).toBeInTheDocument()
    expect(screen.getByText(en.quiz.fewer_other.replace('{{count}}', 6))).toBeInTheDocument()
  })

  it('"← Back to chat" on the ready panel goes back to the Project', async () => {
    const { state, router } = await startQuiz()
    finishQuiz(state, 'q-1', 10)
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    const panel = (await screen.findByRole('heading', { name: en.quiz.ready_other.replace('{{count}}', 10) })).closest('section')

    fireEvent.click(within(panel).getByRole('button', { name: en.activity.back }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a'))
  })

  it('Cancel returns to setup with the choices kept and "Cancelled. Your choices are kept."', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { state } = await openSetup()
    fireEvent.click(screen.getByRole('radio', { name: '20' }))
    fireEvent.click(screen.getByRole('button', { name: 'Photosynthesis 2' }))
    await waitFor(() => expect(make(20)).toBeEnabled())
    fireEvent.click(make(20))
    await screen.findByText(en.quiz.steps.reading)

    fireEvent.click(screen.getByRole('button', { name: en.quiz.cancel }))

    expect(await screen.findByText(en.quiz.cancelled)).toBeInTheDocument()
    expect(state.cancelled).toEqual(['q-1'])
    expect(screen.getByRole('radio', { name: '20' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Photosynthesis 2' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText(en.quiz.steps.reading)).not.toBeInTheDocument()
    const polls = callsTo('/api/projects/a/jobs').length
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3))
    expect(callsTo('/api/projects/a/jobs')).toHaveLength(polls)
  })

  it('a failed job shows the Inline error with "Try again", which starts a new job from the same choices', async () => {
    const { state } = await startQuiz()

    failJob(state, 'q-1', 'llm_unavailable')
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(en.quiz.failed)
    expect(alert).toHaveTextContent(en.inlineError.reassurance)
    const retry = within(alert).getByRole('button', { name: en.inlineError.retry })
    await waitFor(() => expect(retry).toHaveFocus())
    expect(screen.getByRole('radio', { name: '10' })).toBeChecked()

    fireEvent.click(retry)

    await waitFor(() => expect(state.quizRequests).toHaveLength(2))
    expect(state.quizRequests[1]).toEqual(state.quizRequests[0])
    expect(await screen.findByText(en.quiz.steps.reading)).toBeInTheDocument()
  })

  it('a scope over the budget shows "That\'s a lot of material…" with no Try again', async () => {
    await openSetup({
      routes: {
        'POST /api/projects/a/quizzes': async () => {
          throw { code: 'scope_too_large', params: {} }
        },
      },
    })
    await waitFor(() => expect(make(10)).toBeEnabled())

    await userEvent.click(make(10))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(en.errors.scope_too_large)
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument()
  })

  it('a network failure on the request shows the Inline error with Try again', async () => {
    let calls = 0
    await openSetup({
      routes: {
        'POST /api/projects/a/quizzes': async () => {
          calls += 1
          throw { code: 'network_error', params: {} }
        },
      },
    })
    await waitFor(() => expect(make(10)).toBeEnabled())
    await userEvent.click(make(10))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(en.quiz.failed)
    await userEvent.click(within(alert).getByRole('button', { name: en.inlineError.retry }))
    expect(calls).toBe(2)
  })

  it('is read-only in an archived Project: the button stays disabled', async () => {
    await openSetup({ projects: [project('a', { archived_at: '2026-11-18T10:00:00Z' })] })

    expect(screen.getByRole('alert')).toHaveTextContent(en.errors.project_read_only)
    expect(make(10)).toBeDisabled()
  })

  it('with no Ready file the button stays disabled', async () => {
    await openSetup({ materials: { a: [material('m1', { status: 'processing' })] } })

    expect(make(10)).toBeDisabled()
    expect(callsTo(`/api/projects/a/capacity?scope=${encodeURIComponent('{"all_topics":true}')}`)).toHaveLength(0)
  })

  it('groups Topics like the Topic list, collapsed above 20', async () => {
    await openSetup({ materials: { a: [material('m1', { topics: topics(25, { groupSize: 10 }) })] } })

    const groups = within(screen.getByRole('group', { name: en.quiz.topics })).getAllByRole('button', { expanded: false })
    expect(groups).toHaveLength(3)
    expect(screen.queryByRole('button', { name: 'Topic 1' })).not.toBeInTheDocument()
    await userEvent.click(groups[0])
    expect(screen.getByRole('button', { name: 'Topic 1' })).toBeInTheDocument()
  })

  it('is in Norwegian too', async () => {
    await i18n.changeLanguage('nb')
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { state } = await openSetup({ lang: 'nb', capacity: 6 })

    expect(screen.getByRole('button', { name: nb.activity.back })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: nb.quiz.topics })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nb.quiz.allTopics })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: nb.quiz.count })).toBeInTheDocument()
    expect(await screen.findByText('Det er bare nok materiale til 6 spørsmål.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Lag 6 i stedet' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Lag 6 spørsmål' }))

    expect(await screen.findByText('Leser materialet ditt')).toBeInTheDocument()
    expect(screen.getByText('Skriver spørsmål')).toBeInTheDocument()
    expect(screen.getByText('Sjekker svarene')).toBeInTheDocument()
    finishQuiz(state, 'q-1', 6)
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    expect(await screen.findByRole('heading', { name: 'Quizen din er klar: 6 spørsmål.' })).toBeInTheDocument()
  })

  it('shows "Vi fikk ikke laget quizen." on a failure in Norwegian', async () => {
    await i18n.changeLanguage('nb')
    const { state } = await startQuiz({ lang: 'nb' })

    failJob(state, 'q-1')
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))

    expect(await screen.findByRole('alert')).toHaveTextContent('Vi fikk ikke laget quizen.')
  })

  it('a missing Project goes to /projects', async () => {
    fakeApi({ projects: [] })
    const { router } = renderRoute('/projects/zzz/quiz')

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'))
  })

  it('moves focus to the Progress steps, then to the ready panel heading', async () => {
    const { state } = await startQuiz()

    await waitFor(() => expect(screen.getByRole('status')).toHaveFocus())

    finishQuiz(state, 'q-1', 10)
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    const heading = await screen.findByRole('heading', { name: en.quiz.ready_other.replace('{{count}}', 10) })
    await waitFor(() => expect(heading).toHaveFocus())
  })

  it('after a cancel, focus returns to the setup heading', async () => {
    await startQuiz()
    await screen.findByText(en.quiz.steps.reading)

    fireEvent.click(screen.getByRole('button', { name: en.quiz.cancel }))

    await screen.findByText(en.quiz.cancelled)
    await waitFor(() => expect(screen.getByRole('heading', { name: en.quiz.title })).toHaveFocus())
  })

  it('a Cancel that finds the Quiz already saved shows the ready panel, not "Cancelled"', async () => {
    const { state } = await startQuiz()
    await screen.findByText(en.quiz.steps.reading)
    finishQuiz(state, 'q-1', 10)

    fireEvent.click(screen.getByRole('button', { name: en.quiz.cancel }))

    expect(await screen.findByRole('heading', { name: en.quiz.ready_other.replace('{{count}}', 10) })).toBeInTheDocument()
    expect(screen.queryByText(en.quiz.cancelled)).not.toBeInTheDocument()
  })

  it('a failed cancel request shows the Inline error and stays on the progress view', async () => {
    const { state } = await startQuiz({
      routes: {
        'POST /api/jobs/q-1/cancel': async () => {
          throw { code: 'network_error', params: {} }
        },
      },
    })
    await screen.findByText(en.quiz.steps.reading)

    fireEvent.click(screen.getByRole('button', { name: en.quiz.cancel }))

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByRole('button', { name: en.inlineError.retry })).toBeInTheDocument()
    expect(screen.getByText(en.quiz.steps.reading)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.quiz.cancel })).toBeEnabled()
    expect(screen.queryByText(en.quiz.cancelled)).not.toBeInTheDocument()
    expect(state.jobs[0].status).toBe('running')
  })

  it('reopening the page while a quiz job runs resumes its progress', async () => {
    fakeApi({
      projects: [project('a')],
      materials: READY,
      jobs: [{ id: 'q-9', project_id: 'a', kind: 'quiz', status: 'running', progress_step: 'writing', result_ref: null }],
    })
    renderRoute('/projects/a/quiz')

    await screen.findByText(en.quiz.steps.writing)
    expect(stepStates()).toEqual([
      [en.quiz.steps.reading, 'done'],
      [en.quiz.steps.writing, 'now'],
      [en.quiz.steps.checking, 'pending'],
    ])
    expect(screen.queryByRole('heading', { name: en.quiz.title })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.quiz.cancel })).toBeInTheDocument()
  })

  it.each(['insufficient_material', 'material_removed', 'scope_too_large'])(
    'a job that failed with %s shows its message with no Try again',
    async (code) => {
      const { state } = await startQuiz()

      failJob(state, 'q-1', code)
      await act(() => vi.advanceTimersByTimeAsync(POLL_MS))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(en.errors[code])
      expect(within(alert).queryByRole('button')).not.toBeInTheDocument()
    },
  )

  it('keeps the button disabled while the capacity is unknown', async () => {
    let answer
    await openSetup({
      routes: {
        [`GET /api/projects/a/capacity?scope=${encodeURIComponent('{"all_topics":true}')}`]: () =>
          new Promise((resolve) => (answer = resolve)),
      },
    })

    await waitFor(() => expect(answer).toBeTypeOf('function'))
    expect(make(10)).toBeDisabled()
    answer({ max_questions: 20 })
    await waitFor(() => expect(make(10)).toBeEnabled())
  })

  it('a failed capacity read shows the Inline error, and Try again reads it again', async () => {
    let failing = true
    await openSetup({
      capacity: () => {
        if (failing) throw { code: 'network_error', params: {} }
        return 20
      },
    })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(en.errors.generic)
    expect(make(10)).toBeDisabled()

    failing = false
    await userEvent.click(within(alert).getByRole('button', { name: en.inlineError.retry }))

    await waitFor(() => expect(make(10)).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a scope with no Ready material says so and keeps the button disabled', async () => {
    await openSetup({
      capacity: () => {
        throw { code: 'insufficient_material', params: {} }
      },
    })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(en.errors.insufficient_material)
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument()
    expect(make(10)).toBeDisabled()
  })
})
