// Edit the Topics in each file (Story 2.6b, FR-22, AD-21): rename, delete, add, and merge from the
// Files panel's Topic list, failures with and without "Try again", read-only Projects, and Norwegian.
// api/client.js and auth/ are mocked (spine › Tests); test/fakeApi.js plays the backend.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { callsTo, fakeApi, material, project, topics } from '../test/fakeApi.js'
import { i18n, renderRoute } from '../test/render.jsx'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

beforeEach(() => {
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
})

function panel() {
  return screen.getByRole('complementary', { name: /^(Files|Filer) · / })
}

function list(count) {
  return within(panel()).getByRole('region', { name: `${count} topics` })
}

function chipLabels(region) {
  return within(region)
    .getAllByRole('listitem')
    .map((chip) => chip.textContent)
}

async function openProject({ files = [material('m', { file_name: 'lecture.pdf', topics: topics(3) })], ...options } = {}) {
  const state = fakeApi({ projects: [project('a')], materials: { a: files }, ...options })
  renderRoute('/projects/a')
  await within(await screen.findByRole('complementary', { name: /^(Files|Filer) · / })).findAllByRole('region')
  return state
}

const deleteName = (label, strings = en) => strings.files.topics.delete.replace('{{label}}', label)

describe('Rename', () => {
  it('a click opens the field; Enter saves the trimmed label and focus returns to the chip', async () => {
    const user = userEvent.setup()
    await openProject()

    await user.click(within(list(3)).getByRole('button', { name: 'Topic 2' }))
    const field = within(panel()).getByRole('textbox', { name: en.files.topics.rename })
    expect(field).toHaveValue('Topic 2')
    expect(field).toHaveFocus()
    await user.clear(field)
    await user.type(field, '  Cell cycle {Enter}')

    expect(callsTo('/api/projects/a/topics/t-2', 'PATCH')).toEqual([
      ['/api/projects/a/topics/t-2', { method: 'PATCH', body: { label: 'Cell cycle' } }],
    ])
    await waitFor(() => expect(chipLabels(list(3))).toEqual(['Topic 1', 'Cell cycle', 'Topic 3']))
    expect(within(panel()).queryByRole('textbox')).not.toBeInTheDocument()
    await waitFor(() => expect(within(list(3)).getByRole('button', { name: 'Cell cycle' })).toHaveFocus())
  })

  it('Esc cancels without saving', async () => {
    const user = userEvent.setup()
    await openProject()

    await user.click(within(list(3)).getByRole('button', { name: 'Topic 1' }))
    await user.type(within(panel()).getByRole('textbox', { name: en.files.topics.rename }), ' changed{Escape}')

    expect(within(panel()).queryByRole('textbox')).not.toBeInTheDocument()
    expect(chipLabels(list(3))).toEqual(['Topic 1', 'Topic 2', 'Topic 3'])
    expect(callsTo('/api/projects/a/topics/t-1', 'PATCH')).toEqual([])
    await waitFor(() => expect(within(list(3)).getByRole('button', { name: 'Topic 1' })).toHaveFocus())
  })

  it.each([
    ['blank', '   '],
    ['unchanged', 'Topic 1'],
  ])('a %s label closes without saving', async (_, value) => {
    const user = userEvent.setup()
    await openProject()

    await user.click(within(list(3)).getByRole('button', { name: 'Topic 1' }))
    const field = within(panel()).getByRole('textbox', { name: en.files.topics.rename })
    await user.clear(field)
    await user.type(field, `${value}{Enter}`)

    expect(within(panel()).queryByRole('textbox')).not.toBeInTheDocument()
    expect(chipLabels(list(3))).toEqual(['Topic 1', 'Topic 2', 'Topic 3'])
    expect(callsTo('/api/projects/a/topics/t-1', 'PATCH')).toEqual([])
  })

  it('Enter on a chip reached with Tab opens the rename field', async () => {
    const user = userEvent.setup()
    await openProject()

    within(list(3)).getByRole('button', { name: 'Topic 1' }).focus()
    await user.keyboard('{Enter}')

    expect(within(panel()).getByRole('textbox', { name: en.files.topics.rename })).toHaveValue('Topic 1')
  })
})

