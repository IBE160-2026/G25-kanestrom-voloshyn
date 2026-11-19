// Days left before a deleted Project is permanently deleted (FR-24; EXPERIENCE.md › Deleted projects):
// ceil((purge_at − now) / 1 day), at least 1. `purge_at` comes from the server (30 days after
// `deleted_at`); without it, it is worked out from `deleted_at`.
export const PURGE_AFTER_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

export function daysLeft(project, now = Date.now()) {
  const purgeAt = project?.purge_at
    ? new Date(project.purge_at).getTime()
    : new Date(project?.deleted_at).getTime() + PURGE_AFTER_DAYS * DAY_MS
  if (!Number.isFinite(purgeAt)) return PURGE_AFTER_DAYS
  return Math.max(1, Math.ceil((purgeAt - now) / DAY_MS))
}
