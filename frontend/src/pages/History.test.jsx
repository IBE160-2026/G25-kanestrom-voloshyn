// History (Story 5.1, FR-25, FR-8): the History link in the Chat bar, the list newest first with each
// type's row, the filter, loading, empty, a failed load with "Try again" (focused), "Show more", opening
// each type (a chat through GET /api/chats/{id}), a read-only Project, the dates, and Norwegian.
// api/client.js and auth/ are mocked (spine › Tests); test/fakeApi.js plays the backend.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { callsTo, chatOf, fakeApi, historyItem, material, project } from '../test/fakeApi.js'
import { i18n, renderRoute } from '../test/render.jsx'
import { formatDate } from './historyDates.js'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

beforeEach(() => {
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
})

const FILES = { a: [material('m1', { file_name: 'notes.md' })] }
const ITEMS = [
  historyItem('quiz', 'q1', { title: 'Mitosis, Meiosis', question_count: 20, answered_count: 20, correct_count: 17 }),
  historyItem('flashcards', 'f1', { title: null, card_count: 10 }),
  historyItem('chat', 'c1', { title: 'What does the kinetochore do?', message_count: 4, scope_file_name: null }),
  historyItem('summary', 's1', { title: 'Meiosis', file_name: 'lecture-04.pptx' }),
  historyItem('quiz', 'q2', { title: 'Cell cycle', question_count: 10, answered_count: 3, correct_count: 2 }),
  historyItem('chat', 'c2', { title: 'Tell me about notes', message_count: 2, scope_file_name: 'notes.md' }),
]

function open(options = {}, path = '/projects/a/history') {
  const state = fakeApi({
    projects: [project('a', { name: 'Biology' })],
    materials: FILES,
    history: { a: ITEMS },
    ...options,
  })
  return { state, ...renderRoute(path) }
}

const rows = () => within(screen.getByRole('list', { name: en.history.title })).getAllByRole('button')
const filterGroup = () => screen.getByRole('group', { name: en.history.filter.label })
const backButton = () => screen.getByRole('button', { name: en.activity.back })

