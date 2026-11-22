import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { nextBlueprintBatch, validateBlueprint } from "../src/blueprint"
import { BLUEPRINT_ATTEMPTS, blockingAssets, isRedoRun, nextProductionBatch, redoneBefore, productionState, readProduction, writeProduction, type ProductionInput } from "../src/blueprint-production"
import { createProject } from "../src/project"
import { RunTaskSchema } from "../src/workspace-runs"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const id = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`
const time = (minute: number) => `2026-10-01T00:${String(minute).padStart(2, "0")}:00.000Z`
const entry = (key: string, kind: string, needs: string[] = [], asset_id: string | null = null) => ({ key, kind, title: `「${key}」`, brief: key, owner: null, needs, asset_id, out_of_scope: null })
// A creature chain, plus one item nothing depends on and one entry that is never made.
const blueprint = validateBlueprint(
  {
    revision: 3, request: "做一只狐狸和一个果子", state: "confirmed", style: { palette: [], shape: "", naming: "", world: "" }, questions: [],
    entries: [
      entry("fox_model", "model"),
      entry("fox_skin", "texture", ["fox_model"]),
      entry("fox", "entity", ["fox_model", "fox_skin"]),
      entry("berry", "item"),
      { ...entry("lore", "worldview"), out_of_scope: "只能存成设计稿" },
    ],
  },
  "fabric-1.21.1",
)
const task = (key: string, state: string, extra: Record<string, unknown> = {}) =>
  RunTaskSchema.parse({ key, module: blueprint.entries.find((value) => value.key === key)!.kind, title: key, prompt: key, source: `blueprint:${key}`, dependencies: [], target_id: null, id: crypto.randomUUID(), asset_id: crypto.randomUUID(), state, detail: "细节", error: null, started_at: null, finished_at: null, ...extra })
const run = (state: string, minute: number, tasks: ReturnType<typeof task>[]) => ({ state, created_at: time(minute), tasks }) as ProductionInput["runs"][number]
const input = (extra: Partial<ProductionInput> = {}): ProductionInput => ({ blueprint, assets: [], runs: [], record: null, ...extra })
const made = (...keys: string[]) => ({ ...blueprint, entries: blueprint.entries.map((value, index) => (keys.includes(value.key) ? { ...value, asset_id: id(index + 1) } : value)) })
const assets = [1, 2, 3, 4].map((n) => ({ id: id(n) }))

test("skipped entries are never started, and neither is anything that needs them", () => {
  expect(nextBlueprintBatch(blueprint, [], ["fox_model"])!.tasks.map((value) => value.key)).toEqual(["berry"])
  expect(nextBlueprintBatch(blueprint, ["fox_model"], ["fox_skin"])!.tasks.map((value) => value.key)).toEqual(["berry"])
  expect(nextBlueprintBatch(blueprint, ["berry"], ["fox_model"])).toBeNull()
})

test("nothing made yet: everything that will be made is waiting and the first batch is in dependency order", () => {
  expect(productionState(input())).toEqual({ saved: [], failed: [], blocked: [], waiting: ["fox_model", "fox_skin", "fox", "berry"], live: false })
  expect(nextProductionBatch(input())!.tasks.map((value) => [value.key, value.dependencies])).toEqual([["fox_model", []], ["fox_skin", ["fox_model"]], ["fox", ["fox_model", "fox_skin"]], ["berry", []]])
})

test("saved means the linked asset exists; a link to a deleted asset is made again as new", () => {
  const linked = made("fox_model", "berry")
  expect(productionState(input({ blueprint: linked, assets })).saved).toEqual(["fox_model", "berry"])
  expect(nextProductionBatch(input({ blueprint: linked, assets }))!.tasks.map((value) => [value.key, value.dependencies])).toEqual([["fox_skin", []], ["fox", ["fox_skin"]]])
  const gone = input({ blueprint: linked, assets: [{ id: id(4) }] })
  expect(productionState(gone).saved).toEqual(["berry"])
  expect(nextProductionBatch(gone)!.tasks.find((value) => value.key === "fox_model")!.target_id).toBeNull()
})

test("one failure leaves an entry waiting for its retry; the second makes it failed and blocks what needs it", () => {
  expect(BLUEPRINT_ATTEMPTS).toBe(2)
  const once = [run("partial", 1, [task("fox_model", "failed", { error: "第一次没做好" }), task("fox_skin", "blocked"), task("fox", "blocked"), task("berry", "completed")])]
  const first = input({ blueprint: made("berry"), assets, runs: once })
  expect(productionState(first)).toMatchObject({ saved: ["berry"], failed: [], blocked: [], waiting: ["fox_model", "fox_skin", "fox"] })
  expect(nextProductionBatch(first)!.tasks.map((value) => value.key)).toEqual(["fox_model", "fox_skin", "fox"])

  const twice = [...once, run("failed", 2, [task("fox_model", "failed", { error: "第二次也没做好" }), task("fox_skin", "blocked"), task("fox", "blocked")])]
  const second = input({ blueprint: made("berry"), assets, runs: twice })
  expect(productionState(second)).toMatchObject({
    failed: [{ key: "fox_model", reason: "第二次也没做好" }],
    // The creature is two steps away from the failure and still names it.
    blocked: [{ key: "fox_skin", by: ["fox_model"] }, { key: "fox", by: ["fox_model"] }],
    waiting: [],
  })
  expect(nextProductionBatch(second)).toBeNull()
  // What does not depend on the failure carries on.
  expect(nextProductionBatch(input({ runs: twice }))!.tasks.map((value) => value.key)).toEqual(["berry"])
})

test("a task that was held up, cut off or cancelled is not a failed try", () => {
  const runs = [
    run("interrupted", 1, [task("berry", "blocked", { detail: "进程中断，未继续执行。" })]),
    run("canceled", 2, [task("berry", "canceled")]),
    run("partial", 3, [task("berry", "blocked")]),
  ]
  expect(productionState(input({ runs }))).toMatchObject({ failed: [], waiting: ["fox_model", "fox_skin", "fox", "berry"] })
})

test("an entry saved after failing is saved, and only tries since this revision was confirmed count", () => {
  const runs = [run("failed", 1, [task("berry", "failed", { error: "一" })]), run("failed", 2, [task("berry", "failed", { error: "二" })])]
  expect(productionState(input({ runs })).failed).toEqual([{ key: "berry", reason: "二" }])
  expect(productionState(input({ blueprint: made("berry"), assets, runs }))).toMatchObject({ saved: ["berry"], failed: [] })
  const record = { schema_version: 1 as const, blueprint_revision: 3, since: time(2), note: null, updated_at: time(2) }
  expect(productionState(input({ runs, record })).failed).toEqual([])
  // A record left over from another revision says nothing about this one.
  expect(productionState(input({ runs, record: { ...record, blueprint_revision: 2, since: time(5) } })).failed).toHaveLength(1)
})

test("a batch still being worked on is reported as live", () => {
  expect(productionState(input({ runs: [run("running", 1, [task("berry", "running")])] })).live).toBe(true)
  expect(productionState(input({ runs: [run("completed", 1, [task("berry", "completed")])] })).live).toBe(false)
  expect(productionState(input({ runs: [run("running", 1, [task("berry", "running", { source: "做一个果子" })])] })).live).toBe(false)
})

test("the production record survives a restart, restarts its count on confirmation and tolerates a damaged file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mod-core-production-"))
  directories.push(root)
  const directory = path.join(root, "project")
  await createProject({ directory, name: "记录", description: "" })
  expect(await readProduction(directory)).toBeNull()
  const first = await writeProduction(directory, { blueprint_revision: 1, note: null, restart: true })
  await Bun.sleep(5)
  const noted = await writeProduction(directory, { blueprint_revision: 1, note: "暂停了" })
  expect(noted).toMatchObject({ since: first.since, note: "暂停了" })
  expect(await readProduction(directory)).toEqual(noted)
  expect((await writeProduction(directory, { blueprint_revision: 1, note: null, restart: true })).since > first.since).toBe(true)
  expect((await writeProduction(directory, { blueprint_revision: 2, note: null })).since > first.since).toBe(true)
  await writeFile(path.join(directory, ".minemods", "production.json"), "{ not json")
  expect(await readProduction(directory)).toBeNull()
})

// B18-J-03: what a batch in hand stands on may be made again now; anything else waits for the batch to end.
test("what a live batch stands on: the saved things its unfinished tasks use, through the run's dependencies and through the plan", () => {
  const saved = made("fox_model", "fox_skin", "berry")
  const modelAsset = saved.entries.find((value) => value.key === "fox_model")!.asset_id!
  const skinAsset = saved.entries.find((value) => value.key === "fox_skin")!.asset_id!
  const berryAsset = saved.entries.find((value) => value.key === "berry")!.asset_id!
  // The fox is not made yet. Its model and skin were saved by earlier batches, so the run lists no dependency for it at all: the plan says what it needs.
  const live = run("running", 1, [task("fox", "running")])
  expect(blockingAssets([live], saved).sort()).toEqual([modelAsset, skinAsset].sort())
  // The berry is saved and nothing unfinished uses it: it waits for the batch like any redo.
  expect(blockingAssets([live], saved)).not.toContain(berryAsset)
  // Through the run: a task of the same batch that is finished, however far back (the skin stands on the model).
  const sameBatch = run("running", 1, [task("fox_model", "completed"), task("fox_skin", "completed", { dependencies: ["fox_model"] }), task("fox", "queued", { dependencies: ["fox_skin"] })])
  expect(new Set(blockingAssets([sameBatch]))).toEqual(new Set([sameBatch.tasks[0]!.asset_id, sameBatch.tasks[1]!.asset_id]))
  // A batch that is over holds nothing, and a task that is finished stands on nothing.
  expect(blockingAssets([run("completed", 1, [task("fox", "completed")])], saved)).toEqual([])
  expect(blockingAssets([run("running", 1, [task("fox", "failed")])], saved)).toEqual([])
})

test("a task is not handed in before the redo of what it stands on: only redo runs count, only while they are being made", () => {
  const saved = made("fox_model", "fox_skin")
  const modelAsset = saved.entries.find((value) => value.key === "fox_model")!.asset_id!
  const fox = task("fox", "running")
  const batch = run("running", 1, [fox])
  const redoTask = task("fox_model", "queued", { asset_id: modelAsset })
  const redo = { ...run("running", 2, [redoTask]), summary: "按玩家的意见重做 1 项内容。" }
  expect(isRedoRun(redo)).toBe(true)
  expect(redoneBefore([redo], batch, fox, saved).map((value) => value.key)).toEqual(["fox_model"])
  // Once the redo has been handed in, or its run is over, the task is free.
  expect(redoneBefore([{ ...redo, tasks: [{ ...redoTask, state: "completed" as const }] }], batch, fox, saved)).toEqual([])
  expect(redoneBefore([{ ...redo, state: "canceled" }], batch, fox, saved)).toEqual([])
  // A run that is not a redo run (an ordinary batch) never holds a task back, and neither does the redo of something the task does not use.
  expect(redoneBefore([{ ...redo, summary: "按蓝图这一批做 1 项" }], batch, fox, saved)).toEqual([])
  expect(redoneBefore([redo], batch, task("berry", "running"), saved)).toEqual([])
})
