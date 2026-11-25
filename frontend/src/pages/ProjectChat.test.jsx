// Ask AI, the chat as the Project home (Story 4.4, FR-16): the Chat bar and Scope control, streamed
// answers ("thinking" until the first delta, no Send meanwhile, announced once), Source labels and the
// uncited "not covered" answer, the scope kept after a reload, the Limit notice and the limit message, a
// failed stream with "Try again", the read-only and no-Ready-file states, Enter / Shift+Enter, and
// Norwegian. api/client.js and auth/ are mocked (spine › Tests); test/fakeApi.js plays the backend and
// its event stream.
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { chatOf, fakeApi, material, project } from '../test/fakeApi.js'
import { i18n, renderRoute } from '../test/render.jsx'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

beforeEach(() => {
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
})

const FILES = {
  a: [material('m1', { file_name: 'notes.md' }), material('m2', { file_name: 'lecture.pdf' })],
}

function open(options = {}) {
  const state = fakeApi({ projects: [project('a', { name: 'Biology' })], materials: FILES, ...options })
  const view = renderRoute('/projects/a')
  return { state, ...view }
}

async function composer() {
  const field = await screen.findByRole('textbox', { name: en.chat.placeholder })
  await waitFor(() => expect(field).toBeEnabled())
  return field
}

const field = () => screen.getByRole('textbox', { name: en.chat.placeholder })
const sendButton = () =>screen.getByRole('button', { name: en.chat.send })
const scopeGroup = () => screen.getByRole('group', { name: en.chat.answerFrom })

async function ask(user, text) {
  await user.type(await composer(), text)
  await user.click(sendButton())
}

