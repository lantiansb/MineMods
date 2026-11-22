import { expect, test } from "bun:test"
import { LOCK_THEN, makingLock } from "../src/renderer/features/making-lock"

// broad20: a thing only queued in the run was locked with 「AI 正在做这一样」, though nothing had started on it.
test("a queued thing is locked with the truth: in the run, not started, and what it waits for", () => {
  expect(makingLock({ status: "making" }, LOCK_THEN.notes)).toBe("AI 正在做这一样，等这一次做完，才能改说明或者让它重做。")
  const queued = makingLock({ status: "making", queued: { waiting_for: ["巫祝的模型"] } }, LOCK_THEN.reference)
  expect(queued).not.toContain("正在做")
  expect(queued).toContain("等「巫祝的模型」先做好")
  expect(queued).toContain("还没开始做")
  expect(makingLock({ status: "making", queued: { waiting_for: [] } }, LOCK_THEN.sixView)).toBe("这一样排在这次制作里，还没开始做；等这一次做完再换六视图。")
  expect(makingLock({ status: "review" }, LOCK_THEN.notes)).toBe("")
})
