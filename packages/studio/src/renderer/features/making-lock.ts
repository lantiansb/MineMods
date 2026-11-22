/**
 * Why a thing's references, six views and notes cannot be changed right now. A thing in the run is locked whether it is being made or only
 * queued (it holds its place in the run), but the reason is said as it is: a queued thing has not been started (broad20: queued things read as
 * 「AI 正在做」). `then` is what waits, the same for both.
 */
export type Lockable = { status: string; queued?: { waiting_for: string[] } }

export function makingLock(item: Lockable, then: string): string {
  if (item.status !== "making") return ""
  if (!item.queued) return `AI 正在做这一样，${then}`
  const waits = item.queued.waiting_for.length ? `，等「${item.queued.waiting_for.join("」「")}」先做好` : ""
  return `这一样排在这次制作里${waits}，还没开始做；${then}`
}

export const LOCK_THEN = {
  reference: "等这一次做完再换参考图。",
  sixView: "等这一次做完再换六视图。",
  notes: "等这一次做完，才能改说明或者让它重做。",
} as const
