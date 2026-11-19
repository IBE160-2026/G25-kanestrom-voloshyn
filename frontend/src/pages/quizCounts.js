// The Count picker's choices for a Quiz (FR-10, AD-12): 5, 10, or 20; the API takes only these.
export const COUNTS = [5, 10, 20]

/** The count sent to the API: the chosen one, or for an offered count the next allowed one up. */
export function requestCount(count) {
  return COUNTS.find((allowed) => allowed >= count) ?? COUNTS[COUNTS.length - 1]
}
