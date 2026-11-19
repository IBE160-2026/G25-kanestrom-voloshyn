// The phone page's Link countdown (EXPERIENCE.md › Phone link): whole minutes, then seconds in the
// last minute, in the same muted text.

/** "Link expires in {n} min", or "Link expires in {m}:{ss}" in the last minute; null once expired. */
export function countdownText(t, msLeft) {
  if (msLeft <= 0) return null
  if (msLeft > 60_000) return t('phone.countdownMin', { n: Math.ceil(msLeft / 60_000) })
  const seconds = Math.ceil(msLeft / 1000)
  const m = Math.floor(seconds / 60)
  const ss = String(seconds % 60).padStart(2, '0')
  return t('phone.countdownSec', { m, ss })
}
