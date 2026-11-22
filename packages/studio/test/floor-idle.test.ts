import { expect, test } from "bun:test"
import { agoWords, idleReason, reviewerLine, type IdleInput } from "../src/renderer/features/floor-idle-model"
import type { ActivityEvent } from "../src/api"

const now = Date.parse("2026-10-19T10:10:00.000Z")
const production = { total: 4, saved: 0, done: 0, to_review: 0, to_redo: 0, failed: 0, blocked: 0, unsatisfied: 0, interrupted: 0 }
const base: IdleInput = { external: true, connected: true, blueprint: null, ideasWaiting: false, ai: undefined, production: { ...production, total: 0 }, events: [], now }
const call = (text: string, secondsAgo: number, extra: Partial<ActivityEvent> = {}): ActivityEvent => ({ seq: 1, at: new Date(now - secondsAgo * 1000).toISOString(), kind: "tool", mark: "note", item: null, title: null, text, tool: "get_blueprint", ...extra })

test("没有接上：说是外面的 AI 没接上，不说它在准备", () => {
  const said = idleReason({ ...base, connected: false, blueprint: "confirmed", production })!
  expect(said.title).toBe("外面的 AI 没有接上")
  expect(idleReason({ ...base, external: false, connected: false })!.title).toBe("AI 还没有连上")
})

test("蓝图等你确认：AI 在等的话说它会自己开始，没在等就只说等你", () => {
  expect(idleReason({ ...base, blueprint: "draft", ai: "waiting", production })).toMatchObject({ title: "AI 在等你确认蓝图", text: expect.stringContaining("会自己开始") })
  const none = idleReason({ ...base, blueprint: "draft", ai: "none", production })!
  expect(none.title).toBe("蓝图在等你确认")
  expect(none.text).toContain("回到你的 AI 窗口")
})

test("蓝图确认以后：刚把确认交给 AI 就说它正在开始；AI 刚读过蓝图就说读了蓝图；什么动静都没有才说要回去叫它", () => {
  expect(idleReason({ ...base, blueprint: "confirmed", ai: "told", production })!.text).toBe("AI 已经收到你的确认，正在开始。")
  const reading = idleReason({ ...base, blueprint: "confirmed", ai: "none", production, events: [call("外部 AI 读了蓝图，看每样东西做到哪一步了。", 20)] })!
  expect(reading.title).toBe("外部 AI 已接上")
  expect(reading.text).toBe("刚刚读了蓝图，看每样东西做到哪一步了。还没开始做下一样。")
  const quiet = idleReason({ ...base, blueprint: "confirmed", ai: "none", production })!
  expect(quiet.text).toBe("回到你的 AI 窗口，说一句「开始做」就行。")
  // Some are made already: the rest is 「继续做」.
  expect(idleReason({ ...base, blueprint: "confirmed", ai: "none", production: { ...production, saved: 2, done: 2 } })!.text).toContain("继续做")
})

test("最近一次调用太久以前，或者被退回了，就不说它刚读过什么", () => {
  const old = idleReason({ ...base, blueprint: "confirmed", production, events: [call("外部 AI 读了蓝图，看每样东西做到哪一步了。", 600)] })!
  expect(old.title).toBe("蓝图确认好了")
  const refused = idleReason({ ...base, blueprint: "confirmed", production, events: [call("外部 AI 读了蓝图，被 Studio 退回了。", 5, { mark: "fail" })] })!
  expect(refused.title).toBe("蓝图确认好了")
  expect(agoWords(new Date(now - 3 * 60_000).toISOString(), now)).toBe("3 分钟前")
})

test("全部做完才说做完：还有等验收、要重做或没做成的，就不说", () => {
  const all = { ...production, saved: 4, done: 4 }
  expect(idleReason({ ...base, blueprint: "confirmed", production: all })).toMatchObject({ title: "全部做完了", action: { id: "overview" } })
  expect(idleReason({ ...base, blueprint: "confirmed", production: { ...all, done: 3, to_review: 1 } })).toBeNull()
  expect(idleReason({ ...base, blueprint: "confirmed", production: { ...all, failed: 1 } })).toBeNull()
})

test("还没有蓝图、想法等你挑：各说各的", () => {
  expect(idleReason({ ...base, ideasWaiting: true })!.title).toBe("想法在等你挑")
  expect(idleReason(base)!.text).toContain("还没有蓝图")
})

test("审查：开着和审查员接上了分开说；没接上的时候给「打开审查员」；关着或用 Studio 自己的 AI 就不说", () => {
  expect(reviewerLine({ external: true, reviewOn: true, reviewer: "never" })).toEqual({ text: "审查已打开，但审查员的窗口还没接上。", open: true })
  expect(reviewerLine({ external: true, reviewOn: true, reviewer: "silent" })!.open).toBe(true)
  expect(reviewerLine({ external: true, reviewOn: true, reviewer: "present" })).toEqual({ text: "审查已打开，审查员的窗口已接上。", open: false })
  expect(reviewerLine({ external: true, reviewOn: true, reviewer: "reading" })!.text).toContain("正在看")
  expect(reviewerLine({ external: true, reviewOn: false, reviewer: "never" })).toBeNull()
  expect(reviewerLine({ external: false, reviewOn: true, reviewer: "never" })).toBeNull()
  expect(reviewerLine({ external: true, reviewOn: true, reviewer: undefined })).toBeNull()
})
