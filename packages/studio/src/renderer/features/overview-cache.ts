import { createSignal } from "solid-js"
import type { ProjectOverview } from "../../api"

const [snapshots, publish] = createSignal<ReadonlyMap<string, ProjectOverview>>(new Map())
const pending = new Map<string, Promise<ProjectOverview>>()
export const overviewKey = (id: string, revision: number) => id + ":" + revision
export const cachedOverview = (key: string) => snapshots().get(key) ?? null

export function storeOverview(key: string, value: ProjectOverview) {
  pending.delete(key)
  publish((current) => {
    const next = new Map(current)
    next.delete(key)
    next.set(key, value)
    // Three recent projects on the home screen and the current workbench.
    if (next.size > 4) next.delete(next.keys().next().value!)
    return next
  })
}

export function readOverview(id: string, revision: number, refresh = false): Promise<ProjectOverview> {
  const key = overviewKey(id, revision)
  const active = pending.get(key)
  if (active) return active
  const cached = cachedOverview(key)
  if (cached && !refresh) return Promise.resolve(cached)
  let timer = 0
  const deadline = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error("读取总览超时，正在重试。")), 60000)
  })
  const read = Promise.race([window.studio.getProjectOverview({ projectId: id, progressOnly: true }), deadline]).then((value) => {
    if (pending.get(key) === read) storeOverview(key, value)
    return value
  }).finally(() => {
    window.clearTimeout(timer)
    if (pending.get(key) === read) pending.delete(key)
  })
  pending.set(key, read)
  return read
}
