import { useEffect, useRef, useState } from 'react'
import styles from './UndoMessage.module.css'

// How long the message stays when nobody hovers or focuses it (EXPERIENCE.md › Undo message).
export const UNDO_MESSAGE_MS = 6000

// Undo message (DESIGN.md › Undo message, EXPERIENCE.md › Component Patterns, UX-DR2): a surface box
// at the bottom left of the main area, in a polite live region. It stays 6 s, and longer while it is
// hovered or focused, then calls `onDone`. `action` ({ label, onClick }) is optional: without one it
// carries a plain notice, such as the one-time Google takeover notice, as a status line that isn't
// a Tab stop. Escape dismisses it while it is hovered or focused. The live region is mounted empty
// and the text added just after, so it is announced.
export default function UndoMessage({ children, action = null, onDone }) {
  const [shown, setShown] = useState(false)
  const [held, setHeld] = useState({ hover: false, focus: false })
  const box = useRef(null)
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  }, [onDone])

  useEffect(() => {
    const timer = setTimeout(() => setShown(true), 0)
    return () => clearTimeout(timer)
  }, [])

  const paused = held.hover || held.focus
  useEffect(() => {
    if (!shown || paused) return
    const timer = setTimeout(() => done.current?.(), UNDO_MESSAGE_MS)
    return () => clearTimeout(timer)
  }, [shown, paused])

  // Escape dismisses it while it holds the pointer or the focus.
  useEffect(() => {
    if (!paused) return
    const onKeyDown = (event) => {
      if (event.key === 'Escape') done.current?.()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [paused])

  return (
    <div className={styles.region} role="status">
      {shown && (
        <div
          ref={box}
          className={styles.message}
          onMouseEnter={() => setHeld((h) => ({ ...h, hover: true }))}
          onMouseLeave={() => setHeld((h) => ({ ...h, hover: false }))}
          onFocus={() => setHeld((h) => ({ ...h, focus: true }))}
          onBlur={(event) => {
            if (!box.current?.contains(event.relatedTarget)) setHeld((h) => ({ ...h, focus: false }))
          }}
        >
          <span>{children}</span>
          {action && (
            <button type="button" className={styles.action} onClick={action.onClick}>
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
