import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { confirmDraft, waitingForYou, WAITING_WORDS, type WaitingInput } from "../src/renderer/features/waiting-for-you-model"

const base: WaitingInput = { blueprint: null, madeCount: 0, ideasWaiting: false, toReview: 0, external: true, running: false }
const source = (file: string) => readFileSync(path.join(import.meta.dir, "../src/renderer", file), "utf8")

test("蓝图在等确认：写着「等你确认」的页面自带「确认蓝图」，和模组总览是同一个按钮的字", () => {
  const waits = waitingForYou({ ...base, blueprint: { state: "draft" }, madeCount: 5 })
  expect(waits).toHaveLength(1)
  expect(waits[0]).toMatchObject({ kind: "blueprint", how: "do", label: "确认蓝图" })
  expect(waits[0]!.blocked).toBeUndefined()
  expect(waits[0]!.text).toContain("等你确认")
  // Studio's own AI starts making right after, and the button says so, as on the overview.
  expect(waitingForYou({ ...base, blueprint: { state: "draft" }, madeCount: 5, external: false })[0]!.label).toBe("确认，开始制作")
})

test("蓝图已经确认、或者还没有蓝图：不再说等确认", () => {
  expect(waitingForYou({ ...base, blueprint: { state: "confirmed" }, madeCount: 5 })).toEqual([])
  expect(waitingForYou(base)).toEqual([])
})

test("不能按的时候说为什么，而不是把按钮藏起来：没有要做的东西，或者正在制作", () => {
  const empty = waitingForYou({ ...base, blueprint: { state: "draft" }, madeCount: 0 })[0]!
  expect(empty.blocked).toBe(WAITING_WORDS.nothingToMake)
  const busy = waitingForYou({ ...base, blueprint: { state: "draft" }, madeCount: 3, running: true })[0]!
  expect(busy.blocked).toBe(WAITING_WORDS.running)
})

test("想法等你挑、东西等你验收：页面带着去那里的按钮；想法只在还没有蓝图时等你，挑好了（ready）就不是等你", () => {
  expect(waitingForYou({ ...base, ideasWaiting: true })[0]).toMatchObject({ kind: "ideas", how: "go", label: "去挑想法" })
  expect(waitingForYou({ ...base, ideasWaiting: true, blueprint: { state: "draft" }, madeCount: 2 }).map((wait) => wait.kind)).toEqual(["blueprint"])
  const review = waitingForYou({ ...base, toReview: 3 })
  expect(review[0]).toMatchObject({ kind: "review", how: "go", label: "去验收" })
  expect(review[0]!.text).toBe("有 3 样做好了，等你验收。")
  // Most pressing first: the blueprint, then the things to look at.
  expect(waitingForYou({ ...base, blueprint: { state: "draft" }, madeCount: 2, toReview: 1 }).map((wait) => wait.kind)).toEqual(["blueprint", "review"])
})

function fakeStudio() {
  const calls: string[] = []
  return {
    calls,
    studio: {
      confirmBlueprint: async (input: { projectId: string; revision: number }) => (calls.push(`confirm:${input.projectId}:${input.revision}`), {} as never),
      startBlueprintProduction: async (input: { projectId: string }) => (calls.push(`start:${input.projectId}`), { started: true } as never),
    },
  }
}

test("确认蓝图是一个动作：先问六视图，再确认（带着屏幕上的版本号），外部 AI 到此为止，Studio 自己的 AI 接着开工", async () => {
  const outside = fakeStudio()
  const order: string[] = []
  const done = await confirmDraft({ projectId: "p", revision: 4, external: true, ready: async () => (order.push("ready"), true), afterConfirm: () => order.push("after"), studio: outside.studio })
  expect(done).toEqual({ confirmed: true, started: null })
  expect(outside.calls).toEqual(["confirm:p:4"])
  expect(order).toEqual(["ready", "after"])

  const own = fakeStudio()
  const owned = await confirmDraft({ projectId: "p", revision: 4, external: false, ready: async () => true, studio: own.studio })
  expect(owned.confirmed).toBe(true)
  expect(owned.started).toEqual({ started: true } as never)
  expect(own.calls).toEqual(["confirm:p:4", "start:p"])
})

test("人选了「先去加六视图」：什么都不确认、什么都不开工", async () => {
  const f = fakeStudio()
  let after = false
  const done = await confirmDraft({ projectId: "p", revision: 1, external: false, ready: async () => false, afterConfirm: () => (after = true), studio: f.studio })
  expect(done).toEqual({ confirmed: false, started: null })
  expect(f.calls).toEqual([])
  expect(after).toBe(false)
})

test("确认被拒（AI 在这期间改了蓝图）：错误交给页面说，不再往下开工", async () => {
  const calls: string[] = []
  const studio = {
    confirmBlueprint: async () => Promise.reject(new Error("蓝图已经变了，请重新看一遍。")),
    startBlueprintProduction: async () => (calls.push("start"), {} as never),
  }
  await expect(confirmDraft({ projectId: "p", revision: 1, external: false, ready: async () => true, studio })).rejects.toThrow("蓝图已经变了")
  expect(calls).toEqual([])
})

test("接线：制作现场挂着这条「等你」，模组总览的确认走同一个 confirmDraft，两处按钮的字出自同一处", () => {
  const floor = source("features/external-workbench.tsx")
  expect(floor).toContain("<WaitingForYou")
  expect(floor).toContain("confirmDraft(")
  expect(floor).toContain("waitingForYou(")
  const overview = source("features/project-assets.tsx")
  expect(overview).toContain("confirmDraft(")
  expect(overview).toContain("WAITING_WORDS.confirm.external")
  expect(overview).toContain("WAITING_WORDS.confirm.own")
  expect(overview).not.toContain('"确认蓝图"')
  // The thing's own story offers its verdict where it says a version waits for one.
  expect(source("features/making-floor-thing.tsx")).toContain("去验收")
})

// Broad19: after 「确认蓝图」 the page used to tell the person to go back to the AI window every time. Studio knows whether the AI has a wait call pending, so it says what is true.
test("确认以后页面说实话：AI 在等就说它会自己开始，没在等才让人回去告诉它", async () => {
  const { afterConfirmWords, beforeConfirmWords, AFTER_CONFIRM_WORDS } = await import("../src/renderer/features/waiting-for-you-model")
  expect(afterConfirmWords("waiting", "开始做")).toBe("AI 已经在等，它会自己开始。")
  expect(afterConfirmWords("told", "开始做")).toBe("AI 已经收到你的确认，正在开始。")
  // No wait call seen (or the AI gave up waiting): only the person can wake it.
  expect(afterConfirmWords("none", "开始做")).toBe("回到你的 AI 窗口，说一句「开始做」就行。")
  expect(afterConfirmWords(undefined, "继续做")).toBe(AFTER_CONFIRM_WORDS.none("继续做"))
  // Before confirming, the same truth about what confirming leads to; nothing for Studio's own AI, whose button starts the making.
  expect(beforeConfirmWords(true, "waiting")).toContain("AI 已经在等")
  expect(beforeConfirmWords(true, undefined)).toContain("回到你的 AI 窗口说一句「开始做」")
  expect(beforeConfirmWords(false, "waiting")).toBeUndefined()
  // The overview page uses these, and does not offer the copyable sentence to an AI that is waiting.
  const overview = source("features/project-assets.tsx")
  expect(overview).toContain("afterConfirmWords(aiWait(), words)")
  expect(overview).toContain('aiWait() !== "waiting" && aiWait() !== "told"')
})
