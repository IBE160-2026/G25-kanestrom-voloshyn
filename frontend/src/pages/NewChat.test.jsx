// "New chat" (Story 4.5, FR-16): a fresh, empty chat on "All materials" while the previous one is kept
// unchanged; the button keeps focus, is off exactly when the composer is (no Ready file, read-only, an
// answer streaming), and a failure shows the Inline error with the current chat kept. api/client.js and
// auth/ are mocked (spine › Tests); test/fakeApi.js plays the backend.
import { screen, waitFor, within } from '@testing-library/react'
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

const FILES = { a: [material('m1', { file_name: 'notes.md' })] }
const THREAD = [
  { id: 'q1', role: 'user', text: 'What is chlorophyll?', sources: [] },
  { id: 'a1', role: 'assistant', text: 'A pigment.', sources: [{ label: 'notes.md · Page 1' }] },
]

function open(options = {}) {
  const state = fakeApi({
    projects: [project('a', { name: 'Biology' })],
    materials: FILES,
    chats: { a: chatOf('chat-a', { scope: { material_id: 'm1' }, messages: structuredClone(THREAD) }) },
    ...options,
  })
  renderRoute('/projects/a')
  return state
}

const newChatButton = () => screen.getByRole('button', { name: en.chat.newChat })
const field = () => screen.getByRole('textbox', { name: en.chat.placeholder })
const scopeGroup = () => screen.getByRole('group', { name: en.chat.answerFrom })

describe('New chat', () => {
  it('opens a fresh, empty chat on "All materials", keeps focus, and leaves the previous chat unchanged', async () => {
    const user = userEvent.setup()
    const state = open()
    expect(await screen.findByText('A pigment.')).toBeInTheDocument()
    await user.type(field(), 'a half-typed question')

    await user.click(newChatButton())

    expect(await screen.findByText(en.chat.empty)).toBeInTheDocument()
    expect(screen.queryByText('A pigment.')).not.toBeInTheDocument()
    expect(field()).toHaveValue('a half-typed question') // a typed draft stays
    expect(within(scopeGroup()).getByRole('button', { name: en.chat.allMaterials })).toHaveAttribute('aria-pressed', 'true')
    expect(newChatButton()).toHaveFocus()
    expect(state.earlierChats).toHaveLength(1)
    expect(state.earlierChats[0]).toMatchObject({ id: 'chat-a', current_scope: { material_id: 'm1' } })
    expect(state.earlierChats[0].messages).toEqual(THREAD)
  })

  it('answers in the new chat, so its messages never join the previous one', async () => {
    const user = userEvent.setup()
    const state = open()
    await screen.findByText('A pigment.')
    await user.click(newChatButton())
    await screen.findByText(en.chat.empty)

    await user.type(field(), 'What is the Calvin cycle?')
    await user.click(screen.getByRole('button', { name: en.chat.send }))

    expect(await screen.findByTestId('chat-answer')).toHaveTextContent('From your notes.')
    expect(state.chats.a.id).not.toBe('chat-a')
    expect(state.chats.a.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(state.earlierChats[0].messages).toEqual(THREAD)
    expect(newChatButton()).toBeEnabled() // on again once the answer completes
  })

  it('is off while an answer streams', async () => {
    const user = userEvent.setup()
    open({ chatStream: 'manual' })
    await screen.findByText('A pigment.')
    await waitFor(() => expect(newChatButton()).toBeEnabled())

    await user.type(field(), 'What is a stoma?')
    await user.click(screen.getByRole('button', { name: en.chat.send }))

    await waitFor(() => expect(newChatButton()).toBeDisabled())
  })

  it('reuses an empty chat instead of adding another one', async () => {
    const user = userEvent.setup()
    const state = open()
    await screen.findByText('A pigment.')
    await user.click(newChatButton())
    await screen.findByText(en.chat.empty)
    const fresh = state.chats.a.id

    await user.click(newChatButton())

    await waitFor(() => expect(newChatButton()).toBeEnabled())
    expect(state.chats.a.id).toBe(fresh)
    expect(state.earlierChats).toHaveLength(1)
  })

  it('is off in a read-only Project, where the thread still shows', async () => {
    fakeApi({
      projects: [project('a', { archived_at: '2026-11-20T10:00:00Z' })],
      materials: FILES,
      chats: { a: chatOf('chat-a', { messages: structuredClone(THREAD) }) },
    })
    renderRoute('/projects/a')

    expect(await screen.findByText('A pigment.')).toBeInTheDocument()
    expect(newChatButton()).toBeDisabled()
  })

  it('is not there before a file is Ready, while the drop zone stands in for the chat', async () => {
    fakeApi({ projects: [project('a')], materials: { a: [] } })
    renderRoute('/projects/a')

    expect(await screen.findByTestId('drop-zone')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.chat.newChat })).not.toBeInTheDocument()
  })

  it('a failure shows the Inline error and keeps the current chat', async () => {
    const user = userEvent.setup()
    const state = open({
      routes: {
        'POST /api/projects/a/chats': () => {
          throw Object.assign(new Error('down'), { code: 'internal_error', params: {} })
        },
      },
    })
    await screen.findByText('A pigment.')

    await user.click(newChatButton())

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('A pigment.')).toBeInTheDocument()
    expect(state.earlierChats).toHaveLength(0)
  })

  it('is in Norwegian too', async () => {
    await i18n.changeLanguage('nb')
    try {
      open()
      expect(await screen.findByRole('button', { name: nb.chat.newChat })).toBeInTheDocument()
      expect(nb.chat.newChat).toBe('Ny samtale')
    } finally {
      await i18n.changeLanguage('en')
    }
  })
})
