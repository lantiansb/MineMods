import { randomUUID } from "node:crypto"
import { MakingRefusal } from "@minemods/mod-core/making"
import type { LookProgress } from "./look-job"

const INSPECTION_RECEIPT_MS = 20_000
const RETAIN_MS = 45 * 60_000
const RETAINED_RESULTS = 24
const LOOK_DEADLINE = { overallMs: 5 * 60_000, finalizingMs: 60_000 }

type Result = { value: Record<string, unknown> } | { error: unknown }
type Entry = {
  projectId: string
  onPoll?: () => void
  done: number
  total: number | null
  result?: Result
  expires?: ReturnType<typeof setTimeout>
}

export function createInspectionReceipts(waitMs = INSPECTION_RECEIPT_MS, tool: "next_inspection" | "look" | "look_audio" = "next_inspection", deadline = tool === "look" ? LOOK_DEADLINE : undefined) {
  const entries = new Map<string, Entry>()
  const look = tool !== "next_inspection"
  const scope = tool === "look_audio" ? "projectId、assetId 和 receipt_id" : "projectId、runId、taskId 和 receipt_id"
  const pending = (id: string, entry: Entry) => ({
    waiting: false,
    rendering: { id, done: entry.done, total: entry.total },
    how: look
      ? `${entry.total === null ? "正在准备预览图" : entry.done >= entry.total ? "预览图已画好，正在整理结果" : `在画，第 ${entry.done} / ${entry.total} 张已完成`}。用 look 带上同一 ${scope} 再来取。`
      : `${entry.total === null ? "正在准备审查图" : `在画，第 ${entry.done} / ${entry.total} 张已完成`}。用 next_inspection 带上同一 projectId 和 receipt_id 再来取。`,
  })
  const read = (result: Result) => {
    if ("error" in result) throw result.error
    return result.value
  }
  return {
    async start(projectId: string, work: (progress: LookProgress, signal: AbortSignal) => Promise<Record<string, unknown>>, onPoll?: () => void) {
      const id = randomUUID()
      const entry: Entry = { projectId, onPoll, done: 0, total: null }
      const abort = new AbortController()
      let timeout: ReturnType<typeof setTimeout> | undefined
      let finalizing: ReturnType<typeof setTimeout> | undefined
      let delay: ReturnType<typeof setTimeout> | undefined
      const delayed = new Promise<null>((resolve) => { delay = setTimeout(resolve, waitMs, null) })
      const limit = Promise.withResolvers<Result>()
      const expire = (message: string) => {
        const error = new MakingRefusal(message)
        limit.resolve({ error })
        abort.abort(error)
      }
      if (deadline) timeout = setTimeout(() => expire("看图超时，再调一次 look。"), deadline.overallMs)
      const progress: LookProgress = (done, total) => {
        if (entry.result || abort.signal.aborted) return
        entry.done = done
        entry.total = total
        if (deadline && finalizing === undefined && total > 0 && done >= total)
          finalizing = setTimeout(() => expire("看图整理结果超时，再调一次 look。"), deadline.finalizingMs)
      }
      const workResult = Promise.resolve().then(() => work(progress, abort.signal)).then(
        (value) => ({ value }), (error: unknown) => ({ error }),
      )
      const settled = Promise.race([workResult, limit.promise]).then((result) => {
        clearTimeout(timeout)
        clearTimeout(finalizing)
        entry.result = result
        if (!entries.has(id)) return result
        entry.expires = setTimeout(() => entries.delete(id), RETAIN_MS)
        entry.expires.unref()
        const retained = [...entries].filter(([, value]) => value.projectId === projectId && value.result !== undefined)
        for (const [oldId, old] of retained.slice(0, Math.max(0, retained.length - RETAINED_RESULTS))) {
          clearTimeout(old.expires)
          entries.delete(oldId)
        }
        return result
      })
      const result = await Promise.race([settled, delayed]).finally(() => clearTimeout(delay))
      if (result) return read(result)
      entries.set(id, entry)
      return pending(id, entry)
    },
    poll(projectId: string, id: string) {
      const entry = entries.get(id)
      if (!entry || entry.projectId !== projectId) throw new MakingRefusal(look ? "找不到这次看图的回执，或者回执已经过期。请重新发起 look。" : "找不到这张审查回执，或者回执已经过期。请重新调用 next_inspection。")
      entry.onPoll?.()
      return entry.result ? read(entry.result) : pending(id, entry)
    },
  }
}
