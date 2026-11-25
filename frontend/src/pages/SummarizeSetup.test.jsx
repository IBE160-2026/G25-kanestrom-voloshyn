// Summarize setup, generation, and the finish notice (Story 4.3, FR-15, FR-26). The Summary view a
// finished job opens is tested in SummaryView.test.jsx.
// api/client.js and auth/ are mocked (spine › Tests); test/fakeApi.js plays the backend, and stepJob /
// finishSummary / failJob move the summary job on.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { failJob, fakeApi, finishSummary, material, project, stepJob, summary, topics } from '../test/fakeApi.js'
import { i18n, renderRoute } from '../test/render.jsx'
import { POLL_MS } from './useGenerationJob.js'
import { NOTICE_POLL_MS } from './useQuizNotices.js'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

beforeEach(() => {
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
})

afterEach(() => {
  vi.useRealTimers()
})

const LAB_TOPICS = [
  { id: 'l-1', label: 'Enzymes', group_label: null, position: 0 },
  { id: 'l-2', label: 'pH', group_label: null, position: 1 },
]
const READY = {
  a: [
    material('m1', { file_name: 'notes.md', file_type: 'md', topics: topics(3, { prefix: 'Cells' }) }),
    material('m2', { file_name: 'lab.pdf', topics: LAB_TOPICS }),
    material('m3', { file_name: 'draft.pdf', status: 'processing' }),
  ],
}
const make = () => screen.getByRole('button', { name: (i18n.language === 'nb' ? nb : en).summary.make })
const STEP = (n, key) => `Step ${n} of 3 · ${en.summary.steps[key]}`
const stepLine = () => screen.getByRole('status').textContent
const fileGroup = () => screen.getByRole('group', { name: en.summary.file })
const topicGroup = () => screen.getByRole('group', { name: en.summary.topic })

async function openSetup(options = {}) {
  const state = fakeApi({ projects: [project('a', { name: 'Biology' })], materials: READY, ...options })
  const view = renderRoute('/projects/a/summarize')
  await screen.findByRole('heading', { level: 2, name: (options.lang === 'nb' ? nb : en).summary.title })
  return { state, ...view }
}

async function startSummary(options = {}) {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const opened = await openSetup(options)
  fireEvent.click(make())
  await waitFor(() => expect(opened.state.summaryRequests).toHaveLength(1))
  return opened
}

