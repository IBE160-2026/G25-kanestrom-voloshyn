// Flashcards setup, generation, and the finish notice (Story 4.1, FR-13, FR-26). The study session the
// finished set opens on is tested in FlashcardSession.test.jsx (Story 4.2).
// api/client.js and auth/ are mocked (spine › Tests); test/fakeApi.js plays the backend, and stepJob /
// finishFlashcards / failJob move the flashcards job on.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import {
  callsTo,
  failJob,
  fakeApi,
  finishFlashcards,
  flashcardSet,
  material,
  project,
  stepJob,
  topics,
} from '../test/fakeApi.js'
import { i18n, renderRoute } from '../test/render.jsx'
import { POLL_MS } from './GenerationSetup.jsx'
import { NOTICE_POLL_MS } from './useQuizNotices.js'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

beforeEach(() => {
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
})

afterEach(() => {
  vi.useRealTimers()
})

const READY = { a: [material('m1', { file_name: 'notes.md', topics: topics(3, { prefix: 'Cells' }) })] }
// The primary button in the active language: "Make {n} cards".
const make = (n) => screen.getByRole('button', { name: i18n.t('flashcards.make', { count: n }) })
const STEP = (n, key) => `Step ${n} of 3 · ${en.flashcards.steps[key]}`
const stepLine = () => screen.getByRole('status').textContent

async function openSetup(options = {}) {
  const state = fakeApi({ projects: [project('a', { name: 'Biology' })], materials: READY, ...options })
  const view = renderRoute('/projects/a/flashcards')
  await screen.findByRole('heading', { level: 2, name: (options.lang === 'nb' ? nb : en).flashcards.title })
  return { state, ...view }
}

async function startSet(options = {}) {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const opened = await openSetup(options)
  await waitFor(() => expect(make(10)).toBeEnabled())
  fireEvent.click(make(10))
  await waitFor(() => expect(opened.state.flashcardRequests).toHaveLength(1))
  return opened
}

