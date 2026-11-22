import { expect, test } from "bun:test"
import { createInspectionReceipts } from "../src/main/inspection-receipts"
import { lookQueue, type LookJob } from "../src/main/look-job"

test("看图超过时限后按任务领取同一份结果，进度随绘制更新", async () => {
  const receipts = createInspectionReceipts(1, "look")
  const finish = Promise.withResolvers<void>()
  const first = await receipts.start("project/run/task", async (progress) => {
    progress(1, 2)
    await finish.promise
    progress(2, 2)
    return { pictures: ["前面", "背面"] }
  })
  const rendering = first.rendering as { id: string; done: number; total: number }
  expect(rendering).toMatchObject({ done: 1, total: 2 })
  expect(first.how as string).toContain("用 look")
  expect(() => receipts.poll("project/run/other", rendering.id)).toThrow("找不到")
  expect(receipts.poll("project/run/task", rendering.id)).toEqual(first)
  finish.resolve()
  await Bun.sleep(0)
  const done = receipts.poll("project/run/task", rendering.id)
  expect(done).toEqual({ pictures: ["前面", "背面"] })
  expect(receipts.poll("project/run/task", rendering.id)).toEqual(done)
})

test("画完以后整理超时会中止工作，旧工作迟到也不能覆盖失败回执", async () => {
  const receipts = createInspectionReceipts(1, "look", { overallMs: 1_000, finalizingMs: 30 })
  const late = Promise.withResolvers<Record<string, unknown>>()
  const canceled = Promise.withResolvers<void>()
  const first = await receipts.start("p/r/t", async (progress, signal) => {
    progress(2, 2)
    signal.addEventListener("abort", () => canceled.resolve(), { once: true })
    return late.promise
  })
  const { id } = first.rendering as { id: string }
  expect(first.how).toContain("正在整理结果")
  await canceled.promise
  await Bun.sleep(0)
  expect(() => receipts.poll("p/r/t", id)).toThrow("看图整理结果超时，再调一次 look")
  late.resolve({ pictures: ["迟到的图"] })
  await Bun.sleep(0)
  expect(() => receipts.poll("p/r/t", id)).toThrow("看图整理结果超时")
  expect(await receipts.start("p/r/t", async () => ({ pictures: ["重新画的图"] }))).toEqual({ pictures: ["重新画的图"] })
})

test("一张也没有画出时仍有结束时限", async () => {
  const receipts = createInspectionReceipts(1, "look", { overallMs: 30, finalizingMs: 5 })
  const canceled = Promise.withResolvers<void>()
  const first = await receipts.start("p/r/t", async (progress, signal) => {
    progress(0, 3)
    signal.addEventListener("abort", () => canceled.resolve(), { once: true })
    await canceled.promise
    signal.throwIfAborted()
    return {}
  })
  expect(first.rendering).toMatchObject({ done: 0, total: 3 })
  await canceled.promise
  await Bun.sleep(0)
  expect(() => receipts.poll("p/r/t", (first.rendering as { id: string }).id)).toThrow("看图超时")
})

test("别的任务取满新回执以后原窗口仍能取回图", async () => {
  const receipts = createInspectionReceipts(1, "look")
  const finish = Promise.withResolvers<{ picture: string }>()
  const issue = (scope: string) => receipts.start(scope, () => finish.promise)
  const first = await issue("original/r/t")
  await Promise.all(Array.from({ length: 25 }, () => issue("another/r/t")))
  finish.resolve({ picture: "画好了" })
  await Bun.sleep(0)
  expect(receipts.poll("original/r/t", (first.rendering as { id: string }).id)).toEqual({ picture: "画好了" })
})

test("取消画图会释放当前画图窗口并跳过排队中已取消的请求", async () => {
  const started = Promise.withResolvers<void>()
  const draws: string[] = []
  let released = 0
  const render = lookQueue(async (job) => {
    const label = job.sheets[0]!.label
    draws.push(label)
    if (label === "当前") {
      started.resolve()
      await new Promise<never>(() => undefined)
    }
    return { ok: true, pictures: [] }
  }, { timeoutMs: 1_000, giveUp: () => { released++ } })
  const job = (label: string): LookJob => ({ scenes: [], sheets: [{ label, columns: 1, cell: [1, 1], cells: [] }] })
  const drawing = new AbortController()
  const waiting = new AbortController()
  const first = render(job("当前"), undefined, drawing.signal)
  const second = render(job("排队"), undefined, waiting.signal)
  const third = render(job("下一张"))
  await started.promise
  waiting.abort()
  drawing.abort()
  expect((await first).ok).toBe(false)
  expect((await second).ok).toBe(false)
  expect((await third).ok).toBe(true)
  expect(released).toBe(1)
  expect(draws).toEqual(["当前", "下一张"])
})
