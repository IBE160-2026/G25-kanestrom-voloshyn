// Progress steps (DESIGN.md › Progress steps; EXPERIENCE.md › Progress steps, Strings › Progress status
// lines, Progress step line).
import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../i18n/en.json'
import nb from '../i18n/nb.json'
import { i18n, renderWithI18n } from '../test/render.jsx'
import GenerationProgress, { LINE_MS } from './GenerationProgress.jsx'
import { readFileSync } from 'node:fs'

// Vitest runs from frontend/.
const css = readFileSync('src/components/GenerationProgress.module.css', 'utf8')

const STEPS = ['Reading your material', 'Writing questions', 'Checking answers']
const FINAL_ONLY = en.progress.lines.slice(-2)
const line = () => screen.getByTestId('progress-line').textContent

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function show(current, props = {}) {
  return renderWithI18n(<GenerationProgress steps={STEPS} current={current} onCancel={() => {}} {...props} />)
}

describe('GenerationProgress', () => {
  it('names the real step as "Step {n} of {total} · {label}" and follows it', () => {
    const view = show(0)
    expect(screen.getByRole('status')).toHaveTextContent('Step 1 of 3 · Reading your material')

    view.rerender(<GenerationProgress steps={STEPS} current={1} onCancel={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('Step 2 of 3 · Writing questions')

    view.rerender(<GenerationProgress steps={STEPS} current={2} onCancel={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('Step 3 of 3 · Checking answers')
  })

  it('the live region holds only the real step; the spinner and rotating line are hidden from screen readers', () => {
    show(0)

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status.textContent).toBe('Step 1 of 3 · Reading your material')
    expect(screen.getByTestId('progress-line')).toHaveAttribute('aria-hidden', 'true')
    expect(status).not.toContainElement(screen.getByTestId('progress-line'))
  })

  it('changes the status line every 2.5 s, never twice the same, and never a final-step line before the last step', () => {
    show(0)
    const seen = [line()]

    for (let i = 0; i < 60; i += 1) {
      act(() => vi.advanceTimersByTime(LINE_MS))
      seen.push(line())
    }

    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).not.toBe(seen[i - 1])
    seen.forEach((text) => expect(en.progress.lines).toContain(text))
    seen.forEach((text) => expect(FINAL_ONLY).not.toContain(text))
    expect(new Set(seen).size).toBeGreaterThan(3)
  })

  it('offers the final-step lines during the last step', () => {
    // Math.random just under 1 picks the last line of the pool.
    vi.spyOn(Math, 'random').mockReturnValue(0.999)
    show(2)

    expect(line()).toBe('Putting on the finishing touches…')
  })

  it('spins only when the system allows motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.spinner\s*\{\s*animation:/)
    // Outside that query the spinner has no animation, so reduced motion shows a static loop.
    const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\}\s*\}/, '')
    expect(outside).not.toMatch(/animation:/)
  })

  it('Cancel calls onCancel and is disabled while cancelling', () => {
    const onCancel = vi.fn()
    const view = show(0, { onCancel })

    fireEvent.click(screen.getByRole('button', { name: en.progress.cancel }))
    expect(onCancel).toHaveBeenCalledTimes(1)

    view.rerender(<GenerationProgress steps={STEPS} current={0} onCancel={onCancel} cancelling />)
    expect(screen.getByRole('button', { name: en.progress.cancel })).toBeDisabled()
  })

  it('reads in Norwegian', async () => {
    await act(() => i18n.changeLanguage('nb'))
    show(1, { steps: ['Leser materialet ditt', 'Skriver spørsmål', 'Sjekker svarene'] })

    expect(screen.getByRole('status')).toHaveTextContent('Steg 2 av 3 · Skriver spørsmål')
    expect(nb.progress.lines.slice(0, -2)).toContain(line())
    expect(screen.getByRole('button', { name: 'Avbryt' })).toBeInTheDocument()
  })
})
