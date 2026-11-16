/** Up to two initials from the first two words, e.g. "Biology 101" → "B1", "Nytt prosjekt" → "NP". */
export function initials(name) {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join('')
    .toLocaleUpperCase()
}
