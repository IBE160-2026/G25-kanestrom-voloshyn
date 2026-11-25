// The Summary view (Story 4.3, FR-15): the scope line, the model's title and sections with their Source
// labels, "Saved to History", "← Back to chat", a missing summary, and Norwegian.
// api/client.js and auth/ are mocked (spine › Tests); test/fakeApi.js plays the backend.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import { fakeApi, material, project, summary } from '../test/fakeApi.js'
import { i18n, renderRoute } from '../test/render.jsx'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

beforeEach(() => {
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
})

const MATERIALS = { a: [material('m1', { file_name: 'notes.md' })] }

function open(summaries, options = {}) {
  fakeApi({ projects: [project('a')], materials: MATERIALS, summaries, ...options })
  return renderRoute('/projects/a/summaries/sum-1')
}

describe('Summary view', () => {
  it('shows the scope line, the title, and each section with its Source labels', async () => {
    open([summary('sum-1', 'a', { n: 2 })])

    const title = await screen.findByRole('heading', { level: 2, name: 'Photosynthesis' })
    expect(screen.getByText('Summary of notes.md · whole file')).toBeInTheDocument()
    expect(title).toBeInTheDocument()
    const sections = screen.getAllByRole('heading', { level: 3 })
    expect(sections.map((h) => h.textContent)).toEqual(['Heading 1', 'Heading 2'])
    const first = sections[0].closest('section')
    expect(within(first).getByText('Text 1.')).toBeInTheDocument()
    expect(within(first).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['notes.md · Page 1'])
    const second = sections[1].closest('section')
    expect(within(second).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['notes.md · Page 2'])
  })

  it('names the chosen Topic in the scope line', async () => {
    open([summary('sum-1', 'a', { topicLabel: 'Calvin cycle' })])

    expect(await screen.findByText('Summary of notes.md · Calvin cycle')).toBeInTheDocument()
  })

  it('splits a section into paragraphs at blank lines', async () => {
    const found = summary('sum-1', 'a', { n: 1 })
    found.sections[0].text = 'First part.\n\nSecond part.'
    open([found])

    expect(await screen.findByText('First part.')).toBeInTheDocument()
    expect(screen.getByText('Second part.')).toBeInTheDocument()
  })

  it('ends with "Saved to History" and "← Back to chat" (primary), which returns to the chat', async () => {
    const { router } = open([summary('sum-1', 'a')])

    await screen.findByRole('heading', { name: 'Photosynthesis' })
    const saved = screen.getByText(en.summary.saved)
    const end = saved.parentElement
    const back = within(end).getByRole('button', { name: en.activity.back })
    expect(saved.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await userEvent.click(back)

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a'))
  })

  it('opens in an archived Project too', async () => {
    open([summary('sum-1', 'a')], { projects: [project('a', { archived_at: '2026-11-18T10:00:00Z' })] })

    expect(await screen.findByRole('heading', { name: 'Photosynthesis' })).toBeInTheDocument()
  })

  it('a missing or foreign summary shows the Inline error with no Try again', async () => {
    open([summary('sum-1', 'b')], { projects: [project('a'), project('b')] })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(en.errors.not_found)
    expect(within(alert).queryByRole('button', { name: en.inlineError.retry })).not.toBeInTheDocument()
    expect(screen.queryByText(en.summary.saved)).not.toBeInTheDocument()
  })

  it('moves focus to the summary title once it shows', async () => {
    open([summary('sum-1', 'a')])

    const title = await screen.findByRole('heading', { level: 2, name: 'Photosynthesis' })
    await waitFor(() => expect(title).toHaveFocus())
  })

  it('a failed read shows "Try again", which loads the summary', async () => {
    const routes = { 'GET /api/projects/a/summaries/sum-1': async () => Promise.reject({ code: 'internal_error', params: {} }) }
    open([summary('sum-1', 'a')], { routes })

    const alert = await screen.findByRole('alert')
    delete routes['GET /api/projects/a/summaries/sum-1']
    await userEvent.click(within(alert).getByRole('button', { name: en.inlineError.retry }))

    expect(await screen.findByRole('heading', { name: 'Photosynthesis' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a missing Project goes to the Projects page', async () => {
    fakeApi({ projects: [project('b')], summaries: [] })
    const { router } = renderRoute('/projects/a/summaries/sum-1')

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'))
  })

  it('is in Norwegian too, leaving the model text as written', async () => {
    await i18n.changeLanguage('nb')
    open([summary('sum-1', 'a', { topicLabel: 'Calvin cycle' })])

    expect(await screen.findByText('Sammendrag av notes.md · Calvin cycle')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Photosynthesis' })).toBeInTheDocument()
    expect(screen.getByText('Lagret i historikken')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '← Tilbake til samtalen' })).toHaveLength(2)
  })

  it('reads "hele filen" for a whole-file summary in Norwegian', async () => {
    await i18n.changeLanguage('nb')
    open([summary('sum-1', 'a')])

    expect(await screen.findByText('Sammendrag av notes.md · hele filen')).toBeInTheDocument()
  })
})
