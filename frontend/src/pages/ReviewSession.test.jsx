// A Mistake Review session (Story 3.5, FR-18, AD-9, AD-10, AD-11). api/client.js and auth/ are mocked
// (spine › Tests); test/fakeApi.js plays the backend: a practice answer is scored and saved once, and a
// correct one clears its Mistake.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { fakeApi, finishReview, material, mistake, project, reviewRound } from '../test/fakeApi.js'
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
const ANSWER = (n) => `/api/projects/a/review-rounds/r1/items/r1-p${n}/answer`

/** Open round `r1` of Project `a`, made from `n` Mistakes (`mistakeOverrides[i]` for the i-th). */
async function openRound({ n = 3, roundOptions = {}, mistakeOverrides = [], projectOverrides = {}, routes = {}, me } = {}) {
  const made = Array.from({ length: n }, (_, i) => mistake('a', ['notes'], mistakeOverrides[i] ?? {}))
  const state = fakeApi({
    ...(me ? { me } : {}),
    projects: [project('a', { name: 'Biology', ...projectOverrides })],
    materials: READY,
    mistakes: made,
    rounds: [reviewRound('r1', 'a', made, roundOptions)],
    routes,
  })
  const view = renderRoute('/projects/a/review/r1')
  return { state, made, ...view }
}

const option = (text) => screen.getByRole('button', { name: new RegExp(text) })
const feedback = () => screen.getByRole('status')
const context = () => screen.getByTestId('review-context')
const progressbar = () => screen.getByRole('progressbar')

