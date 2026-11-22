import { expect, test } from "bun:test"
import { PARALLEL_WORDS, parallelPlan, PROJECT_RUN_LIMITS } from "../src/workspace-runs"

type State = "queued" | "running" | "completed" | "saving" | "failed"
const task = (key: string, state: State, dependencies: string[] = []) => ({ id: `id-${key}`, key, title: `任务${key}`, module: "block" as const, state, dependencies })
const run = (tasks: ReturnType<typeof task>[], state: "running" | "completed" = "running") => ({ state, tasks })

test("现在能领的任务：依赖都已提交的，不超过空位，拖住别的任务最多的排在前面", () => {
  // d and e wait for c; c waits for a; b stands alone. a holds up c, d, e; b holds up nothing.
  const plan = parallelPlan(run([task("b", "queued"), task("a", "queued"), task("c", "queued", ["a"]), task("d", "queued", ["c"]), task("e", "queued", ["c"])]))
  expect(plan.limit).toBe(PROJECT_RUN_LIMITS.parallel)
  expect(plan.free).toBe(PROJECT_RUN_LIMITS.parallel)
  expect(plan.ready_now.map((value) => value.key)).toEqual(["a", "b"])
  expect(plan.waiting.map((value) => [value.key, value.waits_for])).toEqual([["c", ["任务a"]], ["d", ["任务c"]], ["e", ["任务c"]]])
  expect(plan.claimed).toEqual([])
})

test("空位按手上的任务数算：占着的不能再领，能领而没有空位的另列出来", () => {
  const many = ["a", "b", "c", "d"].map((key) => task(key, "queued"))
  const plan = parallelPlan(run([task("x", "running"), ...many]))
  expect(plan.free).toBe(PROJECT_RUN_LIMITS.parallel - 1)
  expect(plan.claimed.map((value) => value.key)).toEqual(["x"])
  expect(plan.ready_now).toHaveLength(PROJECT_RUN_LIMITS.parallel - 1)
  expect(plan.ready_later).toHaveLength(many.length - (PROJECT_RUN_LIMITS.parallel - 1))
  // A task being saved holds its place too.
  expect(parallelPlan(run([task("x", "saving"), task("y", "running"), task("z", "running"), task("a", "queued")])).ready_now).toEqual([])
})

test("依赖提交以后任务才变得能领；没在运行的运行什么都不给", () => {
  const before = parallelPlan(run([task("a", "running"), task("c", "queued", ["a"])]))
  expect(before.ready_now).toEqual([])
  expect(before.waiting[0]).toMatchObject({ key: "c", waits_for: ["任务a"] })
  expect(parallelPlan(run([task("a", "completed"), task("c", "queued", ["a"])])).ready_now.map((value) => value.key)).toEqual(["c"])
  expect(parallelPlan(run([task("a", "completed"), task("c", "queued", ["a"])], "completed")).ready_now).toEqual([])
})

test("说给外部 AI 的话：能领的全部在同一轮领下来，等评审的时候去做别的；数字来自上限", () => {
  const plan = parallelPlan(run([task("a", "queued"), task("b", "queued"), task("c", "queued", ["a"])]))
  const batch = PARALLEL_WORDS.batch(plan)
  expect(batch).toContain("「任务a」「任务b」")
  expect(batch).toContain("在同一轮里同时调用 2 次 claim_task")
  expect(batch).toContain(PARALLEL_WORDS.meanwhile)
  expect(batch).toContain(`始终有 ${PROJECT_RUN_LIMITS.parallel} 个在做`)
  const after = parallelPlan(run([task("a", "completed"), task("b", "running"), task("c", "queued", ["a"])]))
  expect(PARALLEL_WORDS.after(after, { state: "running" })).toContain("「任务c」")
  expect(PARALLEL_WORDS.after(after, { state: "completed" })).toContain("next_batch")
  expect(PARALLEL_WORDS.after(parallelPlan(run([task("b", "running")])), { state: "running" })).toContain("手上还有 1 个在做")
})