describe('History', () => {
  it('opens from the History link in the Chat bar, replacing the chat, and "← Back to chat" returns', async () => {
    const user = userEvent.setup()
    const { router } = open({ chats: { a: chatOf('chat-a') } }, '/projects/a')

    const link = await screen.findByRole('link', { name: en.history.link })
    // The link sits right of "New chat".
    const newChat = screen.getByRole('button', { name: en.chat.newChat })
    expect(newChat.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await user.click(link)

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a/history'))
    expect(await screen.findByText('Mitosis, Meiosis')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: en.chat.placeholder })).not.toBeInTheDocument()

    await user.click(backButton())
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a'))
  })

  it('lists every item newest first, with its type label, title, and meta line', async () => {
    open()

    await screen.findByText('Mitosis, Meiosis')
    const texts = rows().map((row) => row.textContent)
    expect(texts).toHaveLength(6)
    const row = (n) => within(rows()[n])
    expect(row(0).getByText('Quiz')).toBeInTheDocument()
    expect(row(0).getByText('17 of 20 correct')).toBeInTheDocument()
    expect(row(1).getByText('Flashcards')).toBeInTheDocument()
    expect(row(1).getByText(en.history.allTopics)).toBeInTheDocument()
    expect(row(1).getByText('10 cards')).toBeInTheDocument()
    expect(row(2).getByText('Chat')).toBeInTheDocument()
    expect(row(2).getByText('What does the kinetochore do?')).toBeInTheDocument()
    expect(row(2).getByText('4 messages · all materials')).toBeInTheDocument()
    expect(row(3).getByText('Summary')).toBeInTheDocument()
    expect(row(3).getByText('Meiosis')).toBeInTheDocument()
    expect(row(3).getByText('lecture-04.pptx')).toBeInTheDocument()
    expect(row(4).getByText('Unfinished · 3 of 10')).toBeInTheDocument()
    expect(row(5).getByText('2 messages · notes.md')).toBeInTheDocument()
  })

  it('filters by type with aria-pressed, asking the server for that type only', async () => {
    const user = userEvent.setup()
    open()
    await screen.findByText('Mitosis, Meiosis')
    expect(within(filterGroup()).getByRole('button', { name: en.history.filter.all })).toHaveAttribute('aria-pressed', 'true')

    const quizzes = within(filterGroup()).getByRole('button', { name: en.history.filter.quiz })
    await user.click(quizzes)

    await waitFor(() => expect(rows()).toHaveLength(2))
    expect(quizzes).toHaveAttribute('aria-pressed', 'true')
    expect(within(filterGroup()).getByRole('button', { name: en.history.filter.all })).toHaveAttribute('aria-pressed', 'false')
    expect(callsTo('/api/projects/a/history?type=quiz')).toHaveLength(1)
    expect(screen.queryByText('What does the kinetochore do?')).not.toBeInTheDocument()
  })

  it('shows static skeleton rows while loading, with "Loading history" for screen readers, and the filter usable', async () => {
    const user = userEvent.setup()
    let release
    const pending = new Promise((resolve) => {
      release = resolve
    })
    open({ routes: { 'GET /api/projects/a/history': () => pending } })

    expect(await screen.findByRole('status')).toHaveTextContent(en.history.loading)
    expect(screen.queryByRole('list', { name: en.history.title })).not.toBeInTheDocument()
    // The filter stays usable while the first page loads.
    await user.click(within(filterGroup()).getByRole('button', { name: en.history.filter.summary }))
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(screen.getByText('lecture-04.pptx')).toBeInTheDocument()
    release({ items: [], next_cursor: null })
  })

  it('an empty History, or a filter with no match, says "Nothing here yet" with the filter still shown', async () => {
    const user = userEvent.setup()
    open({ history: { a: [historyItem('quiz', 'q1')] } })
    await screen.findByText('4 of 5 correct')

    await user.click(within(filterGroup()).getByRole('button', { name: en.history.filter.chat }))

    expect(await screen.findByRole('heading', { name: en.history.emptyTitle })).toBeInTheDocument()
    expect(screen.getByText(en.history.emptyBody)).toBeInTheDocument()
    expect(filterGroup()).toBeInTheDocument()
  })

  it('a failed load shows the Inline error with "Try again", which takes focus and reloads the current filter', async () => {
    const user = userEvent.setup()
    let failures = 1
    const { state } = open({
      routes: {
        'GET /api/projects/a/history?type=summary': (_body, live) => {
          if (failures-- > 0) throw { code: 'internal_error', params: {} }
          return { items: live.history.a.filter((item) => item.type === 'summary'), next_cursor: null }
        },
      },
    })
    await screen.findByText('Mitosis, Meiosis')
    await user.click(within(filterGroup()).getByRole('button', { name: en.history.filter.summary }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(en.history.loadError)
    const retry = within(alert).getByRole('button', { name: en.inlineError.retry })
    await waitFor(() => expect(retry).toHaveFocus())
    expect(filterGroup()).toBeInTheDocument()
    expect(backButton()).toBeInTheDocument()

    await user.click(retry)

    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(state.history.a).toHaveLength(6)
  })

  it('another Account\'s or a missing Project shows the Inline error with no "Try again"', async () => {
    open({}, '/projects/zzz/history')

    const alert = await screen.findByRole('alert')
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument()
  })

  it('"Show more" appends the next page', async () => {
    const user = userEvent.setup()
    open({ historyPageSize: 4 })
    await screen.findByText('Mitosis, Meiosis')
    expect(rows()).toHaveLength(4)

    await user.click(screen.getByRole('button', { name: en.history.showMore }))

    await waitFor(() => expect(rows()).toHaveLength(6))
    expect(screen.queryByRole('button', { name: en.history.showMore })).not.toBeInTheDocument()
    expect(callsTo('/api/projects/a/history?cursor=4')).toHaveLength(1)
    // Focus moves to the first appended row, not to the page body.
    await waitFor(() => expect(rows()[4]).toHaveFocus())
  })

  it('a failed "Show more" keeps the rows, and "Try again" fetches that page again and appends it', async () => {
    const user = userEvent.setup()
    let failures = 1
    open({
      historyPageSize: 4,
      routes: {
        'GET /api/projects/a/history?cursor=4': (_body, live) => {
          if (failures-- > 0) throw { code: 'internal_error', params: {} }
          return { items: live.history.a.slice(4), next_cursor: null }
        },
      },
    })
    await screen.findByText('Mitosis, Meiosis')

    await user.click(screen.getByRole('button', { name: en.history.showMore }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(en.history.loadError)
    expect(rows()).toHaveLength(4)
    const firstPage = callsTo('/api/projects/a/history').length

    await user.click(within(alert).getByRole('button', { name: en.inlineError.retry }))

    await waitFor(() => expect(rows()).toHaveLength(6))
    expect(screen.getByText('2 messages · notes.md')).toBeInTheDocument()
    expect(callsTo('/api/projects/a/history?cursor=4')).toHaveLength(2)
    expect(callsTo('/api/projects/a/history')).toHaveLength(firstPage)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await waitFor(() => expect(rows()[4]).toHaveFocus())
  })

  it.each([
    ['Mitosis, Meiosis', '/projects/a/quizzes/q1'],
    ['10 cards', '/projects/a/flashcard-sets/f1'],
    ['lecture-04.pptx', '/projects/a/summaries/s1'],
  ])('opening the row with "%s" goes to %s', async (text, path) => {
    const user = userEvent.setup()
    const { router } = open()

    await user.click((await screen.findByText(text)).closest('button'))

    await waitFor(() => expect(router.state.location.pathname).toBe(path))
  })

  it('opening a chat row opens it through GET /api/chats/{id}, and the Project home shows that chat', async () => {
    const user = userEvent.setup()
    const earlier = chatOf('c1', {
      messages: [
        { id: 'u1', role: 'user', text: 'What does the kinetochore do?', sources: [] },
        { id: 'a1', role: 'assistant', text: 'It anchors spindle fibres.', sources: [] },
      ],
    })
    const { state, router } = open({ chats: { a: chatOf('chat-a') }, storedChats: [{ project_id: 'a', chat: earlier }] })

    await user.click((await screen.findByText('What does the kinetochore do?')).closest('button'))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a'))
    expect(state.chatOpens).toEqual(['c1'])
    expect(await screen.findByText('It anchors spindle fibres.')).toBeInTheDocument()
    // It can be continued in an active Project.
    expect(screen.getByRole('textbox', { name: en.chat.placeholder })).toBeEnabled()
  })

  it('a chat that fails to open shows the Inline error with no "Try again" and stays in History', async () => {
    const user = userEvent.setup()
    const { state, router } = open({ chats: { a: chatOf('chat-a') } })

    await user.click((await screen.findByText('What does the kinetochore do?')).closest('button'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(en.errors.not_found)
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument()
    expect(state.chatOpens).toEqual(['c1'])
    expect(router.state.location.pathname).toBe('/projects/a/history')
  })

  it('a read-only Project lists and opens items, and its History link works', async () => {
    const user = userEvent.setup()
    const earlier = chatOf('c1', { messages: [{ id: 'a1', role: 'assistant', text: 'An old answer.', sources: [] }] })
    const { state, router } = open(
      {
        projects: [project('a', { name: 'Biology', archived_at: '2026-11-21T10:00:00Z' })],
        chats: { a: chatOf('chat-a', { messages: [{ id: 'x', role: 'assistant', text: 'Current.', sources: [] }] }) },
        storedChats: [{ project_id: 'a', chat: earlier }],
      },
      '/projects/a',
    )

    const link = await screen.findByRole('link', { name: en.history.link })
    await user.click(link)
    await user.click((await screen.findByText('What does the kinetochore do?')).closest('button'))

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a'))
    expect(state.chatOpens).toEqual(['c1'])
    expect(await screen.findByText('An old answer.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: en.chat.placeholder })).toBeDisabled()
  })

  it('formats dates as "Today, HH:MM", "Yesterday", a short date, and the year when not this year', () => {
    const now = new Date(2026, 10, 26, 15, 0)
    const t = i18n.getFixedT('en')
    expect(formatDate(t, new Date(2026, 10, 26, 9, 5).toISOString(), 'en', now)).toBe('Today, 09:05')
    expect(formatDate(t, new Date(2026, 10, 26, 0, 5).toISOString(), 'en', now)).toBe('Today, 00:05')
    expect(formatDate(t, new Date(2026, 10, 25, 23, 59).toISOString(), 'en', now)).toBe('Yesterday')
    expect(formatDate(t, new Date(2026, 9, 10, 12, 0).toISOString(), 'en', now)).toBe('Oct 10')
    expect(formatDate(t, new Date(2025, 9, 10, 12, 0).toISOString(), 'en', now)).toBe('Oct 10, 2025')

    const tNb = i18n.getFixedT('nb')
    expect(formatDate(tNb, new Date(2026, 10, 26, 9, 5).toISOString(), 'nb', now)).toBe('I dag, 09:05')
    expect(formatDate(tNb, new Date(2026, 10, 25, 8, 0).toISOString(), 'nb', now)).toBe('I går')
  })

  it('reads in Norwegian', async () => {
    await i18n.changeLanguage('nb')
    try {
      open()
      expect(await screen.findByText('17 av 20 riktige')).toBeInTheDocument()
      expect(screen.getByText('Ikke fullført · 3 av 10')).toBeInTheDocument()
      expect(screen.getByText('10 kort')).toBeInTheDocument()
      expect(screen.getByText('4 meldinger · alt materiale')).toBeInTheDocument()
      expect(screen.getAllByText('Samtale')).toHaveLength(2)
      expect(screen.getByRole('group', { name: nb.history.filter.label })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Treningskort' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: nb.activity.back })).toBeInTheDocument()
    } finally {
      await i18n.changeLanguage('en')
    }
  })
})
