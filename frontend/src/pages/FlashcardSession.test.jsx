// Studying a flashcard set (Story 4.2, FR-14). api/client.js and auth/ are mocked (spine › Tests);
// test/fakeApi.js plays the backend: it derives the queue from the stored marks like the server, ends the
// set on the final "Got it", and refuses marks on an ended set.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { fakeApi, flashcardSet, material, project } from '../test/fakeApi.js'
import { i18n, renderRoute } from '../test/render.jsx'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

beforeEach(() => {
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
})

const READY = { a: [material('notes', { file_name: 'notes.pdf' })] }
const S = en.flashcards.session
const MARK = (n) => `POST /api/projects/a/flashcard-sets/s1/cards/s1-c${n}/mark`

/** Open set `s1` of Project `a`. */
async function openSet({ setOptions = {}, projectOverrides = {}, routes = {} } = {}) {
  const state = fakeApi({
    projects: [project('a', { name: 'Biology', ...projectOverrides })],
    materials: READY,
    flashcardSets: [flashcardSet('s1', 'a', setOptions)],
    routes,
  })
  const view = renderRoute('/projects/a/flashcard-sets/s1')
  return { state, ...view }
}

const card = () => screen.getByTestId('flashcard')
const gotIt = () => screen.getByRole('button', { name: S.gotIt })
const notYet = () => screen.getByRole('button', { name: S.notYet })
const live = () => screen.getByTestId('flashcard-live')

async function firstCard(text = 'Question 1?') {
  await waitFor(() => expect(card()).toHaveTextContent(text))
}

