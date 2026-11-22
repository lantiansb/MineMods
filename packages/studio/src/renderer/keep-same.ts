/**
 * A list read again, with every row that did not change kept as the very object it was. A read returns new objects each time, and `<For>` goes by identity: without this every
 * row on screen is rebuilt on every read, which drops the keyboard's focus, a hovered tooltip and selected text, and restarts whatever was animating.
 */
export function keepSame<T>(before: readonly T[], next: readonly T[], key: (row: T) => string | number, same: (left: T, right: T) => boolean = (left, right) => JSON.stringify(left) === JSON.stringify(right)): T[] {
  const known = new Map(before.map((row) => [key(row), row]))
  return next.map((row) => {
    const was = known.get(key(row))
    return was !== undefined && same(was, row) ? was : row
  })
}
