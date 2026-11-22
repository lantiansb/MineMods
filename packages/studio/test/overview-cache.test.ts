import { expect, test } from "bun:test"
import { cachedOverview, overviewKey, readOverview, storeOverview } from "../src/renderer/features/overview-cache"
import type { ProjectOverview } from "../src/api"

test("首页与工作台共享同一版正在读的总览，失败后能重读，旧响应不会覆盖新状态", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window")
  let calls = 0
  const old = { items: [] } as unknown as ProjectOverview
  const fresh = { items: [], review_on: true } as unknown as ProjectOverview
  let resolve!: (value: ProjectOverview) => void
  const response = new Promise<ProjectOverview>((done) => { resolve = done })
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    setTimeout, clearTimeout, studio: { getProjectOverview: () => ++calls === 1 ? Promise.reject(Error("busy")) : response },
  } })
  try {
    const id = "cache-retry"
    await expect(readOverview(id, 1)).rejects.toThrow("busy")
    const waiting = readOverview(id, 1)
    expect(readOverview(id, 1, true)).toBe(waiting)
    const key = overviewKey(id, 1)
    storeOverview(key, fresh)
    resolve(old)
    await waiting
    expect(cachedOverview(key)).toBe(fresh)
    expect(await readOverview(id, 1)).toBe(fresh)
    expect(cachedOverview(overviewKey(id, 2))).toBeNull()
    expect(calls).toBe(2)
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original)
    else Reflect.deleteProperty(globalThis, "window")
  }
})
