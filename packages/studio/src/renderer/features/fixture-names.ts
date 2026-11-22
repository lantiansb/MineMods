/** Give repeated pieces of scenery stable, readable numbers in map and editor order. */
export function fixtureLabels(slots: readonly { id: string; asset: string }[], name: (asset: string) => string | undefined) {
  const groups = new Map<string, string[]>()
  for (const slot of slots) {
    const title = name(slot.asset) ?? "场地物件"
    groups.set(title, [...(groups.get(title) ?? []), slot.id])
  }
  return new Map([...groups].flatMap(([title, ids]) => ids.map((id, index) =>
    [id, ids.length > 1 ? title + " " + (index + 1) : title] as const)))
}