describe('Mistake Review session', () => {
  it('opens at the first item with the context card, "0 of 3 cleared", and no feedback', async () => {
    const { made } = await openRound()

    expect(await screen.findByRole('heading', { name: 'Practice 1?' })).toBeInTheDocument()
    expect(context()).toHaveTextContent(made[0].question)
    expect(context()).toHaveTextContent(`${en.review.earlierAnswer} ${made[0].earlier}`)
    // The original's correct answer stays hidden until answered.
    expect(context()).not.toHaveTextContent(made[0].correct)
    expect(context()).not.toHaveTextContent(en.review.fileRemoved)
    expect(progressbar()).toHaveAccessibleName('0 of 3 cleared')
    expect(progressbar()).toHaveAttribute('aria-valuenow', '0')
    expect(feedback()).toBeEmptyDOMElement()
    expect(screen.getByRole('button', { name: en.review.stop })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: new RegExp(en.review.next) })).not.toBeInTheDocument()
  })

  it('a right answer by key clears it once saved, then "Next mistake" (→) moves on', async () => {
    const { state, made } = await openRound()
    await screen.findByRole('heading', { name: 'Practice 1?' })

    await userEvent.keyboard('2')

    await within(feedback()).findByRole('heading', { name: en.quiz.correct })
    expect(feedback()).toHaveTextContent('Since 1.')
    expect(within(feedback()).getByText('notes.pdf · Page 1')).toBeInTheDocument()
    expect(progressbar()).toHaveAccessibleName('1 of 3 cleared')
    expect(context()).toHaveTextContent(`${en.quiz.correctAnswer} ${made[0].correct}`)
    expect(option('Choice 1B')).toHaveTextContent(en.quiz.correctAnswer)
    expect(state.mistakes[0].cleared).toBe(true)
    const next = screen.getByRole('button', { name: new RegExp(en.review.next) })
    await waitFor(() => expect(next).toHaveFocus())

    await userEvent.keyboard('{ArrowRight}')

    expect(await screen.findByRole('heading', { name: 'Practice 2?' })).toBeInTheDocument()
    await waitFor(() => expect(option('Choice 2A')).toHaveFocus())
    expect(context()).toHaveTextContent(made[1].question)
  })

  it('a wrong answer keeps the Mistake: "Not quite", "It stays in your review.", still "0 of 3 cleared"', async () => {
    const { state } = await openRound()
    await screen.findByRole('heading', { name: 'Practice 1?' })

    fireEvent.click(option('Choice 1C'))

    await within(feedback()).findByRole('heading', { name: en.quiz.notQuite })
    expect(feedback()).toHaveTextContent(en.quiz.staysInReview)
    expect(option('Choice 1C')).toHaveTextContent(en.quiz.yourAnswer)
    expect(progressbar()).toHaveAccessibleName('0 of 3 cleared')
    expect(progressbar()).toHaveAttribute('aria-valuenow', '1')
    expect(state.mistakes.filter((m) => !m.cleared)).toHaveLength(3)
    expect(state.mistakes).toHaveLength(3)
  })

  it('a failed save shows the Inline error with "Try again"; the Mistake stays counted until saved', async () => {
    const { state } = await openRound({
      routes: {
        [`POST ${ANSWER(1)}`]: async () => {
          throw { code: 'http_error', params: {} }
        },
      },
    })
    await screen.findByRole('heading', { name: 'Practice 1?' })

    fireEvent.click(option('Choice 1B'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(en.errors.generic)
    await waitFor(() => expect(within(alert).getByRole('button', { name: en.inlineError.retry })).toHaveFocus())
    expect(progressbar()).toHaveAccessibleName('0 of 3 cleared')
    expect(state.mistakes[0].cleared).toBe(false)
    expect(feedback()).toBeEmptyDOMElement()
  })

  it('"Stop for now" returns to the chat with "Your progress is saved." and no panel', async () => {
    const { router } = await openRound()
    await screen.findByRole('heading', { name: 'Practice 1?' })
    fireEvent.click(option('Choice 1B'))
    await within(feedback()).findByRole('heading', { name: en.quiz.correct })

    fireEvent.click(screen.getByRole('button', { name: en.review.stop }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a'))
    expect(await screen.findByText(en.review.saved)).toBeInTheDocument()
    expect(await screen.findByTestId('mistakes-card')).toHaveTextContent('2 mistakes to review')
    // The router state is cleared at once, so a reload or Back doesn't show the line again; it stays now.
    await waitFor(() => expect(router.state.location.state).toBeNull())
    expect(router.state.historyAction).toBe('REPLACE')
    expect(screen.getByText(en.review.saved)).toBeInTheDocument()
    expect(screen.queryByText(en.review.allCleared)).not.toBeInTheDocument()
  })

  it('"← Back to chat" also says "Your progress is saved."', async () => {
    const { router } = await openRound()
    await screen.findByRole('heading', { name: 'Practice 1?' })

    fireEvent.click(screen.getByRole('button', { name: en.activity.back }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a'))
    expect(await screen.findByText(en.review.saved)).toBeInTheDocument()
  })

  it('says "The file this came from was removed." on a Mistake whose file was removed', async () => {
    await openRound({ n: 2, mistakeOverrides: [{ file_removed: true }] })
    await screen.findByRole('heading', { name: 'Practice 1?' })

    expect(context()).toHaveTextContent(en.review.fileRemoved)
  })

  it('reopening part-way starts at the first unanswered item', async () => {
    const made = [mistake('a', ['notes'], { cleared: true }), mistake('a'), mistake('a')]
    fakeApi({
      projects: [project('a', { name: 'Biology' })],
      materials: READY,
      mistakes: made,
      rounds: [reviewRound('r1', 'a', made, { answered: { 0: 'b' } })],
    })
    renderRoute('/projects/a/review/r1')

    expect(await screen.findByRole('heading', { name: 'Practice 2?' })).toBeInTheDocument()
    expect(progressbar()).toHaveAccessibleName('1 of 3 cleared')
    expect(progressbar()).toHaveAttribute('aria-valuenow', '1')
  })

  it('Round done: with Mistakes left, "Review mistakes" starts a new round with a new practice question', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { state, made, router } = await openRound({ n: 2 })
    await screen.findByRole('heading', { name: 'Practice 1?' })
    fireEvent.click(option('Choice 1B'))
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(en.review.next) }))
    await screen.findByRole('heading', { name: 'Practice 2?' })

    fireEvent.click(option('Choice 2D'))

    const panel = await screen.findByTestId('review-panel')
    const headline = within(panel).getByRole('heading', { name: 'Round done. 1 mistake still to review.' })
    await waitFor(() => expect(headline).toHaveFocus())
    expect(screen.queryByText(en.review.allCleared)).not.toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: en.activity.back })).toBeInTheDocument()
    // The last answer's feedback stays in view above the panel.
    expect(within(feedback()).getByRole('heading', { name: en.quiz.notQuite })).toBeInTheDocument()

    fireEvent.click(within(panel).getByRole('button', { name: en.review.again }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a/review'))
    await waitFor(() => expect(state.reviewRequests).toBe(1))
    finishReview(state, 'rv-1')
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a/review/round-1'))
    expect(await screen.findByRole('heading', { name: 'Practice 1?' })).toBeInTheDocument()
    // One item, for the Mistake still outstanding, and not the answered practice question.
    expect(state.rounds['round-1'].items.map((i) => [i.id, i.mistake_id])).toEqual([['round-1-p1', made[1].id]])
    expect(progressbar()).toHaveAccessibleName('0 of 1 cleared')
    expect(context()).toHaveTextContent(made[1].question)
  })

  it('All cleared: from Start, two right answers end on "All cleared! Nice work." and the card is gone', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const state = fakeApi({
      projects: [project('a', { name: 'Biology' })],
      materials: READY,
      mistakes: [mistake('a'), mistake('a')],
    })
    const { router } = renderRoute('/projects/a')
    fireEvent.click(
      await within(await screen.findByTestId('mistakes-card')).findByRole('button', { name: en.mistakes.start }),
    )
    await waitFor(() => expect(state.reviewRequests).toBe(1))
    finishReview(state, 'rv-1')
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    await screen.findByRole('heading', { name: 'Practice 1?' })

    await userEvent.keyboard('2')
    await within(feedback()).findByRole('heading', { name: en.quiz.correct })
    await userEvent.keyboard('{ArrowRight}')
    await screen.findByRole('heading', { name: 'Practice 2?' })
    await userEvent.keyboard('2')

    const panel = await screen.findByTestId('review-panel')
    expect(within(panel).getByRole('heading', { name: en.review.allCleared })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: en.review.newQuiz })).toBeInTheDocument()
    expect(screen.queryByText(/Round done/)).not.toBeInTheDocument()
    expect(progressbar()).toHaveAccessibleName('2 of 2 cleared')

    fireEvent.click(within(panel).getByRole('button', { name: en.activity.back }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a'))
    await screen.findByRole('button', { name: en.tools.quiz })
    await waitFor(() => expect(screen.queryByTestId('mistakes-card')).not.toBeInTheDocument())
  })

  it('"Make a new quiz" on the All cleared panel opens Quiz setup', async () => {
    const { router } = await openRound({ n: 1 })
    await screen.findByRole('heading', { name: 'Practice 1?' })
    fireEvent.click(option('Choice 1B'))

    fireEvent.click(await screen.findByRole('button', { name: en.review.newQuiz }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a/quiz'))
  })

  it('a read-only Project opens the round with its options disabled', async () => {
    const { state } = await openRound({ projectOverrides: { archived_at: '2026-11-18T10:00:00Z' } })
    await screen.findByRole('heading', { name: 'Practice 1?' })

    expect(screen.getByRole('alert')).toHaveTextContent(en.errors.project_read_only)
    expect(option('Choice 1A')).toBeDisabled()
    await userEvent.keyboard('2')
    expect(state.practiceAnswers).toEqual([])
  })

  it('a save refused as read-only turns the page read-only without "Try again"', async () => {
    await openRound({
      routes: {
        [`POST ${ANSWER(1)}`]: async () => {
          throw { code: 'project_read_only', params: {} }
        },
      },
    })
    await screen.findByRole('heading', { name: 'Practice 1?' })

    fireEvent.click(option('Choice 1B'))

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.project_read_only)
    expect(screen.queryByRole('button', { name: en.inlineError.retry })).not.toBeInTheDocument()
    expect(option('Choice 1A')).toBeDisabled()
  })

  it('a missing round says so without "Try again"', async () => {
    fakeApi({ projects: [project('a', { name: 'Biology' })], materials: READY })
    renderRoute('/projects/a/review/nope')

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.not_found)
    expect(screen.queryByRole('button', { name: en.inlineError.retry })).not.toBeInTheDocument()
  })

  it('reads in Norwegian, including the Round done panel', async () => {
    await i18n.changeLanguage('nb')
    await openRound({ n: 2 })
    await screen.findByRole('heading', { name: 'Practice 1?' })

    expect(progressbar()).toHaveAccessibleName('0 av 2 repetert')
    expect(context()).toHaveTextContent(nb.review.earlierAnswer)
    expect(screen.getByRole('button', { name: nb.review.stop })).toBeInTheDocument()

    fireEvent.click(option('Choice 1B'))
    expect(await screen.findByRole('button', { name: new RegExp(nb.review.next) })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(nb.review.next) }))
    await screen.findByRole('heading', { name: 'Practice 2?' })
    fireEvent.click(option('Choice 2A'))

    const panel = await screen.findByTestId('review-panel')
    expect(within(panel).getByRole('heading', { name: 'Runden er ferdig. 1 feil igjen å repetere.' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: nb.review.again })).toBeInTheDocument()
  })

  it('a round still being made sends the student to its progress view', async () => {
    fakeApi({
      projects: [project('a', { name: 'Biology' })],
      materials: READY,
      mistakes: [mistake('a')],
      jobs: [{ id: 'rv-9', project_id: 'a', kind: 'review_round', status: 'running', progress_step: 'writing',
               result_ref: null, round_id: 'r9' }],
      rounds: [{ id: 'r9', project_id: 'a', job_id: 'rv-9', items: [] }],
    })
    const { router } = renderRoute('/projects/a/review/r9')

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a/review'))
    expect(await screen.findByText(`Step 2 of 2 · ${en.review.steps.writing}`)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a failed round shows its message without "Try again"', async () => {
    fakeApi({
      projects: [project('a', { name: 'Biology' })],
      materials: READY,
      jobs: [{ id: 'rv-9', project_id: 'a', kind: 'review_round', status: 'failed', error_code: 'llm_unavailable',
               result_ref: null }],
      rounds: [{ id: 'r9', project_id: 'a', job_id: 'rv-9', items: [] }],
    })
    renderRoute('/projects/a/review/r9')

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.llm_unavailable)
    expect(screen.queryByRole('button', { name: en.inlineError.retry })).not.toBeInTheDocument()
  })

  it('a finished round with no items says not found', async () => {
    fakeApi({
      projects: [project('a', { name: 'Biology' })],
      materials: READY,
      rounds: [{ id: 'r9', project_id: 'a', items: [] }],
    })
    renderRoute('/projects/a/review/r9')

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.not_found)
    expect(screen.queryByRole('button', { name: en.inlineError.retry })).not.toBeInTheDocument()
  })

  it('ends on All cleared when nothing is outstanding any more, even with no clears', async () => {
    const { state } = await openRound({ n: 1 })
    await screen.findByRole('heading', { name: 'Practice 1?' })
    // Withdrawn elsewhere (its file removed with the opt-out) while the round was open.
    state.mistakes[0].withdrawn = true

    fireEvent.click(option('Choice 1C'))

    const panel = await screen.findByTestId('review-panel')
    expect(within(panel).getByRole('heading', { name: en.review.allCleared })).toBeInTheDocument()
    expect(screen.queryByText(/Round done/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.review.again })).not.toBeInTheDocument()
  })

  it('an original question served again shows "Your earlier answer" only once answered', async () => {
    const { made } = await openRound({ n: 2, mistakeOverrides: [{ from_original: true }] })
    await screen.findByRole('heading', { name: 'Practice 1?' })

    expect(context()).toHaveTextContent(made[0].question)
    expect(context()).not.toHaveTextContent(en.review.earlierAnswer)
    expect(context()).not.toHaveTextContent(made[0].earlier)

    fireEvent.click(option('Choice 1B'))

    await within(feedback()).findByRole('heading', { name: en.quiz.correct })
    expect(context()).toHaveTextContent(`${en.review.earlierAnswer} ${made[0].earlier}`)
  })
})
