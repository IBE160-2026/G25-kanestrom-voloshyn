// Detect and show the Topics (Story 2.6a, FR-22, AD-21): the Topic count on a Ready row, the read-only
// Topic list with its groups, collapse, keyboard use, and the Grouped-topics note. api/client.js and
// auth/ are mocked (spine › Tests); test/fakeApi.js plays the backend for the panel test.
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { fakeApi, material, project, topics } from '../test/fakeApi.js'
import { i18n, renderRoute, renderWithI18n } from '../test/render.jsx'
import FileRow from './FileRow.jsx'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

beforeEach(() => {
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
})

function row(overrides) {
  renderWithI18n(
    <ul>
      <FileRow material={material('m', { file_name: 'lecture.pdf', ...overrides })} />
    </ul>,
  )
  return screen.getAllByRole('listitem')[0]
}

const groupName = (chapter, count, strings = en) =>
  (count === 1 ? strings.files.topics.group_one : strings.files.topics.group_other)
    .replace('{{chapter}}', chapter)
    .replace('{{count}}', count)

describe('Topic count and list', () => {
  it('shows "{n} topics" and the chips for a Ready file, in order', () => {
    const li = row({ topics: topics(6) })

    expect(within(li).getByText('6 topics')).toBeInTheDocument()
    const chips = within(li).getByRole('region', { name: '6 topics' })
    expect(within(chips).getAllByRole('listitem').map((chip) => chip.textContent)).toEqual([
      'Topic 1',
      'Topic 2',
      'Topic 3',
      'Topic 4',
      'Topic 5',
      'Topic 6',
    ])
    // Ungrouped: no group rows, and no editing yet (Story 2.6b).
    expect(within(li).queryAllByRole('button')).toEqual([])
    expect(within(li).queryByText(en.files.topics.grouped)).not.toBeInTheDocument()
  })

  it('uses the singular for one topic', () => {
    const li = row({ topics: topics(1) })
    expect(within(li).getByText('1 topic')).toBeInTheDocument()
  })

  it('shows the count and list for a partly unreadable file too', () => {
    const li = row({ warning: true, warning_pages: [2], topics: topics(3) })
    expect(within(li).getByText('3 topics')).toBeInTheDocument()
    expect(within(li).getByText('Topic 3')).toBeInTheDocument()
  })

  it.each([
    ['Reading…', { status: 'processing' }],
    ['Rejected', { status: 'rejected', reject_reason: 'unreadable' }],
  ])('shows no count or list for a %s file', (_, overrides) => {
    const li = row({ ...overrides, topics: topics(3) })
    expect(within(li).queryByText('3 topics')).not.toBeInTheDocument()
    expect(within(li).queryByRole('region')).not.toBeInTheDocument()
    expect(within(li).queryByText('Topic 1')).not.toBeInTheDocument()
  })

  it('shows groups expanded at 20 topics or fewer', () => {
    const li = row({ topics: topics(20, { groupSize: 10 }) })

    const part1 = within(li).getByRole('button', { name: groupName('Part 1', 10) })
    expect(part1).toHaveAttribute('aria-expanded', 'true')
    expect(within(li).getByText('Topic 1')).toBeInTheDocument()
    expect(within(li).getByText('Topic 20')).toBeInTheDocument()
  })

  it('collapses groups above 20 topics; a click, Enter, or Space toggles one and aria-expanded follows', async () => {
    const user = userEvent.setup()
    const li = row({ topics: topics(25, { groupSize: 10 }) })

    const rows = within(li).getAllByRole('button')
    expect(rows.map((b) => b.getAttribute('aria-label'))).toEqual([
      groupName('Part 1', 10),
      groupName('Part 2', 10),
      groupName('Part 3', 5),
    ])
    expect(rows.every((b) => b.getAttribute('aria-expanded') === 'false')).toBe(true)
    expect(within(li).queryByText('Topic 1')).not.toBeInTheDocument()

    await user.click(rows[0])
    expect(rows[0]).toHaveAttribute('aria-expanded', 'true')
    expect(within(li).getByText('Topic 1')).toBeInTheDocument()
    expect(within(li).queryByText('Topic 11')).not.toBeInTheDocument()

    // Keyboard: Tab reaches the scrolling list, then each group row; Enter and Space toggle.
    rows[0].blur()
    await user.tab()
    expect(within(li).getByRole('region', { name: '25 topics' })).toHaveFocus()
    await user.tab()
    expect(rows[0]).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(rows[0]).toHaveAttribute('aria-expanded', 'false')
    expect(within(li).queryByText('Topic 1')).not.toBeInTheDocument()
    await user.tab()
    expect(rows[1]).toHaveFocus()
    await user.keyboard(' ')
    expect(rows[1]).toHaveAttribute('aria-expanded', 'true')
    expect(within(li).getByText('Topic 11')).toBeInTheDocument()
  })

  it('keeps server order with interleaved groups and ungrouped Topics', async () => {
    const user = userEvent.setup()
    const t = (n, group) => ({ id: `t-${n}`, label: `Topic ${n}`, group_label: group, position: n - 1 })
    const li = row({
      topics: [t(1, null), t(2, 'A'), t(3, 'constructor'), t(4, null), t(5, 'A'), t(6, 'A')],
    })

    // Every run expanded (6 topics): chips in server order, each run under its own row.
    const chips = within(li).getAllByText(/^Topic \d$/).map((chip) => chip.textContent)
    expect(chips).toEqual(['Topic 1', 'Topic 2', 'Topic 3', 'Topic 4', 'Topic 5', 'Topic 6'])
    const rows = within(li).getAllByRole('button')
    expect(rows.map((b) => b.getAttribute('aria-label'))).toEqual([
      groupName('A', 1),
      groupName('constructor', 1),
      groupName('A', 2),
    ])

    // Toggling the "constructor" run collapses only that run.
    await user.click(rows[1])
    expect(rows[1]).toHaveAttribute('aria-expanded', 'false')
    expect(within(li).queryByText('Topic 3')).not.toBeInTheDocument()
    expect(rows[0]).toHaveAttribute('aria-expanded', 'true')
    expect(rows[2]).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows the Grouped-topics note at the 100-topic ceiling only', () => {
    const li = row({ topics: topics(100, { groupSize: 10 }) })
    expect(within(li).getByText('100 topics')).toBeInTheDocument()
    expect(within(li).getByText(en.files.topics.grouped)).toBeInTheDocument()
    expect(within(li).getAllByRole('button')).toHaveLength(10)
  })

  it('shows no note below the ceiling', () => {
    const li = row({ topics: topics(99, { groupSize: 10 }) })
    expect(within(li).queryByText(en.files.topics.grouped)).not.toBeInTheDocument()
  })

  it('works in Norwegian, with plurals', async () => {
    await i18n.changeLanguage('nb')
    const li = row({ topics: topics(100, { groupSize: 10 }) })

    expect(within(li).getByText('100 emner')).toBeInTheDocument()
    expect(within(li).getByText(nb.files.topics.grouped)).toBeInTheDocument()
    expect(within(li).getByRole('button', { name: groupName('Part 1', 10, nb) })).toBeInTheDocument()
    expect(i18n.t('files.topics.count', { count: 1 })).toBe('1 emne')
    expect(i18n.t('files.topics.group', { chapter: 'Kapittel 1', count: 1 })).toBe('Kapittel 1, 1 emne')
  })

  it('shows the Topics the server lists in the Files panel', async () => {
    fakeApi({
      projects: [project('a')],
      materials: {
        a: [
          material('ok', { file_name: 'notes.pdf', topics: topics(4) }),
          material('x', { file_name: 'blank.pdf', status: 'rejected', reject_reason: 'unreadable' }),
        ],
      },
    })
    renderRoute('/projects/a')

    const panel = await screen.findByRole('complementary', { name: /^Files · / })
    expect(await within(panel).findByText('4 topics')).toBeInTheDocument()
    expect(within(panel).getByText('Topic 4')).toBeInTheDocument()
    expect(within(panel).getAllByText(/ topics?$/)).toHaveLength(1)
  })
})
