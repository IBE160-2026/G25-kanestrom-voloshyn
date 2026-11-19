// The Mistakes card in the chat (Story 3.3, FR-9, FR-12, AD-10). api/client.js and auth/ are mocked
// (spine › Tests); test/fakeApi.js plays the backend: a newly saved wrong answer adds an outstanding
// Mistake, and GET .../mistakes/summary counts them.
import { act, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '../api/client.js'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import { callsTo, fakeApi, material, mistake, project, quiz } from '../test/fakeApi.js'
import { i18n, renderRoute } from '../test/render.jsx'
import { useMistakes } from './useMistakes.js'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

beforeEach(() => {
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
})

const READY = { a: [material('notes', { file_name: 'notes.pdf' })] }
const summaryReads = () => callsTo('/api/projects/a/mistakes/summary')
const card = () => screen.queryByTestId('mistakes-card')

function setup({ mistakes = [], projectOverrides = {}, ...options } = {}) {
  return fakeApi({
    projects: [project('a', { name: 'Biology', ...projectOverrides })],
    materials: READY,
    mistakes,
    ...options,
  })
}

/** The chat has loaded and its summary has been read. */
async function opened() {
  await waitFor(() => expect(screen.getByRole('button', { name: en.tools.quiz })).toBeEnabled())
  await waitFor(() => expect(summaryReads().length).toBeGreaterThan(0))
}

const many = (n) => Array.from({ length: n }, () => mistake('a'))

describe('Mistakes card', () => {
  it('shows nothing at 0, never "0 mistakes"', async () => {
    setup()
    renderRoute('/projects/a')
    await opened()

    expect(card()).not.toBeInTheDocument()
    expect(screen.queryByText(/0 mistakes/)).not.toBeInTheDocument()
  })

  it.each([
    [1, '1 mistake to review'],
    [5, '5 mistakes to review'],
  ])('with %i outstanding reads "%s" at the top of the chat', async (n, text) => {
    setup({ mistakes: many(n) })
    renderRoute('/projects/a')

    const shown = await screen.findByTestId('mistakes-card')
    expect(shown).toHaveTextContent(text)
    // Above the quiz notices, at the top of the chat column.
    expect(shown.compareDocumentPosition(screen.getByTestId('ready-notices')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // A polite live region, so a new count is announced.
    expect(shown).toHaveAttribute('role', 'status')
    // "Start" on the card opens Mistake Review (Story 3.4).
    expect(within(shown).getByRole('button', { name: en.mistakes.start })).toBeInTheDocument()
  })

  it('counts only this Project and leaves out withdrawn mistakes', async () => {
    setup({
      mistakes: [mistake('a'), { ...mistake('a'), withdrawn: true }, mistake('b')],
      projects: [project('a', { name: 'Biology' }), project('b')],
    })
    renderRoute('/projects/a')

    expect(await screen.findByTestId('mistakes-card')).toHaveTextContent('1 mistake to review')
  })

  it.each([['archived_at'], ['deleted_at']])('is hidden while the Project is read-only (%s)', async (column) => {
    setup({ mistakes: many(5), projectOverrides: { [column]: '2026-11-18T10:00:00Z' } })
    renderRoute('/projects/a')
    await screen.findByRole('button', { name: en.tools.quiz })
    await waitFor(() => expect(summaryReads().length).toBeGreaterThan(0))
    // Let the summary land.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(card()).not.toBeInTheDocument()
  })

  it('keeps the chat working when the summary fails', async () => {
    setup({
      routes: {
        'GET /api/projects/a/mistakes/summary': () => {
          throw { code: 'internal_error', params: {} }
        },
      },
    })
    renderRoute('/projects/a')
    await opened()

    expect(card()).not.toBeInTheDocument()
  })

  it('shows the new count after answering two wrong and going "← Back to chat", with no reload', async () => {
    const state = setup({ quizzes: [quiz('z', 'a', { n: 3, correct: 'b' })] })
    const { router } = renderRoute('/projects/a')
    await opened()
    expect(card()).not.toBeInTheDocument()

    await router.navigate('/projects/a/quizzes/z')
    await screen.findByRole('heading', { name: 'Question 1?' })
    fireEvent.click(screen.getByRole('button', { name: /Option 1A/ }))
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(en.quiz.next) }))
    await screen.findByRole('heading', { name: 'Question 2?' })
    fireEvent.click(screen.getByRole('button', { name: /Option 2C/ }))
    await waitFor(() => expect(state.mistakes).toHaveLength(2))

    fireEvent.click(screen.getByRole('button', { name: en.activity.back }))

    expect(await screen.findByTestId('mistakes-card')).toHaveTextContent('2 mistakes to review')
  })

  it('a right answer adds no mistake', async () => {
    const state = setup({ quizzes: [quiz('z', 'a', { n: 2, correct: 'b' })] })
    renderRoute('/projects/a/quizzes/z')
    await screen.findByRole('heading', { name: 'Question 1?' })

    fireEvent.click(screen.getByRole('button', { name: /Option 1B/ }))
    await screen.findByRole('button', { name: new RegExp(en.quiz.next) })

    expect(state.mistakes).toHaveLength(0)
  })

  it('works in Norwegian, with the same form for one', async () => {
    await i18n.changeLanguage('nb')
    setup({ mistakes: many(1) })
    renderRoute('/projects/a')

    expect(await screen.findByTestId('mistakes-card')).toHaveTextContent('Du har 1 feil å repetere')
  })

  it.each([
    ['en', 1, '1 mistake to review'],
    ['en', 3, '3 mistakes to review'],
    ['nb', 1, 'Du har 1 feil å repetere'],
    ['nb', 3, 'Du har 3 feil å repetere'],
  ])('%s with count %i reads "%s"', (lng, count, expected) => {
    expect(i18n.getFixedT(lng)('mistakes.card', { count })).toBe(expected)
  })
})

describe('useMistakes', () => {
  it('keeps only the latest read: an older answer arriving late never overwrites a newer one', async () => {
    const pending = []
    vi.mocked(apiFetch).mockImplementation(
      () => new Promise((resolve) => pending.push(resolve)),
    )
    const { result } = renderHook(() => useMistakes('a'))
    await waitFor(() => expect(pending).toHaveLength(1))

    act(() => {
      result.current.refresh()
    })
    await waitFor(() => expect(pending).toHaveLength(2))

    await act(async () => pending[1]({ outstanding: 1, by_material: { notes: 1 } }))
    await act(async () => pending[0]({ outstanding: 5, by_material: { notes: 5 } }))

    expect(result.current.known).toBe(true)
    expect(result.current.outstanding).toBe(1)
  })

  it('a refresh after a failed first read fills the count', async () => {
    let reads = 0
    vi.mocked(apiFetch).mockImplementation(async () => {
      reads += 1
      if (reads === 1) throw { code: 'internal_error', params: {} }
      return { outstanding: 2, by_material: {} }
    })
    const { result } = renderHook(() => useMistakes('a'))
    await waitFor(() => expect(reads).toBe(1))
    expect(result.current.known).toBe(false)

    await act(async () => result.current.refresh())

    expect(result.current.outstanding).toBe(2)
  })
})
