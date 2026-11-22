/** Polls carrying the same content must not reset a user's draft. A real external change needs explicit reload. */
export function itemDisplayKey(value: unknown): string {
  return JSON.stringify(value, (_key, current: unknown) => current && typeof current === "object" && !Array.isArray(current)
    ? Object.fromEntries(Object.keys(current).sort().map(key => [key, (current as Record<string, unknown>)[key]]))
    : current)
}

export function itemDisplaySync(savedKey: string, baselineKey: string, dirty: boolean, submittedKey: string | null) {
  if (savedKey === baselineKey) return "unchanged"
  return dirty && savedKey !== submittedKey ? "conflict" : "replace"
}