describe('The chat', () => {
  it('is the home view: the Chat bar with "All materials" selected, the thread, the tool buttons, and the composer', async () => {
    open()

    await composer()
    const bar = screen.getByTestId('chat-bar')
    expect(bar).toHaveTextContent(en.chat.answerFrom)
    const all = within(scopeGroup()).getByRole('button', { name: en.chat.allMaterials })
    expect(all).toHaveAttribute('aria-pressed', 'true')
    const oneFile = within(scopeGroup()).getByRole('button', { name: new RegExp(en.chat.oneFile) })
    expect(oneFile).toHaveAttribute('data-selected', 'false')
    expect(oneFile).not.toHaveAttribute('aria-pressed')
    expect(await screen.findByText(en.chat.empty)).toBeInTheDocument()
    const tools = screen.getByRole('group', { name: en.tools.label })
    expect(tools).toHaveTextContent(en.tools.label)
    expect(within(tools).getByRole('button', { name: en.tools.quiz })).toBeEnabled()
    // Order: Chat bar, thread, tools, composer.
    const thread = screen.getByTestId('chat-thread')
    expect(bar.compareDocumentPosition(thread) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(thread.compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(tools.compareDocumentPosition(await composer()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(sendButton()).toBeDisabled() // nothing typed yet
  })

  it('shows "thinking" until the first delta, streams the text, keeps Send off until done, then shows the sources and announces once', async () => {
    const user = userEvent.setup()
    const { state } = open({ chatStream: 'manual' })

    await ask(user, 'What is chlorophyll?')

    expect(state.chatSends).toEqual([{ text: 'What is chlorophyll?' }])
    expect(screen.getByTestId('chat-question')).toHaveTextContent('What is chlorophyll?')
    const pending = screen.getByTestId('chat-pending')
    expect(pending).toHaveAttribute('aria-live', 'polite')
    expect(pending).toHaveTextContent(en.chat.thinking)
    // The composer is off until the answer completes.
    expect(field()).toHaveValue('')
    expect(field()).toBeDisabled()
    expect(sendButton()).toBeDisabled()

    act(() => state.streams[0].delta('Chlorophyll absorbs '))
    expect(await screen.findByText('Chlorophyll absorbs')).toBeInTheDocument()
    expect(pending).toBeEmptyDOMElement()
    // Streamed text sits outside every live region.
    expect(screen.getByTestId('chat-streaming').closest('[aria-live]')).toBeNull()
    act(() => state.streams[0].delta('blue and red light.'))
    expect(await screen.findByText('Chlorophyll absorbs blue and red light.')).toBeInTheDocument()
    expect(sendButton()).toBeDisabled()
    expect(field()).toBeDisabled()
    expect(screen.getByTestId('chat-announce')).toBeEmptyDOMElement()

    act(() => state.streams[0].done([{ label: 'notes.md · Page 2' }]))

    const answer = await screen.findByTestId('chat-answer')
    expect(within(answer).getByText(en.chat.who)).toBeInTheDocument()
    expect(within(answer).getByText('Chlorophyll absorbs blue and red light.')).toBeInTheDocument()
    expect(within(answer).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['notes.md · Page 2'])
    expect(screen.queryByTestId('chat-streaming')).not.toBeInTheDocument()
    const announce = screen.getByTestId('chat-announce')
    expect(announce).toHaveTextContent(`${en.chat.answerReady} Chlorophyll absorbs blue and red light.`)
    // The composer is back on, with focus in the field.
    await waitFor(() => expect(field()).toBeEnabled())
    expect(field()).toHaveFocus()
    await user.type(field(), 'Next question')
    expect(sendButton()).toBeEnabled()
    // The Limit notice is a plain line, never a second live region next to the announcement.
    expect(screen.queryByRole('status', { name: /messages left/ })).not.toBeInTheDocument()
  })

  it('announces a second answer with the same text again', async () => {
    const user = userEvent.setup()
    open({ chatAnswer: () => ({ deltas: ['Same answer.'], sources: [] }) })

    await ask(user, 'First?')
    await waitFor(() => expect(screen.getByTestId('chat-announce')).toHaveTextContent('Same answer.'))
    const first = screen.getByTestId('chat-announce').firstChild

    await ask(user, 'Again?')
    await waitFor(() => expect(screen.getAllByTestId('chat-answer')).toHaveLength(2))

    const second = screen.getByTestId('chat-announce').firstChild
    expect(second).toHaveTextContent(`${en.chat.answerReady} Same answer.`)
    expect(second).not.toBe(first)
    expect(first.isConnected).toBe(false)
  })

  it('a "not covered" answer shows no Source labels', async () => {
    const user = userEvent.setup()
    open({ chatAnswer: () => ({ deltas: ["Your notes don't cover this."], sources: [] }) })

    await ask(user, 'Who won the World Cup?')

    const answer = await screen.findByTestId('chat-answer')
    expect(answer).toHaveTextContent("Your notes don't cover this.")
    expect(within(answer).queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('after a reload, both messages show with their Source labels and the scope as it was left', async () => {
    const user = userEvent.setup()
    const { state, unmount } = open()
    await composer()

    await user.click(within(scopeGroup()).getByRole('button', { name: new RegExp(en.chat.oneFile) }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'lecture.pdf' }))
    expect(state.scopeChanges).toEqual([{ scope: { material_id: 'm2' } }])
    const chosen = await within(scopeGroup()).findByRole('button', { name: /lecture\.pdf/ })
    expect(chosen).toHaveAttribute('data-selected', 'true')
    expect(within(scopeGroup()).getByRole('button', { name: en.chat.allMaterials })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await ask(user, 'What is chlorophyll?')
    await screen.findByTestId('chat-answer')
    unmount()

    renderRoute('/projects/a')

    const answer = await screen.findByTestId('chat-answer')
    expect(screen.getByTestId('chat-question')).toHaveTextContent('What is chlorophyll?')
    expect(answer).toHaveTextContent('From your notes.')
    expect(within(answer).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['notes.md · Page 1'])
    expect(within(scopeGroup()).getByRole('button', { name: /lecture\.pdf/ })).toHaveAttribute('data-selected', 'true')

    await user.click(within(scopeGroup()).getByRole('button', { name: en.chat.allMaterials }))
    await waitFor(() =>
      expect(within(scopeGroup()).getByRole('button', { name: en.chat.allMaterials })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )
    expect(state.scopeChanges.at(-1)).toEqual({ scope: { all_materials: true } })
  })

  it('shows "{n} messages left today" at 10 or fewer, and counts a sent message off', async () => {
    const user = userEvent.setup()
    open({ messagesLeft: 10 })

    expect(await screen.findByTestId('limit-notice')).toHaveTextContent('10 messages left today')
    await ask(user, 'What is chlorophyll?')
    await screen.findByTestId('chat-answer')

    expect(screen.getByTestId('limit-notice')).toHaveTextContent('9 messages left today')
  })

  it('shows no Limit notice above 10', async () => {
    open({ messagesLeft: 11 })

    await composer()
    expect(screen.queryByTestId('limit-notice')).not.toBeInTheDocument()
  })

  it('at 0 shows the limit message instead and turns Send off', async () => {
    const user = userEvent.setup()
    open({ messagesLeft: 0 })

    expect(await screen.findByTestId('limit-notice')).toHaveTextContent(en.chat.limitReached)
    await user.type(await composer(), 'One more?')
    expect(sendButton()).toBeDisabled()
  })

  it('a send the server declines at the limit shows the limit message and keeps the question', async () => {
    const user = userEvent.setup()
    const { state } = open({ messagesLeft: 3 })
    await composer()
    state.messagesLeft = 0 // used up in another tab

    await ask(user, 'One more?')

    expect(await screen.findByTestId('limit-notice')).toHaveTextContent(en.chat.limitReached)
    expect(await composer()).toHaveValue('One more?')
    expect(screen.queryByTestId('chat-question')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a failed stream removes the pending answer, puts the question back, and "Try again" resends it', async () => {
    const user = userEvent.setup()
    let calls = 0
    const { state } = open({
      chatAnswer: () => {
        calls += 1
        return calls === 1 ? { deltas: ['Half an '], error: 'llm_unavailable' } : { deltas: ['Whole answer.'], sources: [] }
      },
    })

    await ask(user, 'What is chlorophyll?')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(en.errors.llm_unavailable)
    expect(alert).toHaveTextContent(en.inlineError.reassurance)
    expect(screen.queryByText('Half an')).not.toBeInTheDocument()
    expect(screen.queryByTestId('chat-question')).not.toBeInTheDocument()
    expect(await composer()).toHaveValue('What is chlorophyll?')
    expect(screen.getByTestId('chat-pending')).toBeEmptyDOMElement()

    await user.click(within(alert).getByRole('button', { name: en.inlineError.retry }))

    expect(await screen.findByTestId('chat-answer')).toHaveTextContent('Whole answer.')
    expect(state.chatSends).toEqual([{ text: 'What is chlorophyll?' }, { text: 'What is chlorophyll?' }])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('Enter sends, and Shift+Enter starts a new line', async () => {
    const user = userEvent.setup()
    const { state } = open()
    const field = await composer()

    await user.type(field, 'First line{Shift>}{Enter}{/Shift}second line')
    expect(field).toHaveValue('First line\nsecond line')
    expect(state.chatSends).toEqual([])

    await user.type(field, '{Enter}')

    await waitFor(() => expect(state.chatSends).toEqual([{ text: 'First line\nsecond line' }]))
    expect(await screen.findByTestId('chat-answer')).toBeInTheDocument()
  })

  it('nothing can be typed or sent while an answer is streaming', async () => {
    const user = userEvent.setup()
    const { state } = open({ chatStream: 'manual' })

    await ask(user, 'First?')
    await user.type(field(), 'Second?{Enter}')

    expect(state.chatSends).toHaveLength(1)
    expect(field()).toBeDisabled()
    expect(field()).toHaveValue('')
  })

  it.each([
    ['project_read_only', en.errors.project_read_only],
    ['insufficient_material', en.errors.insufficient_material],
    ['not_found', en.errors.not_found],
    ['chat_busy', en.errors.generic],
  ])('a %s refusal shows its message with no "Try again", and the question is back', async (code, message) => {
    const user = userEvent.setup()
    open({
      routes: {
        'POST /api/chats/chat-a/messages': () => {
          throw { code, params: {} }
        },
      },
    })

    await ask(user, 'What is chlorophyll?')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(message)
    expect(within(alert).queryByRole('button', { name: en.inlineError.retry })).not.toBeInTheDocument()
    expect(alert).not.toHaveTextContent(en.inlineError.reassurance)
    expect(await composer()).toHaveValue('What is chlorophyll?')
  })

  it('a scoped file that is no longer Ready shows as "All materials"', async () => {
    open({
      materials: { a: [material('m1', { file_name: 'notes.md' }), material('m3', { status: 'processing' })] },
      routes: {
        'GET /api/projects/a/chat': (_, state) => {
          state.chats.a = chatOf('chat-a', { scope: { material_id: 'm3' } })
          return structuredClone(state.chats.a)
        },
      },
    })

    await composer()
    expect(within(scopeGroup()).getByRole('button', { name: en.chat.allMaterials })).toHaveAttribute('aria-pressed', 'true')
    const oneFile = within(scopeGroup()).getByRole('button', { name: new RegExp(en.chat.oneFile) })
    expect(oneFile).toHaveAttribute('data-selected', 'false')
  })

  it('leaving the chat aborts the stream: nothing is stored, and nothing carries over', async () => {
    const user = userEvent.setup()
    const { state, unmount } = open({ chatStream: 'manual' })

    await ask(user, 'What is chlorophyll?')
    expect(screen.getByTestId('chat-pending')).toHaveTextContent(en.chat.thinking)
    unmount()

    expect(state.aborted).toBe(1)
    renderRoute('/projects/a')
    expect(await composer()).toHaveValue('')
    expect(await screen.findByText(en.chat.empty)).toBeInTheDocument()
    expect(screen.queryByTestId('chat-question')).not.toBeInTheDocument()
    expect(screen.getByTestId('chat-pending')).toBeEmptyDOMElement()
  })

  it('switching Project aborts the stream, and the other Project starts clean', async () => {
    const user = userEvent.setup()
    const state = fakeApi({
      projects: [project('a', { name: 'Biology' }), project('b', { name: 'Chemistry' })],
      materials: { ...FILES, b: [material('m9', { file_name: 'atoms.md' })] },
      chatStream: 'manual',
    })
    const { router } = renderRoute('/projects/a')

    await ask(user, 'What is chlorophyll?')
    await act(() => router.navigate('/projects/b'))

    await waitFor(() => expect(state.aborted).toBe(1))
    expect(await composer()).toHaveValue('')
    expect(await screen.findByText(en.chat.empty)).toBeInTheDocument()
    expect(screen.queryByTestId('chat-question')).not.toBeInTheDocument()
    expect(screen.getByTestId('chat-pending')).toBeEmptyDOMElement()
    expect(state.chats.a.messages).toEqual([])
  })

  it('a read-only Project shows its thread, but the composer, Send, and scope are off', async () => {
    fakeApi({
      projects: [project('a', { archived_at: '2026-11-20T10:00:00Z' })],
      materials: FILES,
      chats: {
        a: chatOf('chat-a', {
          messages: [
            { id: 'q1', role: 'user', text: 'What is chlorophyll?', sources: [] },
            { id: 'a1', role: 'assistant', text: 'A pigment.', sources: [{ label: 'notes.md · Page 1' }] },
          ],
        }),
      },
    })
    renderRoute('/projects/a')

    expect(await screen.findByText('A pigment.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: en.chat.placeholder })).toBeDisabled()
    expect(sendButton()).toBeDisabled()
    for (const segment of within(scopeGroup()).getAllByRole('button')) expect(segment).toBeDisabled()
    expect(screen.queryByTestId('limit-notice')).not.toBeInTheDocument()
  })

  it('with no Ready file, the drop zone stands in for the chat and the composer is off', async () => {
    fakeApi({ projects: [project('a')], materials: { a: [material('m1', { status: 'processing' })] } })
    renderRoute('/projects/a')

    expect(await screen.findByTestId('drop-zone')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-bar')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: en.chat.placeholder })).toBeDisabled()
    expect(sendButton()).toBeDisabled()
  })

  it('is in Norwegian too', async () => {
    await i18n.changeLanguage('nb')
    const user = userEvent.setup()
    const { state } = open({ chatStream: 'manual', messagesLeft: 1 })

    const field = await screen.findByRole('textbox', { name: nb.chat.placeholder })
    await waitFor(() => expect(field).toBeEnabled())
    expect(screen.getByRole('group', { name: nb.chat.answerFrom })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: nb.chat.allMaterials })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: new RegExp(nb.chat.oneFile) })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: nb.tools.label })).toBeInTheDocument()
    expect(screen.getByTestId('limit-notice')).toHaveTextContent('1 melding igjen i dag')

    await user.type(field, 'Hva er klorofyll?')
    await user.click(screen.getByRole('button', { name: nb.chat.send }))

    expect(screen.getByTestId('chat-pending')).toHaveTextContent('Study Buddy tenker …')
    act(() => state.streams[0].delta('Et pigment.'))
    act(() => state.streams[0].done([]))
    expect(await screen.findByTestId('chat-announce')).toHaveTextContent('Svaret er klart Et pigment.')
    expect(screen.getByTestId('limit-notice')).toHaveTextContent(nb.chat.limitReached)
  })
})