describe('Summarize setup', () => {
  it('opens from the Summarize button after Quiz and Flashcards, enabled once a file is Ready', async () => {
    fakeApi({ projects: [project('a')], materials: READY })
    const { router } = renderRoute('/projects/a')

    const button = await screen.findByRole('button', { name: en.tools.summarize })
    await waitFor(() => expect(button).toBeEnabled())
    const row = within(screen.getByTestId('tools-row')).getAllByRole('button')
    expect(row.map((b) => b.textContent)).toEqual([en.tools.quiz, en.tools.flashcards, en.tools.summarize])
    await userEvent.click(button)

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a/summarize'))
    expect(await screen.findByRole('heading', { name: en.summary.title })).toBeInTheDocument()
  })

  it('keeps the Summarize button disabled while files are only Reading…', async () => {
    fakeApi({ projects: [project('a')], materials: { a: [material('m1', { status: 'processing' })] } })
    renderRoute('/projects/a')

    await screen.findByText(en.files.status.processing)
    expect(screen.getByRole('button', { name: en.tools.summarize })).toBeDisabled()
  })

  it.each(['archived_at', 'deleted_at'])('keeps the Summarize button disabled when %s is set', async (column) => {
    fakeApi({ projects: [project('a', { [column]: '2026-11-18T10:00:00Z' })], materials: READY })
    renderRoute('/projects/a')

    await screen.findAllByText('Cells 1')
    expect(screen.getByRole('button', { name: en.tools.summarize })).toBeDisabled()
  })

  it('shows "Which file?" with the Ready files, the first preselected, and "Whole file" selected', async () => {
    const { state } = await openSetup()

    expect(screen.getByText(en.tools.summarize)).toBeInTheDocument()
    const files = within(fileGroup()).getAllByRole('radio')
    expect(files.map((radio) => radio.value)).toEqual(['m1', 'm2'])
    expect(within(fileGroup()).getByRole('radio', { name: /notes\.md/ })).toBeChecked()
    expect(within(fileGroup()).getByRole('radio', { name: /notes\.md/ })).toHaveAccessibleName('notes.md 3 topics')
    const chips = within(topicGroup()).getAllByRole('radio')
    expect(chips.map((chip) => chip.closest('label').textContent)).toEqual([en.summary.wholeFile, 'Cells 1', 'Cells 2', 'Cells 3'])
    expect(within(topicGroup()).getByRole('radio', { name: en.summary.wholeFile })).toBeChecked()
    expect(screen.queryByRole('group', { name: /how many/i })).not.toBeInTheDocument()
    expect(make()).toBeEnabled()
    // Nothing is sent before "Make summary".
    expect(state.summaryRequests).toEqual([])
  })

  it('the Topic choices follow the file, and choosing a file resets the Topic to "Whole file"', async () => {
    const { state } = await openSetup()
    await userEvent.click(within(topicGroup()).getByRole('radio', { name: 'Cells 2' }))
    expect(within(topicGroup()).getByRole('radio', { name: 'Cells 2' })).toBeChecked()

    await userEvent.click(within(fileGroup()).getByRole('radio', { name: /lab\.pdf/ }))

    const chips = within(topicGroup()).getAllByRole('radio')
    expect(chips.map((chip) => chip.closest('label').textContent)).toEqual([en.summary.wholeFile, 'Enzymes', 'pH'])
    expect(within(topicGroup()).getByRole('radio', { name: en.summary.wholeFile })).toBeChecked()
    expect(state.summaryRequests).toEqual([])
  })

  it('arrow keys move inside each radio group', async () => {
    await openSetup()
    const notes = within(fileGroup()).getByRole('radio', { name: /notes\.md/ })
    notes.focus()

    await userEvent.keyboard('{ArrowDown}')

    expect(within(fileGroup()).getByRole('radio', { name: /lab\.pdf/ })).toBeChecked()
    within(topicGroup()).getByRole('radio', { name: en.summary.wholeFile }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(within(topicGroup()).getByRole('radio', { name: 'Enzymes' })).toBeChecked()
  })

  it('sends the whole file as {material_id, topic_id: null}', async () => {
    const { state } = await openSetup()

    await userEvent.click(make())

    await waitFor(() => expect(state.summaryRequests).toEqual([{ material_id: 'm1', topic_id: null }]))
  })

  it('sends the chosen file and Topic', async () => {
    const { state } = await openSetup()
    await userEvent.click(within(fileGroup()).getByRole('radio', { name: /lab\.pdf/ }))
    await userEvent.click(within(topicGroup()).getByRole('radio', { name: 'pH' }))

    await userEvent.click(make())

    await waitFor(() => expect(state.summaryRequests).toEqual([{ material_id: 'm2', topic_id: 'l-2' }]))
    expect(state.quizRequests).toEqual([])
    expect(state.flashcardRequests).toEqual([])
  })

  it('shows the Progress steps in turn, then the summary, replacing the setup in the history', async () => {
    const { state, router } = await startSummary()

    await waitFor(() => expect(stepLine()).toBe(STEP(1, 'reading')))
    expect(screen.getByText(/notes\.md/)).toBeInTheDocument()
    stepJob(state, 's-1', 'writing')
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    expect(stepLine()).toBe(STEP(2, 'writing'))
    expect(stepLine()).toContain('Writing the summary')
    stepJob(state, 's-1', 'checking')
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    expect(stepLine()).toBe(STEP(3, 'checking'))

    finishSummary(state, 's-1', 2)
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))

    expect(await screen.findByRole('heading', { name: 'Photosynthesis' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/projects/a/summaries/sum-s-1')
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('Cancel returns to setup with both choices kept', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { state } = await openSetup()
    fireEvent.click(within(fileGroup()).getByRole('radio', { name: /lab\.pdf/ }))
    fireEvent.click(within(topicGroup()).getByRole('radio', { name: 'Enzymes' }))
    fireEvent.click(make())
    await screen.findByText(STEP(1, 'reading'))

    fireEvent.click(screen.getByRole('button', { name: en.progress.cancel }))

    expect(await screen.findByText(en.summary.cancelled)).toBeInTheDocument()
    expect(state.cancelled).toEqual(['s-1'])
    expect(within(fileGroup()).getByRole('radio', { name: /lab\.pdf/ })).toBeChecked()
    expect(within(topicGroup()).getByRole('radio', { name: 'Enzymes' })).toBeChecked()
    await waitFor(() => expect(screen.getByRole('heading', { name: en.summary.title })).toHaveFocus())
  })

  it('a failed job shows "We couldn\'t make your summary." with both choices kept, and Try again starts a new job', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { state } = await openSetup()
    fireEvent.click(within(fileGroup()).getByRole('radio', { name: /lab\.pdf/ }))
    fireEvent.click(within(topicGroup()).getByRole('radio', { name: 'pH' }))
    fireEvent.click(make())
    await waitFor(() => expect(state.summaryRequests).toHaveLength(1))

    failJob(state, 's-1', 'llm_unavailable')
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("We couldn't make your summary.")
    expect(alert).toHaveTextContent(en.inlineError.reassurance)
    expect(within(fileGroup()).getByRole('radio', { name: /lab\.pdf/ })).toBeChecked()
    expect(within(topicGroup()).getByRole('radio', { name: 'pH' })).toBeChecked()
    const retry = within(alert).getByRole('button', { name: en.inlineError.retry })
    await waitFor(() => expect(retry).toHaveFocus())
    fireEvent.click(retry)

    await waitFor(() => expect(state.summaryRequests).toHaveLength(2))
    expect(state.summaryRequests[1]).toEqual({ material_id: 'm2', topic_id: 'l-2' })
  })

  it('a rule failure shows only its message', async () => {
    const { state } = await startSummary()

    failJob(state, 's-1', 'insufficient_material')
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(en.errors.insufficient_material)
    expect(within(alert).queryByRole('button', { name: en.inlineError.retry })).not.toBeInTheDocument()
  })

  it('with no Ready file it says so and the button stays disabled', async () => {
    await openSetup({ materials: { a: [material('m3', { status: 'processing' })] } })

    expect(screen.getByRole('alert')).toHaveTextContent(en.errors.insufficient_material)
    expect(make()).toBeDisabled()
  })

  it('is read-only in an archived Project: the button stays disabled', async () => {
    await openSetup({ projects: [project('a', { archived_at: '2026-11-18T10:00:00Z' })] })

    expect(screen.getByRole('alert')).toHaveTextContent(en.errors.project_read_only)
    expect(make()).toBeDisabled()
  })

  it('reopening the page while a summary job runs resumes its progress; a flashcards job does not', async () => {
    fakeApi({
      projects: [project('a')],
      materials: READY,
      jobs: [
        { id: 'f-9', project_id: 'a', kind: 'flashcards', status: 'running', progress_step: 'checking', result_ref: null },
        { id: 's-9', project_id: 'a', kind: 'summary', status: 'running', progress_step: 'writing', result_ref: null, file_name: 'lab.pdf' },
      ],
    })
    renderRoute('/projects/a/summarize')

    await screen.findByText(STEP(2, 'writing'))
    expect(screen.getByText(/lab\.pdf/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: en.summary.title })).not.toBeInTheDocument()
  })

  it('a resumed job keeps its own file and Topic, so a cancel shows them and a retry resends them', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const state = fakeApi({
      projects: [project('a')],
      materials: READY,
      jobs: [
        {
          id: 's-9',
          project_id: 'a',
          kind: 'summary',
          status: 'running',
          progress_step: 'writing',
          result_ref: null,
          file_name: 'lab.pdf',
          topic_labels: ['pH'],
        },
      ],
    })
    renderRoute('/projects/a/summarize')
    await screen.findByText(STEP(2, 'writing'))

    fireEvent.click(screen.getByRole('button', { name: en.progress.cancel }))

    expect(await screen.findByText(en.summary.cancelled)).toBeInTheDocument()
    expect(within(fileGroup()).getByRole('radio', { name: /lab\.pdf/ })).toBeChecked()
    expect(within(topicGroup()).getByRole('radio', { name: 'pH' })).toBeChecked()
    fireEvent.click(make())
    await waitFor(() => expect(state.summaryRequests).toEqual([{ material_id: 'm2', topic_id: 'l-2' }]))
  })

  it('a resumed job whose file is gone keeps the defaults', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fakeApi({
      projects: [project('a')],
      materials: READY,
      jobs: [
        { id: 's-9', project_id: 'a', kind: 'summary', status: 'running', progress_step: 'reading', result_ref: null, file_name: 'old.pdf', topic_labels: ['X'] },
      ],
    })
    renderRoute('/projects/a/summarize')
    await screen.findByText(STEP(1, 'reading'))

    fireEvent.click(screen.getByRole('button', { name: en.progress.cancel }))

    await screen.findByText(en.summary.cancelled)
    expect(within(fileGroup()).getByRole('radio', { name: /notes\.md/ })).toBeChecked()
    expect(within(topicGroup()).getByRole('radio', { name: en.summary.wholeFile })).toBeChecked()
  })

  it('back on the setup after a failure, the files are read again, so a removed file is gone', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { state } = await openSetup()
    fireEvent.click(within(fileGroup()).getByRole('radio', { name: /lab\.pdf/ }))
    fireEvent.click(make())
    await waitFor(() => expect(state.summaryRequests).toHaveLength(1))

    state.materials.a = state.materials.a.filter((m) => m.id !== 'm2')
    failJob(state, 's-1', 'llm_unavailable')
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))

    await screen.findByRole('alert')
    await waitFor(() => expect(within(fileGroup()).queryByRole('radio', { name: /lab\.pdf/ })).not.toBeInTheDocument())
    expect(within(fileGroup()).getByRole('radio', { name: /notes\.md/ })).toBeChecked()
    expect(within(topicGroup()).getByRole('radio', { name: en.summary.wholeFile })).toBeChecked()
  })

  it('a group holding the chosen Topic stays open, so its radio stays checked', async () => {
    await openSetup({ materials: { a: [material('m1', { file_name: 'big.pdf', topics: topics(25, { groupSize: 5 }) })] } })
    const part2 = within(topicGroup()).getByRole('button', { name: /^Part 2,/ })
    expect(part2).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(part2)
    await userEvent.click(within(topicGroup()).getByRole('radio', { name: 'Topic 7' }))

    await userEvent.click(part2)

    expect(part2).toHaveAttribute('aria-expanded', 'true')
    expect(within(topicGroup()).getByRole('radio', { name: 'Topic 7' })).toBeChecked()
  })

  it('a request refused as scope_too_large shows only its message and keeps both choices', async () => {
    const { state } = await openSetup({
      routes: { 'POST /api/projects/a/summaries': async () => Promise.reject({ code: 'scope_too_large', params: { max_tokens: 1000 } }) },
    })
    await userEvent.click(within(fileGroup()).getByRole('radio', { name: /lab\.pdf/ }))
    await userEvent.click(within(topicGroup()).getByRole('radio', { name: 'Enzymes' }))

    await userEvent.click(make())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(en.errors.scope_too_large)
    expect(within(alert).queryByRole('button', { name: en.inlineError.retry })).not.toBeInTheDocument()
    expect(within(fileGroup()).getByRole('radio', { name: /lab\.pdf/ })).toBeChecked()
    expect(within(topicGroup()).getByRole('radio', { name: 'Enzymes' })).toBeChecked()
    expect(state.jobs).toEqual([])
  })

  it('is in Norwegian too', async () => {
    await i18n.changeLanguage('nb')
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { state } = await openSetup({ lang: 'nb' })

    expect(screen.getByRole('group', { name: 'Hvilken fil?' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Begrens til ett emne (valgfritt)' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Hele filen' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Lag sammendrag' }))

    expect(await screen.findByText('Steg 1 av 3 · Leser materialet ditt')).toBeInTheDocument()
    stepJob(state, 's-1', 'writing')
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    expect(screen.getByText('Steg 2 av 3 · Skriver sammendraget')).toBeInTheDocument()
    failJob(state, 's-1')
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))

    expect(await screen.findByRole('alert')).toHaveTextContent('Vi fikk ikke laget sammendraget ditt.')
  })
})