describe('Flashcard session', () => {
  it('opens on the first card: "1 of {total}", the bar, the term front, and no mark buttons yet', async () => {
    await openSet({ setOptions: { n: 3 } })
    await firstCard()

    expect(screen.getByText('1 of 3')).toBeInTheDocument()
    const bar = screen.getByRole('progressbar', { name: '1 of 3' })
    expect(bar).toHaveAttribute('aria-valuenow', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '3')
    expect(card()).toHaveTextContent(S.term)
    expect(card()).toHaveTextContent(S.flip)
    expect(card()).not.toHaveTextContent('Answer 1.')
    expect(live()).toBeEmptyDOMElement()
    expect(screen.queryByRole('button', { name: S.gotIt })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: S.notYet })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: S.stop })).toBeInTheDocument()
    expect(screen.queryByText(/cards were possible/)).not.toBeInTheDocument()
  })

  it('a click flips the card to the answer and its Source label, in the live region', async () => {
    await openSet()
    await firstCard()

    await userEvent.click(card())

    expect(live()).toHaveTextContent('Answer 1. · notes.pdf · Page 1')
    expect(live()).toHaveAttribute('aria-live', 'polite')
    expect(card()).not.toContainElement(live())
    expect(card()).toHaveTextContent('Answer 1.')
    expect(card()).toHaveTextContent('notes.pdf · Page 1')
    expect(card()).toHaveTextContent('Question 1?')
    expect(card()).not.toHaveTextContent(S.term)
    expect(gotIt()).toBeEnabled()
    expect(notYet()).toBeEnabled()

    await userEvent.click(card())
    expect(live()).toBeEmptyDOMElement()
  })

  it('Space flips the card, from the page or with the card focused', async () => {
    await openSet()
    await firstCard()

    await userEvent.keyboard(' ')
    expect(live()).toHaveTextContent('Answer 1.')

    card().focus()
    await userEvent.keyboard(' ')
    expect(live()).toBeEmptyDOMElement()
  })

  it('"Got it" (→) shows the next card with focus on it and fills the bar', async () => {
    const { state } = await openSet({ setOptions: { n: 3 } })
    await firstCard()

    await userEvent.keyboard('{ArrowRight}') // not flipped yet: nothing happens
    expect(state.flashcardMarks).toEqual([])

    await userEvent.keyboard(' ')
    await userEvent.keyboard('{ArrowRight}')

    await firstCard('Question 2?')
    expect(state.flashcardMarks).toEqual([{ card_id: 's1-c1', mark: 'got_it' }])
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
    expect(card()).toHaveFocus()
    expect(screen.queryByRole('button', { name: S.gotIt })).not.toBeInTheDocument()
  })

  it('"Not yet" (←) brings the card back after the others, and the end counts its second try', async () => {
    const { state } = await openSet({ setOptions: { n: 2 } })
    await firstCard()

    await userEvent.click(card())
    await userEvent.keyboard('{ArrowLeft}')
    await firstCard('Question 2?')
    expect(screen.getByText('1 of 2')).toBeInTheDocument()

    await userEvent.click(card())
    await userEvent.click(gotIt())
    await firstCard('Question 1?')
    expect(screen.getByText('2 of 2')).toBeInTheDocument()

    await userEvent.click(card())
    await userEvent.click(gotIt())

    const headline = await screen.findByRole('heading', { name: '2 cards done. 1 needed a second try' })
    expect(headline).toHaveFocus()
    expect(state.flashcardMarks.map((m) => [m.card_id, m.mark])).toEqual([
      ['s1-c1', 'not_yet'],
      ['s1-c2', 'got_it'],
      ['s1-c1', 'got_it'],
    ])
    expect(screen.queryByTestId('flashcard')).not.toBeInTheDocument()
  })

  it('a reload resumes where the marks left off', async () => {
    await openSet({ setOptions: { n: 3, marks: [[0, 'not_yet'], [1, 'got_it']] } })

    await firstCard('Question 3?')
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
  })

  it('the end screen reads "1 card done" in the singular, and "Make more cards" opens Flashcards setup', async () => {
    const { router } = await openSet({ setOptions: { n: 1 } })
    await firstCard()
    await userEvent.click(card())
    await userEvent.click(gotIt())

    expect(await screen.findByRole('heading', { name: '1 card done. 0 needed a second try' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: S.more }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a/flashcards'))
  })

  it('an ended set opens on the end screen with what was done', async () => {
    const { router } = await openSet({
      setOptions: { n: 4, marks: [[0, 'got_it'], [1, 'not_yet'], [2, 'not_yet'], [2, 'got_it']], ended: true },
    })

    expect(await screen.findByRole('heading', { name: '2 cards done. 2 needed a second try' })).toBeInTheDocument()
    expect(screen.queryByTestId('flashcard')).not.toBeInTheDocument()
    const actions = screen.getAllByRole('button').map((b) => b.textContent)
    expect(actions.slice(-3)).toEqual([S.more, en.history.again, en.activity.back])
    await userEvent.click(screen.getAllByRole('button', { name: en.activity.back }).at(-1))
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a'))
  })

  it('a mark refused with flashcard_set_ended reloads the set and shows the end screen', async () => {
    const { state } = await openSet({ setOptions: { n: 3, marks: [[0, 'got_it']] } })
    await firstCard('Question 2?')
    // The set ended meanwhile (idle, or another set opened).
    state.flashcardSets.s1.ended_at = '2026-11-23T12:30:00Z'

    await userEvent.click(card())
    await userEvent.click(gotIt())

    const headline = await screen.findByRole('heading', { name: '1 card done. 0 needed a second try' })
    await waitFor(() => expect(headline).toHaveFocus())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('"Stop for now" and "← Back to chat" return to the chat and write nothing', async () => {
    const { state, router } = await openSet()
    await firstCard()
    await userEvent.click(card())

    await userEvent.click(screen.getByRole('button', { name: S.stop }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a'))
    expect(state.flashcardMarks).toEqual([])

    await router.navigate('/projects/a/flashcard-sets/s1')
    await firstCard()
    await userEvent.click(screen.getByRole('button', { name: en.activity.back }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/a'))
    expect(state.flashcardMarks).toEqual([])
  })

  it('shows the fewer note on the first card when the set holds fewer cards than asked', async () => {
    await openSet({ setOptions: { n: 4, requested: 10 } })
    await firstCard()

    expect(screen.getByText('Only 4 cards were possible from this material.')).toBeInTheDocument()
    expect(screen.getByText('1 of 4')).toBeInTheDocument()
  })

  it('is read-only in an archived Project: the card flips, the mark buttons are disabled', async () => {
    const { state } = await openSet({ projectOverrides: { archived_at: '2026-11-20T10:00:00Z' } })
    await firstCard()
    expect(screen.getByRole('alert')).toHaveTextContent(en.errors.project_read_only)

    await userEvent.click(card())

    expect(live()).toHaveTextContent('Answer 1.')
    expect(gotIt()).toBeDisabled()
    expect(notYet()).toBeDisabled()
    await userEvent.keyboard('{ArrowRight}')
    expect(state.flashcardMarks).toEqual([])
  })

  it('a save refused as project_read_only turns the page read-only', async () => {
    await openSet({ routes: { [MARK(1)]: async () => Promise.reject({ code: 'project_read_only', params: {} }) } })
    await firstCard()
    await userEvent.click(card())

    await userEvent.click(gotIt())

    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.project_read_only)
    expect(gotIt()).toBeDisabled()
    expect(card()).toHaveTextContent('Question 1?')
  })

  it('a failed save keeps the card and shows "Try again" with focus, which sends the mark again', async () => {
    // Overrides replace the fake's handler; deleting one restores it.
    const routes = { [MARK(1)]: async () => Promise.reject({ code: 'internal_error', params: {} }) }
    const { state } = await openSet({ setOptions: { n: 2 }, routes })
    await firstCard()
    await userEvent.click(card())

    await userEvent.click(notYet())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(en.errors.generic)
    const retry = within(alert).getByRole('button', { name: en.inlineError.retry })
    await waitFor(() => expect(retry).toHaveFocus())
    expect(card()).toHaveTextContent('Question 1?')
    expect(screen.getByText('1 of 2')).toBeInTheDocument()

    delete routes[MARK(1)]
    await userEvent.click(retry)

    await firstCard('Question 2?')
    expect(state.flashcardMarks).toEqual([{ card_id: 's1-c1', mark: 'not_yet' }])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('"Try again" still sends the mark after the card was flipped back to the front', async () => {
    const routes = { [MARK(1)]: async () => Promise.reject({ code: 'internal_error', params: {} }) }
    const { state } = await openSet({ setOptions: { n: 2 }, routes })
    await firstCard()
    await userEvent.click(card())
    await userEvent.click(gotIt())
    const alert = await screen.findByRole('alert')

    await userEvent.click(card()) // back to the front
    expect(live()).toBeEmptyDOMElement()
    delete routes[MARK(1)]
    await userEvent.click(within(alert).getByRole('button', { name: en.inlineError.retry }))

    await firstCard('Question 2?')
    expect(state.flashcardMarks).toEqual([{ card_id: 's1-c1', mark: 'got_it' }])
  })

  it('a save refused as not_found shows its message with no "Try again"', async () => {
    await openSet({ routes: { [MARK(1)]: async () => Promise.reject({ code: 'not_found', params: {} }) } })
    await firstCard()
    await userEvent.click(card())

    await userEvent.click(gotIt())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(en.errors.not_found)
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument()
    expect(card()).toHaveTextContent('Question 1?')
  })

  it('flashcard_set_ended with a failing reload keeps the card with "Try again", which then shows the end screen', async () => {
    const routes = {}
    const { state } = await openSet({ setOptions: { n: 3, marks: [[0, 'got_it']] }, routes })
    await firstCard('Question 2?')
    state.flashcardSets.s1.ended_at = '2026-11-23T12:30:00Z'
    routes['GET /api/projects/a/flashcard-sets/s1'] = async () => Promise.reject({ code: 'internal_error', params: {} })

    await userEvent.click(card())
    await userEvent.click(gotIt())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(en.errors.generic)
    expect(card()).toHaveTextContent('Question 2?')

    delete routes['GET /api/projects/a/flashcard-sets/s1']
    await userEvent.click(within(alert).getByRole('button', { name: en.inlineError.retry }))

    expect(await screen.findByRole('heading', { name: '1 card done. 0 needed a second try' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('Space on a focused "Got it" or "Not yet" button presses it and does not flip', async () => {
    const { state } = await openSet({ setOptions: { n: 3 } })
    await firstCard()
    await userEvent.click(card())

    gotIt().focus()
    await userEvent.keyboard(' ')
    await firstCard('Question 2?')
    expect(live()).toBeEmptyDOMElement()

    await userEvent.click(card())
    notYet().focus()
    await userEvent.keyboard(' ')
    await firstCard('Question 3?')
    expect(live()).toBeEmptyDOMElement()
    expect(state.flashcardMarks).toEqual([
      { card_id: 's1-c1', mark: 'got_it' },
      { card_id: 's1-c2', mark: 'not_yet' },
    ])
  })

  it('ignores held keys (repeats): no flipping back and forth, no mark', async () => {
    const { state } = await openSet()
    await firstCard()

    fireEvent.keyDown(document.body, { key: ' ', repeat: true })
    expect(live()).toBeEmptyDOMElement()

    fireEvent.keyDown(document.body, { key: ' ' })
    expect(live()).toHaveTextContent('Answer 1.')
    fireEvent.keyDown(document.body, { key: ' ', repeat: true })
    fireEvent.keyDown(document.body, { key: 'ArrowRight', repeat: true })
    fireEvent.keyDown(document.body, { key: 'ArrowLeft', repeat: true })
    expect(live()).toHaveTextContent('Answer 1.')
    expect(state.flashcardMarks).toEqual([])
  })

  it('a missing set shows the Inline error with no "Try again"', async () => {
    fakeApi({ projects: [project('a')], materials: READY })
    renderRoute('/projects/a/flashcard-sets/nope')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(en.errors.not_found)
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument()
  })

  it('a missing Project goes to /projects', async () => {
    fakeApi({ projects: [] })
    const { router } = renderRoute('/projects/zzz/flashcard-sets/s1')

    await waitFor(() => expect(router.state.location.pathname).toBe('/projects'))
  })

  it('a failed read shows "Try again", which loads the set', async () => {
    const routes = { 'GET /api/projects/a/flashcard-sets/s1': async () => Promise.reject({ code: 'internal_error', params: {} }) }
    await openSet({ routes })

    const alert = await screen.findByRole('alert')
    delete routes['GET /api/projects/a/flashcard-sets/s1']
    await userEvent.click(within(alert).getByRole('button', { name: en.inlineError.retry }))

    await firstCard()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('ignores the keys while typing in a text input or with a modifier held', async () => {
    const { state } = await openSet()
    await firstCard()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    await userEvent.keyboard(' ')
    expect(live()).toBeEmptyDOMElement()

    input.blur()
    await userEvent.keyboard('{Shift>} {/Shift}')
    expect(live()).toBeEmptyDOMElement()

    await userEvent.keyboard(' ')
    input.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(state.flashcardMarks).toEqual([])
    input.remove()
  })

  it('is in Norwegian too', async () => {
    await i18n.changeLanguage('nb')
    await openSet({ setOptions: { n: 1 } })
    const N = nb.flashcards.session
    await firstCard()

    expect(screen.getByText('1 av 1')).toBeInTheDocument()
    expect(card()).toHaveTextContent('Begrep')
    expect(card()).toHaveTextContent('Klikk for å snu')
    expect(screen.getByRole('button', { name: N.stop })).toHaveTextContent('Stopp for nå')
    await userEvent.click(card())
    expect(screen.getByRole('button', { name: N.notYet })).toHaveTextContent('Ikke ennå')
    await userEvent.click(screen.getByRole('button', { name: N.gotIt }))

    expect(await screen.findByRole('heading', { name: '1 treningskort ferdig. 0 trengte et nytt forsøk' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: N.more })).toHaveTextContent('Lag flere treningskort')
  })
})
