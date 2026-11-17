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
