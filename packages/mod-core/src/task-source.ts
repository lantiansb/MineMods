/**
 * Where a run task came from. Normally `source` quotes the person's own request; a task made from an
 * entry of the confirmed blueprint names that entry instead. Kept free of imports so the planner,
 * the route check and the status view all agree on one spelling.
 */
const PREFIX = "blueprint:"

export function blueprintSource(key: string) {
  return `${PREFIX}${key}`
}

/** The blueprint entry key a task source names, or null when the source is the person's own words. */
export function blueprintSourceKey(source: string) {
  return source.startsWith(PREFIX) ? source.slice(PREFIX.length) : null
}
