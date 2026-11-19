// Show-once guard for the Google takeover notice (AD-19), kept outside React state so a remount of
// the app shell (e.g. leaving and re-entering the signed-in pages) doesn't show it again.
let shown = false

export function takeoverNoticeShown() {
  return shown
}

export function markTakeoverNoticeShown() {
  shown = true
}

/** For tests only. */
export function resetTakeoverNotice() {
  shown = false
}
