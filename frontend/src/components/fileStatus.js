// File status and type tile, shared by the file row and the QR dialog's arrived batches (DESIGN.md ›
// File row, File status).

/** 'processing' (Reading…), 'ready', 'warning' (Ready, partly unreadable), or 'rejected'. */
export function fileState(material) {
  if (material.status === 'processing') return 'processing'
  if (material.status === 'rejected') return 'rejected'
  return material.warning ? 'warning' : 'ready'
}

// A phone batch (Story 6.2) shows the "IMG" tile of the QR dialog mock.
export const TILE = { pdf: 'PDF', docx: 'DOCX', pptx: 'PPTX', txt: 'TXT', md: 'MD', jpg: 'JPG', png: 'PNG', heic: 'HEIC', phone_batch: 'IMG' }

/** The tile's label: from the file type, else from the name's extension (a file still uploading). */
export function tileLabel(material) {
  if (material.file_type) return TILE[material.file_type] ?? material.file_type.toUpperCase()
  const ext = String(material.file_name).split('.').pop().toLowerCase()
  if (ext === 'jpeg') return TILE.jpg
  return ext ? ext.toUpperCase().slice(0, 4) : ''
}
