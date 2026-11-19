import { useEffect, useState } from 'react'
import styles from './UndoMessage.module.css'

// How long the message stays (EXPERIENCE.md › Component Patterns › Undo message).
export const UNDO_MESSAGE_MS = 6000

// Undo message (DESIGN.md › Undo message): a surface box with a hairline border, at the bottom left
// of the main area, for 6 seconds, staying while hovered or focused; then `onClose()`. `action` is
// the optional primary text action ("Undo"); the one-time Google takeover notice has none. The
// caller puts it in an always-mounted live region, so it is announced.
export default function UndoMessage({ children, action = null, onClose }) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (hovered || focused) return
    const timer = setTimeout(() => onClose?.(), UNDO_MESSAGE_MS)
    return () => clearTimeout(timer)
  }, [hovered, focused, onClose])

  return (
    <div
      className={styles.message}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <span>{children}</span>
      {action}
    </div>
  )
}
