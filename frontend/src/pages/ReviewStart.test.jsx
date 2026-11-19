// Starting a Mistake Review round (Story 3.4, FR-17, FR-18, FR-26, AD-11). api/client.js and auth/ are
// mocked (spine › Tests); test/fakeApi.js plays the backend, and stepJob / finishReview / failJob move the
// `review_round` job on.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { callsTo, failJob, fakeApi, finishReview, material, mistake, project, stepJob } from '../test/fakeApi.js'
import { i18n, renderRoute } from '../test/render.jsx'
import { POLL_MS } from './ReviewStart.jsx'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

beforeEach(() => {
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
})

afterEach(() => {
  vi.useRealTimers()
})

const READY = { a: [material('notes', { file_name: 'notes.pdf' })] }
const card = () => screen.queryByTestId('mistakes-card')
// The Progress steps' step line, "Step {n} of 2 · {label}" (the polite live region).
const STEP = (n, key, lang = en) =>
  i18n.getFixedT(lang === en ? 'en' : 'nb')('progress.step', { n, total: 2, label: lang.review.steps[key] })

function setup({ mistakes = 2, projectOverrides = {}, ...options } = {}) {
  return fakeApi({
    projects: [project('a', { name: 'Biology', ...projectOverrides })],
    materials: READY,
    mistakes: Array.from({ length: mistakes }, () => mistake('a')),
    ...options,
  })
}

/** Open the chat and press "Start" on the Mistakes card; the round is requested. */
async function startFromCard(state) {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const view = renderRoute('/projects/a')
  const start = await within(await screen.findByTestId('mistakes-card')).findByRole('button', { name: en.mistakes.start })
  fireEvent.click(start)
  await waitFor(() => expect(state.reviewRequests).toBe(1))
  return view
}

const poll = () => act(() => vi.advanceTimersByTimeAsync(POLL_MS))

