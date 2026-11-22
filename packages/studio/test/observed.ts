/** Wait for a published state. The deadline only diagnoses a missing state, never stands in for it. */
export async function untilObserved<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = performance.now() + 60_000
  for (;;) {
    const value = await read()
    if (ready(value)) return value
    if (performance.now() >= deadline) throw new Error("The expected test state was not published")
    await Bun.sleep(10)
  }
}
