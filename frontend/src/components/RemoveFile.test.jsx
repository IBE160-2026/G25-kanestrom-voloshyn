// Remove a file (Story 2.7, FR-20, AD-23): the "···" menu, the Remove file dialog, the immediate
// Rejected removal, failures, the count, and focus. api/client.js and auth/ are mocked (spine › Tests);
// test/fakeApi.js plays the backend.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSession } from '../auth/index.js'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { POLL_MS } from '../pages/useProjectFiles.js'
import { callsTo, fakeApi, material, project } from '../test/fakeApi.js'
import { i18n, renderRoute } from '../test/render.jsx'

vi.mock('../auth/index.js', async () => (await import('../test/mocks.js')).authMock())
vi.mock('../api/client.js', async () => (await import('../test/mocks.js')).clientMock())

beforeEach(() => {
  vi.mocked(hasSession).mockReset().mockResolvedValue(true)
})

afterEach(() => {
  vi.useRealTimers()
})

const FILES = [
  material('r', { file_name: 'lecture.pdf', status: 'processing' }),
  material('ok', { file_name: 'notes.pdf' }),
  material('w', { file_name: 'scan.pdf', warning: true, warning_pages: [2] }),
  material('x', { file_name: 'blank.pdf', status: 'rejected', reject_reason: 'unreadable' }),
]

function panel() {
  return screen.getByRole('complementary', { name: /^(Files|Filer) · / })
}

async function openProject({ files = FILES, ...options } = {}) {
  const state = fakeApi({
    projects: [project('a')],
    materials: { a: files },
    jobs: [{ id: 'j-r', project_id: 'a', kind: 'material_processing', status: 'running', result_ref: 'r' }],
    ...options,
  })
  renderRoute('/projects/a')
  await screen.findByRole('button', { name: /^(Upload|Last opp)$/ })
  if (files.length > 0) await within(panel()).findAllByRole('listitem')
  else await within(panel()).findByText(en.files.empty)
  return state
}

const deletes = (id) => callsTo(`/api/projects/a/materials/${id}`, 'DELETE')

/** Open the "···" menu of `name` and choose Remove; returns the trigger. */
async function chooseRemove(user, name, strings = en) {
  const trigger = within(panel()).getByRole('button', { name: strings.files.remove.menu.replace('{{name}}', name) })
  await user.click(trigger)
  await user.click(await screen.findByRole('menuitem', { name: strings.files.remove.item }))
  return trigger
}

