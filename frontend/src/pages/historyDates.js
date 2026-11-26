// History row dates (Story 5.1; EXPERIENCE.md › History row, dates), formatted with Intl in the UI language.

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** "Today, HH:MM", "Yesterday", or a short month and day (with the year when it isn't this year). */
export function formatDate(t, iso, language, now = new Date()) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  if (sameDay(date, now)) {
    const time = new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
    return t('history.today', { time })
  }
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(date, yesterday)) return t('history.yesterday')
  const options = { month: 'short', day: 'numeric' }
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric'
  return new Intl.DateTimeFormat(language, options).format(date)
}
