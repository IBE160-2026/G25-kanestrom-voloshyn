// Taking a Quiz (Story 3.2, FR-11, AD-9). api/client.js and auth/ are mocked (spine › Tests);
// test/fakeApi.js plays the backend, scoring and saving each answer once like the server.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client.js'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import { callsTo, fakeApi, project, quiz } from '../test/fakeApi.js'
import { i18n, renderRoute } from '../test/render.jsx'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

beforeEach(() => {
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
})

afterEach(() => {
  vi.useRealTimers()
})

const ANSWER = (n) => `/api/projects/a/quizzes/z/questions/z-q${n}/answer`

/** Open Quiz `z` of Project `a`; `quizOptions` go to `quiz()`, `projectOverrides` to the Project. */
async function openQuiz({ quizOptions = {}, projectOverrides = {}, routes = {} } = {}) {
  const state = fakeApi({
    projects: [project('a', { name: 'Biology', ...projectOverrides })],
    quizzes: [quiz('z', 'a', quizOptions)],
    routes,
  })
  const view = renderRoute('/projects/a/quizzes/z')
  return { state, ...view }
}

const option = (text) => screen.getByRole('button', { name: new RegExp(text) })
const feedback = () => screen.getByRole('status')

describe('Quiz page', () => {
  it('opens a fresh Quiz at question 1 with a progress bar, four options, and no feedback', async () => {
    await openQuiz()

    expect(await screen.findByRole('heading', { name: 'Question 1?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.activity.back })).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '1 of 3' })).toHaveAttribute('aria-valuenow', '0')
    const options = screen.getAllByRole('button', { name: /Option 1/ })
    expect(options.map((b) => b.textContent)).toEqual(['1Option 1A', '2Option 1B', '3Option 1C', '4Option 1D'])
    options.forEach((b) => expect(b).toBeEnabled())
    expect(feedback()).toHaveAttribute('aria-live', 'polite')
    expect(feedback()).toBeEmptyDOMElement()
    expect(screen.queryByRole('button', { name: new RegExp(en.quiz.next) })).not.toBeInTheDocument()
    expect(screen.getByTestId('key-hints')).toHaveTextContent(`1–4 ${en.quiz.keys.answer}`)
  })

  it('the progress bar fills with answers, and the hints switch to "→ next" once answered', async () => {
    await openQuiz()
    await screen.findByRole('heading', { name: 'Question 1?' })

    fireEvent.click(option('Option 1B'))

    await within(feedback()).findByRole('heading', { name: en.quiz.correct })
    expect(screen.getByRole('progressbar', { name: '1 of 3' })).toHaveAttribute('aria-valuenow', '1')
    expect(screen.getByTestId('key-hints')).toHaveTextContent(`→ ${en.quiz.keys.next}`)
    expect(screen.getByTestId('key-hints')).not.toHaveTextContent(en.quiz.keys.answer)
  })

  it('an ignored key is not claimed', async () => {
    await openQuiz({ projectOverrides: { archived_at: '2026-11-18T10:00:00Z' } })
    await screen.findByRole('heading', { name: 'Question 1?' })

    const event = new KeyboardEvent('keydown', { key: '1', bubbles: true, cancelable: true })
    document.body.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
  })

  it('a read-only Project moves on without answers and ends on the summary, unanswered counting as missed', async () => {
    const { state } = await openQuiz({
      quizOptions: { n: 2, answered: { 0: 'b' } },
      projectOverrides: { deleted_at: '2026-11-18T10:00:00Z' },
    })
    // The answered first question is passed; the second, unanswered, opens with options disabled.
    expect(await screen.findByRole('heading', { name: 'Question 2?' })).toBeInTheDocument()
    expect(option('Option 2A')).toBeDisabled()

    await userEvent.keyboard('{ArrowRight}')

    const score = await screen.findByRole('heading', { name: '1 of 2 correct' })
    const missed = within(score.closest('section')).getAllByRole('listitem')
    expect(missed).toHaveLength(1)
    expect(missed[0]).toHaveTextContent('2. Question 2?')
    expect(missed[0]).not.toHaveTextContent(en.quiz.yourAnswer)
    expect(state.answers).toEqual([])
  })

  it('"See results" works without an answer in a read-only Project', async () => {
    await openQuiz({ quizOptions: { n: 1 }, projectOverrides: { archived_at: '2026-11-18T10:00:00Z' } })
    await screen.findByRole('heading', { name: 'Question 1?' })

    fireEvent.click(screen.getByRole('button', { name: new RegExp(en.quiz.seeResults) }))

    expect(await screen.findByRole('heading', { name: '0 of 1 correct' })).toBeInTheDocument()
  })

  it('a save refused as read-only shows no "Try again" and turns the page read-only', async () => {
    await openQuiz({
      routes: {
        [`POST ${ANSWER(1)}`]: async () => {
          throw { code: 'project_read_only', params: {} }
        },
      },
    })
    await screen.findByRole('heading', { name: 'Question 1?' })

    fireEvent.click(option('Option 1C'))

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.project_read_only)
    expect(screen.queryByRole('button', { name: en.inlineError.retry })).not.toBeInTheDocument()
    for (const name of ['Option 1A', 'Option 1B', 'Option 1C', 'Option 1D']) expect(option(name)).toBeDisabled()
    expect(screen.getByRole('button', { name: new RegExp(en.quiz.next) })).toBeInTheDocument()
  })

  it('a save refused as not found shows the message without "Try again"', async () => {
    await openQuiz({
      routes: {
        [`POST ${ANSWER(1)}`]: async () => {
          throw { code: 'not_found', params: {} }
        },
      },
    })
    await screen.findByRole('heading', { name: 'Question 1?' })

    fireEvent.click(option('Option 1C'))

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.not_found)
    expect(screen.queryByRole('button', { name: en.inlineError.retry })).not.toBeInTheDocument()
  })

  it('a failed load offers "Try again", which loads the Quiz', async () => {
    let fail = true
    fakeApi({ projects: [project('a')], quizzes: [quiz('z', 'a')] })
    const real = vi.mocked(apiFetch).getMockImplementation()
    vi.mocked(apiFetch).mockImplementation(async (path, options) => {
      if (path === '/api/projects/a/quizzes/z' && fail) {
        fail = false
        throw { code: 'network_error', params: {} }
      }
      return real(path, options)
    })
    renderRoute('/projects/a/quizzes/z')

    const alert = await screen.findByRole('alert')
    fireEvent.click(within(alert).getByRole('button', { name: en.inlineError.retry }))

    expect(await screen.findByRole('heading', { name: 'Question 1?' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a Quiz with no questions shows the not-found Inline error, not a summary', async () => {
    fakeApi({ projects: [project('a')], quizzes: [quiz('z', 'a', { n: 0 })] })
    renderRoute('/projects/a/quizzes/z')

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.not_found)
    expect(screen.queryByRole('button', { name: en.inlineError.retry })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '0 of 0 correct' })).not.toBeInTheDocument()
  })

  it('a right answer shows "Correct", the explanation, and its source label', async () => {
    const { state } = await openQuiz()
    await screen.findByRole('heading', { name: 'Question 1?' })

    fireEvent.click(option('Option 1B'))

    expect(await within(feedback()).findByRole('heading', { name: en.quiz.correct })).toBeInTheDocument()
    expect(within(feedback()).getByText('Because 1.')).toBeInTheDocument()
    expect(within(feedback()).getByText('notes.pdf · Page 1')).toBeInTheDocument()
    expect(within(feedback()).queryByText(en.quiz.staysInReview)).not.toBeInTheDocument()
    expect(option('Option 1B')).toHaveAttribute('data-state', 'correct')
    expect(option('Option 1B')).toHaveTextContent(en.quiz.correctAnswer)
    expect(option('Option 1A')).toHaveAttribute('data-state', 'dim')
    expect(state.answers).toEqual([{ question_id: 'z-q1', option_id: 'b' }])
    await waitFor(() => expect(screen.getByRole('button', { name: new RegExp(en.quiz.next) })).toHaveFocus())
  })

  it('a wrong answer shows "Not quite" and "It stays in your review.", with both answers marked', async () => {
    await openQuiz()
    await screen.findByRole('heading', { name: 'Question 1?' })

    fireEvent.click(option('Option 1C'))

    expect(await within(feedback()).findByRole('heading', { name: en.quiz.notQuite })).toBeInTheDocument()
    expect(within(feedback()).getByText(en.quiz.staysInReview)).toBeInTheDocument()
    expect(within(feedback()).getByText('Because 1.')).toBeInTheDocument()
    expect(within(feedback()).getByText('notes.pdf · Page 1')).toBeInTheDocument()
    expect(option('Option 1C')).toHaveAttribute('data-state', 'mistake')
    expect(option('Option 1C')).toHaveTextContent(en.quiz.yourAnswer)
    expect(option('Option 1B')).toHaveAttribute('data-state', 'correct')
    expect(option('Option 1B')).toHaveTextContent(en.quiz.correctAnswer)
    expect(option('Option 1A')).toHaveAttribute('data-state', 'dim')
    expect(option('Option 1D')).toHaveAttribute('data-state', 'dim')
    for (const name of ['Option 1A', 'Option 1B', 'Option 1C', 'Option 1D']) expect(option(name)).toBeDisabled()
  })

  it('keyboard only: 2 answers, → shows the next question with focus on its first option', async () => {
    const { state } = await openQuiz()
    await screen.findByRole('heading', { name: 'Question 1?' })

    await userEvent.keyboard('2')
    await within(feedback()).findByRole('heading', { name: en.quiz.correct })
    expect(state.answers).toEqual([{ question_id: 'z-q1', option_id: 'b' }])

    await userEvent.keyboard('{ArrowRight}')

    expect(await screen.findByRole('heading', { name: 'Question 2?' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '2 of 3' })).toBeInTheDocument()
    await waitFor(() => expect(option('Option 2A')).toHaveFocus())
    expect(feedback()).toBeEmptyDOMElement()
  })

  it('keys 1–4 answer each option in order, and → does nothing before an answer', async () => {
    const { state } = await openQuiz({ quizOptions: { n: 4 } })
    await screen.findByRole('heading', { name: 'Question 1?' })

    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('heading', { name: 'Question 1?' })).toBeInTheDocument()

    for (const [key, n] of [['1', 1], ['2', 2], ['3', 3], ['4', 4]]) {
      await screen.findByRole('heading', { name: `Question ${n}?` })
      await userEvent.keyboard(key)
      await within(feedback()).findByRole('heading')
      await userEvent.keyboard('{ArrowRight}')
    }
    expect(state.answers.map((a) => a.option_id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('ignores the keys while typing in a text input', async () => {
    const { state } = await openQuiz()
    await screen.findByRole('heading', { name: 'Question 1?' })
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    await userEvent.keyboard('2')

    expect(state.answers).toEqual([])
    expect(feedback()).toBeEmptyDOMElement()
    input.remove()
  })

  it('never advances on its own', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await openQuiz()
    await screen.findByRole('heading', { name: 'Question 1?' })
    fireEvent.click(option('Option 1A'))
    await within(feedback()).findByRole('heading', { name: en.quiz.notQuite })

    await act(() => vi.advanceTimersByTimeAsync(60_000))

    expect(screen.getByRole('heading', { name: 'Question 1?' })).toBeInTheDocument()
  })

  it('a second click while saving sends one answer', async () => {
    const { state } = await openQuiz()
    await screen.findByRole('heading', { name: 'Question 1?' })

    fireEvent.click(option('Option 1A'))
    fireEvent.click(option('Option 1B'))

    await within(feedback()).findByRole('heading', { name: en.quiz.notQuite })
    expect(state.answers).toEqual([{ question_id: 'z-q1', option_id: 'a' }])
  })

  it('"See results" on the last question shows the score and each missed question with both answers', async () => {
    const { router } = await openQuiz({ quizOptions: { n: 3, answered: { 0: 'b' } } })
    await screen.findByRole('heading', { name: 'Question 2?' })
    fireEvent.click(option('Option 2D'))
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(en.quiz.next) }))
    await screen.findByRole('heading', { name: 'Question 3?' })
    fireEvent.click(option('Option 3A'))

    const results = await screen.findByRole('button', { name: new RegExp(en.quiz.seeResults) })
    expect(screen.queryByRole('button', { name: new RegExp(en.quiz.next) })).not.toBeInTheDocument()
    fireEvent.click(results)

    const score = await screen.findByRole('heading', { name: '1 of 3 correct' })
    await waitFor(() => expect(score).toHaveFocus())
    const missed = within(score.closest('section')).getAllByRole('listitem')
    expect(missed).toHaveLength(2)
    expect(missed[0]).toHaveTextContent('2. Question 2?')
    expect(missed[0]).toHaveTextContent(`${en.quiz.yourAnswer} Option 2D`)
    expect(missed[0]).toHaveTextContent(`${en.quiz.correctAnswer} Option 2B`)
    expect(missed[1]).toHaveTextContent('3. Question 3?')
    expect(missed[1]).toHaveTextContent(`${en.quiz.yourAnswer} Option 3A`)
    expect(screen.getByText(en.quiz.missedStay)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: en.quiz.newQuiz }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a/quiz'))
  })

  it('"← Back to chat" on the score summary returns to the Project', async () => {
    const { router } = await openQuiz({ quizOptions: { n: 2, answered: { 0: 'b', 1: 'b' } } })

    expect(await screen.findByRole('heading', { name: '2 of 2 correct' })).toBeInTheDocument()
    expect(screen.queryByText(en.quiz.missedStay)).not.toBeInTheDocument()
    const back = screen.getAllByRole('button', { name: en.activity.back })
    fireEvent.click(back[back.length - 1])

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a'))
  })

  it('reopening part-way starts at the first unanswered question', async () => {
    await openQuiz({ quizOptions: { n: 10, answered: { 0: 'b', 1: 'a', 2: 'b', 3: 'c' } } })

    expect(await screen.findByRole('heading', { name: 'Question 5?' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '5 of 10' })).toBeInTheDocument()
    expect(feedback()).toBeEmptyDOMElement()
  })

  it('a failed save shows the Inline error with "Try again", and the question stays unanswered', async () => {
    const { state } = await openQuiz({
      routes: {
        [`POST ${ANSWER(1)}`]: async () => {
          throw { code: 'network_error', params: {} }
        },
      },
    })
    await screen.findByRole('heading', { name: 'Question 1?' })

    fireEvent.click(option('Option 1C'))

    const alert = await screen.findByRole('alert')
    const retry = within(alert).getByRole('button', { name: en.inlineError.retry })
    await waitFor(() => expect(retry).toHaveFocus())
    expect(feedback()).toBeEmptyDOMElement()
    expect(option('Option 1C')).toBeEnabled()
    expect(option('Option 1C')).toHaveAttribute('data-state', 'open')
    expect(state.answers).toEqual([])
  })

  it('"Try again" sends the same answer again', async () => {
    let calls = 0
    const state = fakeApi({ projects: [project('a')], quizzes: [quiz('z', 'a')] })
    renderRoute('/projects/a/quizzes/z')
    await screen.findByRole('heading', { name: 'Question 1?' })
    // The first save fails on the network; the second reaches the fake.
    const real = vi.mocked(apiFetch).getMockImplementation()
    vi.mocked(apiFetch).mockImplementation(async (path, options) => {
      if (path === ANSWER(1) && calls++ === 0) throw { code: 'network_error', params: {} }
      return real(path, options)
    })

    fireEvent.click(option('Option 1C'))
    fireEvent.click(await within(await screen.findByRole('alert')).findByRole('button', { name: en.inlineError.retry }))

    expect(await within(feedback()).findByRole('heading', { name: en.quiz.notQuite })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(state.answers).toEqual([{ question_id: 'z-q1', option_id: 'c' }])
  })

  it('a read-only Project shows the Quiz with its options disabled', async () => {
    const { state } = await openQuiz({ projectOverrides: { archived_at: '2026-11-18T10:00:00Z' } })

    expect(await screen.findByRole('heading', { name: 'Question 1?' })).toBeInTheDocument()
    for (const name of ['Option 1A', 'Option 1B', 'Option 1C', 'Option 1D']) expect(option(name)).toBeDisabled()
    await userEvent.keyboard('1')
    expect(state.answers).toEqual([])
    expect(callsTo(ANSWER(1), 'POST')).toHaveLength(0)
  })

  it('says when fewer questions were possible, above the first question', async () => {
    await openQuiz({ quizOptions: { n: 6, requested: 10 } })

    expect(await screen.findByRole('heading', { name: 'Question 1?' })).toBeInTheDocument()
    expect(screen.getByText(en.quiz.fewer_other.replace('{{count}}', 6))).toBeInTheDocument()
  })

  it('reads in Norwegian', async () => {
    await i18n.changeLanguage('nb')
    await openQuiz({ quizOptions: { n: 1 } })
    await screen.findByRole('heading', { name: 'Question 1?' })
    expect(screen.getByRole('button', { name: '← Tilbake til samtalen' })).toBeInTheDocument()

    fireEvent.click(option('Option 1A'))

    expect(await within(feedback()).findByRole('heading', { name: 'Ikke helt' })).toBeInTheDocument()
    expect(within(feedback()).getByText('Det ligger fortsatt i repetisjonen din.')).toBeInTheDocument()
    expect(option('Option 1A')).toHaveTextContent('Ditt svar')
    expect(option('Option 1B')).toHaveTextContent('Riktig svar')
    fireEvent.click(screen.getByRole('button', { name: /Se resultatet/ }))
    expect(await screen.findByRole('heading', { name: '0 av 1 riktige' })).toBeInTheDocument()
    expect(screen.getByText('Spørsmål du bommet på, ligger i repetisjonen din.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ny quiz' })).toBeInTheDocument()
  })

  it('a right answer reads "Riktig" in Norwegian, and "Neste spørsmål" moves on', async () => {
    await i18n.changeLanguage('nb')
    await openQuiz()
    await screen.findByRole('heading', { name: 'Question 1?' })

    fireEvent.click(option('Option 1B'))

    expect(await within(feedback()).findByRole('heading', { name: 'Riktig' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Neste spørsmål/ }))
    expect(await screen.findByRole('heading', { name: 'Question 2?' })).toBeInTheDocument()
  })

  it('a missing Project goes to /projects', async () => {
    fakeApi({ projects: [] })
    const { router } = renderRoute('/projects/zzz/quizzes/z')

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'))
  })

  it('a missing Quiz shows the Inline error', async () => {
    fakeApi({ projects: [project('a')] })
    renderRoute('/projects/a/quizzes/nope')

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.not_found)
  })
})