describe('Remove a file', () => {
  it('gives Reading…, Ready, and partly-readable rows a "···" menu and Rejected rows a Remove button', async () => {
    await openProject()
    const rows = within(panel()).getAllByRole('listitem')
    for (const [row, name] of [[rows[0], 'lecture.pdf'], [rows[1], 'notes.pdf'], [rows[2], 'scan.pdf']]) {
      expect(within(row).getByRole('button', { name: `More options for ${name}` })).toBeInTheDocument()
      expect(within(row).queryByRole('button', { name: en.files.remove.item })).not.toBeInTheDocument()
    }
    expect(within(rows[3]).queryByRole('button', { name: /More options/ })).not.toBeInTheDocument()
    expect(within(rows[3]).getByRole('button', { name: en.files.remove.item })).toBeInTheDocument()
  })

  it('removes a Ready file through the dialog: the row leaves, the count updates, focus goes to Upload', async () => {
    const user = userEvent.setup()
    await openProject()
    expect(screen.getByRole('heading', { name: 'Files · 3 of 10' })).toBeInTheDocument()

    await chooseRemove(user, 'notes.pdf')
    const dialog = await screen.findByRole('dialog', { name: 'Remove notes.pdf?' })
    expect(dialog).toHaveTextContent(en.files.remove.body)
    expect(within(dialog).getByRole('button', { name: en.files.remove.cancel })).toHaveFocus()
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: en.files.remove.confirm }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(deletes('ok')).toHaveLength(1)
    expect(within(panel()).queryByTitle('notes.pdf')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Files · 2 of 10' })).toBeInTheDocument()
    await waitFor(() => expect(within(panel()).getByRole('button', { name: en.files.upload })).toHaveFocus())
  })

  it('shows the short body for a Reading… file and frees its slot at once', async () => {
    const user = userEvent.setup()
    const state = await openProject()

    await chooseRemove(user, 'lecture.pdf')
    const dialog = await screen.findByRole('dialog', { name: 'Remove lecture.pdf?' })
    expect(dialog).toHaveTextContent(en.files.remove.reading)
    expect(dialog).not.toHaveTextContent(en.files.remove.body)
    await user.click(within(dialog).getByRole('button', { name: en.files.remove.confirm }))

    await waitFor(() => expect(within(panel()).queryByTitle('lecture.pdf')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Files · 2 of 10' })).toBeInTheDocument()
    expect(state.jobs[0].status).toBe('cancelled')
  })

  it('removes a Rejected file at once, with no dialog', async () => {
    const user = userEvent.setup()
    await openProject()
    const row = within(panel()).getAllByRole('listitem')[3]

    await user.click(within(row).getByRole('button', { name: en.files.remove.item }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(within(panel()).queryByTitle('blank.pdf')).not.toBeInTheDocument())
    expect(deletes('x')).toHaveLength(1)
    // A Rejected file never held a slot.
    expect(screen.getByRole('heading', { name: 'Files · 3 of 10' })).toBeInTheDocument()
    await waitFor(() => expect(within(panel()).getByRole('button', { name: en.files.upload })).toHaveFocus())
  })

  it.each([
    ['Cancel', async (user, dialog) => user.click(within(dialog).getByRole('button', { name: en.files.remove.cancel }))],
    ['Esc', async (user) => user.keyboard('{Escape}')],
  ])('%s closes the dialog, removes nothing, and returns focus to the "···" trigger', async (_, close) => {
    const user = userEvent.setup()
    await openProject()
    const trigger = await chooseRemove(user, 'notes.pdf')
    const dialog = await screen.findByRole('dialog', { name: 'Remove notes.pdf?' })

    await close(user, dialog)

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(deletes('ok')).toHaveLength(0)
    expect(within(panel()).getByTitle('notes.pdf')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Files · 3 of 10' })).toBeInTheDocument()
  })

  it('keeps the dialog open with the Inline error on failure, and Try again removes the file', async () => {
    const user = userEvent.setup()
    let fail = true
    let release
    const state = await openProject({
      routes: {
        'DELETE /api/projects/a/materials/ok': async (_, s) => {
          if (fail) throw { code: 'network_error', params: {} }
          await new Promise((resolve) => {
            release = resolve
          })
          s.materials.a = s.materials.a.filter((m) => m.id !== 'ok')
          return null
        },
      },
    })

    await chooseRemove(user, 'notes.pdf')
    const dialog = await screen.findByRole('dialog', { name: 'Remove notes.pdf?' })
    await user.click(within(dialog).getByRole('button', { name: en.files.remove.confirm }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent(en.files.remove.failed)
    expect(alert).toHaveTextContent(en.inlineError.reassurance)
    const retry = within(alert).getByRole('button', { name: en.inlineError.retry })
    await waitFor(() => expect(retry).toHaveFocus())
    // The file keeps its slot.
    expect(screen.getByTitle('notes.pdf')).toBeInTheDocument()
    // The modal hides the panel from assistive technology while it is open.
    expect(screen.getByRole('heading', { name: 'Files · 3 of 10', hidden: true })).toBeInTheDocument()

    fail = false
    await user.click(retry)
    // Both buttons are disabled while removing.
    await waitFor(() => expect(within(dialog).getByRole('button', { name: en.files.remove.confirm })).toBeDisabled())
    expect(within(dialog).getByRole('button', { name: en.files.remove.cancel })).toBeDisabled()
    await waitFor(() => expect(release).toBeTypeOf('function'))
    release()

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(within(panel()).queryByTitle('notes.pdf')).not.toBeInTheDocument()
    expect(state.materials.a.map((m) => m.id)).toEqual(['r', 'w', 'x'])
  })

  it('shows the Inline error when removing a Rejected file fails, and Try again removes it', async () => {
    const user = userEvent.setup()
    let fail = true
    await openProject({
      routes: {
        'DELETE /api/projects/a/materials/x': async (_, s) => {
          if (fail) throw { code: 'network_error', params: {} }
          s.materials.a = s.materials.a.filter((m) => m.id !== 'x')
          return null
        },
      },
    })
    const row = within(panel()).getAllByRole('listitem')[3]
    await user.click(within(row).getByRole('button', { name: en.files.remove.item }))

    const alert = await within(panel()).findByRole('alert')
    expect(alert).toHaveTextContent(en.files.remove.failed)
    expect(within(panel()).getByTitle('blank.pdf')).toBeInTheDocument()

    fail = false
    await user.click(within(alert).getByRole('button', { name: en.inlineError.retry }))
    await waitFor(() => expect(within(panel()).queryByTitle('blank.pdf')).not.toBeInTheDocument())
    expect(within(panel()).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('offers no removal in a read-only Project', async () => {
    await openProject({ projects: [project('a', { archived_at: '2026-11-17T10:00:00Z' })] })
    expect(within(panel()).queryByRole('button', { name: /More options/ })).not.toBeInTheDocument()
    expect(within(panel()).queryByRole('button', { name: en.files.remove.item })).not.toBeInTheDocument()
  })

  it('works in Norwegian', async () => {
    const user = userEvent.setup()
    await i18n.changeLanguage('nb')
    await openProject()

    const row = within(panel()).getAllByRole('listitem')[3]
    expect(within(row).getByRole('button', { name: nb.files.remove.item })).toBeInTheDocument()

    await chooseRemove(user, 'notes.pdf', nb)
    const dialog = await screen.findByRole('dialog', { name: 'Vil du fjerne notes.pdf?' })
    expect(dialog).toHaveTextContent(nb.files.remove.body)
    expect(within(dialog).getByRole('button', { name: nb.files.remove.cancel })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: nb.files.remove.confirm })).toBeInTheDocument()
    await user.keyboard('{Escape}')

    await chooseRemove(user, 'lecture.pdf', nb)
    expect(await screen.findByRole('dialog', { name: 'Vil du fjerne lecture.pdf?' })).toHaveTextContent(
      nb.files.remove.reading,
    )
  })

  it('a list request sent before the removal, answering after it, does not bring the row back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    let listCalls = 0
    let answerLate
    const state = await openProject({
      routes: {
        'GET /api/projects/a/materials': (_, s) => {
          listCalls += 1
          const snapshot = s.materials.a.map((m) => ({ ...m }))
          if (listCalls === 1) return snapshot
          // The poll's refetch: held, and answered with the list as it was when it was sent.
          return new Promise((resolve) => {
            answerLate = () => resolve(snapshot)
          })
        },
      },
    })
    // The job finishes, so the next poll refetches the list (still including lecture.pdf).
    state.jobs[0].status = 'completed'
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))
    await waitFor(() => expect(answerLate).toBeTypeOf('function'))

    await chooseRemove(user, 'lecture.pdf')
    const dialog = await screen.findByRole('dialog', { name: 'Remove lecture.pdf?' })
    await user.click(within(dialog).getByRole('button', { name: en.files.remove.confirm }))
    await waitFor(() => expect(screen.queryByTitle('lecture.pdf')).not.toBeInTheDocument())

    await act(async () => answerLate())

    expect(screen.queryByTitle('lecture.pdf')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Files · 2 of 10' })).toBeInTheDocument()
  })

  it('treats not_found as removed: the dialog closes, the row leaves, focus goes to Upload', async () => {
    const user = userEvent.setup()
    await openProject({
      routes: {
        'DELETE /api/projects/a/materials/ok': () => {
          throw { code: 'not_found', params: {} }
        },
      },
    })

    await chooseRemove(user, 'notes.pdf')
    const dialog = await screen.findByRole('dialog', { name: 'Remove notes.pdf?' })
    await user.click(within(dialog).getByRole('button', { name: en.files.remove.confirm }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByTitle('notes.pdf')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await waitFor(() => expect(within(panel()).getByRole('button', { name: en.files.upload })).toHaveFocus())
  })

  it('shows "This project is read-only." with no Try again when the Project became read-only', async () => {
    const user = userEvent.setup()
    const readOnly = () => {
      throw { code: 'project_read_only', params: {} }
    }
    await openProject({
      routes: { 'DELETE /api/projects/a/materials/ok': readOnly, 'DELETE /api/projects/a/materials/x': readOnly },
    })

    await chooseRemove(user, 'notes.pdf')
    const dialog = await screen.findByRole('dialog', { name: 'Remove notes.pdf?' })
    await user.click(within(dialog).getByRole('button', { name: en.files.remove.confirm }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent(en.errors.project_read_only)
    expect(alert).not.toHaveTextContent(en.files.remove.failed)
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByTitle('notes.pdf')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const row = within(panel()).getAllByRole('listitem')[3]
    await user.click(within(row).getByRole('button', { name: en.files.remove.item }))
    const rowAlert = await within(panel()).findByRole('alert')
    expect(rowAlert).toHaveTextContent(en.errors.project_read_only)
    expect(within(rowAlert).queryByRole('button')).not.toBeInTheDocument()
    expect(within(panel()).getByTitle('blank.pdf')).toBeInTheDocument()
  })

  it('gives a row still uploading neither the "···" menu nor the Remove button', async () => {
    await openProject({
      files: [],
      routes: { 'POST /api/projects/a/materials': () => new Promise(() => {}) },
    })
    const dataTransfer = { files: [new File(['x'], 'sending.pdf')], types: ['Files'], dropEffect: 'none' }
    fireEvent.dragOver(panel(), { dataTransfer })
    fireEvent.drop(panel(), { dataTransfer })

    const row = await within(panel()).findByRole('listitem')
    expect(row).toHaveTextContent('sending.pdf')
    expect(row).toHaveTextContent(en.files.status.processing)
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
  })
})