describe('Summary ready notice', () => {
  const job = (overrides = {}) => ({
    id: 's-1',
    project_id: 'a',
    kind: 'summary',
    status: 'completed',
    progress_step: null,
    result_ref: 'sum-1',
    error_code: null,
    topic_labels: [],
    file_name: 'notes.md',
    ...overrides,
  })
  const SUMMARY = summary('sum-1', 'a')

  it('shows "Your summary of {file} is ready · Open", and Open goes to the summary', async () => {
    const state = fakeApi({ projects: [project('a')], materials: READY, jobs: [job()], summaries: [SUMMARY] })
    const { router } = renderRoute('/projects/a')

    const region = await screen.findByTestId('ready-notices')
    await waitFor(() => expect(region).toHaveTextContent('Your summary of notes.md is ready · Open'))

    await userEvent.click(within(region).getByRole('button', { name: 'Open' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a/summaries/sum-1'))
    expect(await screen.findByRole('heading', { name: 'Photosynthesis' })).toBeInTheDocument()
    await waitFor(() => expect(state.jobs[0].seen).toBe(true))
  })

  it('appears when a summary job finishes while the student is on the chat', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const state = fakeApi({
      projects: [project('a')],
      materials: READY,
      jobs: [job({ status: 'running', progress_step: 'writing', result_ref: null, file_name: 'lab.pdf' })],
    })
    renderRoute('/projects/a')
    await waitFor(() => expect(screen.getByRole('button', { name: en.tools.summarize })).toBeEnabled())
    expect(screen.getByTestId('ready-notices')).toBeEmptyDOMElement()

    finishSummary(state, 's-1')
    await act(() => vi.advanceTimersByTimeAsync(NOTICE_POLL_MS))

    expect(screen.getByTestId('ready-notices')).toHaveTextContent('Your summary of lab.pdf is ready · Open')
  })

  it('reads "Sammendraget ditt av … er klart · Åpne" in Norwegian', async () => {
    await i18n.changeLanguage('nb')
    fakeApi({ projects: [project('a')], materials: READY, jobs: [job()], summaries: [SUMMARY] })
    renderRoute('/projects/a')

    const region = await screen.findByTestId('ready-notices')
    await waitFor(() => expect(region).toHaveTextContent('Sammendraget ditt av notes.md er klart · Åpne'))
  })
})