describe('Delete', () => {
  it('× deletes a chip and the count updates', async () => {
    const user = userEvent.setup()
    await openProject()

    await user.click(within(panel()).getByRole('button', { name: deleteName('Topic 2') }))

    expect(callsTo('/api/projects/a/topics/t-2', 'DELETE')).toHaveLength(1)
    await waitFor(() => expect(chipLabels(list(2))).toEqual(['Topic 1', 'Topic 3']))
    expect(within(panel()).getByText('2 topics')).toBeInTheDocument()
    // Focus stays in the list.
    await waitFor(() => expect(within(list(2)).getByRole('button', { name: 'Topic 3' })).toHaveFocus())
  })

  it('the last chip has no ×, but can still be renamed', async () => {
    await openProject({ files: [material('m', { topics: topics(1) })] })

    expect(within(panel()).queryByRole('button', { name: /^Delete topic/ })).not.toBeInTheDocument()
    expect(within(panel()).getByRole('button', { name: 'Topic 1' })).toBeInTheDocument()
  })

  it('the chips, each ×, and "+ Add topic" can be reached with Tab', async () => {
    const user = userEvent.setup()
    await openProject({ files: [material('m', { topics: topics(2) })] })
    const region = list(2)

    within(region).getByRole('button', { name: 'Topic 1' }).focus()
    await user.tab()
    expect(within(region).getByRole('button', { name: deleteName('Topic 1') })).toHaveFocus()
    await user.tab()
    expect(within(region).getByRole('button', { name: 'Topic 2' })).toHaveFocus()
    await user.tab()
    expect(within(region).getByRole('button', { name: deleteName('Topic 2') })).toHaveFocus()
    await user.tab()
    expect(within(panel()).getByRole('button', { name: en.files.topics.add })).toHaveFocus()
  })
})

describe('Add', () => {
  it('"+ Add topic" opens the field; Enter adds the Topic last', async () => {
    const user = userEvent.setup()
    await openProject()

    await user.click(within(panel()).getByRole('button', { name: en.files.topics.add }))
    await user.type(within(panel()).getByRole('textbox', { name: en.files.topics.new }), ' Mitosis {Enter}')

    expect(callsTo('/api/projects/a/materials/m/topics', 'POST')).toEqual([
      ['/api/projects/a/materials/m/topics', { method: 'POST', body: { label: 'Mitosis' } }],
    ])
    await waitFor(() => expect(chipLabels(list(4))).toEqual(['Topic 1', 'Topic 2', 'Topic 3', 'Mitosis']))
    expect(within(panel()).getByText('4 topics')).toBeInTheDocument()
    await waitFor(() => expect(within(panel()).getByRole('button', { name: en.files.topics.add })).toHaveFocus())
  })

  it('a blank new Topic closes without saving', async () => {
    const user = userEvent.setup()
    await openProject()

    await user.click(within(panel()).getByRole('button', { name: en.files.topics.add }))
    await user.type(within(panel()).getByRole('textbox', { name: en.files.topics.new }), '  {Enter}')

    expect(within(panel()).queryByRole('textbox')).not.toBeInTheDocument()
    expect(callsTo('/api/projects/a/materials/m/topics', 'POST')).toEqual([])
  })
})