describe('Mistake Review start', () => {
  it('"Start" opens the start page, which asks for a round and follows its steps to the session', async () => {
    const state = setup()
    const { router } = await startFromCard(state)

    expect(router.state.location.pathname).toBe('/projects/a/review')
    expect(await screen.findByText(STEP(1, 'reading'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.progress.cancel })).toBeEnabled()

    stepJob(state, 'rv-1', 'writing')
    await poll()
    expect(await screen.findByText(STEP(2, 'writing'))).toBeInTheDocument()

    finishReview(state, 'rv-1')
    await poll()
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a/review/round-1'))
    expect(await screen.findByRole('heading', { name: 'Practice 1?' })).toBeInTheDocument()
    // The start page was replaced, and the job marked seen (no notice later).
    expect(router.state.historyAction).toBe('REPLACE')
    expect(callsTo('/api/jobs/rv-1/seen', 'POST')).toHaveLength(1)
  })

  it('never starts on its own: opening the chat requests nothing', async () => {
    const state = setup()
    renderRoute('/projects/a')

    expect(await screen.findByTestId('mistakes-card')).toBeInTheDocument()
    expect(state.reviewRequests).toBe(0)
  })

  it('has no "Start" in a read-only Project', async () => {
    setup({ projectOverrides: { archived_at: '2026-11-18T10:00:00Z' } })
    renderRoute('/projects/a')

    await screen.findByText('notes.pdf')
    expect(card()).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.mistakes.start })).not.toBeInTheDocument()
  })

  it('Cancel stops the round and returns to the chat, with the count unchanged', async () => {
    const state = setup()
    const { router } = await startFromCard(state)
    await screen.findByText(STEP(1, 'reading'))

    fireEvent.click(screen.getByRole('button', { name: en.progress.cancel }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a'))
    expect(state.cancelled).toEqual(['rv-1'])
    expect(await screen.findByTestId('mistakes-card')).toHaveTextContent('2 mistakes to review')
  })

  it('a failed round shows the Inline error with "Try again", which asks for a new round', async () => {
    const state = setup()
    await startFromCard(state)
    await screen.findByText(STEP(1, 'reading'))

    failJob(state, 'rv-1', 'llm_unavailable')
    await poll()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(en.errors.generic)
    expect(alert).toHaveTextContent(en.inlineError.reassurance)
    const retry = within(alert).getByRole('button', { name: en.inlineError.retry })
    await waitFor(() => expect(retry).toHaveFocus())

    fireEvent.click(retry)

    await waitFor(() => expect(state.reviewRequests).toBe(2))
    expect(await screen.findByText(STEP(1, 'reading'))).toBeInTheDocument()
    expect(state.mistakes.filter((m) => !m.cleared)).toHaveLength(2)
  })

  it('a round that failed for a rule shows its message without "Try again"', async () => {
    const state = setup()
    await startFromCard(state)
    await screen.findByText(STEP(1, 'reading'))

    failJob(state, 'rv-1', 'insufficient_material')
    await poll()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(en.errors.insufficient_material)
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument()
  })

  it('a refused request that names a rule shows only its message', async () => {
    setup({ mistakes: 0 })
    renderRoute('/projects/a/review')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(en.errors.insufficient_material)
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument()
  })

  it('follows a round that is already being made instead of starting another', async () => {
    const state = setup({
      jobs: [{ id: 'rv-old', project_id: 'a', kind: 'review_round', status: 'running', progress_step: 'writing',
               result_ref: null, round_id: 'round-old' }],
    })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { router } = renderRoute('/projects/a/review')

    expect(await screen.findByText(STEP(2, 'writing'))).toBeInTheDocument()
    expect(callsTo('/api/projects/a/review-rounds', 'POST')).toHaveLength(0)

    finishReview(state, 'rv-old')
    await poll()
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a/review/round-old'))
  })

  it('a second start answered "review_in_progress" follows the running round', async () => {
    const running = { id: 'rv-other', project_id: 'a', kind: 'review_round', status: 'running',
                      progress_step: 'reading', result_ref: null, round_id: 'round-other' }
    let listed = 0
    setup({
      routes: {
        // The first read misses the round (it is made in between); the start then says it is running.
        'GET /api/projects/a/jobs': async () => (listed++ === 0 ? [] : [running]),
        'POST /api/projects/a/review-rounds': async () => {
          throw { code: 'review_in_progress', params: {} }
        },
      },
    })
    renderRoute('/projects/a/review')

    expect(await screen.findByText(STEP(1, 'reading'))).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('leaving while it is made shows "Your practice questions are ready · Open" in the chat', async () => {
    const state = setup()
    const { router } = await startFromCard(state)
    await screen.findByText(STEP(1, 'reading'))

    fireEvent.click(screen.getByRole('button', { name: en.activity.back }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a'))
    finishReview(state, 'rv-1')
    await poll()

    const notices = screen.getByTestId('ready-notices')
    await waitFor(() => expect(notices).toHaveTextContent('Your practice questions are ready · Open'))
    fireEvent.click(within(notices).getByRole('button', { name: 'Open' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a/review/round-1'))
    expect(callsTo('/api/jobs/rv-1/seen', 'POST')).toHaveLength(1)
    expect(await screen.findByRole('heading', { name: 'Practice 1?' })).toBeInTheDocument()
  })

  it('a cancelled or failed round shows no notice', async () => {
    setup({
      jobs: [
        { id: 'rv-1', project_id: 'a', kind: 'review_round', status: 'cancelled', result_ref: null },
        { id: 'rv-2', project_id: 'a', kind: 'review_round', status: 'failed', result_ref: null },
      ],
    })
    renderRoute('/projects/a')

    await screen.findByTestId('mistakes-card')
    await waitFor(() => expect(callsTo('/api/projects/a/jobs').length).toBeGreaterThan(0))
    expect(screen.getByTestId('ready-notices')).toBeEmptyDOMElement()
  })

  it('reads in Norwegian', async () => {
    await i18n.changeLanguage('nb')
    const state = setup({ me: { first_name: 'Emma', language: 'nb', email_verified: false, ui_prefs: {},
                                last_project_id: null, privacy_notice_accepted: true } })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderRoute('/projects/a')
    const start = await within(await screen.findByTestId('mistakes-card')).findByRole('button', { name: nb.mistakes.start })
    fireEvent.click(start)

    expect(await screen.findByText(STEP(1, 'reading', nb))).toBeInTheDocument()
    stepJob(state, 'rv-1', 'writing')
    await poll()
    expect(await screen.findByText(STEP(2, 'writing', nb))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nb.activity.back })).toBeInTheDocument()
  })
})