describe('Flashcards setup', () => {
  it('opens from the Flashcards button next to Quiz, enabled once a file is Ready', async () => {
    fakeApi({ projects: [project('a')], materials: READY })
    const { router } = renderRoute('/projects/a')

    const button = await screen.findByRole('button', { name: en.tools.flashcards })
    await waitFor(() => expect(button).toBeEnabled())
    const row = within(screen.getByTestId('tools-row')).getAllByRole('button')
    expect(row.map((b) => b.textContent)).toEqual([en.tools.quiz, en.tools.flashcards])
    await userEvent.click(button)

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a/flashcards'))
    expect(await screen.findByRole('heading', { name: en.flashcards.title })).toBeInTheDocument()
  })

  it('keeps the Flashcards button disabled while files are only Reading…', async () => {
    fakeApi({ projects: [project('a')], materials: { a: [material('m1', { status: 'processing' })] } })
    renderRoute('/projects/a')

    await screen.findByText(en.files.status.processing)
    expect(screen.getByRole('button', { name: en.tools.flashcards })).toBeDisabled()
  })

  it('keeps the Flashcards button disabled in an archived Project', async () => {
    fakeApi({ projects: [project('a', { archived_at: '2026-11-18T10:00:00Z' })], materials: READY })
    renderRoute('/projects/a')

    await screen.findAllByText('Cells 1')
    expect(screen.getByRole('button', { name: en.tools.flashcards })).toBeDisabled()
  })

  it('shows "Which topics?", "How many cards?" with 10 preselected, and "Make 10 cards"', async () => {
    await openSetup()

    expect(screen.getByText(en.tools.flashcards)).toBeInTheDocument()
    const topicsField = screen.getByRole('group', { name: en.flashcards.topics })
    const chips = within(topicsField).getAllByRole('button')
    expect(chips.map((chip) => chip.textContent)).toEqual([en.flashcards.allTopics, 'Cells 1', 'Cells 2', 'Cells 3'])
    const countField = screen.getByRole('group', { name: en.flashcards.count })
    expect(within(countField).getAllByRole('radio').map((radio) => radio.value)).toEqual(['5', '10', '20'])
    expect(within(countField).getByRole('radio', { name: '10' })).toBeChecked()
    await waitFor(() => expect(make(10)).toBeEnabled())
    expect(make(10)).toHaveTextContent('Make 10 cards')

    await userEvent.click(screen.getByRole('radio', { name: '20' }))
    expect(make(20)).toBeInTheDocument()
  })

  it('sends the chosen scope and count to the flashcard-sets endpoint', async () => {
    const { state } = await openSetup()
    await userEvent.click(screen.getByRole('button', { name: 'Cells 2' }))
    await userEvent.click(screen.getByRole('radio', { name: '5' }))
    await waitFor(() => expect(make(5)).toBeEnabled())

    await userEvent.click(make(5))

    await waitFor(() => expect(state.flashcardRequests).toEqual([{ scope: { topic_ids: ['t-2'] }, count: 5 }]))
    expect(state.quizRequests).toEqual([])
  })

  it('with too little material, the note offers max_cards and disables the button until it fits', async () => {
    const { state } = await openSetup({ capacity: 6 })

    const note = await screen.findByText("There's only enough material for 6 cards.")
    expect(note).toHaveAttribute('role', 'status')
    expect(make(10)).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Make 6 instead' }))
    expect(make(6)).toBeEnabled()
    await userEvent.click(make(6))

    await waitFor(() => expect(state.flashcardRequests).toEqual([{ scope: { all_topics: true }, count: 10 }]))
  })

  it('reads the note from max_cards', async () => {
    await openSetup({
      routes: {
        [`GET /api/projects/a/capacity?scope=${encodeURIComponent('{"all_topics":true}')}`]: async () => ({
          max_questions: 20,
          max_cards: 4,
        }),
      },
    })

    expect(await screen.findByText("There's only enough material for 4 cards.")).toBeInTheDocument()
  })

  it('shows the Progress steps in turn, then the first card, replacing the setup in the history', async () => {
    const { state, router } = await startSet()

    await waitFor(() => expect(stepLine()).toBe(STEP(1, 'reading')))
    stepJob(state, 'f-1', 'writing')
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    expect(stepLine()).toBe(STEP(2, 'writing'))
    stepJob(state, 'f-1', 'checking')
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    expect(stepLine()).toBe(STEP(3, 'checking'))

    finishFlashcards(state, 'f-1', 10)
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))

    expect(await screen.findByText('1 of 10')).toBeInTheDocument()
    expect(screen.getByTestId('flashcard')).toHaveTextContent('Question 1?')
    expect(router.state.location.pathname).toBe('/projects/a/flashcard-sets/set-f-1')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(screen.queryByText(/cards were possible/)).not.toBeInTheDocument()
    expect(callsTo('/api/jobs/f-1/seen', 'POST')).toHaveLength(1)
  })

  it('the set opens saying when fewer cards were possible', async () => {
    const { state } = await startSet()

    finishFlashcards(state, 'f-1', 6)
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))

    expect(await screen.findByText('1 of 6')).toBeInTheDocument()
    expect(screen.getByText('Only 6 cards were possible from this material.')).toBeInTheDocument()
  })

  it('Cancel returns to setup with the choices kept', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { state } = await openSetup()
    fireEvent.click(screen.getByRole('radio', { name: '20' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cells 3' }))
    await waitFor(() => expect(make(20)).toBeEnabled())
    fireEvent.click(make(20))
    await screen.findByText(STEP(1, 'reading'))

    fireEvent.click(screen.getByRole('button', { name: en.progress.cancel }))

    expect(await screen.findByText(en.flashcards.cancelled)).toBeInTheDocument()
    expect(state.cancelled).toEqual(['f-1'])
    expect(screen.getByRole('radio', { name: '20' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Cells 3' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(screen.getByRole('heading', { name: en.flashcards.title })).toHaveFocus())
  })

  it('a failed job shows "We couldn\'t make the flashcards." with Try again, which starts a new job', async () => {
    const { state } = await startSet()

    failJob(state, 'f-1', 'llm_unavailable')
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("We couldn't make the flashcards.")
    const retry = within(alert).getByRole('button', { name: en.inlineError.retry })
    await waitFor(() => expect(retry).toHaveFocus())
    fireEvent.click(retry)

    await waitFor(() => expect(state.flashcardRequests).toHaveLength(2))
    expect(state.flashcardRequests[1]).toEqual(state.flashcardRequests[0])
  })

  it('is read-only in an archived Project: the button stays disabled', async () => {
    await openSetup({ projects: [project('a', { archived_at: '2026-11-18T10:00:00Z' })] })

    expect(screen.getByRole('alert')).toHaveTextContent(en.errors.project_read_only)
    expect(make(10)).toBeDisabled()
  })

  it('reopening the page while a flashcards job runs resumes its progress; a quiz job does not', async () => {
    fakeApi({
      projects: [project('a')],
      materials: READY,
      jobs: [
        { id: 'q-9', project_id: 'a', kind: 'quiz', status: 'running', progress_step: 'checking', result_ref: null },
        { id: 'f-9', project_id: 'a', kind: 'flashcards', status: 'running', progress_step: 'writing', result_ref: null },
      ],
    })
    renderRoute('/projects/a/flashcards')

    await screen.findByText(STEP(2, 'writing'))
    expect(screen.queryByRole('heading', { name: en.flashcards.title })).not.toBeInTheDocument()
  })

  it('is in Norwegian too', async () => {
    await i18n.changeLanguage('nb')
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { state } = await openSetup({ lang: 'nb', capacity: 6 })

    expect(screen.getByRole('group', { name: 'Hvor mange treningskort?' })).toBeInTheDocument()
    expect(await screen.findByText('Det er bare nok materiale til 6 treningskort.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Lag 6 i stedet' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Lag 6 treningskort' }))

    expect(await screen.findByText('Steg 1 av 3 · Leser materialet ditt')).toBeInTheDocument()
    stepJob(state, 'f-1', 'writing')
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    expect(screen.getByText('Steg 2 av 3 · Skriver treningskort')).toBeInTheDocument()
    finishFlashcards(state, 'f-1', 5)
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))

    expect(await screen.findByText('1 av 5')).toBeInTheDocument()
    expect(screen.getByText('Bare 5 treningskort var mulig ut fra materialet.')).toBeInTheDocument()
  })

  it('shows "Vi fikk ikke laget treningskortene." on a failure in Norwegian', async () => {
    await i18n.changeLanguage('nb')
    const { state } = await startSet({ lang: 'nb' })

    failJob(state, 'f-1')
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))

    expect(await screen.findByRole('alert')).toHaveTextContent('Vi fikk ikke laget treningskortene.')
  })
})

describe('Flashcards ready notice', () => {
  const job = (overrides = {}) => ({
    id: 'f-1',
    project_id: 'a',
    kind: 'flashcards',
    status: 'completed',
    progress_step: null,
    result_ref: 'set-1',
    error_code: null,
    topic_labels: [],
    ...overrides,
  })
  const SET = flashcardSet('set-1', 'a', { n: 10 })

  it('shows "Your flashcards on {topic} are ready · Open", and Open goes to the set', async () => {
    const state = fakeApi({
      projects: [project('a')],
      materials: READY,
      jobs: [job({ topic_labels: ['Cells 1', 'Cells 2'] })],
      flashcardSets: [SET],
    })
    const { router } = renderRoute('/projects/a')

    const notices = within(await screen.findByTestId('ready-notices'))
    expect(await notices.findByText(/Your flashcards on Cells 1 and Cells 2 are ready/)).toBeInTheDocument()
    expect(screen.getByTestId('ready-notices')).toHaveTextContent('Your flashcards on Cells 1 and Cells 2 are ready · Open')

    await userEvent.click(notices.getByRole('button', { name: 'Open' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a/flashcard-sets/set-1'))
    expect(await screen.findByText('1 of 10')).toBeInTheDocument()
    await waitFor(() => expect(state.jobs[0].seen).toBe(true))
  })

  it('appears when a flashcards job finishes while the student is on the chat', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const state = fakeApi({
      projects: [project('a')],
      materials: READY,
      jobs: [job({ status: 'running', progress_step: 'writing', result_ref: null })],
    })
    renderRoute('/projects/a')
    await waitFor(() => expect(screen.getByRole('button', { name: en.tools.flashcards })).toBeEnabled())
    expect(screen.getByTestId('ready-notices')).toBeEmptyDOMElement()

    finishFlashcards(state, 'f-1', 10)
    await act(() => vi.advanceTimersByTimeAsync(NOTICE_POLL_MS))

    expect(screen.getByTestId('ready-notices')).toHaveTextContent('Your flashcards on all topics are ready · Open')
  })

  it('reads "Treningskortene dine om … er klare · Åpne" in Norwegian', async () => {
    await i18n.changeLanguage('nb')
    fakeApi({ projects: [project('a')], materials: READY, jobs: [job({ topic_labels: ['Cells 1'] })], flashcardSets: [SET] })
    renderRoute('/projects/a')

    const region = await screen.findByTestId('ready-notices')
    await waitFor(() => expect(region).toHaveTextContent('Treningskortene dine om Cells 1 er klare · Åpne'))
  })
})