describe('Merge', () => {
  it('Ctrl+click selects; with 2 selected, Merge merges and opens the merged Topic for rename', async () => {
    const user = userEvent.setup()
    await openProject({ files: [material('m', { topics: topics(4) })] })
    expect(within(panel()).queryByRole('button', { name: en.files.topics.merge })).not.toBeInTheDocument()

    await user.keyboard('{Control>}')
    await user.click(within(list(4)).getByRole('button', { name: 'Topic 3' }))
    expect(within(list(4)).getByRole('button', { name: 'Topic 3' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(panel()).queryByRole('button', { name: en.files.topics.merge })).not.toBeInTheDocument()
    await user.click(within(list(4)).getByRole('button', { name: 'Topic 2' }))
    await user.keyboard('{/Control}')
    expect(within(panel()).queryByRole('textbox')).not.toBeInTheDocument()

    await user.click(within(panel()).getByRole('button', { name: en.files.topics.merge }))

    expect(callsTo('/api/projects/a/topics/merge', 'POST')).toEqual([
      ['/api/projects/a/topics/merge', { method: 'POST', body: { topic_ids: ['t-2', 't-3'] } }],
    ])
    const field = await within(panel()).findByRole('textbox', { name: en.files.topics.rename })
    expect(field).toHaveValue('Topic 2')
    expect(field).toHaveFocus()
    expect(within(panel()).getByText('3 topics')).toBeInTheDocument()
    expect(within(panel()).queryByRole('button', { name: en.files.topics.merge })).not.toBeInTheDocument()
    await user.clear(field)
    await user.type(field, 'Cell division{Enter}')
    await waitFor(() => expect(chipLabels(list(3))).toEqual(['Topic 1', 'Cell division', 'Topic 4']))
  })

  it('Space selects and unselects a chip without renaming it', async () => {
    const user = userEvent.setup()
    await openProject()
    const first = within(list(3)).getByRole('button', { name: 'Topic 1' })

    first.focus()
    await user.keyboard(' ')
    expect(first).toHaveAttribute('aria-pressed', 'true')
    expect(within(panel()).queryByRole('textbox')).not.toBeInTheDocument()
    await user.keyboard(' ')
    expect(first).toHaveAttribute('aria-pressed', 'false')

    await user.keyboard(' ')
    within(list(3)).getByRole('button', { name: 'Topic 3' }).focus()
    await user.keyboard(' ')
    await user.click(within(panel()).getByRole('button', { name: en.files.topics.merge }))

    expect(callsTo('/api/projects/a/topics/merge', 'POST')[0][1].body).toEqual({ topic_ids: ['t-1', 't-3'] })
    expect(await within(panel()).findByRole('textbox', { name: en.files.topics.rename })).toHaveValue('Topic 1')
  })
})

describe('Failures', () => {
  it('a network or server failure shows the Inline error with "Try again", which repeats the edit', async () => {
    const user = userEvent.setup()
    let calls = 0
    await openProject({
      routes: {
        'DELETE /api/projects/a/topics/t-1': (_, state) => {
          calls += 1
          if (calls === 1) throw { code: 'internal_error', params: {} }
          const file = state.materials.a[0]
          file.topics = file.topics.filter((t) => t.id !== 't-1')
          return { material_id: 'm', topics: file.topics }
        },
      },
    })

    await user.click(within(panel()).getByRole('button', { name: deleteName('Topic 1') }))

    const alert = await within(panel()).findByRole('alert')
    expect(alert).toHaveTextContent(en.files.topics.failed)
    const retry = within(alert).getByRole('button', { name: en.inlineError.retry })
    await waitFor(() => expect(retry).toHaveFocus())
    expect(chipLabels(list(3))).toEqual(['Topic 1', 'Topic 2', 'Topic 3'])
    expect(within(panel()).getByText('3 topics')).toBeInTheDocument()

    await user.click(retry)

    expect(calls).toBe(2)
    await waitFor(() => expect(chipLabels(list(2))).toEqual(['Topic 2', 'Topic 3']))
    expect(within(panel()).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a refusal that names a rule shows only its message, with no "Try again"', async () => {
    const user = userEvent.setup()
    await openProject({ files: [material('m', { topics: topics(100) })] })

    await user.click(within(panel()).getByRole('button', { name: en.files.topics.add }))
    await user.type(within(panel()).getByRole('textbox', { name: en.files.topics.new }), 'One more{Enter}')

    const alert = await within(panel()).findByRole('alert')
    expect(alert).toHaveTextContent(en.errors.topic_limit_reached)
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument()
    expect(within(panel()).getByText('100 topics')).toBeInTheDocument()
  })

  it('a refused rename shows the Topic copy for invalid_name', async () => {
    const user = userEvent.setup()
    await openProject({
      routes: {
        'PATCH /api/projects/a/topics/t-1': () => {
          throw { code: 'invalid_name', params: {} }
        },
      },
    })

    await user.click(within(list(3)).getByRole('button', { name: 'Topic 1' }))
    await user.type(within(panel()).getByRole('textbox', { name: en.files.topics.rename }), 'x{Enter}')

    const alert = await within(panel()).findByRole('alert')
    expect(alert).toHaveTextContent(en.files.topics.invalidName)
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument()
    expect(chipLabels(list(3))).toEqual(['Topic 1', 'Topic 2', 'Topic 3'])
  })
})

describe('Read-only and Norwegian', () => {
  it('a read-only Project shows the Topic list without edit controls', async () => {
    await openProject({ projects: [project('a', { archived_at: '2026-11-17T10:00:00Z' })] })

    expect(chipLabels(list(3))).toEqual(['Topic 1', 'Topic 2', 'Topic 3'])
    expect(within(list(3)).queryAllByRole('button')).toEqual([])
    expect(within(panel()).queryByRole('button', { name: en.files.topics.add })).not.toBeInTheDocument()
  })

  it('works in Norwegian', async () => {
    const user = userEvent.setup()
    await i18n.changeLanguage('nb')
    await openProject({
      routes: {
        'DELETE /api/projects/a/topics/t-2': () => {
          throw { code: 'internal_error', params: {} }
        },
      },
    })
    const region = within(panel()).getByRole('region', { name: '3 emner' })

    expect(within(panel()).getByRole('button', { name: nb.files.topics.add })).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: deleteName('Topic 1', nb) })).toBeInTheDocument()

    await user.click(within(region).getByRole('button', { name: 'Topic 1' }))
    expect(within(panel()).getByRole('textbox', { name: nb.files.topics.rename })).toBeInTheDocument()
    await user.keyboard('{Escape}')

    await user.click(within(region).getByRole('button', { name: deleteName('Topic 2', nb) }))
    const alert = await within(panel()).findByRole('alert')
    expect(alert).toHaveTextContent(nb.files.topics.failed)
    expect(within(alert).getByRole('button', { name: nb.inlineError.retry })).toBeInTheDocument()

    await user.keyboard('{Control>}')
    await user.click(within(region).getByRole('button', { name: 'Topic 1' }))
    await user.click(within(region).getByRole('button', { name: 'Topic 3' }))
    await user.keyboard('{/Control}')
    expect(within(panel()).getByRole('button', { name: nb.files.topics.merge })).toBeInTheDocument()
  })
})

