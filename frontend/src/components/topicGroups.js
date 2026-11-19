// Topic grouping shared by the Topic list (Files panel) and the Topic scope picker (Quiz setup):
// EXPERIENCE.md › Topic list, Topic scope picker. Chapter or part groups are consecutive runs of
// Topics with the same `group_label`, in the server's order; above 20 Topics they start collapsed.
export const COLLAPSE_ABOVE = 20

/** Consecutive runs of Topics with the same group, in server order; ungrouped runs have label null. */
export function groupTopics(topics) {
  const runs = []
  for (const topic of topics) {
    const label = topic.group_label ?? null
    const last = runs[runs.length - 1]
    if (last && last.label === label) last.items.push(topic)
    else runs.push({ label, items: [topic] })
  }
  return runs
}
