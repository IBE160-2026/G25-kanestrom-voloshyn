// The phone link's QR code (FR-21, AD-24), drawn in the browser with the `qrcode` package from the
// spine: never a network service, and nothing HTTPS-only.
import QRCode from 'qrcode'

/** The phone's address for a token, from the server's public URL (`app_public_url`); null without one
 * (this page's own origin may be `localhost`, which the phone can't reach). */
export function phoneUrl(base, token) {
  if (!base) return null
  return `${String(base).replace(/\/+$/, '')}/u/${encodeURIComponent(token)}`
}

/** The QR code's dark modules as one SVG path (one 1x1 square per module), and its size in modules. */
export function qrPath(text) {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const parts = []
  for (let row = 0; row < modules.size; row += 1) {
    for (let col = 0; col < modules.size; col += 1) {
      if (modules.get(row, col)) parts.push(`M${col} ${row}h1v1h-1z`)
    }
  }
  return { size: modules.size, d: parts.join('') }
}