describe('Grouped files', () => {
  const groupRow = (chapter, count) =>
    within(panel()).getByRole('button', { name: `${chapter}, ${count} ${count === 1 ? 'topic' : 'topics'}` })

  it('renames a chip inside a group', async () => {
    const user = userEvent.setup()
    await openProject({ files: [material('m', { topics: topics(6, { groupSize: 3 }) })] })

    await user.click(within(list(6)).getByRole('button', { name: 'Topic 2' }))
    const field = within(panel()).getByRole('textbox', { name: en.files.topics.rename })
    await user.clear(field)
    await user.type(field, 'Mitosis{Enter}')

    await waitFor(() => expect(within(list(6)).getByRole('button', { name: 'Mitosis' })).toBeInTheDocument())
    expect(groupRow('Part 1', 3)).toHaveAttribute('aria-expanded', 'true')
    expect(groupRow('Part 2', 3)).toBeInTheDocument()
  })

  it('× inside a group deletes the chip and updates the group count', async () => {
    const user = userEvent.setup()
    await openProject({ files: [material('m', { topics: topics(6, { groupSize: 3 }) })] })

    await user.click(within(panel()).getByRole('button', { name: deleteName('Topic 5') }))

    await waitFor(() => expect(groupRow('Part 2', 2)).toBeInTheDocument())
    expect(groupRow('Part 1', 3)).toBeInTheDocument()
    expect(within(list(5)).queryByRole('button', { name: 'Topic 5' })).not.toBeInTheDocument()
  })

  it("a group's only chip has a × while the file has other Topics, and deleting it removes the group", async () => {
    const user = userEvent.setup()
    await openProject({ files: [material('m', { topics: topics(4, { groupSize: 3 }) })] })
    expect(groupRow('Part 2', 1)).toBeInTheDocument()

    await user.click(within(panel()).getByRole('button', { name: deleteName('Topic 4') }))

    await waitFor(() => expect(chipLabels(list(3))).toEqual(['Topic 1', 'Topic 2', 'Topic 3']))
    expect(within(panel()).queryByRole('button', { name: /^Part 2,/ })).not.toBeInTheDocument()
  })

  it('Ctrl+click merges across two groups and the group counts update', async () => {
    const user = userEvent.setup()
    await openProject({ files: [material('m', { topics: topics(6, { groupSize: 3 }) })] })

    await user.keyboard('{Control>}')
    await user.click(within(list(6)).getByRole('button', { name: 'Topic 2' }))
    await user.click(within(list(6)).getByRole('button', { name: 'Topic 5' }))
    await user.keyboard('{/Control}')
    await user.click(within(panel()).getByRole('button', { name: en.files.topics.merge }))

    expect(callsTo('/api/projects/a/topics/merge', 'POST')[0][1].body).toEqual({ topic_ids: ['t-2', 't-5'] })
    expect(await within(panel()).findByRole('textbox', { name: en.files.topics.rename })).toHaveValue('Topic 2')
    expect(groupRow('Part 1', 3)).toBeInTheDocument()
    expect(groupRow('Part 2', 2)).toBeInTheDocument()
    expect(within(panel()).getByText('5 topics')).toBeInTheDocument()
  })

  it('after a delete whose neighbour sits in a collapsed group, focus goes to "+ Add topic"', async () => {
    const user = userEvent.setup()
    await openProject({ files: [material('m', { topics: topics(24, { groupSize: 12 }) })] })
    await user.click(groupRow('Part 1', 12))

    await user.click(within(panel()).getByRole('button', { name: deleteName('Topic 12') }))

    await waitFor(() => expect(groupRow('Part 1', 11)).toBeInTheDocument())
    await waitFor(() => expect(within(panel()).getByRole('button', { name: en.files.topics.add })).toHaveFocus())
  })
})

