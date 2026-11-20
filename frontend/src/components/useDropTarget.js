import { useEffect, useState } from 'react'

function isFileDrag(event) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

/**
 * While mounted, a file dropped outside the drop targets does nothing, instead of the browser
 * opening it and leaving the app.
 */
export function useBlockWindowFileDrop() {
  useEffect(() => {
    const block = (event) => {
      if (isFileDrag(event)) event.preventDefault()
    }
    window.addEventListener('dragover', block)
    window.addEventListener('drop', block)
    return () => {
      window.removeEventListener('dragover', block)
      window.removeEventListener('drop', block)
    }
  }, [])
}

/** Drag-and-drop handlers for a drop target; `onFiles` gets the dropped files. */
export function useDropTarget(onFiles, enabled) {
  const [over, setOver] = useState(false)
  const hasFiles = isFileDrag
  return {
    over: enabled && over,
    handlers: {
      onDragOver(event) {
        if (!enabled || !hasFiles(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setOver(true)
      },
      onDragLeave(event) {
        if (!event.currentTarget.contains(event.relatedTarget)) setOver(false)
      },
      onDrop(event) {
        setOver(false)
        if (!enabled) return
        event.preventDefault()
        onFiles(event.dataTransfer?.files)
      },
    },
  }
}

/**
 * A drop anywhere in the window (Cristoffer, 2026-11-20): once a file drag enters the window, `active`
 * is true and the caller shows a full-screen overlay with `handlers`. Leaving the window, ending the
 * drag, or dropping hides it; a drop on the overlay gives the files to `onFiles`.
 */
export function useWindowFileDrop(onFiles, enabled) {
  const [active, setActive] = useState(false)
  useEffect(() => {
    if (!enabled) return undefined
    const show = (event) => {
      if (isFileDrag(event)) setActive(true)
    }
    const hide = () => setActive(false)
    window.addEventListener('dragenter', show)
    window.addEventListener('dragend', hide)
    window.addEventListener('drop', hide)
    return () => {
      window.removeEventListener('dragenter', show)
      window.removeEventListener('dragend', hide)
      window.removeEventListener('drop', hide)
      setActive(false)
    }
  }, [enabled])
  return {
    active: enabled && active,
    handlers: {
      onDragOver(event) {
        event.preventDefault()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      },
      // Its children take no pointer events, so this fires only when the drag leaves the window.
      onDragLeave(event) {
        if (!event.currentTarget.contains(event.relatedTarget)) setActive(false)
      },
      onDrop(event) {
        event.preventDefault()
        setActive(false)
        onFiles(event.dataTransfer?.files)
      },
    },
  }
}