describe('A Topic that is gone', () => {
  it('a not_found failure shows its message without "Try again" and fetches the list again', async () => {
    const user = userEvent.setup()
    await openProject({
      routes: {
        'DELETE /api/projects/a/topics/t-1': (_, state) => {
          // Deleted elsewhere meanwhile: the server no longer has it.
          const file = state.materials.a[0]
          file.topics = file.topics.filter((t) => t.id !== 't-1')
          throw { code: 'not_found', params: {} }
        },
      },
    })
    const listsBefore = callsTo('/api/projects/a/materials').length

    await user.click(within(panel()).getByRole('button', { name: deleteName('Topic 1') }))

    const alert = await within(panel()).findByRole('alert')
    expect(alert).toHaveTextContent(en.errors.not_found)
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument()
    await waitFor(() => expect(chipLabels(list(2))).toEqual(['Topic 2', 'Topic 3']))
    expect(callsTo('/api/projects/a/materials').length).toBe(listsBefore + 1)
  })
})

describe('Merge mode', () => {
  const menuButton = (name) => within(panel()).getByRole('button', { name: `More options for ${name}` })

  async function startMergeMode(user, name = 'lecture.pdf', strings = en) {
    const trigger = within(panel()).getByRole('button', {
      name: strings.files.remove.menu.replace('{{name}}', name),
    })
    await user.click(trigger)
    await user.click(await screen.findByRole('menuitem', { name: strings.files.topics.mergeTopics }))
    return trigger
  }

  async function menuItems(user, name) {
    await user.click(menuButton(name))
    const items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent)
    await user.keyboard('{Escape}')
    return items
  }

  it('"Merge topics" shows only for a Ready file with 2+ Topics in an active Project', async () => {
    const user = userEvent.setup()
    await openProject({
      files: [
        material('m', { file_name: 'lecture.pdf', topics: topics(3) }),
        material('w', { file_name: 'scan.pdf', warning: true, warning_pages: [2], topics: topics(2) }),
        material('one', { file_name: 'single.pdf', topics: topics(1) }),
        material('r', { file_name: 'reading.pdf', status: 'processing' }),
      ],
    })

    expect(await menuItems(user, 'lecture.pdf')).toEqual([en.files.topics.mergeTopics, en.files.remove.item])
    expect(await menuItems(user, 'scan.pdf')).toEqual([en.files.topics.mergeTopics, en.files.remove.item])
    expect(await menuItems(user, 'single.pdf')).toEqual([en.files.remove.item])
    expect(await menuItems(user, 'reading.pdf')).toEqual([en.files.remove.item])
  })

  it('offers no "Merge topics" in a read-only Project', async () => {
    await openProject({ projects: [project('a', { archived_at: '2026-11-17T10:00:00Z' })] })
    expect(within(panel()).queryByRole('button', { name: /More options/ })).not.toBeInTheDocument()
  })

  it('plain clicks select; Merge is enabled at 2, sends both ids, and opens rename on the survivor', async () => {
    const user = userEvent.setup()
    await openProject({ files: [material('m', { file_name: 'lecture.pdf', topics: topics(4) })] })

    await startMergeMode(user)

    expect(within(panel()).getByText(en.files.topics.mergeHint)).toBeInTheDocument()
    await waitFor(() => expect(within(list(4)).getByRole('button', { name: 'Topic 1' })).toHaveFocus())
    expect(within(panel()).queryByRole('button', { name: /^Delete topic/ })).not.toBeInTheDocument()
    expect(within(panel()).queryByRole('button', { name: en.files.topics.add })).not.toBeInTheDocument()
    const merge = within(panel()).getByRole('button', { name: en.files.topics.merge })
    expect(merge).toBeDisabled()

    await user.click(within(list(4)).getByRole('button', { name: 'Topic 3' }))
    expect(within(panel()).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(list(4)).getByRole('button', { name: 'Topic 3' })).toHaveAttribute('aria-pressed', 'true')
    expect(merge).toBeDisabled()
    within(list(4)).getByRole('button', { name: 'Topic 2' }).focus()
    await user.keyboard(' ')
    expect(merge).toBeEnabled()

    await user.click(merge)

    expect(callsTo('/api/projects/a/topics/merge', 'POST')).toEqual([
      ['/api/projects/a/topics/merge', { method: 'POST', body: { topic_ids: ['t-2', 't-3'] } }],
    ])
    const field = await within(panel()).findByRole('textbox', { name: en.files.topics.rename })
    expect(field).toHaveValue('Topic 2')
    expect(within(panel()).queryByText(en.files.topics.mergeHint)).not.toBeInTheDocument()
    expect(within(panel()).getByText('3 topics')).toBeInTheDocument()
  })

  it.each([
    ['Cancel', async (user) => user.click(within(panel()).getByRole('button', { name: en.files.topics.cancel }))],
    ['Esc', async (user) => user.keyboard('{Escape}')],
  ])('%s ends the mode with nothing sent and focus back on "···"', async (_, end) => {
    const user = userEvent.setup()
    await openProject()
    const trigger = await startMergeMode(user)
    await user.click(within(list(3)).getByRole('button', { name: 'Topic 1' }))
    await user.click(within(list(3)).getByRole('button', { name: 'Topic 2' }))

    await end(user)

    expect(within(panel()).queryByText(en.files.topics.mergeHint)).not.toBeInTheDocument()
    expect(within(panel()).queryByRole('button', { name: en.files.topics.merge })).not.toBeInTheDocument()
    expect(within(list(3)).getByRole('button', { name: 'Topic 1' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(panel()).getByRole('button', { name: en.files.topics.add })).toBeInTheDocument()
    expect(callsTo('/api/projects/a/topics/merge', 'POST')).toEqual([])
    await waitFor(() => expect(trigger).toHaveFocus())
    // Back outside the mode, a click renames again.
    await user.click(within(list(3)).getByRole('button', { name: 'Topic 1' }))
    expect(within(panel()).getByRole('textbox', { name: en.files.topics.rename })).toBeInTheDocument()
  })

  it('works in Norwegian', async () => {
    const user = userEvent.setup()
    await i18n.changeLanguage('nb')
    await openProject()

    await startMergeMode(user, 'lecture.pdf', nb)

    expect(within(panel()).getByText(nb.files.topics.mergeHint)).toBeInTheDocument()
    expect(within(panel()).getByRole('button', { name: nb.files.topics.merge })).toBeDisabled()
    await user.click(within(panel()).getByRole('button', { name: nb.files.topics.cancel }))
    expect(within(panel()).queryByText(nb.files.topics.mergeHint)).not.toBeInTheDocument()
  })
})
